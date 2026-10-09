# Draft auto-start — plan (2026-10-06, PLAN ONLY, no code yet)

**Giorgio's rule (2026-10-06, verbatim):** "the draft is not something that is started manually. It should be something that starts at the minute that is selected by the commissioner. So if the commissioner sets it for noon tomorrow, the draft room will open at 11 a.m. and the draft will automatically start at noon."

Branch `feat/draft-auto-start` off `origin/main` @ `89b79c1`. Provisional migrations `20261111000000`–`09`.
Builds on: #67 draft order modes (applied), #58 pick clock (applied), #105 feasibility (applied),
#123 freeze (merged), `ops/autopick-cron-live` (`20261106000000`, sweep cron, in flight),
#126 leave-league (`20261107000000`–`06`, open).

## 0. The fact that makes this small

Manual start **already cannot happen before `draft_date`**: `computeStartBlockers` refuses with
`draft_date_not_reached` (`draft-control/rules.ts`). So "manual start" today only means *who pulls the
trigger at or after T*. Auto-start replaces the commissioner with the server at T. The checks,
the order lock (`trg_leagues_order_start`), the clock anchor (`trg_leagues_pick_clock` stamps
`draft_started_at = now()`), #123's freeze, and #126's reconfirm gate all fire on the
`draft_status` flip, so they apply whatever path flips it. Consequences:

- An old 1.1.0 commissioner tapping Start at T+3 s does exactly what the cron would do a few seconds later. It's harmless, so we need **no forced client release**.
- The first pick's clock runs from the actual flip (`draft_started_at`), not from `draft_date`, so cron lag (≤ ~10 s) never eats into pick 1's clock.

## 1. Mechanism (recommendation: extend the sweep, one shared start path)

**Recommend: one start routine (`_shared/draft-start.ts`). Both draft-control and the existing 10 s sweep call it. The sweep gets a second, independent predicate.** I don't recommend a separate cron: it would need a second job, a second function deploy and a second set of monitoring. It would also duplicate the auth/vault/timeout wiring #58 and `ops/autopick-cron-live` already proved.

1. **Extract** `computeStartBlockers` + `feasibilityBlockers` + the flip out of `draft-control/index.ts` into `_shared/draft-start.ts`:
   `startDraftIfDue(admin, leagueId, now) → { outcome: 'started' | 'already_started' | 'blocked' | 'not_due' | 'changed', blockers? }`.
   `draft-control` `start` and the sweep both call it, so there is one code path.
2. **The flip becomes a SQL function**, `public.start_league_draft(p_league_id uuid, p_expect jsonb)`: SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE revoked from PUBLIC **and anon and authenticated** (CLAUDE.md grant trap), service_role only, proacl-verified. It:
   - takes the league row lock (`FOR UPDATE`). This conflicts with the `FOR NO KEY UPDATE` that join/leave/#123/#126 take, so it serializes with every membership change;
   - re-checks **under the lock** the cheap SQL-expressible rules: `draft_status = 'not_started'`, `draft_date <= now()`, members ≥ 4, `playoff_teams` valid and ≤ members, `stake_mode` set, no `league_roster_reconfirm` row;
   - **compare-and-swaps** the values the TS feasibility check judged (member count, `playoff_teams`, `stake_mode`, `budget_amount`, `num_rounds`, slot-set hash) against `p_expect`, the same CAS idea as `"record_trade_atomic"`. A mismatch returns `changed`, and the next tick re-checks;
   - flips `draft_status` → `in_progress`. The existing triggers do the rest;
   - returns jsonb `{status: started|already_started|blocked|changed, reason}`. Game-flow refusals come back as values, not raises, so `.rpc()`'s `{error}` stays reserved for real failures (CLAUDE.md #5: destructure and check).

   This closes today's TOCTOU between `computeStartBlockers` and the `.update()`. Example: a commissioner changes `playoff_teams` in the gap, or a join lands between the feasibility read and the flip.
   Feasibility (a pool read over cached prices) stays in TS before the call. Prices drifting between the read and the flip is accepted: it's the same as today.
3. **Due predicate**: `public.due_draft_starts()` (service_role only), shaped like `overdue_draft_turns()`. It returns `not_started` leagues with `draft_date <= now()` and `draft_date > now() - <grace>` (§2). It **excludes leagues whose last blocked attempt is < 60 s old**, the `draft_stalls` back-off pattern from `20261106000000`. Without that, a blocked league would post every 10 s forever and re-run a feasibility pool read each time.
4. **Cron**: a new migration re-schedules `draft_autopick_sweep` (same job name, same URL, same vault key, same `timeout_milliseconds`) with
   `where exists (<the 20261106000000 overdue predicate, verbatim>) or exists (select 1 from public.due_draft_starts())`.
   The sweep runs **the start pass first**, then the overdue pass. They can't interfere: a draft just started has pick 1 due `pick_seconds` later, so it's not overdue on this tick. **Ordering dependency:** this migration must be stamped and applied after `20261106000000`. If it lands first, the later file's `unschedule`/`schedule` silently reverts it to overdue-only. A PGlite wiring test pins the command text, like `autopick_cron_wiring.test.ts`.
