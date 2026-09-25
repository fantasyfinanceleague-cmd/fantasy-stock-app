# Deploy runbook — PR #9 (`security/claude-security-fixes-20260730`)

**Rewritten 2026-09-24** after merging `main` @ `2be4638` (PR #10 + PR #11) into the
branch. This replaces the July/September runbook in full: the old Phase C (F12 /
`place-order`) is gone because `main` deleted `place-order` (DR-001), and it already
applied both the `trades` policy drop and the `refresh_symbols_daily` cron reschedule.

Every step below is **prod-mutating and Giorgio's to run.** The golden rule applies
throughout: **verify the EFFECT, not the command's output.** A clean `db push`, a
`succeeded` cron row, or an HTTP 200 is not evidence.

## What ships

| Fix | Kind | Lands via | Waits for mobile release? |
|---|---|---|---|
| F1 + F11 — leagues column guard trigger | migration `20260925000000` | `db push` | no |
| F6 — `league_standings` INSERT bounded to zero | migration `20260925000001` | `db push` | no |
| F5 — `refresh-symbols` apikey guard, `verify_jwt=false` | edge function + `config.toml` | functions deploy | no |
| F9 — `historical-bars` date validation | edge function | functions deploy | no |
| F7 — server-side `send-notification` | new edge function | functions deploy | **client half: yes** |
| F3/F4 — CSPRNG invite codes (web) | web client | merge → Vercel | no |
| F3/F4 — CSPRNG invite codes (mobile) | mobile client | EAS build | **yes** |
| F2 — password-reset recovery nonce | mobile client + Auth redirect allowlist | dashboard + EAS build | **yes** |
| F13 — re-auth before password change | mobile client | EAS build | **yes** |

**Not in this PR:** F8 (push-token relocation, staged in
`docs/migrations/STAGED_L2_push_token_capability.sql`) and F10 (matchup forgery, which is
closed by server-side schedule generation). F12 was superseded by `main`.

**Why the migrations were renamed.** They were authored as `20260730000000/01`, but prod's
latest applied version is `20260816000000`, and `db push` refuses pending local migrations
older than the remote's latest. The bodies are unchanged apart from header notes and one
extra `REVOKE ... FROM anon, authenticated` on the trigger function (hygiene only; see
the header).

---

## Step 0 — Pre-flight (read-only)

Run each query **separately** in the SQL editor, which shows only the last result.

**0.1 — Nothing else is pending.** From the repo root, with the branch checked out:
```bash
supabase migration list
```
Expect exactly **two** local-only rows, `20260925000000` and `20260925000001`, and remote
at `20260816000000`. **Anything else pending → stop.** `db push` applies EVERY pending file.

**0.2 — The cron key pair matches, proven by a sibling that uses it.** `enrich_symbols_10min`
authenticates with the same pair `refresh-symbols` will use (vault `cron_apikey` →
`SB_SECRET_KEY_CRON`). Its 200s prove the two values are equal. Note that
`net._http_response` has no `url` column, so responses are identified by body shape:
```sql
SELECT created, status_code, left(content::text, 120) AS body
FROM net._http_response
WHERE content::text LIKE '%"batch":%'           -- enrich-symbols success shape
ORDER BY created DESC LIMIT 5;
```
Expect recent rows with `status_code = 200`. If they're all 401 `{"error":"unauthorized"}`,
the pair is already broken: fix that first. F5 cannot work either.

**0.3 — Baseline: refresh-symbols is failing today.**
```sql
SELECT created, status_code, left(content::text, 120) AS body
FROM net._http_response
WHERE status_code = 401
  AND (content::text ILIKE '%authorization header%' OR content::text ILIKE '%invalid jwt%')
ORDER BY created DESC LIMIT 5;
```
Expect 401s carrying the **gateway's** generic body, not our JSON, at `:00` of
00/06/12/18 UTC. `refresh-symbols` is the only cron target still behind `verify_jwt`, so
these rows are its runs. This is what step 3.2 should
change.

---

## Step 1 — Push the branch  *(HUMAN)*

```bash
git push origin security/claude-security-fixes-20260730
```
This updates PR #9. The GitGuardian check fails on the allowlisted anon key, a known
false positive: dismiss it on the dashboard.

## Step 2 — Supabase Auth redirect allowlist (F2; additive, zero risk)

Dashboard → Authentication → URL Configuration → Redirect URLs: add
`fantasystockapp://**` (or the narrower `fantasystockapp://reset-password?**`).
The new client sends `redirectTo: fantasystockapp://reset-password?rn=<nonce>`. Without a
pattern that preserves the query string, the fail-closed nonce check rejects **every**
legitimate reset. Existing entries still match old clients, so adding this breaks nothing.
**It must be in place before the step-6 mobile build reaches anyone.**

## Step 3 — Edge functions (all backward-compatible; any order among 3.1–3.3)

From the repo root on the branch:

**3.1 — F9**
```bash
supabase functions deploy historical-bars
```
Verify: a bad date such as `"start":"2020-01-01&feed=sip"` returns **our** HTTP 400
`invalid_start`, and a normal `YYYY-MM-DD` request still returns bars (the mobile chart
still renders).

**3.2 — F5**
```bash
supabase functions deploy refresh-symbols
```
This deploy carries `verify_jwt = false`. A true→false flip may not take on the first
deploy, so verify that it did:
```bash
curl -s -i -X POST https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/refresh-symbols
```
Expect `401` with body exactly `{"error":"Unauthorized"}` (**our** handler). The gateway's
`Missing authorization header` means the flip didn't take: redeploy, and check the
dashboard's Verify-JWT toggle for the function.
Then check the effect after the next scheduled run (`0 */6 * * *` UTC):
```sql
SELECT created, status_code, left(content::text, 120) AS body
FROM net._http_response
WHERE content::text LIKE '%"count":%'           -- refresh-symbols success shape
ORDER BY created DESC LIMIT 3;
```
Expect `200 {"ok":true,"count":<several thousand>}`. Don't use `cron.job_run_details`: it reports
`succeeded` on enqueue. Optional: `SELECT count(*) FROM symbols;` before and after.

**3.3 — F7**
```bash
supabase functions deploy send-notification
```
It uses `SB_PUBLISHABLE_KEY` and `SB_SECRET_KEY_INTERNAL`, which are already set as
project secrets and used by `validate-and-record-pick`, so no `secrets set` is needed.
Verify:
- No `Authorization` header → the gateway's 401 (this function is `verify_jwt = true`).
- A real user JWT with `{"type":"nope","league_id":"x","target_user_id":"y"}` → **our**
  `400 unknown notification type`.
- A real user JWT with `type: "draft_turn"`, a league you're in, and a leaguemate as the
  target → `200` with `sent:true`, or `sent:false` with a truthful `reason`
  (`no_token_or_disabled`, `expo_ticket_error`). **`500 lookup_failed` is a real failure.**

Nothing calls this function until step 6. Live mobile builds still send directly to
`exp.host` (that is F8's exposure, unchanged by this step).

## Step 4 — Migrations (F1, F6)

```bash
supabase db push --dry-run
supabase db push
```
The dry run must list exactly the two files from 0.1. **Old clients are unaffected:**
mobile no longer writes `leagues.draft_status`. The server's `markDraftComplete` uses an
admin client with no user JWT, so `auth.uid()` is NULL and the guard is a no-op. Web
`DraftPage` completion is exactly the trigger's allowed carve-out.

Effect verification (each query separately):
```sql
SELECT version FROM supabase_migrations.schema_migrations
WHERE version >= '20260816000000' ORDER BY version;
-- expect 20260816000000, 20260925000000, 20260925000001
```
```sql
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'public.leagues'::regclass AND NOT tgisinternal;
-- expect exactly: trg_leagues_member_update_columns | O
```
```sql
SELECT proname, prosecdef, proconfig, proacl::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname = 'enforce_leagues_member_update_columns';
-- expect prosecdef = true, proconfig = {"search_path=public, pg_temp"},
-- proacl WITHOUT anon= or authenticated= entries
```
```sql
SELECT policyname, cmd, roles::text, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'league_standings'
ORDER BY policyname;
-- expect ONLY league_standings_insert_members (INSERT, with_check has
-- wins = 0 AND losses = 0 AND ties = 0 AND points_for = 0 AND points_against = 0)
-- and league_standings_select_members (SELECT). No UPDATE/DELETE policy.
```
**Trigger behaviour:** paste all of `docs/security/f1-f6-effect-test.sql` into the SQL editor
and run it. It builds its own fixture leagues, switches role and JWT claims the way
PostgREST does, runs 8 cases, then **raises on purpose** so everything rolls back and
the results appear in the error panel. Expect 8 × `PASS`. Any `FAIL` is a real finding:
stop and report it. *(This script has not been run yet; no local Postgres was available
when it was written. If it errors before printing results, e.g. on a fixture insert,
that is a bug in the script, not the trigger. Report it.)*

## Step 5 — Merge PR #9  *(= Vercel prod deploy)*

The PR adds no new Vercel env vars. The web delta is the CSPRNG invite-code helper
(`apps/web/src/utils/inviteCode.js`, `useLeagues.js`). With `APP_PAUSED = true` only the
landing page is live, so a successful `npm run build` proves nothing (see CLAUDE.md). The
evidence is the Vercel deployment of the merge commit going **Ready**. If `main` has moved
since this branch was last merged, re-merge and re-run `node scripts/gen-architecture.mjs
--check` before merging.

## Step 6 — Mobile release  *(EAS **build**, NOT an OTA update)*

**Why not OTA:** this branch adds `expo-crypto`, a **native** module imported at load time
by `_layout.tsx` (via `lib/recoveryNonce.ts`). `runtimeVersion` uses `policy: appVersion`,
and the branch bumps `expo.version` from `1.0.0` to `1.1.0`, so this JS belongs to a **new
runtime**. An `eas update` from `main` now reaches no existing binary, which is the point:
on a 1.0.0 binary it would crash at startup (`Cannot find native module 'ExpoCrypto'`).
**Do not revert the version bump to force an OTA.**

Preconditions: step 2 (redirect allowlist) and step 3.3 (`send-notification` live).
```bash
cd apps/mobile && eas build --profile production --platform all
```
Run it from `apps/mobile/`, never from the repo root, which offers to create a duplicate
project (decline that). Consider bundling with `ui/design-system-pass-v2` if its visual
check passes (STATUS §5).

Smoke checks on the new build:
- **F2:** request a reset, open the emailed link, and reach reset-password to set a new
  password. If the reset is rejected, the step-2 allowlist entry is wrong.
- **F13:** a password change with a wrong current password is refused.
- **F3:** a new league's invite code is 10 characters from the unambiguous alphabet.
- **F7:** in a two-human draft, the next picker receives "It's Your Turn!".
  `send-notification` logs show `sent:true`.

## Step 7 — Refresh the map

1. Re-capture `docs/architecture/db-snapshot.json`: run `docs/architecture/db-snapshot.sql`
   against prod and save the single output cell. The current snapshot is from 2026-08-12.
2. `node scripts/gen-architecture.mjs`, then commit.
3. Drift panel: the HIGH row `enforce_leagues_member_update_columns() — ABSENT from prod
   snapshot` must clear. If it doesn't, the push didn't land, whatever step 4's output
   said.

## Step 8 — Record it

Update `docs/STATUS.md` §2 (ledger: migrations through `20260925000001`, deployed
functions, the `refresh_symbols_daily` 200 evidence) and §4 (remove defect 4, the
refresh-symbols 401).

---

## After this ships: F8 phase 2 has a new precondition

`STAGED_L2_push_token_capability.sql` drops `user_profiles.expo_push_token`. Every
**1.0.0** mobile binary still writes its own token to that column and reads leaguemates'
tokens from it. Apply phase 2 only after 1.0.0 binaries are drained, i.e. testers are all
on ≥ 1.1.0. `send-notification` already handles both schema states, and its legacy
fallback can be deleted once phase 2 lands.

## Rollback

- **Migrations:** never edit an applied file. Mitigate with a new migration, e.g.
  `DROP TRIGGER trg_leagues_member_update_columns ON public.leagues;`, or recreate the
  prior `league_standings_insert_members` (`WITH CHECK (is_member(league_id))`).
- **Edge functions:** redeploy the previous version. For `refresh-symbols`, a rollback
  reinstates the 401s and nothing else.
- **Mobile:** 1.0.0 binaries keep working throughout. Nothing in steps 1–5 requires them
  to update.
