/**
 * Hermetic tests for sp/PhaseChip's text (components/sp/logic/phaseChip.ts).
 * Design Lead ruling (Phase 3b-1): the PHASE decides the chip's style; an
 * optional `label` only overrides its text ("Week 6", "Draft Sat 7:00 PM ET",
 * "Final"). The tag type style uppercases it on screen.
 *
 *   cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { phaseChipStyle, phaseChipText, phaseChipUppercase, PHASE_LABELS } from '../components/sp/logic/phaseChip.ts';

Deno.test('phase chip: without a label, each phase shows its default text', () => {
  assertEquals(phaseChipText('live_open'), 'Live');
  assertEquals(phaseChipText('pre_draft'), 'Pre-draft');
  assertEquals(phaseChipText('season_complete'), 'Complete');
  assertEquals(Object.keys(PHASE_LABELS).length, 8);
});

Deno.test('phase chip: a label replaces the text only', () => {
  assertEquals(phaseChipText('live_open', 'Week 6'), 'Week 6');
  assertEquals(phaseChipText('season_complete', 'Final'), 'Final');
  assertEquals(phaseChipStyle('live_open'), 'live'); // still the live style (dot + liveText)
  assertEquals(phaseChipStyle('season_complete'), 'final');
});

Deno.test('phase chip: a blank label falls back to the default text', () => {
  assertEquals(phaseChipText('pre_draft', ''), 'Pre-draft');
  assertEquals(phaseChipText('pre_draft', '   '), 'Pre-draft');
});


Deno.test('phase chip: a custom label is sentence case; default phase text stays an uppercase tag', () => {
  assertEquals(phaseChipUppercase('Week 6'), false);
  assertEquals(phaseChipUppercase('Draft Sat 7:00 PM ET'), false);
  assertEquals(phaseChipUppercase(undefined), true);
  assertEquals(phaseChipUppercase('  '), true);
});
