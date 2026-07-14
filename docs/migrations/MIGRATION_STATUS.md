# Supabase API Key Migration — STATUS

**This is a living document. Update it at every phase boundary.** It exists so any fresh Claude Code session (or future-you) can get up to speed in 60 seconds. For detailed records, see the per-phase report files referenced below.

Last updated: **Phase 3b COMPLETE & MERGED to main (`42f742b`)** — web app is now on the publishable key in production. Step 5 (Vercel cutover) done & verified: `VITE_SUPABASE_PUBLISHABLE_KEY` added (all envs) → merged → deploy Ready with clean console → old `VITE_SUPABASE_ANON_KEY` removed from Vercel → clean rebuild confirmed. **ALL surfaces (cron, edge functions, scripts, mobile, web) are now off legacy keys.** Phase 4 (disable legacy keys) is **UNBLOCKED on the migration side but STILL gated on 2 mobile write-checks** (real trade + real draft, market/draft hours). Phase 3a merged (`fa1e221`); Phase 2b-2 (cron) merged (`eae20ed`). See `MIGRATION_PHASE_3A_REPORT.md`.

> **Parallel track — RLS hardening B1 LANDED (2026-07-12, branch `rls-hardening`):** the placeholder `dev_all` RLS on the six league tables (`leagues`, `league_members`, `league_invites`, `matchups`, `league_standings`, `week_snapshots`) — a **live anon-read data exposure** via the publishable key — is now closed with membership-scoped policies, verified from the anon vector (`[]` on all six). This is a separate effort from the API-key migration but touches the same Supabase surface. Full record + fast-follow queue (edge-function write-closure, `start_new_league_season` lockdown, deferred L6/L7): see **`RLS_HARDENING_SPEC.md`**.

---

## The goal

Migrate this project from legacy Supabase API keys (`anon` / `service_role` JWTs) to the new key system (`sb_publishable_...` / `sb_secret_...`). Reason: legacy keys were leaked in git history; the new system lets us make the leaked keys inert and is the path Supabase is steering all projects toward. End goal is a setup that survives Supabase eventually killing legacy JWT support entirely — nothing of ours should depend on legacy-key backwards compatibility.

---

## Current state (what's done, what's not)

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Audit of full migration scope | ✅ DONE — see `MIGRATION_PHASE_0_REPORT.md` |
| 1 | Set up new keys alongside legacy (function secrets + local .env) | ✅ DONE — see `MIGRATION_PHASE_1_REPORT.md` |
| 2a | Migrate 7 client-invoked edge functions to new keys | ✅ DONE & MERGED to main — see `MIGRATION_PHASE_2A_REPORT.md` |
| 2b-1 | Proof-of-concept: migrate 1 cron function (`snapshot-week-end`) to apikey auth | ✅ DONE & MERGED to main — spec: `MIGRATION_PHASE_2B1_SNAPSHOT_WEEK_END.md`, report: `MIGRATION_PHASE_2B1_REPORT.md` |
| 2b-2 | Migrate remaining 3 cron functions. Spec: `MIGRATION_PHASE_2B2_SPEC.md`, report: `MIGRATION_PHASE_2B2_REPORT.md` | ✅ DONE & MERGED — A `process-week-results` (`e92ce06`); B `snapshot-week-start` + C `sync-alpaca-orders` (`eae20ed`) |
| 3a | Migrate LOCAL SCRIPTS + MOBILE to new keys. Spec: `MIGRATION_PHASE_3A_SPEC.md`, report: `MIGRATION_PHASE_3A_REPORT.md` | ✅ MERGED to main (`fa1e221`) — structural migration done (scripts gated; mobile auth+reads gated, **writes unverified** → 2 Phase-4 hard gates). |
| 3b | Migrate WEB APP / Vercel to new keys. Spec: `MIGRATION_PHASE_3B_SPEC.md` | ✅ DONE & MERGED to main (`42f742b`) — web app on the publishable key in production. Step 5 Vercel cutover verified: `VITE_SUPABASE_PUBLISHABLE_KEY` added (all envs) → merged → deploy Ready, clean console → old `VITE_SUPABASE_ANON_KEY` removed → clean rebuild confirmed. |
| 4 | Disable legacy keys in Supabase dashboard (one-way door) | ⏸️ NOT STARTED — migration side now UNBLOCKED (all surfaces off legacy keys), but **STILL BLOCKED by 2 mobile write-path verifications (see gotchas)** |
| 5 | Cleanup (orphaned secrets, `.claude/settings.local.json`, docs, git history scrub) | ⏸️ NOT STARTED |

