/**
 * Hermetic tests for sp/Button's `status` prop (Phase 3b-1 foundation
 * addition): VoiceOver hears "Loading" while busy, and a loading or done
 * button can't be pressed again.
 *
 *   cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { buttonStatusA11y } from '../components/sp/logic/buttonStatus.ts';

Deno.test('button status: idle announces its label and is pressable unless disabled', () => {
  assertEquals(buttonStatusA11y('Sign in', 'idle', false), { label: 'Sign in', busy: false, pressable: true });
  assertEquals(buttonStatusA11y('Sign in', 'idle', true), { label: 'Sign in', busy: false, pressable: false });
});

Deno.test('button status: loading announces "Loading", is busy, and ignores presses', () => {
  assertEquals(buttonStatusA11y('Sign in', 'loading', false), { label: 'Loading', busy: true, pressable: false });
});

Deno.test('button status: done keeps its label and ignores presses (the action is already proceeding)', () => {
  assertEquals(buttonStatusA11y('Update password', 'done', false), { label: 'Update password', busy: false, pressable: false });
});