5. **Idempotent and race-safe**: two sweeps, sweep vs. a 1.1.0 manual tap, or sweep vs. a client kick (below) all hit the row lock. The loser's re-check sees `in_progress` and gets `already_started`, which is a success. The advisory key `'record-trade:'||league_id` isn't involved: trades are refused pre-draft, and the league row lock is the right serializer for start. #123's freeze and the leagues column guard exempt `auth.uid() IS NULL` (the service role), and #126's reconfirm gate refuses the flip **for every role**. `start_league_draft` checks that row itself under the lock, so the gate trigger is a backstop that never fires in normal flow.
6. **Responsive path (mirrors the pick clock):** the cron is the backstop. When a lobby's countdown hits 0, the client calls `draft-control {action:'start'}`. That action changes from *commissioner only* to *any member, only when due*. It's safe because it can only do what the cron would do within 10 s, and the existing rate limit applies. With a client watching, the start is instant. With nobody watching, it starts within ~10 s.
7. **Close the bypass:** [I2a] `leagues_update_commissioner` still lets a commissioner flip `draft_status` directly over PostgREST, **before T**, skipping every check. A BEFORE UPDATE trigger refuses any change to `draft_status` when `auth.uid() IS NOT NULL` (`draft_status_server_only`, 42501-style refusal). Pre-check: grep shows no shipped client writes `draft_status` directly (web `handleStartDraft` is paused; the web `completeDraft` write moved into `finalize_league_draft`). **Needs a decision:** should this ride with the auto-start release, or wait for the `drop_I6_I2b` deferral? (It's cheap and independent.)

## 2. Blocked at T: DECISION for Giorgio (mockup material)

**What can still be wrong at T?** If #126 merges, membership is locked from T−1h. So the state at T differs from the state at T−1h only by: the commissioner's own edits in that hour (playoff teams, slots, stake mode); a pending roster reconfirmation; fewer than 4 members (the order never finalized); and price drift breaking feasibility (rare). **So the blocker check should run at T−1h, when the room opens, as an early warning.** Then the commissioner has the full hour to fix things. That applies under every option below.

| Option | At T, if blocked | Pros | Cons |
|---|---|---|---|
| **A. Start as soon as fixed** | Stay `not_started`. The commissioner gets a push. The draft starts automatically the moment the blocker clears | Zero extra steps; the "set it and forget it" spirit | A fix at 3 a.m. starts a draft nobody attends. Every pick is then auto-picked (never skipped), so the draft gets decided by a robot |
| **B. Pick a new time** | Stay `not_started`, marked *missed*. The commissioner must set a new `draft_date` (≥ 1 h out, so the room/order/leave rhythm repeats) | Predictable; members always know when to show up | One more step for the commissioner, even for a 10-second fix |
| **C. Auto-fix what's safe, then A or B** | Only two blockers are safely fixable: `playoff_teams` > members (clamp to members) and a pending reconfirm with ≥ 4 members (auto "move forward"). Everything else still needs A or B | Most real cases (someone left) just start on time | The server changes league rules without asking, and the commissioner learns afterwards |
| **★ Recommended: A with a 15-min grace, then B** | Blocked at T: push the commissioner; start automatically if fixed by T+15 min. After that, the draft is *missed* and needs a new time. The `<grace>` in `due_draft_starts()` is this window | Covers "fixed it in a minute" with no re-scheduling, and never starts a draft nobody is there for | Two states to explain (delayed vs. missed) |

**Who gets told, and what members see** (copy for the Design Lead; push = `league_notifications` outbox, delivered by draft-order-notify's loop):
- **T−1h, room opens, no blockers:** the existing `draft_order_set` push to every human ("You pick 3rd. The draft starts at 12:00 PM ET").
- **T−1h, blocked:** commissioner only. New kind `draft_start_at_risk`: "Your draft can't start at 12:00 PM ET: <first blocker>. Fix it in the lobby."
- **T, started:** every human. New kind `draft_started`: "Your draft has started. You pick 3rd." This matters now that nobody taps Start.
- **T, blocked:** commissioner gets `draft_start_blocked` ("…didn't start: <blocker>. Fix it by 12:15 and it starts right away."). Members see a lobby banner: "The draft is delayed. Waiting on <commissioner>." Push members too? That's a decision; I recommend lobby only, and a push only if the draft becomes *missed*.
- **Missed (after the grace):** commissioner gets "Pick a new draft time". Members see "Draft postponed. The commissioner will pick a new time."
- The kind CHECK grows (`draft_order_set` + #126's `member_left` + these three). #126 and Run it back (#94) also touch that CHECK, so whichever merges last re-creates it with the union.

**Server state for "delayed/missed":** a table `draft_start_blocks(league_id pk, first_blocked_at, last_seen_at, blockers jsonb, notified_at)` with members SELECT. It drives the back-off, the one-time push, and the lobby banner. Clients don't derive "delayed" from `draft_date < now()`, because that NULL/absent row would be an overloaded tag. The row is deleted on start or on a new `draft_date`.

## 3. T−1h "the draft room opens": what the server provides

Already built by #67: at the later of `draft_date − 1h` and the 4th member, the order is finalized. Lazily by any read (`get_draft_order`), and on time by the **deferred `draft_order_notify` cron (`20261013000001`)**, which also delivers the `draft_order_set` push. **Auto-start makes that cron a precondition:** without it, a league nobody opens still finalizes, but only lazily at the flip (via `trg_leagues_order_start`'s backstop), and nobody gets the "room is open" push. Its README preconditions (deploy + byte-verify draft-order-notify, a manual run on a test league) must be met **before** auto-start ships. I'd promote it in the same release, re-stamped after `20261106000000`/#126's range.

New server work for T−1h:
- `draft-order-notify` (or the sweep's start pass, whichever runs the T−1h tick) evaluates the blockers once at T−1h and writes `draft_start_at_risk` for the commissioner (§2).
- `get_draft_order` already returns `finalize_at` and `state`. The lobby's "room open" phase is `state ∈ {finalized}` or `now ≥ finalize_at`. No new read is needed; the client derives the phase from these fields, not from wall-clock math alone.
- `draft-control status` gains `starts_at` (= `draft_date`) and `start_state: 'scheduled' | 'room_open' | 'due' | 'delayed' | 'missed' | 'started'` from the server's clock, so a skewed phone clock can't show the wrong phase. Blockers keep their current shape.

## 4. Removing manual start

**Server:**
- `draft-control start` stays as the client *kick* (§1.6): any member, refused with `draft_date_not_reached` before T, exactly as today. The commissioner check goes away and the action's meaning stays the same, so 1.1.0's button keeps working. It just can't do anything the cron wouldn't.
- The new `draft_status` trigger (§1.7) removes the PostgREST bypass.

**Client (mobile worker, via the Orchestrator).** Branch `ui/mobile-league-setup`, `apps/mobile/app/(tabs)/league.tsx` `LeagueLobby`:
1. Remove the `Start the draft` button, the `confirming` state, `startDraft`'s *button* path, and the `<StartDraftConfirm>` mount.
2. Replace them with a **countdown card** for everyone (not just the commissioner):
   - "The draft starts at 12:00 PM ET" with a live countdown;
   - "The draft room is open. The order is set." from T−1h (the order panel);
   - "Starting…" at 0, while it fires the kick (`draft-control {action:'start'}`) once and then polls `refresh()`.
3. `StartDraftConfirm.tsx`'s *fix-it* content becomes the **commissioner's blocker card**. It shows when `status` returns blockers: before T as "fix this before 12:00", after T as delayed or missed. Keep the playoff-teams stepper (`onSetPlayoffTeams`), the invite share, and the reconfirm actions (#126). Drop `onStart`/`onNotYet`. The component is renamed or split (`DraftBlockersCard`).
4. *Missed* state: the commissioner sees "Pick a new draft time" (opens the League-settings date picker, min = now + 1 h). Members see "Postponed".
5. `lib/game/useDraftStatus.ts`: read `starts_at`/`start_state`. `canStart` is no longer a button gate. It becomes `start_state === 'due'` (kick eligibility).
6. `app/(tabs)/draft.tsx` (main and both lobby branches) still has the 1.1.0 Start button at `:386`/`:691`. Same treatment if that screen survives into 1.2.0, otherwise leave it alone (the server keeps it harmless).
7. The date picker (League settings + create flow) shows ET, enforces min now + 1 h, and its helper copy reads: "The draft room opens 1 hour before; the draft starts automatically."
8. Copy for `describeStartBlocker`: new states `delayed`/`missed`; `draft_date_not_reached` is never shown as a blocker any more (it's just the countdown).
9. Tests: the pure phase derivation (`scheduled/room_open/due/delayed/missed`) in `tests-deno/`.

## 5. Edge cases

- **`draft_date` in the past or within the hour, at set time:** today there's no server constraint (column `timestamptz NULL`, no CHECK). Add a BEFORE INSERT/UPDATE trigger: for a user session (`auth.uid() IS NOT NULL`), a **changed** non-NULL `draft_date` must be ≥ `now() + interval '1 hour'` (`draft_date_too_soon`). That keeps the T−1h rhythm (order reveal, leave lock, room open) from being skipped. Same-value patches pass, because league-settings always sends the column (#123's lesson). The service role is exempt. Open question: allow a small slack (e.g. 55 min) for slow form submits?
- **Editing the date after T−1h:** today it's allowed (the order stays finalized at the old date). Recommendation: **refuse** user-session changes once `now() ≥ OLD.draft_date − 1h` and the draft is `not_started`, **except** in the *missed* state, where B needs a new time. Members are already locked in by #126 at T−1h, so pushing the date later would keep them locked against their expectation. Clearing to TBD after T−1h is refused too.
- **Legacy leagues at deploy:** any `not_started` league with a past `draft_date` would be auto-started on the first tick. The grace window (`draft_date > now() − 15 min`) means they're *missed*, never started. **Read-only pre-check before the push:**
  `SELECT id, name, draft_date, (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) FROM leagues l WHERE draft_status = 'not_started' AND draft_date IS NOT NULL ORDER BY draft_date;`
  Any row within the coming 15 min at deploy time gets attention first.
- **Time zones / DST:** store UTC (`timestamptz`, already), compare `draft_date <= now()` (absolute, DST-proof), cron is UTC. Display in `America/New_York` via `Intl.DateTimeFormat` with an explicit `hourCycle: 'h12'` (the Hermes `formatToParts` trap in memory: never format hours without an `hourCycle`). The picker must convert an ET wall time to UTC through the tz database, never a fixed −4/−5 offset. The spring-forward gap (2:00–2:59 AM ET doesn't exist) is refused, and the fall-back overlap (1:00–1:59 AM ET happens twice) resolves to the first occurrence. Simplest: the picker offers 15-minute steps and the converter round-trips to detect both cases. Tests cover both 2026 transitions (Mar 8, Nov 1).
- **TBD date:** never auto-starts (`draft_date IS NULL` isn't due). The lobby says "The commissioner hasn't set a draft time".
- **< 4 members at T:** blocked under every option (bots stay test-account-only). Under the recommendation: a 15-min grace (a 4th person joining starts it at once), then missed.
- **Draft started, nobody connected:** the sweep cron's overdue pass auto-picks every turn (#58/#105, never skips), which is why that cron is a hard precondition (it's in flight now).
- **Sweep bounds:** the start pass is capped (e.g. 10 starts/run) ahead of the overdue pass's `MAX_LEAGUES_PER_RUN`, so a burst of noon drafts can't starve overdue turns. The rest go on the next tick.

## 6. Success-signal discipline (verification plan for the build)

- The sweep's `ok` means only "ran". Start outcomes go in `starts: [{league_id, outcome}]` and failures in `start_errors`, never folded into `ok` (CLAUDE.md #7).
- Effect proof by data: on a test league with `draft_date` = now + 62 min and every app closed, `league_draft_order_meta.state` goes to `finalized` near T−1h. Then at T: `draft_status = 'in_progress'`, `draft_started_at - draft_date < 15 s`, and picks start arriving. A blocked twin league (3 members) stays `not_started` with a `draft_start_blocks` row and exactly one commissioner notice.
- Effect test as ONE `DO` block: proacl of `start_league_draft`/`due_draft_starts` (service_role only, no anon/authenticated); user-session `draft_status` write refused; `draft_date` too-soon refused; the cron command contains both predicates.
- PGlite suite: concurrency (two flips → one `started`, one `already_started`), the CAS `changed` path, the grace boundary, the back-off, and #126 reconfirm.
- The CLI-splitter guard covers new files. Quote any identifier containing "atomic" (none planned).
- Partial-state check: "due" is per league, and blockers are evaluated per league every tick. There's no batch "any league started → done" shortcut. The `draft_start_blocks` row is keyed per league and deleted on start, so a stale row can't hide a later block.

## Decisions needed (for Giorgio, via mockups)

1. Blocked at T: A / B / C / ★ (A 15-min grace → B). If C: which auto-fixes.
2. Push members when the draft is delayed, or only when it's missed?
3. Refuse `draft_date` edits after T−1h (recommended) vs. allow postponing.
4. Minimum lead time when setting a date: exactly 1 h, or 1 h with slack.
5. Ship the `draft_status` server-only trigger with this release (recommended) or later.

## Release order (sketch)

`ops/autopick-cron-live` (sweep cron live) → #126 → draft-order-notify cron promoted → this branch: `db push` (`20261111…`), then deploy draft-autopick-sweep **and** draft-control (both import `_shared/draft-start.ts`; byte-verify both upload lists) → effect test → the mobile countdown UI ships with 1.2.0. The server is safe ahead of the UI: old clients' Start button becomes a redundant kick.

---

# BUILD v1 (★A, 15-min grace): SUPERSEDED by BUILD v2 below

Kept for the record. Giorgio rejected ★A ("people still need an hour heads up and notice"). The mechanism below (one start path, the locked compare-and-swap flip, the cron reschedule, draft_status server-only) carries over. The grace, `draft_start_blocks` and the "missed" state do not.

# BUILD (2026-10-06, after the Orchestrator's GO)

Built: everything that doesn't depend on decisions 1–4. Not built: notification copy/kinds, the client, the `draft_date` lead-time/edit guards (decisions 3/4), and relaxing `start` to any member (the client kick, §1.6). That needs an explicit OK.

| Piece | Where |
|---|---|
| Policy (★A: 15-min grace, then missed; B/C noted in place) | `supabase/functions/_shared/draft-start-policy.ts` + `public.draft_start_grace()` (pinned equal by test) |
| One start path | `supabase/functions/_shared/draft-start.ts` `startDraftIfDue`, used by `draft-control` `start` AND the sweep's start pass |
| The flip (row lock + window + floor + CAS) | `public.start_league_draft` in `20261111000000` |
| Due list + 60 s back-off | `public.due_draft_starts`, `draft_start_blocks`, `note_draft_start_blocked` (`20261111000000`) |
| Cron | `20261111000002`: same job, guard = overdue (verbatim from `20261106000000`) OR due |
| `status` | gains `starts_at` + `start_state`; from the room-open hour it evaluates feasibility too (the early warning) |
| `draft_status` server-only | `20261111000001`: rule (1) of #123's `enforce_league_rules_frozen_after_draft_start` (one place, body otherwise verbatim) + an INSERT guard |
| Effect test | `docs/security/draft-auto-start-effect-test.sql` (ONE DO block, 20 lines) |
| Tests | `_shared/draft-start(-policy).test.ts` (hermetic), `supabase/tests/draft_auto_start.pglite.test.ts`, `draft_auto_start_cron_wiring.test.ts` |

## Legacy pre-check (read-only, Giorgio, run BEFORE the push and again right before it)

Every `not_started` league, and what the first sweep tick will do with it:

```sql
SELECT l.id, l.name, l.draft_date, l.commissioner_id,
       (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) AS members,
       CASE
         WHEN l.draft_date IS NULL                         THEN 'tbd: never auto-starts'
         WHEN l.draft_date > now()                         THEN 'future: auto-starts at draft_date'
         WHEN l.draft_date > now() - interval '15 minutes' THEN 'DUE NOW: the first tick tries to start it'
         ELSE                                                   'missed: never auto-starts; needs a new draft time'
       END AS on_first_tick
  FROM leagues l
 WHERE l.draft_status = 'not_started'
 ORDER BY l.draft_date NULLS LAST;
```

Read it as: any `DUE NOW` row starts within 10 s of the push. Any `future` row starts on its own at its time. Decide on each (test leagues especially) before pushing: clear the date, or accept. `missed` rows are safe. A commissioner's old Start button now refuses them with `draft_start_missed`; setting a new date re-opens the window.

## Release (HUMAN ACTION, in order)

0. Preconditions: `20261106000000`–`02` (the auto-pick cron, on main) and `20261107000000`–`06` (#126, on main) applied first, or in the same push (timestamp order does it). Check with `SELECT version FROM supabase_migrations.schema_migrations WHERE version >= '20261106000000' ORDER BY version;`. The auto-pick runbook (`docs/migrations/AUTOPICK_CRON_LIVE.md`) must be complete before this push, because this file re-schedules the same job. #94 may land either side (its gate is caught by name). The draft-order-notify cron is recommended in the same release (§3).
1. Merge. Refresh the deploy checkout (CLAUDE.md). Run the pre-check above.
2. `supabase db push --dry-run`: it must list `20261111000000`–`02` (re-stamped later than anything already applied; never `--include-all`). Then `supabase db push`. Confirm in `supabase_migrations.schema_migrations`.
3. Deploy **draft-control** and **draft-autopick-sweep** (both import `_shared/draft-start.ts`). The upload list must include `_shared/draft-start.ts`, `_shared/draft-start-policy.ts` and `draft-control/rules.ts` (for the sweep too). Content check first: `grep -c startDraftIfDue supabase/functions/draft-autopick-sweep/index.ts` ≥ 1. Byte-verify both downloads against the commit.
   Push-vs-deploy order: deploy within minutes of the push. The new cron posts for due drafts at once, and the OLD sweep ignores them (harmless, no starts). The old draft-control `start` keeps working until redeployed, but it writes `draft_status` with the service role, which the server-only rule exempts.
4. `docs/security/draft-auto-start-effect-test.sql`: 20 PASS lines. Also, as postgres, run `SELECT exists (SELECT 1 FROM public.due_draft_starts());`: it must return without error. The cron command isn't validated at schedule time, and a broken guard would silently stop the auto-pick backstop too. Then the live check in `20261111000002`'s footer (a test league ~62 min out, every app closed; `draft_started_at - draft_date` well under 15 s).
5. Re-capture `docs/architecture/db-snapshot.json` (new functions + grants + the cron command), re-run the map, update STATUS.

**Supersedes:** `docs/security/freeze-league-rules-effect-test.sql` R7 and D1 now refuse with `draft_status_server_only`. Don't re-run that file as a gate.
**Web:** the paused web app's `DraftPage.jsx` start flip and member `completeDraft` are refused from here on. Re-route them through draft-control before any unpause.

## Merge notes (rebased onto main @ 5471392: auto-pick cron + #126 merged)

- **#126 (leave-league), integrated.** `draft-control` start runs `startDraftIfDue`. `draft-start.ts` reads `league_roster_reconfirm` (fails closed) into `toStartState`, so the TS evaluation reports `roster_reconfirm_required` before any pool read. `start_league_draft` also catches #126's real gate by name. The PGlite chain loads `20261107000000` + `20261107000006` and proves it. `status` and `confirm_roster` keep #126's read. #126's raw `updErr` string match is gone with the conditional UPDATE it guarded.
- **#94 (Run it back):** `renewal_replies_pending` is caught by name. A stand-in raising its exact text (`20261115000004` on its branch) is tested. Its start trigger sets `num_participants`, which isn't a CAS input. `renew_league` INSERTs `not_started` (allowed by the INSERT guard), and `start_renewed_season` never writes `draft_status`. Re-check both when it rebases.
- **Kind CHECK / notifications:** untouched here.

## Review (2026-10-06): supabase-reviewer + security-reviewer, no blockers

Fixed: M1 (error/changed outcomes back off too), L1 (Alpaca checked only before the overdue pass, never blocking starts), L2 (`note_draft_start_blocked` reads `FOR SHARE`), L3 (duplicate REVOKE and the needless trigger re-create dropped; `draft_start_blocks` is SELECT-only for service_role). Feasibility detail is stripped for non-commissioners in `status`. H1 (ordering) is gone: both files are on main, and the wiring test now requires both. M2: verified against #126's real gate (tested) and #94's text. Self-review: a *missed* draft now reports a `draft_start_missed` blocker, so `can_start` is false.
Accepted / for Giorgio:
- **Backdating `draft_date`** (security LOW): a commissioner can set the date to a minute ago and the draft starts within ~10 s, fully checked, but skipping the T−1h notice. That's decision 4 (minimum lead).
- **The manual Start shares the 15-min grace** (M4): after it, only a new date re-opens the window. An operator can rescue a league with a SQL-editor `draft_date` update.
- **Numeric precision** (M5): a price bound or budget with more than ~15 significant digits would never compare equal, so the CAS returns `changed` and backs off forever. It fails closed, and no realistic value does this.


---

# BUILD v2 (2026-10-06): Giorgio's decisions, gate at room-open time

**Decisions (verbatim intent, via the Orchestrator):**
1. The REAL GATE is room-open time (T−1h). Blocked then: the room doesn't open, the draft doesn't start, the league is **postponed**, everyone is told, and the commissioner picks a **new time** (≥ 1 h notice again). There's no late start. Blocked at T even though the room opened (rare): the same.
2. The commissioner is warned **before** the room opens: the moment the league becomes blocked, and again at T−2h if still blocked.
3. Pushes to everyone: the room opens (with your position), the draft started, the draft is postponed.
4. Draft times: quarter hours only, ≥ 1 h ahead (a 55-min floor, enforced server-side).
5. Once the room opens the time can't change, except when postponed.

## Lifecycle (T = draft_date)

| When | Who | What |
|---|---|---|
| before T−1h | sweep WATCH pass (`draft_watch_due` → `watchLeague` → `record_draft_watch`) | Evaluates a league when its inputs change (join/leave/settings), or every 5 min inside 24 h (price drift). Becoming blocked → `draft_at_risk` to the commissioner. Still blocked at T−2h → one reminder. |
| T−1h−30s … T | sweep GATE (same pass) | Blocked → `postpone_league_draft` (stage `room_open`). Clear → `gate_cleared_at`. The 30 s lead lets the 10 s sweep act before #67 finalizes at T−1h. |
| ≥ T−1h | notify cron (`open_due_draft_rooms`) | Finalizes the order and writes `draft_room_open` per human (late joiners too), once per draft time. |
| ≥ T | sweep START pass (`startDraftIfDue` → `start_league_draft`) | Starts: the room must have opened, then the floor and the CAS. Writes `draft_started` per human. Blocked → postpone (stage `start`). The room never opened → postpone (`room_did_not_open`). A system hiccup → retry for 5 min, then postpone (`start_failed`). |

**Postponed** is an explicit `draft_postponements` row (stage `room_open` / `start` / `legacy`). A real postponement also clears `leagues.draft_date`: nothing is due for #67, leaving re-opens (#126 locks on `_draft_order_is_due(draft_date)`), and every client shows "no time". A new `draft_date` deletes the row (`trg_leagues_draft_rescheduled`).

**Why a new `draft_room_open` kind:** #67's `draft_order_set` is written by every finalize and is unique per member per league, *ever*. A league postponed after its order was set could never announce its new time. `draft_order_set` rows stay as in-app records; a trigger marks their push `skipped` at insert (and the never-delivered backlog is settled once), so nobody gets two pushes. No #67/#126 function is re-created.

## Files (20261111000000–03)

- `…000000_draft_auto_start.sql`:
  - `draft_start_policy()`, `draft_start_watch`, `draft_postponements`;
  - the kind CHECK union, plus the in-app trigger and the backlog settle;
  - the legacy backfill;
  - `_draft_start_inputs`, `draft_watch_due`, `record_draft_watch`, `postpone_league_draft`, `due_draft_starts`, `start_league_draft`, `open_due_draft_rooms`, `draft_room_notices_due`, `draft_notice_context`.
- `…000001_draft_status_server_only.sql`:
  - `draft_status` server-only: #123's rule (1), plus an INSERT guard;
  - **the draft-time guard** (quarter hour, ≥ now+55 min, locked after room-open unless postponed; DEFINER, since it reads the service-only postponements);
  - the reschedule trigger.
- `…000002_draft_autopick_sweep_auto_start.sql`: the sweep guard = overdue (verbatim from `20261106000000`) OR `due_draft_starts()` OR `draft_watch_due()`.
- `…000003_schedule_draft_order_notify.sql`: **promoted** from `deferred/20261013000001`. Guard = `draft_order_notify_due() OR draft_room_notices_due()`, `timeout_milliseconds := 180000`.

## Copy: the Design Lead's strings, verbatim (board #call-auto-start, 6cd10b8 / PR #128)

| Push (kind) | Text |
|---|---|
| Room open, everyone (`draft_room_open`) | "The draft room is open. You pick 4th. The draft starts at 7:00 PM ET." |
| Started, everyone (`draft_started`) | "The draft has started. You pick 4th." |
| At risk, commissioner, as soon as blocked (`draft_at_risk`) | "The draft room can't open yet: {first blocker}. Fix it before {Sat 6:00 PM ET}, or the draft is postponed." |
| Reminder, commissioner, T−2h, still blocked (`draft_at_risk_reminder`) | "One hour left to fix your league. If it isn't ready by {6:00 PM ET}, the draft is postponed." |
| Postponed, members (`draft_postponed`) | "The draft is postponed. {Commissioner} will pick a new time." |
| Postponed, commissioner | "The draft is postponed: the league wasn't ready at {6:00 PM ET}. Fix it, then pick a new time." (the room time; T for a stage-`start` postponement) |
| Time set/changed, everyone (`draft_time_set`) | "The draft is now {Sun, Oct 4 · 7:00 PM ET}." **NEW COPY (flagged): first-set variant** "The draft is set for {…}." when the member was never told a time for this league before |
| {first blocker} | Whole clauses, verbatim from the board's strings box (PR #135): "Sofia F. left the league" · "Sofia F. and Ana P. left the league" · "3 managers left the league" · "8 playoff teams, but 7 teams are in" (or "there are more playoff teams than teams" when the counts aren't known) · "the number of playoff teams isn't set" · "fewer than 4 teams have joined" · "some slots can't be filled" · "the budget can't fill every roster" · "the league's stakes aren't set" · "not every Season 1 player has answered" · fallback "something in League settings needs fixing". Members' fallback name: "The commissioner". **NEW COPY** (one line): "a manager left the league" for a confirmation row with no readable names. |

**ET formatting** is built from `formatToParts` with `hourCycle: 'h12'` pinned (the Hermes trap), with plain spaces. It's tested for noon/midnight and both 2026 DST switches. The title is the league name, with control characters stripped and capped at 60.

**Time-set rule (Giorgio: "Anytime a draft time is changed, everyone receives a notification").**
- **Who:** every human member, **the person who made the change included** (Giorgio: "Everyone in the league gets the notifications when draft times are changed"), for any set or change to a non-NULL time while not started. A service-role or operator change tells everyone too.
- **Debounce:** at most one pending notice per member per league (a partial unique index). Each change re-stamps it, and it's sent after **2 quiet minutes**, worded from the *current* time. A commissioner fiddling with the picker produces one push with the final time.
- **Clearing** the time (TBD), or a postponement clearing it, sends no time-set push (a postponement has its own).

Every push carries `data.screen: 'draft'` (1.1.0 routes by `screen`) and `data.type` = the kind. Each push is re-checked at send time and skipped if no longer true.

## For the mobile worker (client work, not built here)

- **`draft-control status`** now returns `start_state` (`no_date | scheduled | at_risk | room_open | due | postponed | started`), `starts_at`, `server_now` (ISO; the DB clock at read, the same instant `start_state` was judged at, so the lobby's countdown needs no `get_draft_clock` call), `postponed: {from, stage, reason} | null`, and blockers judged ahead of time (the date is a countdown; `draft_date_not_reached` and `draft_postponed` stay in `blockers` only to keep the 1.1.0 Start button disabled).
- **`draft-control start`** refusals: `draft_postponed`, `draft_start_retrying`, plus the existing ones.
- **Date pickers** (create-league, league-settings): `minuteInterval={15}`, minimum now + 1 h, ET labels. The server refuses `draft_time_invalid` / `draft_time_too_soon` / `draft_time_locked` (22023).
  - **1.1.0 compatibility:** its picker allows any minute, so a 1.1.0 commissioner picking 12:07 gets a save error. Same-value saves still pass.
- Lobby: the countdown; at-risk and postponed cards (commissioner: fix / pick a new time; members: "postponed, <commissioner> will pick a new time"); no Start button.

## Release (HUMAN ACTION, in order)

0. **Preconditions** (release prep 2026-10-07: merged with main @ 0 behind; migrations re-stamped to `20261111000000`–`03`):
   - applied in prod: `20261106000000`–`02` (auto-pick cron, #120), `20261107000000`–`06` (#126), `20261108000000`–`01` (#121) and `20261110000000`–`02` (commissioner transfer, #132). Check with `SELECT version FROM supabase_migrations.schema_migrations WHERE version >= '20261106000000' ORDER BY version;`.
   - #160 (the server-side "your turn" push) is live. This branch carries its `_shared/draft-write.ts` unchanged, so redeploying the sweep from here keeps it.
1. **Read-only pre-check** (run before the push, and again right before it). The backfill postpones every `not_started` league whose time has passed (silently). Any league whose time is within the next hour gets gated on the first tick: it opens its room with less than 1 h notice, or is postponed. Decide on each:
   ```sql
   SELECT l.id, l.name, l.draft_date,
          (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) AS members,
          CASE WHEN l.draft_date IS NULL THEN 'tbd: nothing happens'
               WHEN l.draft_date <= now() THEN 'past: postponed silently (legacy)'
               WHEN l.draft_date <= now() + interval '1 hour' THEN 'WITHIN THE HOUR: gated on the first tick'
               ELSE 'future: watched; room at T-1h, start at T' END AS on_push
     FROM leagues l WHERE l.draft_status = 'not_started' ORDER BY l.draft_date NULLS LAST;
   ```
2. **Deploy `draft-order-notify` first** (from the refreshed deploy checkout). Its cron isn't scheduled until the push, so the new code sits idle until then.
   - Content check: `grep -c decideNotice supabase/functions/draft-order-notify/index.ts` ≥ 1.
   - The upload list must include `draft-order-notify/plan.ts`, `_shared/push.ts`, `_shared/cron-auth.ts`.
   - Byte-verify with a download + diff.
3. **`supabase db push --dry-run`**: exactly `20261111000000`–`03`. Then **`supabase db push`**, and confirm in `schema_migrations`.
3b. **Immediately after the push**, deploy `draft-autopick-sweep`, then `draft-control`.
   - **Not before the push:** draft-control's `status` reads `draft_postponements` and would 500 until the table exists, and the sweep's new passes would log errors every run.
   - Between the push and these deploys, the widened sweep cron posts to the OLD sweep, which ignores the auto-start work (harmless). So keep the gap to minutes.
   - Content check: `grep -c watchLeague supabase/functions/draft-autopick-sweep/index.ts` ≥ 1 and `grep -c resolveServerNow supabase/functions/draft-control/index.ts` ≥ 1.
   - Both upload lists must include `_shared/draft-start.ts`, `_shared/draft-start-policy.ts`, `draft-control/rules.ts`, `_shared/draft-write.ts` (with #160's `commitGatedPick`), `_shared/draft-feasibility.ts`, `_shared/push-copy.ts`.
   - Byte-verify each.
4. `docs/security/draft-auto-start-effect-test.sql`: every line PASS (24 lines; C1/C2 run for real on prod).
5. As postgres: `SELECT exists (SELECT 1 FROM public.draft_watch_due()), exists (SELECT 1 FROM public.due_draft_starts()), public.draft_room_notices_due();` must return without error. Neither cron command is validated at schedule time.
6. **Live test** (a throwaway league, every app closed; verify by DATA):
   - (a) 4 members, a time ~2 h out: the room opens at T−1h (`room_opened_at`, `draft_room_open` rows settled sent / no_device), and it starts at T (`draft_started_at − draft_date` < 15 s, `draft_started` rows). After pick 1, the pick-2 manager gets #160's turn push; pick 1's manager gets only "The draft has started. You pick 1st." (no second push).
   - (b) 3 members, ~2 h out: an at-risk row for the commissioner within ~10 s of creation; at T−1h a postponement row, `draft_date` NULL, and `draft_postponed` rows.
7. Re-capture `db-snapshot.json`, re-run the map, update STATUS.

**Supersedes:** lines R7 and D1 of `freeze-league-rules-effect-test.sql`. **Web:** the paused web start/finish writes and off-grid date edits are refused. Route them through draft-control before any unpause.


## Review round 2 (2026-10-06): supabase + security reviewers on 0840bfc

Fixed (each with a test and a negative control):
- **The order is set only after the gate clears** (supabase #3). `_draft_order_sync` gains "gate cleared for this time". A time saved 55–60 min out can't have its order set, and members leave-locked, by a lazy read before the gate judges it.
- **Postponed leagues never finalize** (security M3). The same function gains "not postponed". The legacy backfill now also clears `draft_date` (old time kept in `postponed_from`), so legacy leagues aren't due for #67's cron, and leaving re-opens.
- **Gate slip** (supabase #2): a league whose inputs change before its room opens is re-gated, and `open_due_draft_rooms` hands back a league whose order couldn't be set. It's postponed at about T−1h with its real reason, not at T.
- **Postpone CAS** (supabase #5).
- **Cron isolation** (supabase #6): the new lists sit behind `draft_auto_start_work_due()`, which returns false on error, so they can never fail the auto-pick backstop.
- **Overlap duplicates** (supabase #7): the watch locks `FOR NO KEY UPDATE`, room-open takes an advisory lock.
- **Unknown verdicts** keep the old signature (supabase #8).
- **Flap guard** (supabase #9): one at-risk push per league per hour.
- **Tie-break** (supabase #10), and **TBD drops the watch row** (supabase #11).
- **Flood guard** (security M1): one postponed push per member per league per hour, and per-league fairness in delivery.
- **Watch starvation** (security M2): gate-window leagues are listed first.
- **The notify cron guards on delivered kinds only** (security L3), and members see departed **names** only (security L1).

Open, for the Orchestrator / Giorgio:
- **1.1.0 compatibility** (supabase #1, HIGH, release-gating): the shipped pickers send any minute, so after this push a 1.1.0 commissioner choosing e.g. 12:07, or a time under 55 min out, gets a save error (`draft_time_invalid` / `draft_time_too_soon`). Same-value saves pass. Options: ship the quarter-hour picker first, or accept the break for TestFlight testers.
- **#94 merge order** (supabase #4): when #94 rebases it must keep this file's union kind CHECK, and its renewal kinds are delivered elsewhere (this cron no longer posts for them). Re-check that `start_renewed_season` never writes `draft_status`.
- **Known limitation:** a stage-`start` postponement (blocked at T after the room opened, rare) keeps its finalized order, so #126 keeps members leave-locked until a new time is set. A follow-up could let `leave_league` skip the order-set lock while postponed.
- **Operational alert** (supabase #13), worth adding to monitoring: `SELECT l.id FROM leagues l JOIN draft_start_watch w ON w.league_id = l.id AND w.draft_date = l.draft_date WHERE w.gate_cleared_at IS NOT NULL AND w.room_opened_at IS NULL AND now() > l.draft_date - interval '58 minutes';` Any row means the room-open job is failing, and those leagues will be postponed at T.
