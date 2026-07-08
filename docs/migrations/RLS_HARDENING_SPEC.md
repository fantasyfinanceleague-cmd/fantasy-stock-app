# RLS & Auth Hardening Spec

**Status:** Captured, not started. Blocked behind Phase 3b (Vercel key cutover, step 5).
**Sequencing decision:** Finish Phase 3b first, then harden. Do not interleave — hardening touches the same Supabase surfaces the migration does.
**Origin:** Surfaced by the `security-reviewer` subagent while auditing whether `APP_PAUSED` provides meaningful protection. It does not — see below.
**Guiding principle:** Built for the distance. RLS that enforces nothing is worse than no RLS, because it reads as protected in a cursory check.

---

## TL;DR

`APP_PAUSED` is a compile-time constant in `apps/web/src/App.jsx` that only swaps which React tree renders. It protects nothing at the backend. Supabase Auth, PostgREST, and edge functions are all reachable directly against the project URL with the publishable key that ships in the client bundle. A user who bypasses the paused UI can register, link Alpaca keys, and place paper-trade orders — the app is not actually "paused" for them.

Two HIGH-severity issues are independent of the flag and are **pre-launch blockers**. Several lower-severity items are worth fixing in the same pass.

All fixes below are prod-mutating and belong to the human (Giorgio). Subagents draft and review; Giorgio runs every `supabase db push`, edge deploy, and project-level toggle.

---

## Blockers (must clear before onboarding any real user)

### B1 — [HIGH] Placeholder RLS on six league tables
**Tables:** `leagues`, `league_members`, `league_invites`, `matchups`, `league_standings`, `week_snapshots`
**State:** RLS enabled, but policies are `USING (true) WITH CHECK (true)` (`dev_all`). Migrations mark them `-- TEMP dev-only RLS (replace before prod)`.
**Impact:** Any authenticated user can read/write all rows across all leagues — fabricate matchups, alter standings, modify other members' memberships.
**Fix:** Replace `dev_all` with real per-user / per-member policies. A correct model already exists in the repo on `trades` and `broker_credentials` — mirror that structure (membership check via `league_members`, ownership via `auth.uid()`).
**Verification:** As user A, attempt to read/write user B's league rows — must be denied. As a legitimate member, normal reads/writes must still pass.

### B2 — [HIGH] `refresh-symbols` edge function has no auth
**Function:** `refresh-symbols`
**State:** Writes to the DB via the service-role key, callable by any anonymous HTTP client — no `verify_jwt`, no apikey guard.
**Impact:** Direct anonymous write path into the database.
**Fix:** Apply the existing cron apikey guard pattern (constant-time, fail-closed, `verify_jwt=false` + vault-backed apikey), or require `verify_jwt` if it should be user-invoked. Match whichever pattern fits how it's actually called.
**Verification:** Anonymous call → rejected. Authorized call (with the correct guard header) → succeeds.

---

## Correctly enforced today (flag-independent) — do not regress

- `broker_credentials`, `trades`, `drafts` — proper per-user / per-member RLS ✅
- Edge functions `place-order`, `save-broker-keys`, `get-broker-keys`, `quote` — enforce JWT identity ✅
- Cron functions `snapshot-week-*`, `process-week-results`, `sync-alpaca-orders` — constant-time, fail-closed apikey guards ✅

These are the reference patterns for the fixes above.

---

## Lower-severity (fix in the same hardening pass)

### L1 — [MEDIUM] `notification_log` INSERT is `WITH CHECK (true)`
Log-poisoning risk. Restrict INSERT to `auth.role() = 'service_role'`.

### L2 — [MEDIUM] `user_profiles` SELECT open to all authed users, now includes `expo_push_token`
Push tokens leak to any authenticated user. Split `expo_push_token` (and any other sensitive columns) out of the public-readable profile surface — separate table, or column-level restriction / view.

### L3 — [LOW/CONFIRM] `symbols` table has no RLS-defining migration in the repo
Cannot confirm RLS state from code alone. Confirm in the live project whether RLS is on and appropriately scoped; add a migration to make the state explicit and reproducible.

### L4 — [LOW] Unauthenticated market-data functions burn third-party quota
`ticker-quotes`, `historical-bars`, `finnhub-quote`, etc. are callable with no caller identity, consuming Alpaca/Finnhub quota. Consider rate-limiting or requiring identity. Lower priority — quota/cost issue, not a data-exposure issue.

### L5 — [PRODUCT DECISION] If "paused" is meant to stop signups
That's a Supabase project-level toggle (Auth → Enable email signups), not a client constant. Decide whether the pause should actually block registration; if so, disable signups at the project level. Note this interacts with Phase 3b — confirm it doesn't block your own local unpause proof.

---

## HUMAN ACTION checklist (all prod-mutating — Giorgio runs these)

Ordered by severity. Each is a hard-stop gate; review drafted policies/code before running.

1. **B1** — Replace `dev_all` policies on the six league tables with real per-user/per-member policies. Push as a reviewed migration.
2. **B2** — Add auth guard to `refresh-symbols`; redeploy the function.
3. **L5** — If pausing signups: disable email signups at the Supabase project level.
4. **L1 / L2** — Fix `notification_log` INSERT policy; split `expo_push_token` out of public-readable profile columns.
5. **L3** — Confirm RLS on `symbols` in the live project; add a defining migration.
6. **L4** — Decide on rate-limiting / identity for market-data functions (defer-able).

---

## Handoff notes (for the eventual Claude Code pass)

- Branch per house convention (e.g. `security-rls-hardening`), atomic commits per surface, `--no-ff --no-verify` merge.
- `supabase-reviewer` (read-only) drafts the corrected policies as a migration and reviews them; it must **not** run `supabase db push`. Its output ends with the exact command for Giorgio to run.
- Giorgio runs all `db push`, edge deploys, and project-level toggles. Subagents never handle real key values.
- Verify B1 and B2 with the explicit allow/deny tests above before merge.
- Do not start until Phase 3b step 5 (Vercel cutover) is merged and clean.
