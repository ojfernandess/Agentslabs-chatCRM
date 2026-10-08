export const SIP_RINGTONE_IDS = ["classic", "bright", "soft", "pulse"] as const;

export type SipRingtoneId = (typeof SIP_RINGTONE_IDS)[number];

type SipTone = { frequency: number; start: number; duration: number; gain: number };

const PATTERNS: Record<SipRingtoneId, { intervalMs: number; tones: SipTone[] }> = {
  classic: { intervalMs: 1600, tones: [{ frequency: 440, start: 0, duration: 0.35, gain: 0.05 }] },
  bright: {
    intervalMs: 1800,
    tones: [
      { frequency: 880, start: 0, duration: 0.18, gain: 0.05 },
      { frequency: 988, start: 0.24, duration: 0.18, gain: 0.05 },
    ],
  },
  soft: { intervalMs: 2000, tones: [{ frequency: 523, start: 0, duration: 0.5, gain: 0.03 }] },
  pulse: {
    intervalMs: 1400,
    tones: [
      { frequency: 660, start: 0, duration: 0.12, gain: 0.05 },
      { frequency: 660, start: 0.2, duration: 0.12, gain: 0.05 },
      { frequency: 660, start: 0.4, duration: 0.12, gain: 0.05 },
    ],
  },
};

export function normalizeSipRingtone(value: unknown): SipRingtoneId {
  return SIP_RINGTONE_IDS.includes(value as SipRingtoneId) ? (value as SipRingtoneId) : "classic";
}

let incomingRingTimer: number | null = null;
let incomingRingCtx: AudioContext | null = null;

export function stopSipRingtone(): void {
  if (incomingRingTimer != null) {
    window.clearInterval(incomingRingTimer);
    incomingRingTimer = null;
  }
  const ctx = incomingRingCtx;
  incomingRingCtx = null;
  void ctx?.close().catch(() => {});
}

function playCycle(ctx: AudioContext, id: SipRingtoneId): void {
  const pattern = PATTERNS[id];
  for (const tone of pattern.tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = tone.frequency;
    const start = ctx.currentTime + tone.start;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + tone.duration + 0.05);
  }
}

export function startSipRingtone(value: unknown): void {
  stopSipRingtone();
  const id = normalizeSipRingtone(value);
  const Ctx = window.AudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  incomingRingCtx = ctx;
  const beep = () => {
    if (incomingRingCtx !== ctx) return;
    playCycle(ctx, id);
  };
  void ctx.resume().then(beep).catch(() => {});
  incomingRingTimer = window.setInterval(() => {
    void ctx.resume().then(beep).catch(() => {});
  }, PATTERNS[id].intervalMs);
}

export function previewSipRingtone(value: unknown): void {
  const id = normalizeSipRingtone(value);
  const Ctx = window.AudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const cycle = () => playCycle(ctx, id);
  void ctx.resume().then(cycle).catch(() => {});
  window.setTimeout(() => {
    void ctx.close().catch(() => {});
  }, PATTERNS[id].intervalMs);
}
