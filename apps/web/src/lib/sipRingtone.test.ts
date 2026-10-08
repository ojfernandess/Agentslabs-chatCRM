import assert from "node:assert/strict";
import test from "node:test";
import { SIP_RINGTONE_IDS, normalizeSipRingtone, sipRingtoneProfile } from "./sipRingtone.js";

test("normalizeSipRingtone keeps the current beep unless a known tone is selected", () => {
  assert.equal(normalizeSipRingtone(undefined), "classic");
  assert.equal(normalizeSipRingtone("nope"), "classic");
  assert.equal(normalizeSipRingtone("bright"), "bright");
  assert.equal(normalizeSipRingtone("pulse"), "pulse");
  assert.equal(normalizeSipRingtone("bell"), "bell");
  assert.equal(normalizeSipRingtone("urgent"), "urgent");
});

test("each ringtone keeps its pitch and repeats near full level", () => {
  const expected: Record<string, { intervalMs: number; frequencies: number[]; minGain: number }> = {
    classic: { intervalMs: 1600, frequencies: [440], minGain: 0.9 },
    bright: { intervalMs: 1800, frequencies: [880, 988], minGain: 0.9 },
    soft: { intervalMs: 2000, frequencies: [523], minGain: 0.8 },
    pulse: { intervalMs: 1400, frequencies: [660, 660, 660], minGain: 0.9 },
    bell: { intervalMs: 2200, frequencies: [480, 620], minGain: 0.45 },
    digital: { intervalMs: 1500, frequencies: [740, 880, 740], minGain: 0.9 },
    chime: { intervalMs: 2400, frequencies: [523, 659, 784], minGain: 0.85 },
    urgent: { intervalMs: 1000, frequencies: [988, 988, 988, 784], minGain: 0.9 },
  };
  assert.deepEqual([...SIP_RINGTONE_IDS], Object.keys(expected));
  for (const id of SIP_RINGTONE_IDS) {
    const profile = sipRingtoneProfile(id);
    const want = expected[id];
    assert.equal(profile.id, id);
    assert.equal(profile.intervalMs, want.intervalMs);
    assert.deepEqual(profile.frequencies, want.frequencies);
    assert.ok(profile.gains.every((gain) => gain >= want.minGain && gain <= 0.95));
    if (id === "bell") assert.ok(profile.gains.every((gain) => gain <= 0.5));
  }
});
