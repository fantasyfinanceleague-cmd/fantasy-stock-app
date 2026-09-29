# Stockpile — Project Status

**Single source of truth for "what is deployed, what is done, what is left."**
Update this file at the end of any session that changes prod state or lands a
workstream. Per-workstream detail lives in the documents linked below and in the
PRs; this page summarises and points.

**Last verified against prod: 2026-09-29** (read-only SQL, deploy downloads and
effect tests run with Giorgio; results recorded inline). Anything marked
**UNVERIFIED** has not been checked against prod and must be confirmed before
anyone builds on it. Resolved defects are collapsed into §5. Their full reasoning
lives in the linked PRs and in git history (`git log -p -- docs/STATUS.md`).

---

## 1. Where things stand

The whole mobile league loop now works in prod **on current code**: a commissioner
creates a league, sets a draft date, fills with bots (test account only), starts the
draft, drafts by company-name search while bots pick server-side, and the server
finalizes the league into a full season (schedule, standings, dates, season 1).
It was proven twice on 2026-09-25: `test_0925` and `test_09_25_v2`. Both are
scheduled Tue 2026-09-29 → Fri 2026-10-16, and their **first real weekly scoring
runs Fri 2026-10-02 21:15 UTC**. That run is the last unproven link (draft →
snapshot → scored week).

