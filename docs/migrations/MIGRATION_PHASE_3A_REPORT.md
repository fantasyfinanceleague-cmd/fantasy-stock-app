# Supabase API Key Migration — Phase 3a Report (Local Scripts + Mobile)

Spec: `MIGRATION_PHASE_3A_SPEC.md`. Built up surface by surface. Branch:
`phase-3a-scripts-mobile` (off main).

| Surface | What | Gate | Status |
|---------|------|------|--------|
| 1 | `simulation-test-runner.mjs` data-plane → `SB_SECRET_KEY_LOCAL_SCRIPTS` | 23/23 | ✅ committed `ad9590f` |
| 2 | `simulate-season.sh` `/rest/v1` → `SB_SECRET_KEY_LOCAL_SCRIPTS` (apikey, no Bearer) | read 200 + data | ✅ committed `021efd9` |
| 3 | `test-draft.js` anon → `SB_PUBLISHABLE_KEY` | A/B faithful | ✅ committed `654155e` |
| 4 | mobile anon → publishable (`lib/supabase.ts`, `eas.json`, `.env`, EAS secret) | Expo Go login + draft | ⏸️ HELD for user (secret/prod parts) |

Pre-flight (masked, before Gate 1): `SB_SECRET_KEY_LOCAL_SCRIPTS`,
`SB_SECRET_KEY_CRON`, `SB_PUBLISHABLE_KEY` in root `.env` confirmed real (correct
`sb_secret_`/`sb_publishable_` prefixes, plausible lengths), not placeholders.

---

## Surface 1 — `simulation-test-runner.mjs` ✅
- Data-plane `createClient` → `SB_SECRET_KEY_LOCAL_SCRIPTS` (dedicated local-scripts secret key; blast-radius isolation, NOT `_INTERNAL`, NOT the cron key).
- **Removed the dead `serviceRoleKey` param** across 7 functions + all call sites — it was already unused (the function call authenticates via `CRON_KEY`), so removal is behavior-preserving and guarantees the local-scripts key can never flow into the function call. Startup now requires `SB_SECRET_KEY_LOCAL_SCRIPTS` + `SB_SECRET_KEY_CRON`.
- **Gate 1 (prove-on-one): 23/23.** That run exercised extensive data-plane WRITES (insert leagues/members/standings/drafts/matchups + deletes) under the local-scripts key — proving its write/admin access.

## Surface 2 — `simulate-season.sh` ✅
- `/rest/v1` PostgREST calls → `apikey: $SB_SECRET_KEY_LOCAL_SCRIPTS`; **dropped the `Authorization: Bearer` header** (an `sb_secret` key is not a JWT — PostgREST would reject it as a bearer token). All `/rest/v1` calls are read-only (GET). Function call already on `SB_SECRET_KEY_CRON` (2b-2). Two-key env checks updated; no legacy keys remain.
- **Gate 2:** a read with the new apikey-only header → **HTTP 200 with rows**. Auth + read confirmed under the local-scripts key. Write access already proven by Surface 1.

## Surface 3 — `test-draft.js` ✅ (migration faithful; pre-existing bug found)
- `SUPABASE_ANON_KEY` → `SB_PUBLISHABLE_KEY` (anon drop-in).
- **Gate 3 via controlled A/B comparison:** ran the script under the new publishable key AND under the legacy anon key — **identical behavior**: `leagues`/`league_members` inserts succeed under both; both hit the **same** `drafts`-table RLS denial. So the key swap is **faithful** (publishable = anon drop-in), which is what Gate 3 set out to verify. No 401 (auth works); the failure is RLS, not auth. Script self-cleaned on both runs.

### 🐛 Pre-existing bug (key-independent) — `drafts` RLS blocks anonymous inserts
`test-draft.js` inserts draft picks anonymously (no user session); every pick is
RLS-denied — identically under legacy anon and new publishable, so **not a
key-migration regression**. **UNRESOLVED, must be answered before Phase 4:** is it
(a) a stale test script that should run in a user session (harmless), or (b) a sign
the real app's draft flow is broken by an RLS change (live bug)? **Cheapest answer:
the Surface 4 mobile gate — draft in the real app on Expo Go.** Real drafting works →
(a) stale test; fails → (b) live bug caught before the one-way Phase 4. Also logged
in `MIGRATION_STATUS.md` gotchas.

---

## Surface 4 — mobile ⏸️ HELD for user

**Code staged by Claude Code (applied to working tree; committed only after Gate 4 passes):**
- `apps/mobile/lib/supabase.ts`: env var renamed `EXPO_PUBLIC_SUPABASE_ANON_KEY` → `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (and local const `supabaseAnonKey` → `supabasePublishableKey`), read for `createClient`.
- `apps/mobile/eas.json`: `preview` + `production` env blocks reference `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `@EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Valid JSON confirmed.
- **Zero-lingering-reference check: ✅ `grep -rn EXPO_PUBLIC_SUPABASE_ANON_KEY apps/mobile/` returns ZERO**; no leftover `supabaseAnonKey` identifier.

**User-run (secret/prod):**
- `apps/mobile/.env` — set `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable value>`.
- EAS secret — create the publishable secret matching `eas.json`; remove old anon secret after cutover (or Phase 5).
- **Gate 4:** Expo Go — log in; exercise quotes, league views, trades; **AND draft in the real app** (answers the drafts-RLS (a)/(b) question above).

---

## Out of scope / carried forward
- Web app / Vercel → **Phase 3b** (`VITE_SUPABASE_ANON_KEY`, `apps/web/...`).
- `drafts`-RLS / anonymous-insert question → resolve at Surface 4 mobile gate, before Phase 4.
- Phase 4 (disable legacy keys), Phase 5 cleanup, retry-path bug — unchanged.
