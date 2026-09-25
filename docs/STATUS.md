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
| Security scan 2026-07-30 (13 findings) | PR #9 (`security/claude-security-fixes-20260730`, 11 commits, 0 behind `main`) — **unmerged**. Fixes F1–F3, F5, F6, F9, F11, F13, F7. Open: **F8** (push tokens), **F10** (schedule forgery). F12 superseded by `main`. | `docs/security/` on the PR branch |
| Mobile design-system pass | Branch `ui/design-system-pass-v2` (9 commits, 2 behind `main`) — **unmerged**, awaiting an Expo Go visual check. | memory / branch log |
| Signup gate | Applied; hook toggle unverified (§2). Opening signups = one `UPDATE app_config`. | `supabase/migrations/20260815000000_signup_gate.sql` |
| Architecture map | Generator + viewer live. Regenerate after any backend/call-site change. | `docs/architecture/`, `CLAUDE.md` |

---

## 4. Open defects (ordered by launch impact)

1. **CRITICAL — mobile-drafted leagues never get a season.** FIX AUTHORED on
   `feat/server-schedule-generation`, **NOT applied or deployed**. Until then, prod
   behaves as described here. `matchups`, initial `league_standings`, and
   `league_start_date`/`league_end_date` were written only by the web client
   (`DraftPage` `completeDraft` and the `Leaderboard` auto-generate effect). The
   server's `markDraftComplete` only flipped `draft_status`, so a mobile-drafted league
   was never snapshotted or scored.
   **Fix (on the branch):** the planning lives in `supabase/functions/_shared/schedule.ts`
   (pure, golden-tested against the web generator; roster order = `computeDraftOrder`).
   Writing is done by `finalize_league_draft` (migration `20260926000000`: SECURITY
   DEFINER, `service_role`-only, validates the payload). In one transaction it writes
   matchups, standings, dates, `num_weeks`, season 1 and the `draft_status` flip.
   `validate-and-record-pick` calls it on the final pick. On failure the draft stays
   `in_progress`, and any later pick, skip or `action:'finalize'` retries (detector:
   §7). The web writers are removed. Playoffs were already server-side
   (`process-week-results` `generatePlayoffs`); nothing moved there.
   **Apply order:** migration → deploy `validate-and-record-pick` → effect-verify with a
   test league → only then the deferred `[I8]`/`[I9]` drop
   (`supabase/migrations/deferred/README.md`).
   **Where to run (after the merge to `main`):** only from the deploy checkout
   `/Users/giorgio/fantasy-stock-deploy`, never from `/Users/giorgio/fantasy-stock`.
   Refresh it first:
   `git -C /Users/giorgio/fantasy-stock-deploy fetch origin && git -C /Users/giorgio/fantasy-stock-deploy checkout --detach origin/main`.
   Then run `supabase db push` (preview with `--dry-run` first) and
   `supabase functions deploy validate-and-record-pick --project-ref haiaaifjcclsvmkfqgmd`.
2. **F10 — any league member can insert arbitrary matchups.** Closed by the deferred
   `20260926000001` policy drop. It is held until defect 1's fix is deployed and
   effect-verified.
3. **`process-week-results` strands `cron_job_status` at `running`** on its two
   early returns (`index.ts:914` query error, `:919` no pending matchups). Until
   fixed in prod, the job's health signal cannot distinguish healthy from broken.
   **FIXED:** merged in PR #12 (`a324395`) and deployed 2026-09-25; the Friday
   `cron_job_status` effect check is pending.
   What changed:
   the query-error return now writes `failed` with the error; the no-pending return
   writes `success` with message `processed 0 matchups: no pending matchups` (the
   CHECK allows only `running|success|failed|retrying`, so the message — stored in
   `error_message`, the table's only text column — carries the distinction; the
   scored path always writes a `processed N …; M refused …` summary, so the column is
   never a NULL-vs-text discriminator). The writer moved to `job-status.ts`, now
   checks the upsert's resolved `{ error }`, and never throws. **Pending:** the
   effect check after the next Friday run
   (`SELECT * FROM cron_job_status WHERE job_name = 'process-week-results';` must
   show a terminal status, not `running`). Until it passes, treat the fix as deployed
   but unverified.
