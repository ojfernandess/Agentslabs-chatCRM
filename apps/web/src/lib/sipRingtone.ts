export const SIP_RINGTONE_IDS = ["classic", "bright", "soft", "pulse", "bell", "digital", "chime", "urgent"] as const;

export type SipRingtoneId = (typeof SIP_RINGTONE_IDS)[number];

type SipTone = { frequency: number; start: number; duration: number; gain: number };

/**
 * O ganho é o nível sustentado, não um pico que decai.
 * O sino usa duas vozes ao mesmo tempo, então cada uma fica mais baixa para a soma não distorcer.
 */
const PATTERNS: Record<SipRingtoneId, { intervalMs: number; tones: SipTone[] }> = {
  classic: { intervalMs: 1600, tones: [{ frequency: 440, start: 0, duration: 0.35, gain: 0.92 }] },
  bright: {
    intervalMs: 1800,
    tones: [
      { frequency: 880, start: 0, duration: 0.18, gain: 0.92 },
      { frequency: 988, start: 0.24, duration: 0.18, gain: 0.92 },
    ],
  },
  soft: { intervalMs: 2000, tones: [{ frequency: 523, start: 0, duration: 0.5, gain: 0.82 }] },
  pulse: {
    intervalMs: 1400,
    tones: [
      { frequency: 660, start: 0, duration: 0.12, gain: 0.92 },
      { frequency: 660, start: 0.2, duration: 0.12, gain: 0.92 },
      { frequency: 660, start: 0.4, duration: 0.12, gain: 0.92 },
    ],
  },
  bell: {
    intervalMs: 2200,
    tones: [
      { frequency: 480, start: 0, duration: 0.9, gain: 0.48 },
      { frequency: 620, start: 0, duration: 0.9, gain: 0.48 },
    ],
  },
  digital: {
    intervalMs: 1500,
    tones: [
      { frequency: 740, start: 0, duration: 0.14, gain: 0.92 },
      { frequency: 880, start: 0.2, duration: 0.14, gain: 0.92 },
      { frequency: 740, start: 0.4, duration: 0.14, gain: 0.92 },
    ],
  },
  chime: {
    intervalMs: 2400,
    tones: [
      { frequency: 523, start: 0, duration: 0.22, gain: 0.9 },
      { frequency: 659, start: 0.2, duration: 0.22, gain: 0.9 },
      { frequency: 784, start: 0.4, duration: 0.32, gain: 0.9 },
    ],
  },
  urgent: {
    intervalMs: 1000,
    tones: [
      { frequency: 988, start: 0, duration: 0.1, gain: 0.95 },
      { frequency: 988, start: 0.16, duration: 0.1, gain: 0.95 },
      { frequency: 988, start: 0.32, duration: 0.1, gain: 0.95 },
      { frequency: 784, start: 0.48, duration: 0.16, gain: 0.95 },
    ],
  },
};

const RING_AHEAD_SEC = 45;

export function normalizeSipRingtone(value: unknown): SipRingtoneId {
  return SIP_RINGTONE_IDS.includes(value as SipRingtoneId) ? (value as SipRingtoneId) : "classic";
}

export function sipRingtoneProfile(value: unknown): {
  id: SipRingtoneId;
  intervalMs: number;
  frequencies: number[];
  gains: number[];
} {
  const id = normalizeSipRingtone(value);
  const pattern = PATTERNS[id];
  return {
    id,
    intervalMs: pattern.intervalMs,
    frequencies: pattern.tones.map((tone) => tone.frequency),
    gains: pattern.tones.map((tone) => tone.gain),
  };
}

let incomingRingCtx: AudioContext | null = null;
let incomingRingTimer: number | null = null;
let previewCtx: AudioContext | null = null;

export function stopSipRingtone(): void {
  if (incomingRingTimer != null) {
    window.clearInterval(incomingRingTimer);
    incomingRingTimer = null;
  }
  const ctx = incomingRingCtx;
  incomingRingCtx = null;
  void ctx?.close().catch(() => {});
}

/** Linear até o joelho; acima disso arredonda a soma de dois tons sem clipar. */
function softCeiling(ctx: AudioContext): WaveShaperNode {
  const samples = 1024;
  const knee = 0.9;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const shaped = ax <= knee ? ax : knee + (1 - knee) * Math.tanh((ax - knee) / (1 - knee));
    curve[i] = Math.sign(x) * Math.min(0.98, shaped);
  }
  const shaper = ctx.createWaveShaper();
  shaper.curve = curve;
  shaper.oversample = "2x";
  return shaper;
}

function ringOutput(ctx: AudioContext): GainNode {
  const master = ctx.createGain();
  master.gain.value = 1;
  const ceiling = softCeiling(ctx);
  master.connect(ceiling);
  ceiling.connect(ctx.destination);
  return master;
}

function playCycle(ctx: AudioContext, bus: AudioNode, id: SipRingtoneId, at: number): void {
  const pattern = PATTERNS[id];
  for (const tone of pattern.tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(tone.frequency, at);
    const start = at + tone.start;
    const attack = Math.min(0.012, tone.duration * 0.25);
    const release = Math.min(0.03, tone.duration * 0.3);
    const attackEnd = start + attack;
    const releaseAt = start + tone.duration;
    const hold = Math.max(attackEnd, releaseAt - release);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.gain, attackEnd);
    if (hold > attackEnd + 0.001) gain.gain.setValueAtTime(tone.gain, hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(start);
    osc.stop(releaseAt + 0.02);
  }
}

function scheduleRing(ctx: AudioContext, bus: AudioNode, id: SipRingtoneId): void {
  const step = PATTERNS[id].intervalMs / 1000;
  let nextAt = ctx.currentTime + 0.02;
  const fill = () => {
    if (incomingRingCtx !== ctx || ctx.state === "closed") return;
    if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.02;
    const horizon = ctx.currentTime + RING_AHEAD_SEC;
    while (nextAt < horizon) {
      try {
        playCycle(ctx, bus, id, nextAt);
      } catch {
        return;
      }
      nextAt += step;
    }
  };
  fill();
  incomingRingTimer = window.setInterval(fill, 15_000);
}

export function startSipRingtone(value: unknown): void {
  stopSipRingtone();
  const id = normalizeSipRingtone(value);
  const Ctx = window.AudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  incomingRingCtx = ctx;
  const bus = ringOutput(ctx);
  void ctx.resume().then(() => {
    if (incomingRingCtx !== ctx) return;
    scheduleRing(ctx, bus, id);
  }).catch(() => {});
}

export function previewSipRingtone(value: unknown): void {
  const id = normalizeSipRingtone(value);
  const Ctx = window.AudioContext;
  if (!Ctx) return;
  const previous = previewCtx;
  previewCtx = null;
  void previous?.close().catch(() => {});
  const ctx = new Ctx();
  previewCtx = ctx;
  const bus = ringOutput(ctx);
  void ctx.resume().then(() => {
    if (previewCtx !== ctx || ctx.state === "closed") return;
    playCycle(ctx, bus, id, ctx.currentTime + 0.02);
  }).catch(() => {});
  window.setTimeout(() => {
    if (previewCtx === ctx) previewCtx = null;
    void ctx.close().catch(() => {});
  }, PATTERNS[id].intervalMs);
}