---

## Keys: current inventory

**New keys created (4):** in Supabase dashboard, "Publishable and secret API keys" tab
- `default` (publishable)
- `cron` (secret)
- `edge-functions-internal` (secret)
- `local-scripts` (secret)

**New keys as function secrets:** `SB_PUBLISHABLE_KEY`, `SB_SECRET_KEY_INTERNAL`, `SB_SECRET_KEY_CRON`

**New keys in local `.env`:** `SB_PUBLISHABLE_KEY`, `SB_SECRET_KEY_LOCAL_SCRIPTS`

**Legacy keys (still active, but no longer used by any surface):** `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — **all surfaces (cron, edge functions, scripts, mobile, web) are now off legacy keys as of Phase 3b (`42f742b`).** The keys remain *enabled* in the dashboard only because disabling them is the explicit one-way door of Phase 4, still gated on the 2 mobile write-checks. Nothing of ours reads them anymore.

See `docs/api-keys-inventory.md` for the full location matrix.

---

## Edge functions: migration status

**Client-invoked (10 total):**
- ✅ Migrated to new keys: `quote`, `place-order`, `save-broker-keys`, `get-broker-keys`, `refresh-symbols`, `symbols-search`, `symbol-name`
- ➖ No change needed (no Supabase auth): `finnhub-quote`, `ticker-quotes`, `historical-bars`

**Cron-invoked (4 total):**
- ✅ `snapshot-week-end` — Phase 2b-1, migrated to apikey auth & merged
- ✅ `process-week-results` — Phase 2b-2 Sub-phase A, migrated to apikey auth & merged (`e92ce06`). The publicly-unauthenticated hole is now CLOSED — it's guarded by a constant-time, fail-closed apikey check against `SB_SECRET_KEY_CRON`; the `process-weekly-matchups` cron job sends the `cron_apikey` vault secret.
- ✅ `snapshot-week-start` — Phase 2b-2 Sub-phase B, migrated to apikey auth & merged (`eae20ed`). `schedule_snapshot_retry()` now has BOTH branches on apikey. (See retry-path bug in gotchas — pre-existing, separate task.)
- ✅ `sync-alpaca-orders` — Phase 2b-2 Sub-phase C, migrated to apikey auth & merged (`eae20ed`). `verify_jwt` flipped true→false; its `verify`/`sync` user-auth modes are now USER-UNREACHABLE dead code (Phase 5 removal).

**All 4 cron functions are now on apikey auth.** No cron path uses the legacy `service_role` key.

---

## Cron auth pattern (the hard part)

Cron functions are being migrated from `Authorization: Bearer <vault service_role JWT>` to `apikey: <sb_secret cron key>` header auth. This requires, per function:
1. `verify_jwt = false` in `supabase/config.toml`
2. Custom apikey validation in the function code (constant-time comparison, fail closed)
3. A vault entry holding the cron apikey (`cron_apikey`), separate from the old `service_role_key` entry
4. The cron migration rewritten to send the apikey header

Chosen approach: full migration (no dependency on legacy JWT backwards-compat), so it survives Supabase killing legacy keys.

---

## Key learnings / gotchas discovered

- ✅ **`process-week-results` public-auth hole is now CLOSED** (Phase 2b-2 Sub-phase A, merge `e92ce06`). It previously had `verify_jwt = false` with NO apikey check — anyone on the internet could invoke this money-adjacent function (a PRE-EXISTING hole, predating Phase 2b). It was fixed FIRST in 2b-2 and merged on its own. The fix was verified: 6a no-key → 401 from our code (fail-closed guard running), 6b/6d invalid → gateway 401, 6c real key → 200 (scoped to a nonexistent UUID, zero prod mutation), harness 23/23.
- 🐛 **PRE-EXISTING BUG (separate task, NOT a key-migration issue): the snapshot retry path is non-functional.** `schedule_snapshot_retry()` calls `cron.schedule(name, retry_time::timestamptz, sql)` for one-time scheduling, but this pg_cron version doesn't support the timestamp overload (only `cron.schedule(name, cron_expression, sql)`) → `cron.schedule(text, timestamp with time zone, text) does not exist`. This is original logic from `20260116000000`; 2b-1/2b-2 only changed the auth **header** inside the scheduled command, never the `cron.schedule()` signature — the auth migration is correct (the failing call's SQL shows `apikey`/`cron_apikey`). Affects BOTH `snapshot-week-start` and `snapshot-week-end` retry paths; the main weekly cron jobs are unaffected (they use the supported cron-expression form). Needs a separate fix; explicitly out of scope for 2b-2. (Discovered spot-checking the retry path during Sub-phase B.)
- 🐛 **PRE-EXISTING BUG (separate, key-independent): `drafts` table RLS blocks anonymous inserts.** `scripts/test-draft.js` inserts draft picks **anonymously** (no user session); every pick is RLS-denied — **IDENTICALLY under the legacy anon key and the new publishable key** (controlled A/B run during Phase 3a Surface 3), so it is **NOT a key-migration regression**. `leagues`/`league_members` inserts succeed under both keys; only `drafts` is blocked. **UNRESOLVED — must be answered before Phase 4 (irreversible):** is this (a) just a **stale test script** that should run inside a user session (harmless), or (b) a sign the **real app's draft flow** is broken by an RLS change (live bug)? **Check: draft in the REAL app on Expo Go** — if real drafting works → stale test (a); if it fails → live bug (b). **Still OPEN:** at the Phase 3a Surface 4 gate the draft window was timing-gated (weekend), so real drafting could not be exercised. This is now **hard gate #2 on Phase 4** (below). (Discovered during Phase 3a Surface 3 verification.)
- 🐛 **PRE-EXISTING BUG (separate, NOT a key-migration issue — pre-launch product bug, found during Phase 3b step 4 local run): web league-creation form submits with null required fields.** The web create-league form posts with `budget_amount` and `duration_days` null, and surfaces the raw Postgres not-null constraint error to the user. Needs client-side validation + friendly error messages. Orthogonal to the migration (the write path itself works — this is missing form validation). Log-only; fix as a separate pre-launch task.
- 🚦 **TWO HARD GATES ON PHASE 4 (one-way door) — from Phase 3a Surface 4. Phase 4 must NOT proceed until BOTH pass:** (1) **publishable-key WRITE** — place a real trade in the mobile app **during market hours** (Gate 4 verified reads only; trades/draft were weekend-blocked, so authenticated writes on the publishable key are UNVERIFIED). (2) **real-app DRAFT** during a draft window — resolves the `drafts`-RLS (a)/(b) question above. Both are timing-gated to market/draft hours. See `MIGRATION_PHASE_3A_REPORT.md`.
- During 2b-1: `snapshot-week-end` had THREE invocation paths on legacy auth, not one (weekly cron job + `trigger_week_end_snapshot()` + `schedule_snapshot_retry()`). Migrating only the cron job would have silently 401'd retries and manual recovery once `verify_jwt=false` went live. Lesson for 2b-2: enumerate ALL invocation paths per function (cron jobs, helper SQL functions, retry schedulers) before flipping the flag.
- Supabase validates the `apikey` header against the project's known keys at the GATEWAY (before the function runs). So a *garbage* apikey is rejected by the platform (401 `{"message":"Invalid API key"}`), not by our code. Our custom check is only exercised by a *valid project key that isn't the expected one* — test the guard with a real-but-wrong key, not just a fake string.
- ⚠️ **`supabase db push --dry-run` does NOT apply the migration — it only previews.** The real `supabase db push` must follow. This was missed TWICE in 2b-2 (`snapshot-week-start` and `sync-alpaca-orders`), each time leaving the live cron job on legacy Bearer while the function already required apikey. The cron.job verification query (`SELECT command FROM cron.job WHERE jobname=...`) is what caught it both times — **ALWAYS run it after every cron migration** to confirm the live job actually shows `apikey`, not just that the push command ran.
- ⚠️ **`verify_jwt` true→false flip does not reliably take on first deploy.** `sync-alpaca-orders` deployed but the gateway was still enforcing JWT (6a returned the platform's `UNAUTHORIZED_NO_AUTH_HEADER` instead of our `{"error":"Unauthorized"}`). A re-deploy fixed it. The **6a test** (no-credential request must reach OUR code) is the proof the flip took; confirm the dashboard **Verify JWT toggle is OFF** too. `db push` / `config.toml` alone don't guarantee the deployed gateway state. (Functions that were ALREADY `verify_jwt=false` don't have this trap.)
- Supabase removed the in-dashboard JWT-secret rotation; new-key migration is the only path
- New auto-injected env vars are PLURAL dictionaries (`SUPABASE_SECRET_KEYS`) not singular — but we use our own named secrets (`SB_SECRET_KEY_INTERNAL`) instead
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` env vars retain LEGACY JWT values even after disabling legacy keys (Supabase bug/behavior) — this is WHY we must rewrite functions to use new key names, not rely on auto-update
- Substitution confirmed working: `createClient(URL, sb_publishable_xxx, {headers:{Authorization: userJWT}})` works as drop-in for anon+userJWT
- Phase 1 placeholder bug: new secret keys were initially pushed with placeholder text; fixed by re-pushing real values
- `.claude/settings.local.json` embeds credentials in bash permission strings (no env block) — deferred to Phase 5
- Pre-commit hook is broken (`pre-commit not found`); all commits use `--no-verify`
- `apps/web/` IS deployed on Vercel (`vercel.json` present) — affects Phase 3
- Alpaca keys already rotated (separate from Supabase migration); dead values still in some files, harmless