**The top blocker is distribution, not code.** None of this is on testers' phones.
The installed 1.0.0 builds predate the August server-side draft changes and are
refused by RLS when they draft (confirmed on Giorgio's phone). The fix is the
**1.1.0 EAS build** (§4 item 1). The web app is deployed but paused
(`APP_PAUSED = true`) to a landing page, and signups are closed server-side.

**Since 2026-09-25:**
- The Phase 3 backend is live and effect-verified: the Home summary and display names (#42); trade history ∪ picks, signup usernames and the market calendar (#43/#49).
- historical-bars pagination is deployed (#29).
- Six mobile fixes merged; they ship with 1.1.0.
- **Product direction (Giorgio, 2026-09-29): the app and platform come FIRST.**
  - The Design Lead is designing the real key app screens for approval.
  - The mobile phases build to them.
  - The landing redesign (PR #45, draft) is **parked** until then, so that it shows the real app.
- **Backend release, 2026-09-29 afternoon (PRs #54–#58).** It is live and effect-verified, and every deployed function was byte-verified against `main`:
  - fixed-notional rebuys reinvest exactly the sale's proceeds (#54);
  - the username format is enforced on every write, and `set_username` / `check_usernames` exist (#55);
  - all-cash players are scored instead of refused forever (#56);
  - the snapshot jobs include bots, drop SKIP rows, and never classify coverage on a failed read (#57);
  - the draft pick clock and server auto-pick run through one legality gate, with a draft queue (#58).
  The auto-pick **cron** is still deferred until a live test (§4 item 19).
- **Design (Giorgio, 2026-09-29):** one layout in two complete themes, Light/Dark, with a System / Light / Dark setting. It replaces the money/game two-surface model. Board v3.3 is on draft PR #52 (the artifact is the review copy). Mobile foundation PR #53 is held for the theme rework.
- **The product name is deferred to pre-launch.** "Stockpile" is a live third-party trademark (USPTO Reg. 4593157), so it must change; Stockade is the front-runner (`docs/design/NAMING.md`). All UI reads `brand.name`.

---

## 2. Prod ledger

### Database

| Fact | State | Evidence |
|---|---|---|
| Migrations applied | Everything in `supabase/migrations/` **through `20261010000000`** | `db push` dry-run (exactly `20261006000000`, `20261007000000`, `20261010000000`) + push, and `schema_migrations` verified by query, 2026-09-29 |
| `trades.funded_by_trade_id` (#54) | Applied: a nullable uuid FK, CHECK `trades_funded_by_trade_id_buy_only` (validated), and the partial UNIQUE index `trades_funded_by_trade_id_unique` (one sale funds at most one buy) | Verified by query, 2026-09-29 |
| Username write path (#55) | Applied. CHECK `user_profiles_username_format` `convalidated = true` (pre-check: 0 violators of 4 rows). `set_username` / `check_usernames` are DEFINER with `search_path` pinned; the ACL is `postgres, service_role, authenticated`, with no anon. `username-write-path-effect-test.sql`: **19/19 PASS** (incl. message-strict anon cases) | 2026-09-29 |
| Draft pick clock + queue (#58) | Applied. `leagues.pick_seconds` (CHECK 30/45/60/75/90), `pick_clock_enabled`, `draft_started_at` (trigger `trg_leagues_pick_clock`, enabled); `drafts.recorded_at` / `pick_source` (CHECK); `draft_queue` (RLS on; no anon; authenticated `r` + PG17 default `m`). Grants:<br>• `get_draft_clock`: authenticated + service_role (INVOKER)<br>• `set_draft_queue`: authenticated (DEFINER)<br>• `overdue_draft_turns`, `auto_pick_search_candidates`, `enforce_leagues_pick_clock`: service_role only<br>`draft-pick-clock-effect-test.sql`: **26/26 PASS** | 2026-09-29 |
| Pre-existing draft held from auto-pick | `test_07_05_26` (`ebd8fae4-…`) has `pick_clock_enabled = false`: it was mid-draft at push time, so the sweep never touches it. To opt it in (with a fresh clock), `UPDATE leagues SET pick_clock_enabled = true WHERE id = …`; otherwise abandon it by hand | 2026-09-29 |
| `get_home_summary()` / `get_league_display_names(uuid)` / `participant_display_name(text)` (#42) | Applied. The two entry points' ACL is `{postgres, authenticated}`; the helper's is `{postgres}` only (no service_role); `search_path` is pinned. `home-summary-display-names-effect-test.sql`: 14/14 PASS | 2026-09-28 |
| `league_activity` view (security_invoker) + `handle_new_user_profile` trigger on `auth.users` + `market_calendar`/`_coverage` + `apply_market_calendar` (service_role) / `market_session_status` (authenticated) (#43) | Applied. relacl/proacl verified (anon has no access to any of them). `game-data-asks-effect-test.sql`: 19 PASS + 2 CHECK. The CHECKs are anon refused with 42501, stricter than expected; the expectation is updated in PR #50 | 2026-09-29 |
| Missing user profiles backfill (#49) | Applied. `users_without_profile = 0` (was 2 of 4) | 2026-09-29 |
| F10 client schedule-insert policies ([I8]/[I9]) | Dropped (PR #22); only SELECT policies remain on `matchups`/`league_standings`; effect test A/B/C PASS | 2026-09-25 |
| Held in `deferred/` | `20260929000000_drop_I6_I2b.sql`, which waits for the 1.1.0 build to ship. `20261010000001_schedule_draft_autopick_sweep.sql` (the auto-pick cron) has preconditions 1–4 met, plus a manual sweep run returning `200 {"ok":true,"examined":0}` with the vault key. It still needs precondition 5, a live overdue-turn test (§4 item 19). See `supabase/migrations/deferred/README.md` | 2026-09-29 |
| Signup gate | `app_config.signups_paused = true`; `restrict_new_signups` ACL correct | 2026-09-24 |
| Signup gate dashboard hook ("Before User Created") | Live: a non-allowlisted mobile signup was refused with the hook's message | Effect-verified 2026-09-25 |
| `finalize_league_draft` | Applied; ACL `{postgres, service_role}`; `search_path=public, pg_temp`; season-1 backfill ran (2 → 0 leagues missing a season) | 2026-09-25 |
| `join_league_by_code` draft guard | Applied; ACL `{postgres, service_role}`; effect test 8/8 PASS | 2026-09-25 |
| `leagues` F1 column-guard trigger + F6 standings rule | Applied; effect test 8/8 PASS | 2026-09-25 |
| `league_members_insert_self` ([I4]) narrowed | Applied; effect test 9/9 PASS | 2026-09-25 |
| `symbols.price_unsupported` | Applied; 421 active symbols marked (matches the code's regex exactly) | 2026-09-25 |
| Symbol pricing backfill | 4,613 of 14,754 active symbols unpriced (down from 4,749); drains ~150/h. BAC and F still unpriced at last check | 2026-09-25 evening |
| `db-snapshot.json` | Captured **2026-08-12**, stale. Re-capture with `docs/architecture/db-snapshot.sql` | — |

> **Migration header comments are authoring-time notes, not deploy state.** "HOLD" in
> a header holds nothing; only `supabase/migrations/deferred/` does (CLAUDE.md).
> `schema_migrations` is the truth.

### Edge functions

**Deployed and byte-verified against `main`** (`supabase functions download` into
scratch, then `diff`), all from the deploy checkout `/Users/giorgio/fantasy-stock-deploy`:

| Function | Deployed from | Notes |
|---|---|---|
| `validate-and-record-pick` | `f0e8eda` | #58: every pick (manual, bot, auto) goes through `_shared/pick-gate.ts` + `draft-write.ts`; new `action:'auto_pick'`; finalize + heal; `bot_pick` |
| `draft-autopick-sweep` (new) | `f0e8eda` | #58. `verify_jwt=false` + the shared `_shared/cron-auth.ts` guard. A no-credential POST returns its own `401 {"error":"Unauthorized"}`. A manual `net.http_post` with the vault key returned `200 {"ok":true,"examined":0}`. **Not scheduled yet** (cron deferred) |
| `record-trade` | `f0e8eda` | #54: proceeds-sized rebuys, `sold_trade_id`, read-only `action:'preview'`, price rounded before sizing. (Previously UNVERIFIED; now byte-verified) |
| `process-week-results` | `f0e8eda` | #56: the `cash_only` scorer, `scoring_inputs_fetch_failed` refusal, and the week-1 fallback SKIP fix; plus the earlier terminal job status |
| `snapshot-week-start`, `snapshot-week-end` | `eb89df3` | #57: bots included, SKIP rows dropped (`_shared/snapshot-holdings.ts`), and `checkSnapshotReads`, so a failed read aborts and retries the league instead of classifying it complete. (Previously UNVERIFIED; now byte-verified) |
| `draft-control` (new) | `28e6885` | start / add_bots / status; `DRAFT_BOTS_ALLOWED_EMAILS` = test account |
| `enrich-symbols` | `8015e95` | batch-pricing fix |
| `preview-league` | `336775a` | hard `draft_started` refusal |
| `historical-bars` | `451ac8e` | PR #29 pagination + timeouts + `complete`/`truncatedSymbols` flags; byte-verified 2026-09-26; its new log line is live |
| `refresh-market-calendar` (new) | `9d86213` | PR #43. `verify_jwt=false` + constant-time `SB_SECRET_KEY_CRON` guard. A no-credential POST returns its own `401`. A manual run populated 68 sessions (2026-09-22 → 2026-12-28) |
| `refresh-symbols`, `send-notification` | `5e3b5d1` | PR #9. `send-notification` is uncalled until 1.1.0 ships |

**UNVERIFIED vs `main`** (never compared): `quote`, `ticker-quotes`, `finnhub-quote`,
`join-league`, `symbol-name`, `symbols-search`. Two functions turned out to be running unmerged-branch code
(found 2026-09-25), so audit these before trusting them (§4).

Deleted under DR-001 (do not resurrect): `place-order`, `save-broker-keys`,
`get-broker-keys`, `sync-alpaca-orders`, and the `broker_credentials` table.

### Cron jobs

| Job | Schedule (UTC) | Verified by effect |
|---|---|---|
| `snapshot-week-start` | `35 14 * * 1,2` | First run for the new leagues: Tue 2026-09-29 |
| `snapshot-week-end` | `5 21 * * 5` | First for the new leagues: Fri 2026-10-02 |
| `process-weekly-matchups` → `process-week-results` | `15 21 * * 5` | `cron_job_status` = `success` on 2026-09-25 (previous Fridays stranded at `running`) |
| `enrich_symbols_10min` | `*/10 * * * *` | `enriched_at` advancing 50/run |
| `refresh_symbols_daily` | `0 */6 * * *` | `200 {"ok":true,"count":13246}` |
| `refresh_market_calendar_daily` (new, #49) | `20 10 * * *` | Scheduled 2026-09-29 (`cron.job` row confirmed). **Verify by data the next day:** `market_calendar_coverage.refreshed_at` within ~24 h |
| `draft_autopick_sweep` (#58) | `10 seconds` (pg_cron is **1.6**) | **Not scheduled**: still in `deferred/` pending the live test (§4 item 19). The cron posts only when `overdue_draft_turns()` returns a row, and reads its key from `vault.decrypted_secrets`. |

> **`net._http_response` can't show the outcome of any job that runs longer than 5 s**
> (pg_net's default timeout; no cron migration sets `timeout_milliseconds`). All the
> jobs above do. Verify by data, never by that table or by `cron.job_run_details`
> (CLAUDE.md, success signals #8).

### Clients

| Surface | State |
|---|---|
| Web (Vercel, auto-deploys `main`) | Deployed. `APP_PAUSED = true`, so the landing page only (the pre-redesign landing, plus #24's heading fix). The web design foundation (PR #35) is merged, and the prod bundle was proven byte-identical. Web drafting was fixed (PR #17) but is paused. |
| Mobile | **1.1.0 on `main`, NOT released.** It has everything from 2026-09-25 (design system, server-side draft start and bots, name search, finalize UI, the PR #9 client fixes). It also has, since then:
  - pre-season/draft-pending labels and Start Draft re-enabling (#26);
  - the zero-league Matchup state (#28);
  - pre-season surfaces and bot-id lookups (#36);
  - Home/Portfolio P/L over all holdings, cash-flow adjusted (#37);
  - password-reset link hardening (#41);
  - the signup username sent as metadata (#43).
  Those are all mobile-only and ship with 1.1.0. `expo-crypto` is a new native module, so over-the-air updates can't reach 1.0.0; it needs an **EAS build**. Tested end to end in the iOS Simulator (Expo Go SDK 54), see `docs/testing/MOBILE_SIMULATOR.md`. |

---

## 3. Workstreams

| Workstream | Status | Detail |
|---|---|---|
| Server-side season generation (PR #14) | ✅ Live and proven by two prod drafts | `supabase/migrations/20260926000000_finalize_league_draft_rpc.sql` |
| Mobile draft flow (PR #20) | ✅ Live (server); mobile client ships with 1.1.0 | `supabase/functions/draft-control/` |
| Security scan 2026-07-30 (PR #9) | ✅ Server side live and verified; **F10 closed** (PR #22, effect test 3/3). **Open: F8** (push tokens; needs 1.1.0 installed first). F12 superseded. | `docs/security/DEPLOY-RUNBOOK.md`, `docs/security/REMAINING-SECURITY-WORK.md` |
| RLS hardening | [I4] narrowed (PR #19); [I7] retired. [I8]/[I9] dropped (PR #22). [I6]/[I2b] drop held for 1.1.0. Remaining interim: [I1], [I2a], [I3], [I5] (create/update/delete/leave-league still client-side). | `docs/migrations/RLS_HARDENING_SPEC.md` |
| Supabase API-key migration | Phases 0–3b done. **Phase 4** (disable legacy keys, a one-way door) is gated on (1) a real publishable-key **trade** from current mobile code (still untested) and (2) a real mobile draft (**done 2026-09-25**). | `docs/migrations/MIGRATION_STATUS.md` |
| In-house simulator (DR-001) | ✅ Phases 0–4 done and applied | `docs/decisions/DR-001-in-house-simulated-trading.md` |
| UI/UX program (full web + mobile overhaul) | Phase 0 audit ✅ (#27). Phase 1 ✅: **Game Day** direction approved (#30, #31/#34/#40/#46 token amendments). Phase 2:
- The web foundation is ✅ merged (#35).
- The mobile foundation (PR #53) was DESIGN-APPROVED, then **held (draft) for the Light/Dark theme rework** (DESIGN_DIRECTION §9A: `<Surface kind>` becomes a ThemeProvider, and the `*.onGame` tokens are deleted).

Phase 3: **app first**.
- Board v3.3 (PR #52, draft) holds the key screens plus the full inventory of 41 screens, in Light and Dark, with contrast scored for 14 tokens and 25 fg-on-fill pairs.
- 3b-1/3b-2/3c/3e build to it, then 3d (the web app). The landing (3a, PR #45) is parked until then. The review bar is raised (#47), and the copy rules are verbatim + generic scoring (#48). | `docs/design/UI-UX-PROGRAM.md`, `docs/design/prompts/phase3-plan.md` |
| Phase 3 backend asks | ✅ #1 Home summary + #2 display names (#42); ✅ #5 trades ∪ picks, #6 signup username, #7 market calendar, #9 draft recap (verified existing) (#43/#49); ✅ #3 met client-side (`buildPLSeries`, #37). Open, and nice-to-have for 3c: #4 intraday samples, #10 scoring status, #11 season result | `docs/design/prompts/phase3-plan.md` |
| Product name | Deferred to pre-launch. Stockpile must go (a live third-party TM); **Stockade** is the front-runner and Odd Lot the runner-up. The rename is prepared on a local, unpushed branch `chore/rename-to-stockade`. Keep the bundle id, slug and scheme | `docs/design/NAMING.md` |
| Mobile design-system pass (PR #15) | ✅ Merged; ships with 1.1.0 | — |
| Architecture map | Current on `main`; db-snapshot stale | `docs/architecture/`, CLAUDE.md |

---

## 4. Open items (ordered by launch impact)

1. **Ship mobile 1.1.0 (EAS build).** It's the only way any of 2026-09-25's mobile
   work reaches phones. 1.0.0 builds can't draft (RLS refuses their direct inserts).
   After install, verify a real **trade** on the publishable key (API-key Phase 4
   gate 1) and the F2 password-reset flow (needs the `fantasystockapp://**` redirect
   URL, added 2026-09-25).
2. ✅ **F10: closed 2026-09-25** (see §5). Number kept so references stay stable.
3. **First scored week, Fri 2026-10-02.** Check `week_snapshots` rows for
   test_0925/test_09_25_v2 after Tue 09-29 14:35 UTC, then `matchups.team1_gain` set
   and `cron_job_status` `success` after Fri 21:15 UTC. This is the last unproven link.
   Also check the market-calendar job by data on 09-30 (`refreshed_at`).
   **Week 2 (bots, #57):** after Mon 10-05 14:35 UTC, every `bot-*` participant must
   have week-2 `week_snapshots` rows (except SKIP-only bots), and `upper(symbol)='SKIP'`
   rows must be 0. After Fri 10-09, week-2 bot matchups must have `team1_gain` non-NULL.
4. ✅ **Mobile draft-screen bugs**: merged (#26, #36). Number kept.
5. **Bot picks are client-triggered** until the `draft_autopick_sweep` cron is promoted
   (item 19). #58's sweep is deployed and auto-picks overdue turns, bots included,
   once scheduled.
6. **Symbol pricing backlog** (~30 h to drain from 2026-09-25). A well-formed ticker
   that Alpaca 400s on every run isn't auto-promoted to `price_unsupported` (the
   half-batch cap bounds the damage); a failure counter is the follow-up.
7. **F8: Expo push tokens** readable by any authenticated user. Staged:
   `docs/migrations/STAGED_L2_push_token_capability.sql`. Apply only after 1.1.0 is on
   all testers' phones, since 1.0.0 reads and writes the column.
8. **`[I6]/[I2b]` drop** (`deferred/20260929000000_drop_I6_I2b.sql`), after 1.1.0
   ships. Until then, any member can still add bots directly via PostgREST.
9. **Season 2+ never gets a schedule.** `start_new_league_season` deletes matchups
   and nothing regenerates them. Follow-up: route it through an edge function
   reusing `_shared/schedule.ts` + `finalize_league_draft`.
10. **`record-trade` concurrent-buy race**, now narrowed by #54 to **cross-user
    same-symbol** (the same-user proceeds race is closed by
    `trades_funded_by_trade_id_unique`). It still needs an atomic SECURITY DEFINER RPC.
11. **No leave-league flow on mobile.**
12. **Deployed-function drift audit** for the UNVERIFIED functions in §2.
13. **Cron monitoring gap:** give each cron `net.http_post` an explicit
    `timeout_milliseconds` so `net._http_response` records real outcomes; share
    `process-week-results/job-status.ts` with both snapshot jobs (they still discard
    their status-write result).
14. **Hygiene:**
    - the revoked Alpaca pair is still stored as secrets `ALPACA_KEY_ID`/`ALPACA_SECRET_KEY` and in `.env.local`;
    - `.gitleaks.toml` allowlists all of `^\.claude/`;
    - `components/LeagueCarousel.tsx` is orphaned (delete task exists);
    - ~25 merged local branches;
    - `db-snapshot.json` needs re-capture;
    - `process-week-results/index.ts` has 10 pre-existing `deno check` errors.
15. **Design → build (the app first):** the board is at v3.3 (PR #52). Pending Giorgio: the "other leagues" row (Concept A with the row, or B with the pill only), and bye = automatic win vs league median (item 18). Next:
    - PR #53 (mobile foundation) gets the Light/Dark ThemeProvider per §9A;
    - then 3b-1 (its backend precondition, `set_username`, is ✅ live);
    - then 3b-2 / 3c / 3e, then 3d (the web app);
    - then the landing resumes from PR #45 (`~/fantasy-stock-design-review/ui-landing-gameday/PARKED.md`).
16. **Market-data attribution.** Giorgio approved a credit line; the board uses "Market data provided by Alpaca" on price surfaces. Confirm the exact wording against the provider's terms. The live landing still shows `[MARKET DATA ATTRIBUTION PLACEHOLDER]`.
17. **Before public launch:** item 1, F8, trade race, leave-league, season 2+, legacy
    keys disabled, `APP_PAUSED = false`, then open signups with
    `UPDATE public.app_config SET signups_paused = false;` (and verify the signup hook
    toggle first).
18. **One league ranking (`fix/unified-league-ranking`, in progress). Deploy before
    Fri 2026-10-16**, when the test leagues' regular seasons end.
    - Standings, Home and playoff seeding currently use 9 different orders. The branch unifies them via the `league_standings_ranked` RPC: W + 0.5·T, then balanced mini-league H2H, then season gain, then join order.
    - It also fixes two bugs: a slice-before-tiebreak at the playoff cutoff, and a league stranded in 'playoffs' with no bracket. The atomic playoff transition is still being finished.
    - **Open for Giorgio:** byes are currently an automatic WIN and aren't evenly distributed. Should a bye instead be scored against the league median?
19. **Promote the auto-pick cron.** Live test first (deferred README precondition 5):
    1. Create a test league with bots.
    2. Before starting the draft, `UPDATE leagues SET pick_seconds = 30 WHERE id = …`.
    3. Start it, close every app, run the sweep manually, and verify `auto_*` / `bot` picks each ≥ 30 s apart.
    4. Then `git mv` the cron file into `supabase/migrations/`, `db push`, and check `cron.job`.
20. **Follow-ups from 2026-09-29:**
    - snapshot-week-end reports `success` when `unbasedPositions` is non-empty (a missed week-start should be surfaced distinctly);
    - snapshot-week-start's "no active leagues" early return writes no terminal status;
    - move the mobile/web profile + login upserts onto `set_username` (mobile `profile.tsx` never calls `validateUsername`);
    - revoke PG17 `MAINTAIN` from `authenticated` on `draft_queue`;
    - `validate-and-record-pick` returns `draft_not_in_progress` before its membership check (pre-existing);
    - the client TradeModal must show proceeds-sized buys and the "which sale pays?" picker (3e).

---

## 5. Resolved 2026-09-24 → 2026-09-29

| Defect | Fix | Proof in prod |
|---|---|---|
| Mobile-drafted leagues never got a season (schedule/standings/dates only written by the paused web) | PR #14: `finalize_league_draft` RPC + server finalize/heal | Two real drafts produced full seasons |
| No season row for leagues created after 2026-01-25 | PR #14: RPC creates season 1 + backfill | Backfill 2 → 0 |
| `process-week-results` stranded status at `running` | PR #12 | Fri 09-25 row = `success` |
| F10: members could forge matchups/standings via client INSERT policies [I8]/[I9] | PR #14 (server finalize) + PR #22 (policy drop, `20261002000000`) | `f10-policy-drop-effect-test.sql` A/B/C PASS; `pg_policies` shows SELECT only |
| Landing hero headline collapsed to 24px on phones (app-wide 480px `!important` rules) | PR #24 | Live check: h1 56px at 375 |
| The mobile Home header's P/L covered only 5 of 18 holdings (+29.29% vs a true +8.15%); 1W counted deposits as gain | PR #37 (client) + PR #29 (historical-bars capped at 1,000 bars, no pagination) | Real data: +$612.13 / +8.15%; 1W +$25.14 (was +$5,025) |
| Pre-season: a red "$-3,000", "Leading +$0.16" before any week, Buy before the draft; a bot-id toast broke profile lookups for everyone in the batch | PR #26, #36 | Simulator + DESIGN-APPROVED |
| Zero-league Matchup showed "Duration League" | PR #28 | Simulator |
| An expired or old reset link led to a dead "Auth session missing" form; the reset screen's password rule (6) contradicted signup (8+ complex) | PR #41 | 130 tests; device test pending 1.1.0 |
| Signup usernames were never saved (an RLS-refused anon upsert under email confirmation); 2 of 4 accounts had no profile | PR #43 (trigger + metadata) + PR #49 (backfill) | `users_without_profile = 0`; effect test #6 G–J PASS |
| Opponent names showed as "Opponent --" or truncated bot ids | PR #42 | Effect test 14/14 |
| Prod ran unmerged-branch `refresh-symbols`/`historical-bars` | PR #9 merge + reconciliation redeploy | Downloads byte-identical to `5e3b5d1` |
| F1/F11 member column rewrite; F6 standings; F5; F9; F7 server half | PR #9 | Effect test 8/8 |
| `enrich-symbols`: one bad symbol wiped a 50-symbol price batch (~4,749 unpriced) | PR #16 | 421 = 421 seed check; backlog draining |
| Web draft page never loaded `stake_mode` (drafting blocked since 08-11); Portfolio read retired `budget_mode` | PR #17 | Unpaused local build |
| Users could join mid-draft | PR #18 | Effect test 8/8 incl. an authenticated direct call → 42501 |
| `[I4]` self-insert bypass (anyone could join any league by ID) | PR #19 | Effect test 9/9 |
| Mobile couldn't start a draft, add bots, search by name, trust finalize; League Settings unreachable | PR #20 | `test_09_25_v2`, fully on mobile |
| Fixed-notional rebuys were sized at a fresh full notional, which created or destroyed money on every sell-then-rebuy; the fill price wasn't rounded before sizing | PR #54 (`funded_by_trade_id` + proceeds walk + a unique index) | Column, CHECK and index verified; `record-trade` byte-verified |
| The username format was enforced only in the signup trigger; the own-row UPDATE policy accepted any string | PR #55 (validated CHECK + `set_username` / `check_usernames`) | Effect test 19/19; PGlite 15 steps |
| All-cash players (sold out, no rebuy) had matchups refused forever from week 2 (and auto-lost in week 1); a failed scoring-input read was scored as empty | PR #56 (`cash_only`, proven flat at BOTH week boundaries; `scoring_inputs_fetch_failed`) | Deployed + byte-verified; the first real cash-user week is still to observe |
| Bots never got snapshots (every bot matchup refused from week 2); a SKIP row became an unpriceable 1-share holding that stalled the whole league; a failed read could mark a week complete or overwrite Monday's prices | PR #57 | Deployed + byte-verified; the effect is observed after Mon 10-05 (item 3) |
| No pick clock; a timed-out manager stalled the draft; bot picks needed an open client | PR #58 (clock, server auto-pick through one legality gate, queue, sweep) | Effect test 26/26; the sweep's 401 and manual 200 verified; cron pending (item 19) |
| Seed generator overwrote an applied migration | PR #13 | — |
| Mobile design-system pass unmerged since 09-01 | PR #15 (visual review in the Simulator) | — |

---

## 6. Branches

| Branch | State |
|---|---|
| `main` | Deployed to Vercel prod (landing only). |
| `ui/landing-gameday` | PR #45, **draft, parked**: the Game Day 3D landing, round 4. Resume after the key screens are approved. |
| `ui/foundation-mobile` | PR #53, **draft, held** for the Light/Dark ThemeProvider rework (§9A). |
| `design/key-screens-2026-09-29` | PR #52, **draft**: the design board (v3.3), the source of truth for the app screens. Merge after Giorgio signs off. |
| `fix/unified-league-ranking` | In progress (item 18). |
| `chore/rename-to-stockade` | LOCAL only (a97bfbb), parked until the name is final. |
| `fix/effect-test-anon-expectations` | PR #50 (test file only). |
| `docs/status-sync-2026-09-29` | This update (PR #51). |
| Merged 2026-09-29, safe to delete | `fix/fixed-notional-slot-proceeds`, `fix/username-write-path`, `fix/all-cash-unscoreable-matchup`, `fix/snapshot-bots-and-skip-rows`, `feat/draft-pick-clock-autopick` |
| Merged, safe to delete with `git branch -d` | `security/claude-security-fixes-20260730`, `feat/server-schedule-generation`, `feat/mobile-draft-start-search-finalize`, `fix/*` from PRs #12/#13/#16–#19/#22, `docs/status-sync-2026-09-25`, `ui/design-system-pass-v2`, `docs/ui-ux-program`, `claude/platform-project-analysis-34b47a`, plus ~20 older (`simulator-core`, `phase4-*`, `item*`, …) |
| Superseded backups | `ui/design-system-pass`, `item4-fix-refresh-symbols-cron`, `backup/pre-filter-2025-08-20` |

---

## 7. Re-verification queries

Run each **separately** in the Supabase SQL editor (it only shows the last
statement's result).

```sql
-- Applied migrations
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 20;
```
```sql
-- Completed matchup leagues missing a schedule (should be empty)
SELECT l.id, l.name, l.league_start_date,
       (SELECT count(*) FROM matchups m WHERE m.league_id = l.id) AS n_matchups
FROM leagues l WHERE l.league_type = 'matchup' AND l.draft_status = 'completed';
```
```sql
-- Stuck draft finalization (every pick made, still in_progress) — should be empty.
SELECT l.id, l.name, l.league_type,
       (SELECT count(*) FROM drafts d WHERE d.league_id = l.id)         AS picks,
       (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) AS members,
       l.num_rounds
FROM leagues l
WHERE l.draft_status = 'in_progress'
  AND (SELECT count(*) FROM drafts d WHERE d.league_id = l.id) > 0
  AND (SELECT count(*) FROM drafts d WHERE d.league_id = l.id)
      >= (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) * l.num_rounds;
```
```sql
-- Symbol pricing backlog
SELECT count(*) FILTER (WHERE active AND last_price IS NULL) AS unpriced,
       count(*) FILTER (WHERE is_draftable)                  AS draftable
FROM symbols;
```
```sql
-- Latest scoring run status (should be success/failed, never stuck at running)
SELECT run_date, status, error_message, updated_at FROM cron_job_status
WHERE job_name = 'process-week-results' ORDER BY run_date DESC LIMIT 3;
```
```sql
-- RLS INSERT policies on the league tables
SELECT tablename, policyname, cmd, with_check FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('league_members','matchups','league_standings')
ORDER BY tablename, policyname;
```
```sql
-- Grants on the security-definer RPCs: expect service_role (+ postgres) only
SELECT proname, proacl, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname IN ('finalize_league_draft','join_league_by_code');
```
```sql
-- Live cron jobs
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
```
```sql
-- Signup gate
SELECT (SELECT signups_paused FROM public.app_config LIMIT 1) AS signups_paused,
       (SELECT proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND proname = 'restrict_new_signups') AS hook_fn_acl;
```