4. **`refresh_symbols_daily` still 401s.** `20260811000000` (applied) makes the job
   send the cron apikey, but `refresh-symbols` is still `verify_jwt = true` with no
   apikey guard. PR #9 carries the other half (F5).
5. **F8 — Expo push tokens are readable by every authenticated user** (and broadcast
   over Realtime) via `user_profiles.expo_push_token`. Staged fix:
   `docs/migrations/STAGED_L2_push_token_capability.sql`; apply only after PR #9's
   `send-notification` is deployed and verified.
6. **`record-trade` concurrent-buy race** — documented in code (`index.ts:229`);
   needs an atomic SECURITY DEFINER RPC (the `join_league_by_code` pattern).
7. **No leave-league flow on mobile** (web has one).
8. **Season 2+ never gets a schedule.** `start_new_league_season` deletes matchups,
   and nothing regenerates them. Mobile calls it from `league-settings.tsx`; the only
   regenerator was the web Leaderboard effect, now removed (it was paused anyway).
   Follow-up: route "start new season" through an edge function that reuses
   `_shared/schedule.ts` and `finalize_league_draft`. The RPC already handles the
   post-reset state: zero regular-season matchups gives a fresh schedule and new
   dates.
9. **No `league_seasons` row for any league created after 2026-01-25.** Only the
   one-off backfill and `start_new_league_season` insert seasons, so
   `complete_league_season` raises 'League has no active season' at the end of every
   newer league's season. `process-week-results` only logs it, and the league sticks
   in `playoffs`. Fixed by the same migration `20260926000000`: `finalize_league_draft`
   creates season 1, plus a one-time backfill for completed leagues. NOT yet applied.
10. **Mobile draft screen needs a finalize/heal trigger** (mobile release scope). If
   the draft is fully picked but `draft_status` is still `in_progress`, call
   `validate-and-record-pick` with `{ league_id, action: 'finalize' }`. Surface
   `status_update_error` instead of showing "Draft Complete!". Today nobody has a
   turn once every pick is made, so the screen has no control that reaches the
   server's heal path. The pick response also still says `draft_complete: true`
   when finalize failed.
11. **Hygiene:** revoked Alpaca pair still stored as Supabase secrets
   `ALPACA_KEY_ID`/`ALPACA_SECRET_KEY` (no readers) and in local `.env.local`;
   `.gitleaks.toml` allowlists all of `^\.claude/` by directory (hid that leak once) —
   narrow it to specific files.

---

## 5. Critical path to a playable closed beta (mobile-first)

1. Confirm the signup-gate dashboard hook (§2).
2. Confirm which mobile build testers are on; anything pre-Phase-4 must update
   (salary-cap column drop, §2).
3. **Server-side schedule generation** (§4 defect 1). Authored on
   `feat/server-schedule-generation`; it needs merge, migration, deploy, and a
   test-league effect check.
4. Merge PR #9; `db push` its migrations; deploy `refresh-symbols` and
   `send-notification`; effect-verify.
5. Fix the stranded `running` status (§4 defect 3). Merged in PR #12 (`a324395`)
   and deployed 2026-09-25; the Friday `cron_job_status` effect check is pending.
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
| `security/claude-security-fixes-20260730` | PR #9, unmerged, 0 behind `main`. GitGuardian check fails on the known anon-key false positive. |
| `feat/server-schedule-generation` | §4 defects 1, 2 (deferred drop), 9: schedule module, `finalize_league_draft` migration, pick-function wiring, web writers removed. Unmerged; migration unapplied, function undeployed. |
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
-- Stuck draft finalization (every pick made, still in_progress) — should be empty.
-- Non-empty = finalize_league_draft failed/refused and nobody retried; read the
-- validate-and-record-pick logs ('finalize: attempt') for the refusal reason.
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
-- finalize_league_draft grants — expect service_role (+ postgres) only
SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname = 'finalize_league_draft';
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
