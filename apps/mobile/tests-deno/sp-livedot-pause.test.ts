/**
 * The LiveDot pulse rule (§9B): it runs only when not reduced, the screen is
 * focused, and the app is active. Blur pauses it; background pauses it; return
 * or focus resumes it; Reduce Motion never runs it. Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { livePulseRunning } from '../components/sp/logic/livedot.ts';

const base = { reduced: false, focused: true, appActive: true };

Deno.test('a focused screen in an active app pulses', () => {
  assertEquals(livePulseRunning(base), true);
});

Deno.test('losing focus (navigation blur) pauses it', () => {
  assertEquals(livePulseRunning({ ...base, focused: false }), false);
});

Deno.test('the app going to the background pauses it', () => {
  assertEquals(livePulseRunning({ ...base, appActive: false }), false);
});

Deno.test('returning to focus or to the foreground resumes it', () => {
  assertEquals(livePulseRunning({ ...base, focused: false }), false);
  assertEquals(livePulseRunning({ ...base, focused: true }), true);
  assertEquals(livePulseRunning({ ...base, appActive: false }), false);
  assertEquals(livePulseRunning({ ...base, appActive: true }), true);
});

Deno.test('Reduce Motion never runs the pulse: a static dot', () => {
  assertEquals(livePulseRunning({ ...base, reduced: true }), false);
});
