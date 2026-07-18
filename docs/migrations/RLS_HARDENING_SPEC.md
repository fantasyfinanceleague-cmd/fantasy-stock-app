# RLS & Auth Hardening Spec

**Status:** **B1 LANDED & VERIFIED on `rls-hardening` (2026-07-12)** — the live anon-read exposure on all six league tables is closed. B2 resolved earlier. Lower-severity L1–L5 not started; L6/L7 deferred. See "B1 — LANDED" and the **Fast-follow queue** at the bottom.
**Sequencing decision:** Phase 3b done first; B1 then applied as **7 gated migration files** (`20260712000000`–`…06`: helpers + one file per table), pushed table-by-table through `/migration-gate` with per-table dry-run → push → anon-read + policy-catalog verify.
**Origin:** Surfaced by the `security-reviewer` subagent while auditing whether `APP_PAUSED` provides meaningful protection. It does not — see below.
**Guiding principle:** Built for the distance. RLS that enforces nothing is worse than no RLS, because it reads as protected in a cursory check.

---

## TL;DR

`APP_PAUSED` is a compile-time constant in `apps/web/src/App.jsx` that only swaps which React tree renders. It protects nothing at the backend. Supabase Auth, PostgREST, and edge functions are all reachable directly against the project URL with the publishable key that ships in the client bundle. A user who bypasses the paused UI can register, link Alpaca keys, and place paper-trade orders — the app is not actually "paused" for them.

Two HIGH-severity issues are independent of the flag and are **pre-launch blockers**. Several lower-severity items are worth fixing in the same pass.

All fixes below are prod-mutating and belong to the human (Giorgio). Subagents draft and review; Giorgio runs every `supabase db push`, edge deploy, and project-level toggle.

---

## Blockers (must clear before onboarding any real user)

