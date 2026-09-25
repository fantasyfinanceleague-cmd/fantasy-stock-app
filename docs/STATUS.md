# Stockpile — Project Status

**Single source of truth for "what is deployed, what is done, what is left."**
Update this file at the end of any session that changes prod state or lands a
workstream. Per-workstream detail lives in the documents linked below; this page
only summarises and points.

**Last verified against prod: 2026-09-24** (read-only SQL run by Giorgio; results
recorded inline). Anything marked **UNVERIFIED** has not been checked against prod
and must be confirmed before anyone builds on it.

---

## 1. Where things stand (one paragraph)

The backend is largely built and tested. The DR-001 in-house simulator (server-side
draft/trade validation, stake modes, draft slots, categories, symbol enrichment), the
snapshot → scoring pipeline, RLS hardening and the API-key migration are all on
`main`, and **every migration on `main` is applied in prod**. The web app is deployed
but paused to a landing page; mobile is the real product surface. **The top blocker
is that a league drafted on mobile never gets a season schedule** (§4, defect 1) — the
schedule is generated only by the paused web client. No league has completed a draft
in prod since the Phase 3 server-side draft path shipped, so that path has never run
end-to-end in prod.

---

## 2. Prod ledger

### Database

| Fact | State | Evidence |
|---|---|---|
| Migrations applied | **All** files in `supabase/migrations/` through `20260816000000` | `supabase_migrations.schema_migrations`, 2026-09-24 (queried `>= 20260811`; earlier versions inferred from the 2026-08-12 `db-snapshot.json`) |
| `20260811000009` (drop `leagues.salary_cap_limit`) | **Applied** — it was authored as "hold for mobile release" | same. Consequence: any mobile build older than the Phase 4 UI work still writes that column and **league create/edit fails** on it |
| Signup gate (`20260815000000`) | Applied; `app_config.signups_paused = true`; `restrict_new_signups` ACL = `postgres, service_role, supabase_auth_admin` only (no `anon`/`authenticated`) | 2026-09-24 query |
| Signup gate dashboard hook ("Before User Created") | **UNVERIFIED** | Effect test: a non-allowlisted signup must be refused; an existing user must still sign in |
| `leagues.allow_undraftable` | Present | 2026-09-24 query |
| Completed matchup leagues | 3, all test data (`__TEST_SIMULATION__`, `Test`, `dec 11 test`), all with matchups, all drafted pre-Phase-3 via web | 2026-09-24 query |
| `db-snapshot.json` | Captured **2026-08-12** — stale | re-capture with `docs/architecture/db-snapshot.sql` |
| Architecture-map drift panel | 2 HIGH rows, **neither actionable**: `restrict_new_signups` "absent" is snapshot staleness (ACL confirmed live 2026-09-24); `symbols` public SELECT is a recorded decision (see its annotation). All 5 `unverified` entries clear on snapshot re-capture. | `node scripts/gen-architecture.mjs` (regenerated 2026-09-24) |

> **Migration headers are authoring-time notes, not deploy state.** Several applied
> migrations still say "AUTHORED, NOT APPLIED" / "HOLD" in their header comments. We
> deliberately do not rewrite applied migrations. `schema_migrations` is the truth.

### Cron jobs (per 2026-08-12 snapshot — UNVERIFIED since)

| Job | Schedule (UTC) | Target | Notes |
|---|---|---|---|
| `snapshot-week-start` | `35 14 * * 1,2` | `snapshot-week-start` | Mon open (+Tue for holiday Mondays) |
| `snapshot-week-end` | `5 21 * * 5` | `snapshot-week-end` | Fri close |
| `process-weekly-matchups` | `15 21 * * 5` | `process-week-results` | Scores matchups, advances weeks/playoffs |
| `enrich_symbols_10min` | `*/10 * * * *` | `enrich-symbols` | Finnhub profiles + `is_draftable` |
| `refresh_symbols_daily` | `0 */6 * * *` | `refresh-symbols` | **Still 401s** — see §4 defect 4 |

### Edge functions (on `main`; deployed versions UNVERIFIED)

