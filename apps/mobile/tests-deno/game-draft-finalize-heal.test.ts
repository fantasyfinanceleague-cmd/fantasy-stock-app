/**
 * UX final sweep S-2 (P1, "every screen on the new UI"): the legacy app/(tabs)/draft.tsx
 * (light-only colours, "Error" alerts, raw reason codes, a manual Start) was still
 * reachable through the draft room's finalize hand-off and a fantasystockapp://draft
 * link. The heal now runs in the room: after the grace window the room asks the server
 * to finalize (idempotent, any member), and if that doesn't go through, Draft complete
 * keeps "Finishing the draft…" with Try again. The legacy route is a redirect to League.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { finalizeHealOutcome } from '../lib/game/draftComplete.ts';
import { SOURCES } from './sourceManifest.generated.ts';
import legacyRoute from '../app/(tabs)/draft.tsx' with { type: 'text' };

const ok = (body: Record<string, unknown>, reason: string | null = null) => ({ transport: false as const, status: null, reason, body });

Deno.test('what a finalize came to: finished, a stale read (re-read), or not finished (Try again)', () => {
  assertEquals(finalizeHealOutcome(ok({ ok: true, draft_complete: true, status_update_error: null })), 'finished');
  assertEquals(finalizeHealOutcome(ok({ ok: false, draft_complete: true, status_update_error: 'finalize failed' })), 'failed');
  assertEquals(finalizeHealOutcome(ok({ ok: false, reason: 'draft_not_complete' }, 'draft_not_complete')), 'reread');
  assertEquals(finalizeHealOutcome({ transport: true }), 'failed'); // no answer: never a guessed success
  assertEquals(finalizeHealOutcome(ok({ ok: false }, 'unhandled')), 'failed');
});

Deno.test('the room finalizes itself once, then offers Try again inside Draft complete (source guards)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assert(room.includes("await seamInvoke('validate-and-record-pick', { body: { league_id: leagueId, action: 'finalize' } });"));
  assert(room.includes('const outcome = finalizeHealOutcome(await readFunctionRefusal(data, error));'));
  assert(room.includes('finishFailed={finishFailed && !finished}'));
  assert(room.includes('onRetryFinish={() => void finishDraft()}'));
  assert(!room.includes("'/(tabs)/draft'"));
  const view = SOURCES['components/game/DraftComplete.tsx'];
  assert(view.includes("{!finished && finishFailed && onRetryFinish ? ("));
  assert(view.includes('<Button label="Try again" variant="secondary" size="sm" onPress={onRetryFinish}'));
});

Deno.test('the legacy draft route is only a redirect to League, and nothing links to it', () => {
  assert(legacyRoute.includes('<Redirect href="/(tabs)/league" />'));
  assert(!legacyRoute.includes('draft-control'), 'no manual Start path');
  assert(!legacyRoute.includes("action: 'start'"));
  for (const [path, src] of Object.entries(SOURCES)) {
    assert(!/router\.(push|replace|navigate)\(\s*['"]\/(\(tabs\)\/)?draft['"]/.test(src), `${path} navigates to the legacy draft route`);
    assert(!/href=["']\/(\(tabs\)\/)?draft["']/.test(src), `${path} links to the legacy draft route`);
  }
});
