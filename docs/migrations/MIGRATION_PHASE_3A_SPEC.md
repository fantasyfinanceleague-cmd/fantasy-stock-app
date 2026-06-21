# Supabase API Key Migration — Phase 3a: Local Scripts + Mobile

## Purpose

Migrate **local scripts** and the **mobile app** off legacy Supabase keys
(`anon` / `service_role` JWTs) onto the new key system (`sb_publishable_…` /
`sb_secret_…`). This is the first half of Phase 3 (clients). The live **web app /
Vercel** is explicitly **deferred to a separate Phase 3b spec** — a
production-touching change gets its own isolated, gated session.

**Guiding principle: built for the distance.** Thorough and durable over fast.
Enumerate the whole surface before touching anything; prove the pattern on one
surface before fanning out; verify each surface end-to-end against the new key.

This phase changes **no edge function and no cron path** (all on apikey auth as of
2b-2). It changes only how local scripts and the mobile client authenticate.

---

## Scope

| In scope (3a) | Deferred / out of scope |
|---------------|--------------------------|
| Local scripts: `simulation-test-runner.mjs`, `simulate-season.sh`, `test-draft.js` | **Web app / Vercel → Phase 3b** (separate spec) |
| Mobile app: `apps/mobile` (`.env`, `eas.json`/EAS secret, `lib/supabase.ts`) | Disabling legacy keys → **Phase 4** |
| `docs/api-keys-inventory.md` update (two-key harness split) | Phase 5 cleanup items; retry-path bug fix |

---

## Full legacy-key surface (enumerated 2026-06-20)

Grep of `scripts/` and `apps/` for `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY`, `anon`, `service_role`:

### 3a — local scripts
| File | Current key | Mechanism | → New key |
|------|-------------|-----------|-----------|
| `scripts/simulation-test-runner.mjs` | `SUPABASE_SERVICE_ROLE_KEY` (data-plane `createClient`, line ~1507; threaded as `serviceRoleKey` param) | supabase-js admin client (seed/teardown) | **`SB_SECRET_KEY_LOCAL_SCRIPTS`** |
| `scripts/simulate-season.sh` | `SUPABASE_SERVICE_ROLE_KEY` (`/rest/v1/...` curls, lines ~89–111) | PostgREST data-plane | **`SB_SECRET_KEY_LOCAL_SCRIPTS`** |
| `scripts/test-draft.js` | `SUPABASE_ANON_KEY` (`createClient`, line ~31) | supabase-js anon client | **`SB_PUBLISHABLE_KEY`** |

> Note: both scripts' **edge-function calls** already use `SB_SECRET_KEY_CRON` (migrated in 2b-2) — do NOT touch those. 3a touches only their **data-plane** auth.

### 3a — mobile
| File | Current | → New |
|------|---------|-------|
| `apps/mobile/lib/supabase.ts` | reads `EXPO_PUBLIC_SUPABASE_ANON_KEY` | publishable key (see naming decision) |
| `apps/mobile/.env` | `EXPO_PUBLIC_SUPABASE_ANON_KEY=<legacy anon>` | publishable key value *(user-set)* |
| `apps/mobile/eas.json` | `EXPO_PUBLIC_SUPABASE_ANON_KEY: "@EXPO_PUBLIC_SUPABASE_ANON_KEY"` (preview + production blocks) | publishable EAS secret ref |

### Tagged for Phase 3b (web/Vercel) — DO NOT touch in 3a
- `apps/web/src/supabase/supabaseClient.js` — `VITE_SUPABASE_ANON_KEY`
- `apps/web/.env.local` — `VITE_SUPABASE_ANON_KEY` (local)
- Vercel project env — `VITE_SUPABASE_ANON_KEY`
- `apps/web/docs/SECURITY.md` — doc reference to `VITE_SUPABASE_ANON_KEY`

### Not key references (grep false positives, ignore)
- `apps/*/package-lock.json`, `stockpile-tokens.css` — matched "canonical" / "anon" substrings, unrelated.

---

## Decisions baked in (from the user)

1. **Blast-radius isolation for local scripts.** Local scripts' admin/data-plane
   (service-role-equivalent) calls use **`SB_SECRET_KEY_LOCAL_SCRIPTS`** — the
   dedicated local-scripts secret key from Phase 1 — **NOT** `SB_SECRET_KEY_INTERNAL`.
   A leaked local-scripts key must be revocable without touching edge functions.
2. **Two-key harness.** After 3a, `simulation-test-runner.mjs` juggles **two** new
   keys: `SB_SECRET_KEY_CRON` (edge-function invocation, done in 2b-2) and
   `SB_SECRET_KEY_LOCAL_SCRIPTS` (data-plane `createClient`). It no longer uses
   `SUPABASE_SERVICE_ROLE_KEY`. Document this split in `api-keys-inventory.md`.
3. **Mobile: anon → publishable.** Drop-in replacement (confirmed in 2b-1: a
   publishable key works as the anon drop-in in `createClient`).
