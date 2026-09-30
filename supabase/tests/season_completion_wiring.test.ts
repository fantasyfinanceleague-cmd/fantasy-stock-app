/**
 * Structural guard for the F-B season-completion heal (see CLAUDE.md "Success
 * signals" #5, F-B instance, and process-week-results/season-completion.ts).
 *
 * The decision/rpc logic is unit-tested without a DB in
 * process-week-results/season-completion.test.ts and against real Postgres in
 * season_completion_heal.pglite.test.ts. Neither of those imports index.ts, so
 * neither would notice if index.ts stopped CALLING healUncompletedSeasons, or
 * if the old fire-and-forget completeSeasonFromPlayoffs (logs `{ error }`,
 * never checks it — the exact bug) came back. This file reads index.ts as
 * TEXT and checks the wiring itself:
 *   1. healUncompletedSeasons is called BEFORE the pending-matchup query, so
 *      it also runs on the "no pending matchups" early return -- the path a
 *      stranded league (final scored, season never completed) takes every
 *      week thereafter;
 *   2. the in-loop finals-completion call site uses completeLeagueSeason
 *      (which checks `{ error }`), not the old completeSeasonFromPlayoffs.
 *
 * Reads files only (no network, no DB), same pattern and same reason as
 * draft_insert_sites.test.ts: keeping this OUT of supabase/functions/ is what
 * keeps `deno test supabase/functions/` hermetic with no --allow-* flags
 * (CLAUDE.md, supabase/tests/README.md). Run with:
 *   deno test --allow-read supabase/tests/season_completion_wiring.test.ts
 */
import { assert } from 'jsr:@std/assert';

const INDEX = new URL('../functions/process-week-results/index.ts', import.meta.url);

Deno.test('index.ts: the season-completion heal runs before the pending-matchup query, and the old fire-and-forget call site is gone', async () => {
  const src = await Deno.readTextFile(INDEX);

  const healCall = src.indexOf('healUncompletedSeasons(supabase, leagueIdFilter)');
  assert(healCall >= 0, 'healUncompletedSeasons is not called in index.ts');

  const pendingQuery = src.indexOf(".from('matchups')\n      .select(`\n        id,");
  assert(pendingQuery >= 0, 'could not locate the pending-matchup query (index.ts restructured?)');

  assert(
    healCall < pendingQuery,
    'healUncompletedSeasons must run BEFORE the pending-matchup query, so it also runs on the ' +
      '"no pending matchups" early return -- the exact path a stranded league takes every week',
  );

  const completionCall = src.indexOf('completeLeagueSeason(supabase, leagueId, finalsWinner, loserId)');
  assert(completionCall >= 0, 'completeLeagueSeason is not called at the in-loop finals-completion site');

  assert(
    !src.includes('completeSeasonFromPlayoffs'),
    'the old fire-and-forget completeSeasonFromPlayoffs (logs { error }, never checks it) has come back',
  );

  // The completion outcome must be CHECKED, not just called: an `await
  // completeLeagueSeason(...)` with nothing reading its result would silently
  // recreate the bug one line down from the fix.
  assert(
    /const\s+completion\s*=\s*await completeLeagueSeason/.test(src),
    'completeLeagueSeason\'s result is not captured -- its { ok, reason } must be checked, not discarded',
  );
});
