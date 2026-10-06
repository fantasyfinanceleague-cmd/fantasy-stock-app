# Draft auto-start — plan (2026-10-06, PLAN ONLY, no code yet)

**Giorgio's rule (2026-10-06, verbatim):** "the draft is not something that is started manually. It should be something that starts at the minute that is selected by the commissioner. So if the commissioner sets it for noon tomorrow, the draft room will open at 11 a.m. and the draft will automatically start at noon."

Branch `feat/draft-auto-start` off `origin/main` @ `89b79c1`. Provisional migrations `20261109000000`–`09`.
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

`ops/autopick-cron-live` (sweep cron live) → #126 → draft-order-notify cron promoted → this branch: `db push` (`20261109…`), then deploy draft-autopick-sweep **and** draft-control (both import `_shared/draft-start.ts`; byte-verify both upload lists) → effect test → the mobile countdown UI ships with 1.2.0. The server is safe ahead of the UI: old clients' Start button becomes a redundant kick.