4. **Prove-on-one first.** Migrate ONE script, verify it authenticates end-to-end
   against the new key, THEN apply to the rest — the discipline that caught the
   `db push` / `verify_jwt` problems in 2b.

### Mobile env var naming — CONFIRMED: RENAME
Rename `EXPO_PUBLIC_SUPABASE_ANON_KEY` → **`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`**
across `lib/supabase.ts`, `apps/mobile/.env`, and `eas.json` (+ a new EAS secret of
that name; remove the old anon secret after cutover or defer to Phase 5). Honest
naming, durable — per "built for the distance."

---

## Tasks

### 0. Branch
```bash
git checkout -b phase-3a-scripts-mobile
```

### 1. PROVE-ON-ONE — `simulation-test-runner.mjs` (richest data-plane surface, 23-test suite)

**Pre-flight (before Gate 1):** confirm `SB_SECRET_KEY_LOCAL_SCRIPTS` and
`SB_PUBLISHABLE_KEY` in root `.env` hold **REAL values, not Phase-1 placeholders**
(we got burned by placeholders before — Phase 1 pushed placeholder text once).
Verify via a **masked** check (key prefix `sb_secret_` / `sb_publishable_` + length,
never echo the full value) or have the user confirm. **If Gate 1 throws a
data-plane 401, a placeholder/bad `SB_SECRET_KEY_LOCAL_SCRIPTS` value is suspect #1.**
- Add a module-level `LOCAL_SCRIPTS_KEY = process.env.SB_SECRET_KEY_LOCAL_SCRIPTS` and use it for the data-plane `createClient(SUPABASE_URL, …)` (line ~1507).
- **Audit the threaded `serviceRoleKey` param** (passed into `runTest` / negative `test.fn` and on to `callEdgeFunction`): anywhere it feeds a **data-plane** client it becomes the local-scripts key; anywhere it reaches `callEdgeFunction` it is already **ignored** (that path uses `CRON_KEY`). Rename the threaded param to avoid future confusion between the two secret keys. **Never route the local-scripts key into the function call, or the cron key into the data plane.**
- Update the startup checks: require `SB_SECRET_KEY_CRON` **and** `SB_SECRET_KEY_LOCAL_SCRIPTS`; drop the `SUPABASE_SERVICE_ROLE_KEY` requirement. Update the usage message.
- **Verification gate (1):** with `SB_SECRET_KEY_CRON` + `SB_SECRET_KEY_LOCAL_SCRIPTS` exported, run `node scripts/simulation-test-runner.mjs` → **full suite passes (expect 23/23)**. Commit only after green.
- **Gate 1 failure reporting (required):** if the harness fails, the report MUST state **which key-class failed** so it's unambiguous:
  - **data-plane** (local-scripts key) — a seed/teardown `createClient` op returns 401 / RLS-denied, OR
  - **function-invocation** (cron key) — the `process-week-results` call returns 401.
  Identify the failing layer explicitly (don't make the reviewer guess which key crossed or is wrong). A data-plane 401 → suspect the `SB_SECRET_KEY_LOCAL_SCRIPTS` value (placeholder?) or that the cron key was mistakenly routed into the data plane.

### 2. `simulate-season.sh`
- Replace the `/rest/v1/...` data-plane auth: `apikey: $SUPABASE_SERVICE_ROLE_KEY` → `apikey: $SB_SECRET_KEY_LOCAL_SCRIPTS`. **Handle the `Authorization: Bearer` header carefully** — legacy used the service_role JWT there; a `sb_secret_…` key is NOT a JWT, so PostgREST may reject it as a malformed bearer token. Prefer **`apikey` alone** (drop the `Authorization` line for the REST calls) and confirm by running; only keep a Bearer header if verification shows it's required.
- Update the env preamble/checks: require `SB_SECRET_KEY_CRON` (function call, unchanged) + `SB_SECRET_KEY_LOCAL_SCRIPTS` (REST); drop `SUPABASE_SERVICE_ROLE_KEY`. Update the WARNING comment (the script's data-plane calls are now on the new key; the Phase-4 breakage warning no longer applies once migrated).
- **Verification gate (2):** run `./scripts/simulate-season.sh` (after `seed-test-league.sql`) → the function runs (5 cron passes) AND the `/rest/v1` verification queries return data, not 401. **Read vs write:** the script's `/rest/v1` calls are currently GET reads (standings/season/matchups). If any `/rest/v1` call writes (POST/PATCH/DELETE), verify a **WRITE succeeds** under `SB_SECRET_KEY_LOCAL_SCRIPTS` — RLS can allow a read but deny a write, so a passing read does NOT prove write access. If the script is read-only over `/rest/v1` (expected), note that explicitly in the report and a successful read is sufficient. (The actual data-plane writes in this flow happen inside the edge function via `SB_SECRET_KEY_INTERNAL`, not via the script's REST calls — confirm this still holds.) Commit after green.

### 3. `test-draft.js`
- `SUPABASE_ANON_KEY` → `SB_PUBLISHABLE_KEY` (`createClient(SUPABASE_URL, process.env.SB_PUBLISHABLE_KEY)`); update the missing-key check + message.
- **Verification gate (3):** run `node scripts/test-draft.js` → it authenticates and completes its draft simulation (no duplicate pick_numbers, snake order correct), no 401. Commit after green.

### 4. Mobile — `apps/mobile`
- **Code (Claude Code):** `lib/supabase.ts` — read the publishable key (renamed var per the decision); `eas.json` — update the `preview` and `production` env blocks to reference the publishable EAS secret.
- **Secrets (user-run, never through Claude Code):**
  - `apps/mobile/.env` — set the publishable key value (and rename the var if renaming). *(Confirm `apps/mobile/.env` is gitignored.)*
  - EAS secret — create the publishable secret (`eas secret:create …`) matching the `eas.json` reference; remove the old anon secret after cutover (or defer removal to Phase 5). Use the temp-file pattern for any value handling.
- **Verification gate (4):**
  - **Zero-lingering-reference check (hard gate):** after the rename, `grep -rn "EXPO_PUBLIC_SUPABASE_ANON_KEY" apps/mobile/` must return **ZERO** results. A leftover old-name reference would break the app at runtime with a confusing `undefined`-key error. The gate does not pass until this is zero.
  - **Runtime:** run on **Expo Go**, **log in**, and exercise the app — **quotes, league views, trades** — confirming auth works on the publishable key. A login/PostgREST failure means the publishable key or RLS path is wrong — STOP.
  - Commit code after both are green.

### 5. `docs/api-keys-inventory.md` (local-only, gitignored — leave uncommitted)
- Record the **two-key harness split**: `simulation-test-runner.mjs` uses `SB_SECRET_KEY_CRON` (function) + `SB_SECRET_KEY_LOCAL_SCRIPTS` (data-plane); no longer uses `SUPABASE_SERVICE_ROLE_KEY`.
- Mark `local-scripts` and `default` (publishable) keys **IN USE**; update the "Where each key lives" rows for mobile (`apps/mobile/.env`, `eas.json`/EAS secret now publishable) and note the scripts' data-plane key.
- Tag the still-legacy web rows as **Phase 3b**.

---

## Verification summary (per-surface gates)

| Gate | Surface | Pass condition |
|------|---------|----------------|
| 1 | `simulation-test-runner.mjs` | full suite 23/23 on local-scripts key (prove-on-one) |
| 2 | `simulate-season.sh` | function passes + `/rest/v1` queries return data |
| 3 | `test-draft.js` | draft sim completes on publishable key |
| 4 | mobile (Expo Go) | login + quotes + league views + trades work on publishable key |

Gate 1 (prove-on-one) must pass before 2–4. Each surface is an **atomic commit**
after its gate is green.

---

## Working method (unchanged from 2b)

- Branch `phase-3a-scripts-mobile`; atomic commits per surface; `--no-verify` (pre-commit hook broken). Use the **temp-file pattern** for any commit message with special chars, and for any secret pushes.
- **Sensitive key values handled by the user**, never passed through Claude Code: the actual values for root `.env` (`SB_SECRET_KEY_LOCAL_SCRIPTS`, `SB_PUBLISHABLE_KEY` — already present from Phase 1), `apps/mobile/.env`, and the EAS secret.
- Root `.env` already holds `SB_SECRET_KEY_LOCAL_SCRIPTS` and `SB_PUBLISHABLE_KEY` (Phase 1). Leave the legacy `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` entries in root `.env` for now (other surfaces may still read them until Phase 3b/4) — do not delete in 3a.
- Deliverable: **`docs/migrations/MIGRATION_PHASE_3A_REPORT.md`**, per-surface (change + gate result), enumeration confirmation, two-key split documented, web refs explicitly tagged 3b, concerns/anomalies, and a "ready for 3b?" note. Leave on branch; merge to main only after user review.

---

## Stop conditions

- Gate 1 (`simulation-test-runner.mjs`) fails → STOP, do not fan out.
- Any surface's data-plane/auth test returns 401 (key not authenticating) or RLS-denies an operation that worked under legacy → STOP, diagnose (is it the right key class? secret vs publishable?).
- The local-scripts key ever routes into a function call, or the cron key into the data plane → STOP (blast-radius isolation violated).
- Any web/Vercel file would be modified → STOP (that's 3b).
- Uncertainty whether `apps/mobile/.env` is gitignored before writing a secret to it → STOP, confirm first.

---

## Out of scope for 3a

- Web app / Vercel (`VITE_SUPABASE_ANON_KEY`, `apps/web/...`) → **Phase 3b** (separate spec, isolated session).
- Disabling legacy keys in the dashboard → **Phase 4**.
- Phase 5 cleanup (orphaned `service_role_key` vault entry; `sync-alpaca-orders` dead `verify`/`sync` modes; `.claude/settings.local.json`; git-history scrub).
- The pre-existing `schedule_snapshot_retry()` `cron.schedule()` timestamp-overload bug.