| Function | Auth | Role |
|---|---|---|
| `validate-and-record-pick` | JWT + in-code user | Authoritative draft-pick gate; marks draft complete on the final pick |
| `record-trade` | JWT + in-code user | Authoritative add/drop (buy/sell) gate |
| `quote`, `ticker-quotes`, `historical-bars`, `finnhub-quote` | JWT (`ticker-quotes`: none — see `config.toml`) | Market data on Stockpile's own Alpaca/Finnhub keys |
| `symbols-search`, `symbol-name` | JWT | Symbol lookup (run as anon — `symbols` SELECT policy is deliberately public) |
| `preview-league`, `join-league` | JWT | Join-by-code, atomic via `join_league_by_code` |
| `refresh-symbols` | JWT (cron needs apikey — PR #9) | Symbol universe refresh |
| `enrich-symbols` | cron apikey | Sector/industry + draftable flag |
| `snapshot-week-start`, `snapshot-week-end`, `process-week-results` | cron apikey (constant-time, fail-closed) | Weekly pipeline |

Deleted under DR-001 (do not resurrect): `place-order`, `save-broker-keys`,
`get-broker-keys`, `sync-alpaca-orders`, and the `broker_credentials` table.

### Clients

| Surface | State |
|---|---|
| Web (Vercel, auto-deploys `main`) | `main` @ `96ceb50` deployed OK. `APP_PAUSED = true` in `apps/web/src/App.jsx` → landing page only. See the build-verification trap in `CLAUDE.md`. |
| Mobile (Expo / EAS) | Phase 3/4 client code is on `main` but **only type-checked** — no device run. Which build/OTA channel testers are on is **UNVERIFIED**. |

---

## 3. Workstreams

| Workstream | Status | Detail |
|---|---|---|
| Supabase API-key migration | Phases 0–3b done. Phase 4 (disable legacy keys — one-way door) **not started**, gated on a real mobile trade + real mobile draft. Phase 5 cleanup open. | `docs/migrations/MIGRATION_STATUS.md` |
| RLS hardening | B1 + preview/join wave done. Interim write policies `[I1]–[I6]`, `[I8]`, `[I9]` remain until create-league / draft-control / leave-league / delete-league / schedule-gen move server-side. | `docs/migrations/RLS_HARDENING_SPEC.md` |
| In-house simulator (DR-001) | Phases 0–4 **done, merged, applied**: schema, server-side pick/trade validation, stake modes, slots, categories + seed, enrichment cron, `is_draftable` enforcement + commissioner override, league-setup and draft UI. | `docs/decisions/DR-001-in-house-simulated-trading.md`, `docs/migrations/SIMULATOR_MIGRATION_SPEC.md` |
| Security scan 2026-07-30 (13 findings) | PR #9 (`security/claude-security-fixes-20260730`) — **unmerged, deploy-ready in code**; re-merged with `main` @ `2be4638` on 2026-09-24, reviewer passes clean (no CRITICAL/HIGH). Fixes F1–F3, F5, F6, F7, F9, F11, F13. Migrations re-timed to `20260925000000`/`…01` (the July timestamps were older than prod's latest and `db push` would refuse them). Needs: push → merge → deploy 3 functions + `db push` from `/Users/giorgio/fantasy-stock-deploy` @ the merge commit → **EAS build 1.1.0** (new native module `expo-crypto`; **not OTA-able** to 1.0.0). Open: **F8** (push tokens; now also waits for 1.0.0 binaries to drain), **F10** (schedule forgery, being closed by server-side schedule gen). F12 superseded by `main`. | `docs/security/DEPLOY-RUNBOOK.md` (ordered), `docs/security/REMAINING-SECURITY-WORK.md` on the PR branch |
| Mobile design-system pass | Branch `ui/design-system-pass-v2` (9 commits, 2 behind `main`) — **unmerged**, awaiting an Expo Go visual check. | memory / branch log |
| Signup gate | Applied; hook toggle unverified (§2). Opening signups = one `UPDATE app_config`. | `supabase/migrations/20260815000000_signup_gate.sql` |
| Architecture map | Generator + viewer live. Regenerate after any backend/call-site change. | `docs/architecture/`, `CLAUDE.md` |

---

## 4. Open defects (ordered by launch impact)

1. **CRITICAL — mobile-drafted leagues never get a season.** `matchups`, initial
   `league_standings`, and `league_start_date`/`league_end_date` are written only by
   the web client (`apps/web/src/pages/DraftPage.jsx` `completeDraft`, and the
   `Leaderboard.jsx` "auto-generate if missing" effect). Mobile writes none of them;
   the server's `markDraftComplete` in `validate-and-record-pick` only flips
   `draft_status`. Every weekly job selects from `matchups`, so such a league is never
   snapshotted or scored. The web path is also racy: the server now marks the draft
   complete, and a realtime update can set the local status to `completed` before
   `completeDraft` runs, which then skips schedule generation.
   **Fix:** a server-side `generate_league_schedule` (SECURITY DEFINER RPC, idempotent,
   pinned `search_path`) called from `markDraftComplete`; covers playoffs + standings
   init; then drop `matchups_insert_members`. This is the same work as **F10** /
   RLS `[I8]`/`[I9]`. Needs one product decision: canonical roster ordering
   (recommended: `DraftPage`'s commissioner-first + sorted, matching the server's
   draft order).
2. **F10 — any league member can insert arbitrary matchups.** Closed by the fix above.
3. **`process-week-results` strands `cron_job_status` at `running`** on its two
   early returns (`index.ts:914` query error, `:919` no pending matchups), so the job's
   health signal could not distinguish healthy from broken.
   **FIXED — merged (PR #12, `a324395`) and DEPLOYED 2026-09-25** from
   `/Users/giorgio/fantasy-stock-deploy` @ `a324395` (`job-status.ts` confirmed in the
   deploy's "Uploading asset" list). An earlier deploy that day came from the wrong
   checkout and shipped stale code. **Only the effect check is pending.** The fix:
   the query-error return now writes `failed` with the error; the no-pending return
   writes `success` with message `processed 0 matchups: no pending matchups` (the
   CHECK allows only `running|success|failed|retrying`, so the message — stored in
   `error_message`, the table's only text column — carries the distinction; the
   scored path always writes a `processed N …; M refused …` summary, so the column is
   never a NULL-vs-text discriminator). The writer moved to `job-status.ts`, now
   checks the upsert's resolved `{ error }`, and never throws. Effect-check after the
   next Friday run (21:15 UTC)
   (`SELECT * FROM cron_job_status WHERE job_name = 'process-week-results';` must
   show a terminal status, not `running`).
4. **`refresh_symbols_daily` still 401s.** `20260811000000` (applied) makes the job
   send the cron apikey, but the deployed `refresh-symbols` is still `verify_jwt = true`
   with no apikey guard. PR #9 carries the other half (F5), ready to deploy (runbook
   step 5). Cleared only when `net._http_response` shows a `200 {"ok":true,"count":…}`
   for it, not when the deploy command succeeds.
5. **F8 — Expo push tokens are readable by every authenticated user** (and broadcast
   over Realtime) via `user_profiles.expo_push_token`. Staged fix:
   `docs/migrations/STAGED_L2_push_token_capability.sql`. Apply only after PR #9's
   `send-notification` is deployed and verified **and** testers are all on the ≥ 1.1.0
   build. 1.0.0 binaries read and write that column directly, so dropping it breaks them.
   Until then, F7's server-side send closes the *app's* cross-user token reads, but not
   an attacker's direct PostgREST/Realtime read.
6. **`record-trade` concurrent-buy race** — documented in code (`index.ts:229`);
   needs an atomic SECURITY DEFINER RPC (the `join_league_by_code` pattern).
7. **No leave-league flow on mobile** (web has one).
8. **Hygiene:** revoked Alpaca pair still stored as Supabase secrets
   `ALPACA_KEY_ID`/`ALPACA_SECRET_KEY` (no readers) and in local `.env.local`;
   `.gitleaks.toml` allowlists all of `^\.claude/` by directory (hid that leak once) —
   narrow it to specific files.

---

## 5. Critical path to a playable closed beta (mobile-first)

1. Confirm the signup-gate dashboard hook (§2).
2. Confirm which mobile build testers are on; anything pre-Phase-4 must update
   (salary-cap column drop, §2).
3. **Server-side schedule generation** (§4 defect 1) — the top engineering item.
4. Ship PR #9 per `docs/security/DEPLOY-RUNBOOK.md`: merge; then, from
   `/Users/giorgio/fantasy-stock-deploy` at the merge commit, deploy `historical-bars`,
   `refresh-symbols`, `send-notification` and `db push` (`20260925000000`/`…01`);
   effect-verify. Its mobile half rides the step-7 EAS build (1.1.0).
5. Stranded `running` status (§4 defect 3) — merged and deployed 2026-09-25; effect-check after Friday's 21:15 UTC run.
6. **One end-to-end test league in prod**: create → mobile draft → Monday snapshot →
   Friday scoring → week 2. This also clears both API-key Phase 4 gates.
7. Mobile release (EAS production build), merged with the design-system branch if it
   passes review.
8. Before public launch: F8, trade race, disable legacy keys, set `APP_PAUSED = false`,
   then open signups with `UPDATE public.app_config SET signups_paused = false;`.

---

## 6. Branches

| Branch | State |
|---|---|
| `main` | Deployed to Vercel prod. |
| `security/claude-security-fixes-20260730` | PR #9, unmerged, 0 behind `main` @ `2be4638` (local merge 2026-09-24; **push pending**). GitGuardian check fails on the known anon-key false positive. |
| `ui/design-system-pass-v2` | Unmerged, awaiting visual check. Checked out in the main checkout. |
| `ui/design-system-pass`, `item4-fix-refresh-symbols-cron` | Superseded (backup / folded into `main` + PR #9). Safe to delete once confirmed. |
| ~20 others (`simulator-core`, `phase4-*`, `item*`, `signup-ux-password`, …) | Fully merged into `main` (0 commits ahead) — safe to delete with `git branch -d`. |

---

## 7. Re-verification queries

Run each **separately** in the Supabase SQL editor (it only shows the last
statement's result).

```sql
-- Applied migrations
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 20;
```
```sql
-- Completed matchup leagues missing a schedule (defect 1 in the wild)
SELECT l.id, l.name, l.league_start_date,
       (SELECT count(*) FROM matchups m WHERE m.league_id = l.id) AS n_matchups
FROM leagues l WHERE l.league_type = 'matchup' AND l.draft_status = 'completed';
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