---

## Working method

Spec-driven: Claude (chat) writes a phase spec → hand to Claude Code → Claude Code executes & produces a report → review report in chat before merging. Each phase works on its own git branch, atomic commits, merge to main only after verification. Sensitive key values are handled by the user directly (vault SQL, real-key curl tests), never passed through Claude Code.

---

## Next action

**Phase 3b is DONE & MERGED to main (`42f742b`).** The web app runs on the publishable key in production; the old `VITE_SUPABASE_ANON_KEY` has been removed from Vercel and a clean rebuild confirmed. **ALL surfaces (cron, edge functions, scripts, mobile, web) are now off legacy keys.** The migration side of Phase 4 is therefore UNBLOCKED — but Phase 4 (disabling legacy keys) is a one-way door and remains gated on 2 mobile write-verifications that could only be done during market/draft hours.

- **Immediate next action: clear the 2 Phase-4 hard gates (both timing-gated to market/draft hours):** (1) **publishable-key WRITE** — place a real trade in the mobile app **during market hours** (Phase 3a Gate 4 verified reads only; authenticated writes on the publishable key are still UNVERIFIED); (2) **real-app DRAFT** during a draft window — resolves the `drafts`-RLS (a)/(b) question in the gotchas. Both must PASS before Phase 4.
- **Then Phase 4:** disable legacy keys in the dashboard (one-way door). Do NOT proceed until both gates above are green.
- **Phase 5 cleanup:** the now-orphaned `service_role_key` vault entry; the USER-UNREACHABLE `verify`/`sync` dead code (+ `ANON_KEY`/`authed` client) in `sync-alpaca-orders`; `.claude/settings.local.json` credentials; git-history scrub.
- **Separate non-migration task:** fix the pre-existing `schedule_snapshot_retry()` `cron.schedule()` timestamp-overload bug (see gotchas) so the snapshot retry path can fire.