### B1 — [✅ LANDED 2026-07-12] Placeholder RLS on six league tables
**Tables:** `leagues`, `league_members`, `league_invites`, `matchups`, `league_standings`, `week_snapshots`
**Was:** RLS enabled but `USING (true) WITH CHECK (true)` (`dev_all`) — anon-readable in prod via the publishable key; any authenticated user could read/write all rows across all leagues.
**Fix landed:** `dev_all` dropped on all six; membership-scoped model mirroring the proven `trades`/`drafts`/`league_seasons` policies.
- **Helpers:** `is_member(uuid)` + `is_commissioner(uuid)`, both `SECURITY DEFINER` (breaks the `league_members` self-referential RLS recursion), `EXECUTE` to `authenticated` only.
- **SELECT model:** `anon → nothing` (policies are `TO authenticated`; `auth.uid()` null); `member → all rows in leagues they belong to` (NOT owner-scoped — cross-member reads for rosters/standings/matchups/snapshots preserved).
- **Writes:** interim owner/commissioner policies `[I1]–[I9]` (strictly tighter than `dev_all`, preserve current behavior) + the permanent commissioner invite INSERT `[P1]`. Full write-closure to edge functions is the fast-follow (see queue).
- **Realtime fix:** `matchups REPLICA IDENTITY FULL` (its PK is `id` only, so `league_id` wasn't in the default replica image → `is_member` events would silently drop). `league_standings` needed none (PK already carries `league_id`).
- **Notable catch:** the `leagues` UPDATE policy was split into `[I2a]` commissioner (settings/start/dates) + `[I2b]` member (`in_progress → completed` only) because draft **completion** is triggered by any member (mobile last-picker / web `completeDraft` useEffect), not the commissioner — a commissioner-only policy would have silently broken draft finalization.
**Verification (prod, 2026-07-12):** 17 policies present, zero `dev_all`, RLS on all six, both helpers `prosecdef=t`, `matchups relreplident='f'` / `league_standings='d'`; **anon read (publishable key, no JWT) returned `[]` for all six tables** — the exposure closed from the attacker's own vector.
**Known interim breakage (accepted):** locking the SELECT surfaces breaks the mobile by-code **join preview** (it reads `leagues`/`league_invites`/`league_members` as a non-member). Web join is unreachable (`APP_PAUSED`); no real users. Unbroken by `preview-league` (fast-follow #1).

### B2 — [RESOLVED / RECLASSIFIED] `refresh-symbols` auth
**Function:** `refresh-symbols`
**Original claim:** "callable by any anonymous HTTP client — no `verify_jwt`, direct anonymous write path."
**Verified state (2026-07-09 prod probe):** the claim was inaccurate. An unauthenticated `POST` to the prod function returns **`401 UNAUTHORIZED_NO_AUTH_HEADER`** at the Supabase **gateway** (before function code runs) — i.e. production already enforces `verify_jwt=true` via the platform default. Anonymous callers are already blocked; no anonymous write path existed.
**Change landed:** explicit `[functions.refresh-symbols] verify_jwt = true` block added to `config.toml` (makes the effective state reproducible / regression-proof; no in-function guard, since this is user-invoked not cron). Functionally a no-op on auth — prod was already gated. The earlier cron-apikey-guard draft was reverted (wrong pattern for a user-invoked function).
**Residual:** the function is any-authenticated, not admin-only → see **L7** (cost-abuse, deferred). Not a data-integrity blocker (no scoping input; only triggers a canonical full refresh).
**Verification:** anonymous call → 401 (confirmed). Authorized (valid user JWT) call would 200 + full symbols refresh — deliberately NOT run (no security value; would trigger a ~12,525-row upsert).

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

### L6 — [DEFERRED / LOW] Weak invite-code generation
**Where:** `apps/mobile/app/create-league.tsx:36-42` (`generateInviteCode`) and `apps/web/src/hooks/useLeagues.js:6-8` (`genCode`) — two divergent generators.
**State:** Both produce a 6-char code from `A-Z0-9` (keyspace 36⁶ ≈ 2.18B) using **`Math.random()`** (non-cryptographic; the web variant's `toString(36).slice(2,8)` is weaker still). No rate-limiting on lookups today.
**Why deferred, not a blocker:** The enumeration risk only matters while an invite code is the *gate* for reading a `leagues` row. Once the `preview-league` edge function (see B1 design) moves the by-code lookup server-side — behind `verify_jwt=true` + per-user/per-IP rate limiting — the code is no longer an RLS-exposed enumeration surface, so `leagues`/`league_members` can be clean members-only. That downgrades this to defense-in-depth.
**Fix (later):** Converge on one generator, switch to `crypto.getRandomValues` (or pg `gen_random_bytes`), lengthen to ≥10–12 chars, and normalize charset. Do this **after** `preview-league` lands; the rate limit in that function is the primary control in the meantime.

### L7 — [DEFERRED / LOW] `refresh-symbols` is any-authenticated (cost-abuse, not integrity)
**Function:** `refresh-symbols`
**State (resolved for B2):** guarded by `verify_jwt=true` (platform JWT verification; anonymous → 401). This authorizes **any** authenticated user, not just admins.
**Why acceptable for now:** the function takes no scoping input — a caller can only trigger the canonical full symbols refresh (idempotent on-conflict upsert), not targeted corruption. The residual risk is **cost/quota abuse** (repeated NASDAQ fetches + ~12,525-row upserts), not data integrity.
**Fix (later):** add an in-function admin-identity check (allowlist on the JWT `sub`) and/or per-user rate limiting to prevent cost abuse. Deferred — cost issue, not a data-exposure blocker. Related: L4 (unauthenticated market-data functions burn third-party quota).

---

## HUMAN ACTION checklist (all prod-mutating — Giorgio runs these)

Ordered by severity. Each is a hard-stop gate; review drafted policies/code before running.

1. ✅ **B1 DONE (2026-07-12)** — `dev_all` replaced with membership-scoped policies on all six tables via 7 gated migrations. Verified from the anon vector. See "B1 — LANDED" above and the Fast-follow queue below.
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

---

## Fast-follow queue (post-B1) — do not lose

B1 closed the read exposure with interim write policies. The remaining work below is what turns "hardened + behavior-preserving" into "fully write-closed", plus deferred lower-severity items.

### 1. Edge functions — the write-closure path (highest priority; also unbreaks join)

**✅ preview/join wave COMPLETE (2026-07-17, merged to main `69bcba1`).** Both functions built, deployed (ACTIVE), and verified end-to-end in Expo Go: preview renders display-only fields (no id/commissioner_id/invite_code), join writes atomically, and the `already_member` + `invalid_code` paths were confirmed in-app. Reachable mobile entry point added on the visible **League tab** (`league.tsx`, header row) plus the hidden `leagues.tsx`. `[I7]` retired (`13820f7`, migration `20260717000000`, applied — verified via `pg_policies`).

- ✅ **`preview-league`** *(BUILT + DEPLOYED)* — server-side by-code lookup via `SB_SECRET_KEY_INTERNAL`, display-only fields + `{joinable, reason}`, `verify_jwt=true`, Postgres rate-limit (`check_and_bump_rate_limit`, per-user + per-IP, fail-open). Closed the mobile by-code join-preview gap.
- ✅ **`join-league`** *(BUILT + DEPLOYED)* — entire join server-side & atomic via `join_league_by_code` (`SECURITY DEFINER`, `SELECT … FOR UPDATE` capacity race fix, `unique_violation` guard; `EXECUTE` revoked from public, granted to `service_role` only). **Retired `[I7]`** (invite accept UPDATE now runs via the RPC on the service role). Removed join's use of `[I4]`, but `[I4]` **stays** — still used by league creation.
- **`create-league`** *(not designed)* — atomic `leagues` + `league_members` self-insert. Retires `[I1]` + part of `[I4]`.
- **`update-league`** *(not designed)* — commissioner settings/date edits. Retires `[I2a]`.
- **`draft-control`** *(not designed)* — draft start/complete transitions + bot member seeding. Retires `[I2b]` + `[I6]`.
- **`leave-league`** *(not designed)* — self-removal. Retires `[I5]`.
- **`delete-league`** *(not designed)* — commissioner delete. Retires `[I3]`.
- **schedule-gen (mini-project #2)** *(not started)* — move client-side matchup schedule + standings init server-side (currently any member's browser runs it). Retires `[I8]` + `[I9]`.

**Interim write-policy → retirement map** (delete the policy when its function lands):
`[I1]`→create-league · `[I2a]`→update-league · `[I2b]`→draft-control · `[I3]`→delete-league · `[I4]`→create-league (still held) · `[I5]`→leave-league · `[I6]`→draft-control · ~~`[I7]`→join-league~~ ✅ **RETIRED 2026-07-17** · `[I8]`/`[I9]`→schedule-gen. `[P1]` (commissioner invite INSERT) is **permanent**. **`league_members` still holds `[I4]`/`[I5]`/`[I6]`** — retires with the create-league / leave-league / draft-control wave.

### 2. `start_new_league_season` lockdown (privileged RPC bypass — decision #3, NOT done)
`SECURITY DEFINER` RPC callable by **any authenticated user** ([apps/mobile/app/league-settings.tsx:125](../../apps/mobile/app/league-settings.tsx:125)); guarded only by `season_status='completed'`, **no commissioner check** → any authed user can trigger a league-wide season reset (wipes matchups, resets standings). Fix: add an internal commissioner-identity check and/or restrict `EXECUTE` to the service role. Bypasses B1's RLS entirely until fixed.

### 3. Deferred / pre-launch checklist
- **Realtime push smoke-test** — B1 confirmed `matchups relreplident='f'` structurally, but the live UPDATE→event delivery was never fired (no matchup rows existed to mutate). Verify with real matchup data before unpause: open the standings screen as a member, mutate a `matchups` row, confirm the live push arrives.
- **Dead `trades` realtime channel** — `useRealtimeTrades.js` subscribes to `trades`, but `trades` is NOT in the `supabase_realtime` publication → dead channel. Either publish `trades` (+ likely `REPLICA IDENTITY FULL`, same as matchups) or remove the subscription. (Spun off as a background task 2026-07-12.)
- **L6 — weak invite codes** — 6-char `Math.random()` codes; converge generators, switch to CSPRNG, lengthen ≥10–12. Lower priority once `preview-league` moves the by-code lookup behind rate-limiting.
- **L7 — `refresh-symbols` any-authenticated** — add admin-identity check + rate-limit (cost-abuse, not integrity).
- **L1–L5** — see checklist above (`notification_log` INSERT, `expo_push_token` split, `symbols` RLS confirm, market-data rate-limiting, signup toggle).

**Surfaced during the preview/join wave (2026-07-17):**
- **Mobile has NO leave-league flow** — a user who joins a league can **never leave it on mobile** (no UI, no `league_members` delete path is invoked). The `[I5]` self-delete policy exists but nothing uses it. Needs a leave action + eventually the `leave-league` fn.
- **No deep-link / invite-URL handler on mobile** — invited users can't tap an invite link into the app; `/join-league` takes no route params (manual code entry only). Web has `/join/:code`; mobile has no equivalent. (Background task.)
- **`leagues.tsx` is vestigial** — `href: null` (hidden from the tab bar), reachable only from the zero-league empty states of `league.tsx`/`portfolio.tsx` ("View Leagues"). **`LeagueCarousel.tsx` is orphaned dead code** — never imported/mounted, referenced only in `ARCHITECTURE.md`. Decide: consolidate onto the League tab or delete. (Background task.)
- **`quote` / `historical-bars` return non-2xx for every symbol in Expo Go** — **UNRESOLVED.** Ruled out `no_credentials`-alone (`historical-bars` uses the shared env Alpaca key, not per-user creds, yet also fails). Two hypotheses: **A) auth/JWT** — both fail at the auth layer (check whether `place-order`/join also fail → auth); **B) Alpaca keys invalid** — per-user creds AND shared env key both stale post-rotation (only market-data functions fail). Confirm via `error.context.json()` in-app or the dashboard invocation status.
