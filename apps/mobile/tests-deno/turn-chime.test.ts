/**
 * The your-turn chime (3c-2; Design Lead spec: "one short chime, under 0.5 s"):
 * our own sound, generated from math by scripts/gen-turn-chime.mjs, never
 * downloaded. The committed WAV must be byte-for-byte what the script makes.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import wavBytes from '../assets/sounds/your-turn.wav' with { type: 'bytes' };
import { DURATION_S, SAMPLE_RATE, chimeWav } from '../../../scripts/gen-turn-chime.mjs';

const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
const ascii = (off: number, len: number) => String.fromCharCode(...wavBytes.slice(off, off + len));

Deno.test('the committed chime is exactly what the script generates (reproducible, ours)', () => {
  const made = chimeWav() as Uint8Array;
  assertEquals(made.length, wavBytes.length);
  assertEquals(made.every((b, i) => b === wavBytes[i]), true);
});

Deno.test('a 16-bit mono 44.1 kHz PCM WAV, under 0.5 s', () => {
  assertEquals([ascii(0, 4), ascii(8, 4), ascii(12, 4), ascii(36, 4)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assertEquals(view.getUint16(20, true), 1); // PCM
  assertEquals(view.getUint16(22, true), 1); // mono
  assertEquals(view.getUint32(24, true), SAMPLE_RATE);
  assertEquals(view.getUint16(34, true), 16);
  const seconds = view.getUint32(40, true) / (SAMPLE_RATE * 2);
  assertEquals(Math.abs(seconds - DURATION_S) < 0.001, true);
  assertEquals(seconds < 0.5, true);
});

Deno.test('soft, not alarming: peak well under full scale, and it ends in silence', () => {
  let peak = 0;
  for (let off = 44; off < wavBytes.length; off += 2) peak = Math.max(peak, Math.abs(view.getInt16(off, true)));
  assertEquals(peak / 32767 < 0.5, true); // about -7 dBFS
  assertEquals(view.getInt16(wavBytes.length - 2, true), 0); // faded to zero: no click at the end
});
