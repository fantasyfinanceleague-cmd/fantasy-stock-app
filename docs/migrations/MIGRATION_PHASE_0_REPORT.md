# Supabase API Key Migration — Phase 0 Audit Report

## 1. Existing New Keys (Dashboard)

**Cannot be audited programmatically.** The Supabase dashboard requires browser login. However, the existence of function secrets `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` suggests new keys were created at some point.

> **Action needed:** Check Dashboard → Settings → API Keys → "Publishable and secret API keys" tab and fill in:
> - Number of publishable keys (`sb_publishable_...`), prefix + creation date of each
> - Number of secret keys (`sb_secret_...`), prefix + creation date of each

---

## 2. Current Function Secrets

Confirmed via `supabase secrets list` (13 secrets, unchanged from prior listing):

| Secret | Used by edge functions? | Notes |
|--------|------------------------|-------|
| `ALPACA_API_KEY` | Yes (7 functions) | |
| `ALPACA_API_SECRET` | Yes (7 functions) | |
| `ALPACA_KEY_ID` | **No** | Same digest as `ALPACA_API_KEY` — duplicate alias |
| `ALPACA_SECRET_KEY` | **No** | Same digest as `ALPACA_API_SECRET` — duplicate alias |
| `BROKER_CRYPTO_KEY` | Yes (4 functions) | |
| `FINNHUB_API_KEY` | Yes (1 function) | |
| `SUPABASE_ANON_KEY` | Yes (6 functions) | |
| `SUPABASE_DB_URL` | **No** | Not read by any edge function |
| `SUPABASE_JWKS` | **No** | Supabase internal (JWT verification) |
| `SUPABASE_PUBLISHABLE_KEYS` | **No** | Orphaned — zero code references |
| `SUPABASE_SECRET_KEYS` | **No** | Orphaned — zero code references |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (9 functions) | |
| `SUPABASE_URL` | Yes (all 14 via auto-inject or explicit) | |

**6 secrets are unused by edge function code:** `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`.

---

## 3. Edge Function Env Var Usage

| Function | `SUPABASE_URL` | `SUPABASE_ANON_KEY` | `SUPABASE_SERVICE_ROLE_KEY` | `ALPACA_API_KEY` | `ALPACA_API_SECRET` | `BROKER_CRYPTO_KEY` | `FINNHUB_API_KEY` | Invocation |
|----------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|------------|
| `process-week-results` | x | | x | x | x | | | Cron |
| `snapshot-week-start` | x | | x | x | x | | | Cron |
| `snapshot-week-end` | x | | x | x | x | | | Cron |
| `sync-alpaca-orders` | x | x | x | | | x | | Cron |
| `place-order` | x | x | x | | | x | | Client |
| `get-broker-keys` | x | x | x | | | x | | Client |
| `save-broker-keys` | x | x | x | | | x | | Client |
| `quote` | x | x | x | | | x | | Client |
| `refresh-symbols` | x | | x | | | | | Client |
| `finnhub-quote` | | | | | | | x | Client |
| `symbols-search` | x | x | | x | x | | | Client |
| `symbol-name` | x | x | | | | | | Client |
| `ticker-quotes` | | | | x | x | | | Client |
| `historical-bars` | | | | x | x | | | Client |

**Citations:**
- `env()` helper defined in each file (e.g., `process-week-results/index.ts:19`, `snapshot-week-start/index.ts:21`)
- Direct `Deno.env.get()` in: `get-broker-keys/index.ts:49-52`, `place-order/index.ts:108-111`, `save-broker-keys/index.ts:95-98`, `refresh-symbols/index.ts:122-123`, `symbols-search/index.ts:78`, `symbol-name/index.ts:35`

---

## 4. Cron Authentication Mechanism

**All 4 cron jobs use the identical pattern:**

```sql
'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                WHERE name = 'service_role_key' LIMIT 1)
```

| Cron job | Schedule | Migration file:line |
|----------|----------|---------------------|
| `snapshot-week-start` | `35 14 * * 1,2` (Mon/Tue 14:35 UTC) | `20260116000000_matchup_scoring_redesign.sql:85-98` |
| `snapshot-week-end` | `5 21 * * 5` (Fri 21:05 UTC) | `20260116000000_matchup_scoring_redesign.sql:101-114` |
| `process-weekly-matchups` | `15 21 * * 5` (Fri 21:15 UTC) | `20260116000000_matchup_scoring_redesign.sql:118-131` |
| `sync-alpaca-orders` | `30 21 * * 1-5` (Mon-Fri 21:30 UTC) | `20260125200000_add_sync_alpaca_cron.sql:13-26` |

**This is the pattern that breaks with `sb_secret_...` keys.** The `service_role_key` in vault is a JWT. The new `sb_secret_...` keys are NOT JWTs and cannot be used in `Authorization: Bearer ...` headers. All 4 cron jobs must be updated.

