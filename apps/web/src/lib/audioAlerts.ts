import type { AudioAlertSoundPref } from "@/lib/profilePrefs";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  ctx = new Ctor();
  return ctx;
}

export async function unlockAudioAlerts() {
  try {
    const c = getCtx();
    if (c.state !== "running") await c.resume();
  } catch {
  }
}

type Step = { freq: number; dur: number; type: OscillatorType; gain: number; at: number };

function buildSteps(sound: Exclude<AudioAlertSoundPref, "none">): Step[] {
  if (sound === "ding") {
    return [{ freq: 880, dur: 0.12, type: "sine", gain: 0.8, at: 0 }];
  }
  if (sound === "ping") {
    return [{ freq: 1046, dur: 0.08, type: "triangle", gain: 0.7, at: 0 }];
  }
  if (sound === "bell") {
    return [
      { freq: 659, dur: 0.1, type: "sine", gain: 0.7, at: 0 },
      { freq: 988, dur: 0.16, type: "sine", gain: 0.55, at: 0.02 },
    ];
  }
  if (sound === "chime") {
    return [
      { freq: 523.25, dur: 0.12, type: "sine", gain: 0.65, at: 0 },
      { freq: 783.99, dur: 0.18, type: "sine", gain: 0.55, at: 0.08 },
    ];
  }
  return [
    { freq: 440, dur: 0.09, type: "sine", gain: 0.6, at: 0 },
    { freq: 659.25, dur: 0.09, type: "sine", gain: 0.55, at: 0.08 },
    { freq: 880, dur: 0.12, type: "sine", gain: 0.5, at: 0.16 },
  ];
}

export async function playAudioAlert(sound: AudioAlertSoundPref, volume = 0.9) {
  if (sound === "none") return;
  try {
    const c = getCtx();
    if (c.state !== "running") await c.resume();
    const t0 = c.currentTime;
    const master = c.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume));
    master.connect(c.destination);

    const steps = buildSteps(sound);
    for (const s of steps) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = s.type;
      osc.frequency.setValueAtTime(s.freq, t0 + s.at);

      const g0 = Math.max(0, Math.min(1, s.gain));
      gain.gain.setValueAtTime(0.0001, t0 + s.at);
      gain.gain.exponentialRampToValueAtTime(g0, t0 + s.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + s.at + s.dur);

      osc.connect(gain);
      gain.connect(master);
      osc.start(t0 + s.at);
      osc.stop(t0 + s.at + s.dur + 0.02);
    }
  } catch {
  }
}

let incomingRingGeneration = 0;
let incomingRingInterval: ReturnType<typeof setInterval> | null = null;
let incomingRingStopTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleTone(
  c: AudioContext,
  master: GainNode,
  t0: number,
  freq: number,
  at: number,
  dur: number,
  peakGain: number,
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t0 + at);
  gain.gain.setValueAtTime(0.0001, t0 + at);
  gain.gain.exponentialRampToValueAtTime(peakGain, t0 + at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0 + at);
  osc.stop(t0 + at + dur + 0.05);
}

async function playIncomingRingBurst(volume = 0.22): Promise<void> {
  const c = getCtx();
  if (c.state !== "running") await c.resume();
  const t0 = c.currentTime;
  const master = c.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume));
  master.connect(c.destination);
  scheduleTone(c, master, t0, 440, 0, 0.22, 0.85);
  scheduleTone(c, master, t0, 480, 0.26, 0.22, 0.85);
  scheduleTone(c, master, t0, 440, 0.55, 0.22, 0.85);
  scheduleTone(c, master, t0, 480, 0.81, 0.22, 0.85);
}

/** Stops the repeating Wavoip incoming-call ring. */
export function stopIncomingCallRing(): void {
  incomingRingGeneration += 1;
  if (incomingRingInterval) {
    clearInterval(incomingRingInterval);
    incomingRingInterval = null;
  }
  if (incomingRingStopTimer) {
    clearTimeout(incomingRingStopTimer);
    incomingRingStopTimer = null;
  }
}

/**
 * Repeating phone-style ring for inbound Wavoip calls.
 * Uses the shared AudioContext (must be unlocked via user gesture in Layout).
 */
/** Short alert when another call joins the queue while one is already ringing. */
export async function playIncomingCallQueuedPulse(volume = 0.28): Promise<void> {
  try {
    await unlockAudioAlerts();
    const c = getCtx();
    if (c.state !== "running") await c.resume();
    const t0 = c.currentTime;
    const master = c.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume));
    master.connect(c.destination);
    scheduleTone(c, master, t0, 880, 0, 0.1, 0.9);
    scheduleTone(c, master, t0, 660, 0.14, 0.12, 0.75);
  } catch {
    /* ignore */
  }
}

export async function playIncomingCallRing(): Promise<void> {
  try {
    await unlockAudioAlerts();
    if (incomingRingInterval) return;

    const gen = ++incomingRingGeneration;

    const tick = () => {
      if (gen !== incomingRingGeneration) return;
      void playIncomingRingBurst();
    };

    await playIncomingRingBurst();
    incomingRingInterval = setInterval(tick, 2400);

    incomingRingStopTimer = setTimeout(() => {
      if (gen === incomingRingGeneration) stopIncomingCallRing();
    }, 45_000);
  } catch {
    /* ignore */
  }
}

