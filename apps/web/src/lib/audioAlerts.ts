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

