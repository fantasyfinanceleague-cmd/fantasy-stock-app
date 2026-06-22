# Supabase API Key Migration — Phase 3b: Web App / Vercel (production)

## Purpose

Migrate the **web app** off the legacy Supabase `anon` JWT onto the new
**publishable** key — the last client on legacy keys. This is the **live
production surface** (Vercel), so it follows **Option B: prove the publishable
key works locally BEFORE touching Vercel.** Local proof → production cutover →
verify → remove old var, with a written rollback.

**Guiding principle: built for the distance** — and for production, *safety
ordering first*. No Vercel change happens until the key is proven locally.

This is the second half of Phase 3 (3a = scripts + mobile, merged `fa1e221`).

---

## Confirmed facts (audit + Vercel dashboard)

- `apps/web/src/supabase/supabaseClient.js:4` reads `import.meta.env.VITE_SUPABASE_ANON_KEY` into `const supabaseAnonKey`, passed to `createClient` (line 11). **No hardcoded fallback** — fully env-controlled. The module also installs a global `fetch` override at load (line 62) and runs `createClient` at module top level.
- The key lives under the name `VITE_SUPABASE_ANON_KEY` in **two real places**: `apps/web/.env.local` (local dev) and **Vercel → Settings → Environment Variables** (production build).
- **`APP_PAUSED = true`** (hardcoded, `apps/web/src/App.jsx:30`). The live site serves the **landing page only**; all auth/data routes bounce to `/`. The landing page itself uses no Supabase. The legacy key still ships in the bundle (static imports load `supabaseClient.js`, instantiating the client on load) but **nothing user-reachable exercises it → LOW blast radius** for the swap.
- **Vercel:** deploys from `main`; Root Directory `apps/web`; "Include files outside root directory" ENABLED; production domain `fantasy-stock-app.vercel.app`. **Vite inlines env vars at BUILD time**, so any Vercel env change requires a **redeploy** to take effect.

## Enumeration — every `VITE_SUPABASE_ANON_KEY` reference in `apps/web/`

| # | Location | Type | Who migrates |
|---|----------|------|--------------|
| 1 | `apps/web/src/supabase/supabaseClient.js:4` | code | Claude Code (step 2) |
| 2 | `apps/web/docs/SECURITY.md:144` | doc | Claude Code (step 2) |
| 3 | `apps/web/.env.local` | local env (gitignored ✓) | **user** (step 3) |
| 4 | Vercel dashboard env var | production | **user** (step 5) |

(`apps/web/.env.local` also defines `VITE_SUPABASE_URL` and unrelated `VITE_ALPACA_*` / `VITE_FINNHUB_API_KEY` / `VITE_HCAPTCHA_SITE_KEY` / `VITE_USE_MOCK_QUOTES` — out of scope.)

## Decision — RENAME the variable

`VITE_SUPABASE_ANON_KEY` → **`VITE_SUPABASE_PUBLISHABLE_KEY`** (honest naming,
consistent with the 3a mobile rename). Touches THREE places that must stay in
sync — code, `.env.local`, Vercel — plus the doc. **Build-time coupling:** the
production build only works when the code (new var name) and the Vercel env (new
var name) are BOTH in place. See step 5 for the ordering that avoids an
undefined-key window.

## Secrets / prod split (unchanged)

Claude Code does **code only** — never the key value, never Vercel. The **user**
does: `.env.local` (real value), the local un-pause/test/revert, and **all**
Vercel dashboard changes + redeploy + live verification.

---

## Tasks (ordered for safety — local proof before production)

### 1. Branch + enumerate
```bash
git checkout -b phase-3b-web-vercel
```
Re-confirm the enumeration above with `grep -rn "VITE_SUPABASE_ANON_KEY" apps/web/` (and the `.env.local` name-only check). List anything new; nothing should be missed.

### 2. CODE rename (Claude Code) + zero-ref gate
- `apps/web/src/supabase/supabaseClient.js`: `import.meta.env.VITE_SUPABASE_ANON_KEY` → `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`, and `const supabaseAnonKey` → `const supabasePublishableKey` (update its use on the `createClient` line).
- `apps/web/docs/SECURITY.md:144`: update the var name (and "anon key" → "publishable key") for honesty.
- **Gate (step 2):** `grep -rn "VITE_SUPABASE_ANON_KEY" apps/web/src/` returns **ZERO** (code clean); no leftover `supabaseAnonKey` identifier. `.env.local` is the user's (step 3).
- Commit this rename. **`APP_PAUSED` stays `true` — do not touch it in this commit.**

### 3. LOCAL env (user)
- In `apps/web/.env.local`, rename the line `VITE_SUPABASE_ANON_KEY=…` → `VITE_SUPABASE_PUBLISHABLE_KEY=<new publishable value>`. (`.env.local` confirmed gitignored.)
- **Confirm `.env.local` is gitignored before writing the value** (stop condition if uncertain).