**Additional finding:** Two older migrations (`20251230210000` line 34, `20260105100000` line 26) contain hardcoded anon key JWTs as fallbacks in manual trigger functions (`trigger_week_processing()`, `trigger_week_snapshot()`). These functions were superseded by the `20260116000000` migration but may still exist in the DB.

---

## 5. CLI Version

- **Installed:** `2.67.1`
- **Latest:** `2.95.4`
- **Version pins:** None found in `package.json` scripts or docs
- **Gap:** 28 minor versions behind. The new key system commands (`supabase secrets` → `supabase env`) may not be fully supported in 2.67.1. The CLI itself warns about updating.

---

## 6. Migration Docs Summary

From [supabase.com/docs/guides/api/api-keys](https://supabase.com/docs/guides/api/api-keys) and [/getting-started/api-keys](https://supabase.com/docs/guides/getting-started/api-keys):

| Constraint | Detail |
|------------|--------|
| Edge Functions + new keys | Edge Functions **only support JWT verification** via legacy `anon`/`service_role` keys. Must deploy with `--no-verify-jwt` flag when using new keys. |
| Custom auth required | Must implement own `apikey`-header authorization logic inside the function code |
| Bearer header | **Cannot** send `sb_publishable_...` or `sb_secret_...` in `Authorization: Bearer ...` header — it is not a JWT and will be rejected |
| `apikey` header | New keys go in `apikey` header, not `Authorization` |
| Cron migration | **No official guidance** on migrating cron→edge function auth from vault JWT to new keys |
| SDK updates | No specific SDK version requirement mentioned |
| Deprecation timeline | **No date announced.** Legacy keys remain accessible in dashboard |

**Key implication for this project:** The cron→edge function authentication pattern (`Bearer <vault JWT>`) has no direct equivalent with new keys. Options:
1. Keep legacy `service_role_key` JWT in vault for cron auth, use new keys for client-side only
2. Switch cron to `apikey` header + custom validation in each function + `--no-verify-jwt` deployment
3. Replace cron→HTTP with cron→SQL (call functions via `pg_net` with `apikey` header)

---

## 7. Client SDK Versions

| Location | Package | Version |
|----------|---------|---------|
| `apps/mobile/package.json:17` | `@supabase/supabase-js` | `^2.89.0` |
| `apps/web/package.json:14` | `@supabase/supabase-js` | `^2.53.0` |
| `package.json:29` (root) | `@supabase/supabase-js` | `^2.99.3` |

No SDK version requirement for new keys was mentioned in docs. The `^2.53.0` in `apps/web` is notably older.

---

## 8. Pre-existing Concerns

1. **Orphaned function secrets.** `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` are set as function secrets but no edge function reads them. Likely leftover from initial exploration of new key system.

2. **Duplicate Alpaca key aliases.** `ALPACA_KEY_ID` has the identical digest as `ALPACA_API_KEY`; `ALPACA_SECRET_KEY` has the identical digest as `ALPACA_API_SECRET`. Code only uses `ALPACA_API_KEY`/`ALPACA_API_SECRET`. The `_KEY_ID`/`_SECRET_KEY` variants are dead.

3. **Hardcoded anon key in migrations.** Two older migration files contain a hardcoded anon key JWT as fallback in manual trigger functions (`20251230210000:34`, `20260105100000:26`). These functions may still exist in the production DB even though the cron jobs they were for have been superseded.

4. **Web app status unknown.** `apps/web/` contains a full Vite+React app with `vercel.json`, `dist/`, and `@supabase/supabase-js ^2.53.0`. Whether it's actively deployed on Vercel is unknown — affects whether client-side key migration is needed for two apps or one.

5. **Pre-commit hook still broken.** `pre-commit not found. Did you forget to activate your virtualenv?` — confirmed from prior session. All commits require `--no-verify`.

6. **`SUPABASE_DB_URL` and `SUPABASE_JWKS` secrets** exist but are not read by any edge function. May be Supabase-managed or orphaned.

---

## 9. Open Questions

1. **Dashboard key metadata.** How many publishable/secret keys already exist? Were they created for testing or intended for production? (Requires manual dashboard check — see Section 1.)

2. **Cron migration strategy.** No official Supabase guidance exists for migrating cron→edge function auth to new keys. Which of the three options in Section 6 should we pursue? Option 1 (keep legacy JWT for cron, new keys for client only) is lowest risk.

3. **Web app active?** Is the Vercel deployment live? If dormant, we can skip it in Phase 1+. If active, its SDK version (`^2.53.0`) is significantly older and would need the `SUPABASE_URL` + key config updated.

4. **CLI update timing.** Should we update from `2.67.1` → `2.95.4` before Phase 1? The `secrets` → `env` command transition may be needed, but updating introduces its own risk.

5. **Orphaned secrets cleanup.** Should we remove `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_DB_URL` in Phase 1 or defer?

6. **Hardcoded fallback keys.** The manual trigger functions with hardcoded anon key fallbacks (`trigger_week_processing`, `trigger_week_snapshot`) should be dropped or updated. Include in Phase 1 scope?
