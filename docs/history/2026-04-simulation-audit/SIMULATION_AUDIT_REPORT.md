# Simulation Audit Report

## 1. Re-run Results

**Command:** `node scripts/simulation-test-runner.mjs`
**Log path:** `logs/simulation-test-2026-04-28T23-27-21-169Z.log`
**Result:** 23/23 passed, 0 failed — identical to the March 22 run.

---

## 2. Bug Summary

The bug described in `PLAYOFF_TRANSITION_FIX.md` **no longer exists in the deployed edge function or the working copy**. It exists only in **git HEAD** (the last committed version).

The committed version (`git show HEAD:supabase/functions/process-week-results/index.ts`, lines 1192–1240) unconditionally advances `current_week + 1` before checking phase transitions, only processes one week advancement per invocation (`if (weekNumber === currentWeek)`), and does not set `season_status = 'playoffs'` on regular→playoff transition. The working copy (uncommitted) replaces this with a `processedWeeks` loop that re-reads `current_week` each iteration, checks `isPlayoffWeek` before advancing, sets `season_status = 'playoffs'`, and handles finals completion inline.

The fix was applied to the working copy and deployed to Supabase **before** the March 22 test run. It was never committed to git.

---

## 3. Harness Exercise Audit

**Does the harness directly UPDATE `current_week`?**
No. The harness sets `current_week: 1` at seed time (`simulation-test-runner.mjs:318`) and never writes to it again. All subsequent advances come from the edge function.

**Does the harness directly UPDATE `season_status`?**
No. The harness sets `season_status: 'active'` at seed time (`:319`) and never writes to it again. The edge function manages all transitions.

**Does the harness invoke `process-week-results` once per week?**
No — it invokes it **once** for the entire regular season (`:776`), expecting the function to process all weeks in a single call. It then invokes it once per playoff round (`:572`) after injecting playoff snapshots (`:568`) and ensuring dates are in the past (`:547`). The harness relies on the function's internal `processedWeeks` loop (working copy lines 1214–1283) to advance through all regular-season weeks in one call.

**For `NEG:IDEMPOTENT`, what state is the league in when the second invocation happens?**
`season_status = 'completed'` (`:874`). The function's query filter (`is('team1_gain', null)`) returns zero matchups → the function returns `{ processed: 0 }` before reaching any week-advancement logic. The idempotent test never exercises the buggy `current_week` increment path — it tests the "already scored" filter only.

---

## 4. Assertion Audit

### Regular → Playoffs transition
- **Asserted:** `season_status === 'playoffs'` (`:804`), `current_week` logged but not asserted to a specific value
- **Not asserted:** `current_week === numWeeks + 1` (only logged at `:802`)

### Intra-playoff round advancement
- **Asserted:** Playoff matchups have results (`:722–726`), winners advanced to next round (verified by populated `team1_user_id`/`team2_user_id` in next round query at `:550–557`)
- **Not asserted:** `current_week` has a specific value after each playoff round

### Playoffs → Completed transition
- **Asserted:** `season_status === 'completed'` (`:613`), `champion_user_id` is not null and equals `userIds[0]` (`:628, :634`), `runner_up_user_id` is not null and not equal to champion (`:629–641`), finals winner matches champion (`:731`), `completed_at` is not null (`:631`)
- **Not asserted:** `current_week` has a specific final value

### Summary
No test asserts `current_week` to a specific expected value at any point. The validation function (`validate()`, `:599–753`) reads `current_week` (`:606`) but only checks `season_status` (`:613`). The harness's `runTest` checks `season_status === 'playoffs'` after regular season (`:804`) but not `current_week`.

---

## 5. Hypothesis Conclusion

**None of A, B, or C.** The premise of the diagnostic is incorrect.

The fix described in `PLAYOFF_TRANSITION_FIX.md` was **already applied** to the working copy and deployed to Supabase before the March 22 test run. The simulation tests the deployed (fixed) function and correctly passes. The "contradiction" (tests pass despite bug existing) is illusory — the bug only exists in git HEAD, not in the deployed code.

Evidence:
- `git diff HEAD -- supabase/functions/process-week-results/index.ts` shows the fix as an uncommitted working-copy change
- The committed version lacks the `league_id` request body parsing that the sim relies on (`:434–443` in working copy; absent from `git show HEAD`), proving the deployed version has the fix
- The sim calls the function once for all regular-season weeks (`:776`) and expects multi-week advancement — this only works with the `processedWeeks` loop, which only exists in the working copy/deployed version
- The `season_status = 'playoffs'` transition requires the `playoffs` CHECK value added by the untracked migration `20260305000000_add_playoffs_season_status.sql`

If the committed (HEAD) version were deployed, the simulation would fail on Test 1 because: (a) the `league_id` filter would be ignored (no `req.json()` parsing), causing all production matchups to be processed alongside test data, and (b) only one week would advance per call, leaving `current_week` at 2 instead of transitioning to playoffs.

---

## 6. Proposed Minimum Test Case

Though the deployed code is correct, the assertions are weak and would not catch a regression. A minimum test case:

**What it would do:** After `callEdgeFunction` for the regular season, and after each playoff round, read `current_week` from the `leagues` table and assert it equals the expected value.

**What it would assert:**
- After regular season processing: `current_week === numWeeks + 1`
- After each non-finals playoff round: `current_week` incremented by 1
- After finals: `current_week` unchanged from pre-finals value (no advancement on season completion)

This test would catch any regression to the unconditional-advance bug because the buggy code would leave `current_week` at 2 (only one advance) instead of `numWeeks + 1`.

---

## 7. Other Concerns

1. **Uncommitted fix deployed to production.** The edge function fix, the `leagueIdFilter` feature, the `processedWeeks` loop, and the `20260305000000_add_playoffs_season_status.sql` migration are all in the working tree but not committed. A `git stash` or checkout would destroy the fix locally. The deployed function would survive but drift from any future `git`-based deployment.

2. **Sim depends on deployed function, not local code.** `callEdgeFunction()` (`:434–443`) hits the remote Supabase function URL. The harness cannot test local changes to `process-week-results/index.ts` without redeploying. If the function is redeployed from git HEAD, all 23 tests would fail.

3. **No `current_week` assertions anywhere.** The validate function checks `season_status` but never `current_week`. The `runTest` function logs `current_week` (`:802`) but only asserts `season_status` (`:804`). A bug that sets `current_week` to an incorrect value would go undetected as long as `season_status` reaches `'completed'`.

4. **`weekNumber` variable in committed code is non-deterministic.** In the committed version (HEAD), `weekNumber = leagueMatchups[0]?.week_number` depends on query result ordering. No `ORDER BY` is applied to the matchups query, so `weekNumber` could be any week — the `if (weekNumber === currentWeek)` guard could silently skip week advancement if the first returned matchup isn't from the current week.

5. **Sim test data hits production DB.** The harness creates/deletes rows in the live Supabase project. Cleanup failures (network errors, FK violations) would leave orphaned `__SIM_TEST_*` leagues in production. The `NEG:MID-WEEK-TRADES` test creates and deletes real `auth.users` records.
