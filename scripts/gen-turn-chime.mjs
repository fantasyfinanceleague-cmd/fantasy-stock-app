#!/usr/bin/env node
// The your-turn chime (3c-2; the Design Lead's your-turn spec: "one short
// chime, under 0.5 s", judged at the gate as short and not alarming). Made
// here, from math, so it's ours and reproducible: never a downloaded sound.
//
// A soft rising two-note sine (G5 then C6, a perfect fourth) with a touch of
// second harmonic for warmth, a 6 ms attack and an exponential decay per note,
// a fade to silence at the end, peak about -7 dBFS. 44.1 kHz, 16-bit mono PCM WAV.
//
// Run: node scripts/gen-turn-chime.mjs   (writes apps/mobile/assets/sounds/your-turn.wav)
// The test (apps/mobile/tests-deno/turn-chime.test.ts) checks the committed file
// is byte-for-byte what this script makes.

export const SAMPLE_RATE = 44100;
export const DURATION_S = 0.42;

const NOTES = [
  { hz: 783.99, startS: 0.0 }, // G5
  { hz: 1046.5, startS: 0.12 }, // C6
];
const ATTACK_S = 0.006;
const DECAY_TAU_S = 0.085;
const HARMONIC = 0.15; // second-harmonic level, relative to the fundamental
const PEAK = 0.45; // linear, about -7 dBFS
const END_FADE_S = 0.03;

/** The chime's samples, -1..1. */
export function chimeSamples() {
  const n = Math.round(SAMPLE_RATE * DURATION_S);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let v = 0;
    for (const note of NOTES) {
      const tn = t - note.startS;
      if (tn < 0) continue;
      const env = (tn < ATTACK_S ? tn / ATTACK_S : 1) * Math.exp(-Math.max(0, tn - ATTACK_S) / DECAY_TAU_S);
      v += env * (Math.sin(2 * Math.PI * note.hz * tn) + HARMONIC * Math.sin(4 * Math.PI * note.hz * tn));
    }
    const fade = t > DURATION_S - END_FADE_S ? Math.max(0, (DURATION_S - t) / END_FADE_S) : 1;
    out[i] = v * fade;
  }
  // Normalise to the peak.
  let max = 0;
  for (const s of out) max = Math.max(max, Math.abs(s));
  for (let i = 0; i < n; i++) out[i] = (out[i] / max) * PEAK;
  return out;
}

/** The chime as a 16-bit mono PCM WAV file. */
export function chimeWav() {
  const samples = chimeSamples();
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  }
  return new Uint8Array(buf);
}

// CLI: write the file (Node only; the test imports the functions above).
if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const out = join(root, 'apps/mobile/assets/sounds/your-turn.wav');
  mkdirSync(dirname(out), { recursive: true });
  const wav = chimeWav();
  writeFileSync(out, wav);
  console.log(`wrote ${out} (${wav.length} bytes, ${DURATION_S}s)`);
}
