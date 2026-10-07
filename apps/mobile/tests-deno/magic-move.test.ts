/**
 * Hermetic tests for lib/motion/magicMove.ts (3e, M1 row -> sheet shared
 * element). Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { interpolateRect, magicMoveReducer, type Rect } from '../lib/motion/magicMove.ts';

const FROM: Rect = { x: 0, y: 100, width: 50, height: 20 };
const TO: Rect = { x: 20, y: 0, width: 100, height: 40 };

Deno.test('interpolateRect: t=0 is exactly the start rect', () => {
  assertEquals(interpolateRect(FROM, TO, 0), FROM);
});

Deno.test('interpolateRect: t=1 is exactly the end rect', () => {
  assertEquals(interpolateRect(FROM, TO, 1), TO);
});

Deno.test('interpolateRect: t=0.5 is the midpoint on every field', () => {
  assertEquals(interpolateRect(FROM, TO, 0.5), { x: 10, y: 50, width: 75, height: 30 });
});

Deno.test('interpolateRect: t outside 0..1 clamps, never overshoots', () => {
  assertEquals(interpolateRect(FROM, TO, -0.5), FROM);
  assertEquals(interpolateRect(FROM, TO, 1.5), TO);
});

Deno.test('magicMoveReducer: a tap starts the flight from idle only', () => {
  assertEquals(magicMoveReducer('idle', { type: 'ROW_TAPPED' }), 'flying');
  assertEquals(magicMoveReducer('flying', { type: 'ROW_TAPPED' }), 'flying');
  assertEquals(magicMoveReducer('handed_off', { type: 'ROW_TAPPED' }), 'handed_off');
});

Deno.test('magicMoveReducer: arrival hands off only while flying', () => {
  assertEquals(magicMoveReducer('flying', { type: 'ARRIVED' }), 'handed_off');
  assertEquals(magicMoveReducer('idle', { type: 'ARRIVED' }), 'idle');
  assertEquals(magicMoveReducer('handed_off', { type: 'ARRIVED' }), 'handed_off');
});

Deno.test('magicMoveReducer: RESET returns to idle from any stage', () => {
  assertEquals(magicMoveReducer('idle', { type: 'RESET' }), 'idle');
  assertEquals(magicMoveReducer('flying', { type: 'RESET' }), 'idle');
  assertEquals(magicMoveReducer('handed_off', { type: 'RESET' }), 'idle');
});

// DL gate checklist: "if the measure fails or a frame drops, the sheet still opens in
// place." startTransition is the one decision point for that -- test it directly.
import { startTransition } from '../lib/motion/magicMove.ts';

Deno.test('startTransition: a null rect (measure failed) yields no transition', () => {
  assertEquals(startTransition('AAPL', 'Apple', null), null);
});

Deno.test('startTransition: a real rect starts the flight with the row\'s symbol and name', () => {
  const rect = { x: 10, y: 20, width: 100, height: 40 };
  assertEquals(startTransition('AAPL', 'Apple', rect), { symbol: 'AAPL', name: 'Apple', fromRect: rect });
});

Deno.test('startTransition: a null name (unknown company) still starts the flight', () => {
  const rect = { x: 0, y: 0, width: 50, height: 20 };
  assertEquals(startTransition('XYZ', null, rect), { symbol: 'XYZ', name: null, fromRect: rect });
});