### 4. 🚦 LOCAL-UNPAUSE PROOF (prove-on-one gate — before ANY Vercel change)
This is the only place we can exercise auth/data on the new key before production (prod is paused).
- Temporarily set `APP_PAUSED = false` in the **LOCAL working tree only** (`App.jsx:30`). **DO NOT COMMIT IT.**
- `cd apps/web && npm run dev`; in the browser: **log in**, perform an **authenticated read** (e.g., dashboard/leagues load), and **a write** against the new publishable key.
- **Write check:** if placing a trade is market-gated (weekend), try a **non-market write** instead — create/join a league, update a profile, or any insert that isn't market-hours-gated. Aim for **at least one real write locally**. If literally everything writable is gated, note it explicitly; the mobile Phase-4 write check then remains the authoritative write verification.
- **Pass:** login + authenticated read succeed on the publishable key (no 401 / RLS-deny), and at least one write succeeds (or is documented as fully gated).
- **REVERT `APP_PAUSED` back to `true`** and **verify the revert**: `git diff main -- apps/web/src/App.jsx` shows **no change to `APP_PAUSED`** (and `grep -n "APP_PAUSED =" apps/web/src/App.jsx` shows `true`). This revert-and-verify is a **hard, explicit step** — `APP_PAUSED=false` must never be committed or merged.
- **Before any later commit on this branch**, re-confirm `APP_PAUSED === true` in the working tree.

### 5. VERCEL CUTOVER (user — only after step 4 passes)
**Ordering matters** — Vercel builds from `main`, and Vite inlines env at build time. To avoid an undefined-key window (which would white-screen even the landing page, since `supabaseClient.js` runs `createClient` at module load via static imports):

1. **ADD** `VITE_SUPABASE_PUBLISHABLE_KEY` = `<new publishable value>` in Vercel → Settings → Environment Variables, for **ALL environments the project builds — Production AND Preview, plus Development if listed** (not Production-only: if preview builds exist and the var is Production-only, previews break on the missing var; it's a publishable key, so covering all environments is harmless). **Leave the old `VITE_SUPABASE_ANON_KEY` in place for now** — having both is harmless (the code reads only the new one) and removes any ordering risk.
2. **Merge** `phase-3b-web-vercel` → `main` — **the Vercel var (5.1) MUST already be added before this merge.** ⚠️ The merge IS the production deploy (Vercel auto-builds from `main`); do NOT merge first out of habit from prior phases where merge was just bookkeeping. With both vars present, the build reads `VITE_SUPABASE_PUBLISHABLE_KEY` successfully. (If 5.1 is skipped, the auto-build runs renamed code against a missing var → undefined key → white screen.)
3. **Redeploy** from `main` (auto on merge, or trigger manually) so the new build picks up the new var + renamed code.
4. **Verify** the live `fantasy-stock-app.vercel.app` landing page loads correctly post-redeploy (no white screen / console error from `createClient`). Since the site is paused, this is the available prod check; the real auth proof was step 4 (local).
5. **Only AFTER verifying the live site**, **REMOVE** the old `VITE_SUPABASE_ANON_KEY` var from Vercel. (Optional: one more redeploy to confirm a clean build with only the new var.)

### 6. ROLLBACK PLAN (if redeploy breaks the live site)
Do not improvise — execute immediately:
1. Vercel → **Deployments** → find the last known-good deployment (the one before this cutover).
2. **"⋯" → Promote to Production** (a.k.a. Instant Rollback). This repoints the production domain to that prior build immediately. That build has the **old code + old anon key inlined at its build time**, so it is self-contained and works even though the env var is mid-migration.
3. **Do NOT remove the old `VITE_SUPABASE_ANON_KEY` var** while rolled back (the new build is the only thing that needed the new var; keep the old until the forward fix is verified).
4. Report: what broke (build log / console), so we fix the branch before re-attempting the cutover.

---

## Gates
- **Step 2:** zero `VITE_SUPABASE_ANON_KEY` refs remain in `apps/web/src/`; no leftover `supabaseAnonKey` identifier.
- **Step 4:** login + authenticated read succeed locally on the publishable key with `APP_PAUSED=false` (local-only); **THEN** `APP_PAUSED` confirmed reverted to `true` (uncommitted diff clean vs main).
- **Step 5:** live landing page loads post-redeploy **before** the old Vercel var is removed.

## Stop conditions
- `APP_PAUSED=false` would be committed/merged → **STOP** (must stay `true` on branch/main).
- Local proof (step 4) fails — login/read 401 or RLS-deny on the new key → **STOP**, do not touch Vercel.
- Live landing page broken after redeploy → execute the **rollback** (promote previous deployment), do **not** remove the old Vercel var, report.
- Any uncertainty whether `.env.local` is gitignored before writing the value → **STOP**.

## Out of scope
- Disabling legacy keys → **Phase 4**.
- The two market-hours write-path checks (mobile trade + real-app draft) → separate **Phase 4 preconditions**, unchanged by 3b.
- Phase 5 cleanup (orphaned `service_role_key` vault entry, dead `verify`/`sync` code, `.claude/settings.local.json`, git-history scrub).

## After 3b merges — Phase 4 becomes possible (but not automatic)
The web app is the **LAST client off legacy keys**. Once 3b is merged AND the two
mobile write-path checks pass (mobile trade + real-app draft, market hours),
**Phase 4 (disable legacy keys) becomes possible** — every surface (cron, edge
functions, scripts, mobile, web) will be on new keys. Phase 4 remains a separate,
explicitly-gated step; do not chain it onto 3b.

## Deliverable
`docs/migrations/MIGRATION_PHASE_3B_REPORT.md` — per-step (code rename + zero-ref gate; local proof result incl. the APP_PAUSED revert verification; Vercel cutover steps + live-load verification; old-var removal; rollback if used). Leave on branch; the **merge is part of the production cutover** (step 5.2), done by the user after review.
