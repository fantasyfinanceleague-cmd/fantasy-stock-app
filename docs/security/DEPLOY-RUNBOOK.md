# Deploy runbook — PR #9 (`security/claude-security-fixes-20260730`)

**Rewritten 2026-09-25** after merging `main` @ `a324395` (PR #10, #11, #12) into the
branch. This replaces the July/September runbook in full: the old Phase C (F12 /
`place-order`) is gone because `main` deleted `place-order` (DR-001), and it already
applied both the `trades` policy drop and the `refresh_symbols_daily` cron reschedule.

Every step below is **prod-mutating and Giorgio's to run.** The golden rule applies
throughout: **verify the EFFECT, not the command's output.** A clean `db push`, a
`succeeded` cron row, or an HTTP 200 is not evidence.

> **Correction, 2026-09-25 (step 0, read-only): prod already runs F5 and F9.** The deployed
> `refresh-symbols` and `historical-bars` are this branch's original security commit
> `2dd699f`, deployed on an unknown date after 2026-07-30 (`supabase functions download`
> comparison). `verify_jwt` is already **off** for `refresh-symbols` in prod: a
> credential-free GET reaches **our** code (`405 {"error":"Method not allowed"}`). And
> `refresh_symbols_daily` returns `200 {"ok":true,"count":13246}`. **`main` was the stale
> side**, not prod. So step 5.1/5.2 are *reconciliation* deploys, functionally no-ops that
> make prod provably equal the merge commit. `send-notification` (5.3) is the only real
> new server code in this PR. Earlier drafts of this runbook said refresh-symbols
> "401s today"; that was wrong.

## Where every deploy runs from

**Never deploy from `/Users/giorgio/fantasy-stock`.** That checkout sits on whatever branch
is being worked on (currently `ui/design-system-pass-v2`), and it has already shipped
stale function code once. Every deploy runs from a folder whose files are exactly
the code meant to ship:

- **After the merge (this runbook):** `/Users/giorgio/fantasy-stock-deploy`, refreshed to
  `origin/main` and **detached at the merge commit**.
- **Before a merge** (not needed here; see below): the PR branch's own worktree at the
  reviewed commit, with an explicit `--project-ref haiaaifjcclsvmkfqgmd`.

The wrong folder fails **silently**, which is why this matters. `supabase functions deploy`
uploads whatever `index.ts` the folder holds. `supabase db push` reads migrations from the
folder it runs in. The main checkout lacks `20260925000000/01`, so it would report
*nothing to push* while F1/F6 sit unapplied: a clean-looking no-op. Every command below
is preceded by `git -C <folder> rev-parse --short HEAD`, which must print the expected
commit.

This PR does not deploy from its own worktree pre-merge for two reasons. Nothing requires
it (next paragraph), and a worktree's HEAD is a moving target: it advances as follow-up
commits land, and concurrent sessions prune worktrees. A detached checkout of
`origin/main` at the merge commit is fixed and reviewable.

**Why this PR merges first and deploys second.** None of its server steps must be live
before the merge:
- F1/F6 migrations don't depend on any function.
- `send-notification`'s only caller is the 1.1.0 mobile build (step 7), which comes later.
- The web delta (CSPRNG invite codes) doesn't call anything new.

Every server step can therefore run from a single folder at a single commit. The gap
between merge and deploy changes nothing live. Prod already runs this PR's
`refresh-symbols` and `historical-bars`, and the policies stay in place until step 6. The
merge actually **removes** a hazard: before it, any `refresh-symbols` or `historical-bars`
deploy from `main` (including a bare `supabase functions deploy`, which deploys EVERY
function) would silently revert F5/F9 in prod.

## What ships, and when each fix goes live

| Fix | Kind | Goes live at | Needs the mobile build? |
|---|---|---|---|
| F1 + F11 — leagues column guard trigger | migration `20260925000000` | step 6 (`db push`) | no — **server-side** |
| F6 — `league_standings` INSERT bounded to zero | migration `20260925000001` | step 6 (`db push`) | no — **server-side** |
| F5 — `refresh-symbols` apikey guard, `verify_jwt=false` | edge function + `config.toml` | **already live** (from `2dd699f`); step 5.2 reconciles | no — **server-side** |
| F9 — `historical-bars` date validation | edge function | **already live** (from `2dd699f`); step 5.1 reconciles | no — **server-side** |
| F7 — server half: `send-notification` | new edge function | step 5 (live but unused) | — |
| F7 — client half: draft-turn push via the function | mobile client | step 7 | **yes** |
| F3/F4 — CSPRNG invite codes (web) | web client | step 3 (merge → Vercel) | no |
| F3/F4 — CSPRNG invite codes (mobile) | mobile client | step 7 | **yes** |
| F2 — password-reset recovery nonce | mobile client + Auth redirect allowlist | step 7 (allowlist: step 2) | **yes** |
| F13 — re-auth before password change | mobile client | step 7 | **yes** |

**The mobile half cannot ship over the air.** This branch adds `expo-crypto`, a **new
native module** that `_layout.tsx` imports at load time (via `lib/recoveryNonce.ts`;
`lib/inviteCode.ts` uses it too). `apps/mobile/app.json` sets `runtimeVersion` with
`policy: "appVersion"`, and the branch bumps `expo.version` from `1.0.0` to `1.1.0`. So
this JS belongs to a new runtime that **no installed binary has**. An `eas update` cannot
deliver F2, F3-mobile, F7-client or F13 to anyone. They arrive only with a new EAS build
(step 7). The bump is deliberate protection: without it, an OTA from `main` would reach
1.0.0 binaries and crash them at startup (`Cannot find native module 'ExpoCrypto'`).
**Don't revert the bump to force an OTA.** One consequence: after this merge, no OTA
from `main` reaches current 1.0.0 testers until they install 1.1.0.

**Not in this PR:** F8 (push-token relocation, staged in
`docs/migrations/STAGED_L2_push_token_capability.sql`) and F10 (matchup forgery, closed by
server-side schedule generation). F12 was superseded by `main`.

**Why the migrations were renamed.** They were authored as `20260730000000/01`, but prod's
latest applied version is `20260816000000`, and `db push` refuses pending local migrations
older than the remote's latest. The bodies are unchanged apart from header notes and one
extra `REVOKE ... FROM anon, authenticated` on the trigger function (hygiene only; see
the header).

---

## Step 0 — Pre-flight SQL (read-only)

Run each query **separately** in the SQL editor, which shows only the last result.

**`net._http_response` is a weak signal here. Verify by data, not by that table.** It has
no `url` column (responses can only be matched by body shape), and **no cron migration sets
`timeout_milliseconds`**. So pg_net's **5 s default** applies: any target that runs
longer than 5 s shows up as a client timeout (`Timeout of 5000 ms reached`, no status)
even when it succeeds. `enrich-symbols` does exactly that on every run. The table can
confirm a fast answer (a 401, a quick 200); it can never confirm the outcome of a slow run.

**0.1 — The cron key pair works, proven by effect.** `enrich_symbols_10min` authenticates with
the same pair as `refresh-symbols` (vault `cron_apikey` → `SB_SECRET_KEY_CRON`). Its HTTP
responses time out (see above), so check the data it writes instead:
```sql
SELECT max(enriched_at) AS latest,
       count(*) FILTER (WHERE enriched_at > now() - interval '1 hour') AS last_hour,
       count(*) FILTER (WHERE enriched_at IS NULL) AS never_enriched
FROM symbols;
```
Observed 2026-09-25: about 50 rows per run (≈300/h), `latest` within the last 10 minutes.
A broken pair would 401 fast (and show in `net._http_response`), and `enriched_at` would
stop advancing.

**0.2 — Baseline: refresh-symbols ALREADY works in prod** (observed 2026-09-25):
```sql
SELECT created, status_code, left(content::text, 120) AS body
FROM net._http_response
WHERE content::text LIKE '%"count":%'           -- refresh-symbols success shape
ORDER BY created DESC LIMIT 3;
```
Expect `200 {"ok":true,"count":<~13k>}` at `:00` of 00/06/12/18 UTC. This run finishes
inside 5 s, so the row is real. And:
```bash
curl -s -i https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/refresh-symbols
```
Expect `405 {"error":"Method not allowed"}`, which is **our** code, so `verify_jwt` is
already off. Both results must hold **before and after** step 5.2.

## Step 1 — Push the branch  *(HUMAN / Orchestrator)*

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
legitimate reset. Existing entries still match 1.0.0 clients, so adding this breaks
nothing. **It must be in place before the step-7 build reaches anyone.**

## Step 3 — Merge PR #9  *(= Vercel prod deploy)*

Merge on GitHub. The PR adds no new Vercel env vars. The web delta is the CSPRNG
invite-code helper (`apps/web/src/utils/inviteCode.js`, `useLeagues.js`). With
`APP_PAUSED = true` only the landing page is live, so a green `npm run build` proves
nothing (see CLAUDE.md). The evidence is the Vercel deployment of the merge commit going
**Ready**. Record the merge commit SHA as `<MERGE>` for steps 4–7.

## Step 4 — Prepare the deploy checkout

```bash
git -C /Users/giorgio/fantasy-stock-deploy fetch origin
git -C /Users/giorgio/fantasy-stock-deploy checkout --detach origin/main
git -C /Users/giorgio/fantasy-stock-deploy log --oneline -1
```
The last line must show `<MERGE>`. If `main` moved again, stop and decide whether to ship
the newer commit too.

**Content sanity.** Each function in this PR is a single `index.ts`, so the deploy's
"Uploading asset" list looks the same whether the code is fresh or stale. Check the
content before deploying. Each count must be **≥ 1**. All four are 0 on the pre-merge
`main` (`a324395`), so a 0 here means the checkout is stale:
```bash
cd /Users/giorgio/fantasy-stock-deploy
grep -c "SB_SECRET_KEY_CRON" supabase/functions/refresh-symbols/index.ts
grep -c "invalid_start" supabase/functions/historical-bars/index.ts
grep -c "expo_ticket_error" supabase/functions/send-notification/index.ts
grep -A2 "^\[functions.refresh-symbols\]" supabase/config.toml | grep -c "verify_jwt = false"
ls supabase/migrations/20260925000000_leagues_member_draft_complete_column_guard.sql supabase/migrations/20260925000001_tighten_league_standings_insert.sql
```

**Link the checkout** (local config only; writes `supabase/.temp/project-ref`, which is
gitignored). This checkout isn't linked yet. On CLI v2.67.1 `db push` has no
`--project-ref`: it pushes to the *linked* project (`--linked`, the default) or to
`--db-url`. So linking is required.
**Keep the DB password out of shell history.** Never pass `-p/--password`, and never use
`--db-url` (the password sits in the URL). Either answer the CLI's hidden-input prompt, or
load the password into the environment without echoing it:
```bash
read -rs SUPABASE_DB_PASSWORD && export SUPABASE_DB_PASSWORD   # value not echoed, not in history
```
Then:
```bash
cd /Users/giorgio/fantasy-stock-deploy
git -C /Users/giorgio/fantasy-stock-deploy rev-parse --short HEAD   # must print <MERGE>
supabase link --project-ref haiaaifjcclsvmkfqgmd
cat supabase/.temp/project-ref
supabase migration list
```
`project-ref` must read `haiaaifjcclsvmkfqgmd`. `migration list` must show exactly **two**
local-only rows, `20260925000000` and `20260925000001`, with remote at
`20260816000000`. **Anything else pending → stop.** `db push` applies EVERY pending file.

## Step 5 — Edge functions  *(from `/Users/giorgio/fantasy-stock-deploy` @ `<MERGE>`)*

All three are backward-compatible with 1.0.0 clients; any order. **5.1 and 5.2 are
reconciliation:** prod already runs this code (from `2dd699f`, which differs from the merge
commit's `refresh-symbols` only by one comment word). Redeploying makes prod provably
equal the merge commit. Success means the downloaded code matches `<MERGE>` and
behaviour is unchanged, not a behaviour change. **5.3 is the only new server code.**

**5.1 — F9**
No function in this PR imports `supabase/functions/_shared/` or any other local file.
All imports are `jsr:` packages, so each deploy's asset list is exactly one `index.ts`.
Any additional or missing local asset means the wrong code: stop.
```bash
cd /Users/giorgio/fantasy-stock-deploy
git -C /Users/giorgio/fantasy-stock-deploy rev-parse --short HEAD   # must print <MERGE>
supabase functions deploy historical-bars --project-ref haiaaifjcclsvmkfqgmd
```
Expect **Uploading asset (historical-bars): supabase/functions/historical-bars/index.ts**
and nothing else.
Verify (unchanged before and after): a bad date such as `"start":"2020-01-01&feed=sip"`
returns **our** HTTP 400 `invalid_start`, and a normal `YYYY-MM-DD` request still returns
bars. Then prove prod equals the merge commit:
```bash
cd /Users/giorgio/fantasy-stock-deploy
supabase functions download historical-bars --project-ref haiaaifjcclsvmkfqgmd   # writes into supabase/functions/historical-bars/
git status --porcelain -- supabase/functions/historical-bars/   # must print NOTHING (modified or extra file = mismatch)
git checkout -- supabase/functions/   # restore tracked files either way; delete any extra file it listed
```


**5.2 — F5**
```bash
git -C /Users/giorgio/fantasy-stock-deploy rev-parse --short HEAD   # must print <MERGE>
supabase functions deploy refresh-symbols --project-ref haiaaifjcclsvmkfqgmd
```
Expect **Uploading asset (refresh-symbols): supabase/functions/refresh-symbols/index.ts**
and nothing else.
`config.toml` now also says `verify_jwt = false`, matching prod (it was the repo that
said `true`). Verify **unchanged** behaviour:
```bash
curl -s -i https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/refresh-symbols
curl -s -i -X POST https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/refresh-symbols
```
Expect `405 {"error":"Method not allowed"}`, then `401 {"error":"Unauthorized"}`, both from
**our** code. Any gateway body (`Missing authorization header` / `Invalid JWT`) means the
deploy **re-enabled** `verify_jwt`. That is a regression: the cron would start failing.
Redeploy, and fix the dashboard's Verify-JWT toggle. Then prove prod equals the merge
commit:
```bash
cd /Users/giorgio/fantasy-stock-deploy
supabase functions download refresh-symbols --project-ref haiaaifjcclsvmkfqgmd   # writes into supabase/functions/refresh-symbols/
git status --porcelain -- supabase/functions/refresh-symbols/   # must print NOTHING (modified or extra file = mismatch)
git checkout -- supabase/functions/   # restore tracked files either way; delete any extra file it listed
```

After the next `0 */6 * * *` run, step 0.2's `"count":` query must still show a fresh `200`.
Don't use `cron.job_run_details`: it reports `succeeded` on enqueue.

**5.3 — F7 (server half)**
```bash
git -C /Users/giorgio/fantasy-stock-deploy rev-parse --short HEAD   # must print <MERGE>
supabase functions deploy send-notification --project-ref haiaaifjcclsvmkfqgmd
```
Expect **Uploading asset (send-notification): supabase/functions/send-notification/index.ts**
and nothing else. This is a **new** function (a `download` before this step fails),
so also confirm it appears in the dashboard's function list with Verify JWT **on**, and:
```bash
cd /Users/giorgio/fantasy-stock-deploy
supabase functions download send-notification --project-ref haiaaifjcclsvmkfqgmd   # writes into supabase/functions/send-notification/
git status --porcelain -- supabase/functions/send-notification/   # must print NOTHING (modified or extra file = mismatch)
git checkout -- supabase/functions/   # restore tracked files either way; delete any extra file it listed
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

Nothing calls this function until step 7. 1.0.0 builds still send directly to `exp.host`
(that is F8's exposure, unchanged here).

## Step 6 — Migrations (F1, F6)  *(from `/Users/giorgio/fantasy-stock-deploy` @ `<MERGE>`, linked in step 4)*

```bash
cd /Users/giorgio/fantasy-stock-deploy
git -C /Users/giorgio/fantasy-stock-deploy rev-parse --short HEAD   # must print <MERGE>
cat supabase/.temp/project-ref                                     # must print haiaaifjcclsvmkfqgmd
supabase db push --dry-run
supabase db push
```
The dry run must list **exactly** `20260925000000_leagues_member_draft_complete_column_guard.sql`
and `20260925000001_tighten_league_standings_insert.sql`. "Remote database is up to date"
here means the wrong folder or a stale checkout, **not** success. The password comes
from the prompt or `SUPABASE_DB_PASSWORD` (step 4), never from `-p`. **1.0.0 clients are unaffected:**
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

## Step 7 — Mobile release  *(EAS **build** from `/Users/giorgio/fantasy-stock-deploy/apps/mobile` @ `<MERGE>`; NOT `eas update`)*

Preconditions: step 2 (redirect allowlist) and step 5.3 (`send-notification` live).
```bash
cd /Users/giorgio/fantasy-stock-deploy/apps/mobile
git -C /Users/giorgio/fantasy-stock-deploy rev-parse --short HEAD   # must print <MERGE>
eas build --profile production --platform all
```
Run it from `apps/mobile/`, never from the repo root, which offers to create a duplicate
project (decline that). If EAS can't evaluate the app config for lack of `node_modules`,
run `npm ci` at the deploy checkout's root first. The build must report runtime
**1.1.0**. Consider bundling with `ui/design-system-pass-v2` if its visual check passes
(STATUS §5); if you do, build from a checkout at that combined commit, not from the
main checkout.

Smoke checks on the new build:
- **F2:** request a reset, open the emailed link, and reach reset-password to set a new
  password. If the reset is rejected, the step-2 allowlist entry is wrong.
- **F13:** a password change with a wrong current password is refused.
- **F3:** a new league's invite code is 10 characters from the unambiguous alphabet.
- **F7:** in a two-human draft, the next picker receives "It's Your Turn!".
  `send-notification` logs show `sent:true`.

## Step 8 — Refresh the map

1. Re-capture `docs/architecture/db-snapshot.json`: run `docs/architecture/db-snapshot.sql`
   against prod and save the single output cell. The current snapshot is from 2026-08-12.
2. `node scripts/gen-architecture.mjs`, then commit on a branch.
3. Drift panel: the HIGH row `enforce_leagues_member_update_columns() — ABSENT from prod
   snapshot` must clear. If it doesn't, the push didn't land, whatever step 6's output
   said.

## Step 9 — Record it

Update `docs/STATUS.md` §2 (ledger: migrations through `20260925000001`, deployed
functions with the folder and commit each came from, the `refresh_symbols_daily` 200
evidence) and §4 (close defect 4 once prod provably equals `<MERGE>`).

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
- **Edge functions:** `send-notification` rollback = delete it on the dashboard (nothing
  calls it before step 7).
  **Never roll `refresh-symbols` or `historical-bars` back to `a324395`**: that is
  pre-PR-#9 `main`, which lacks F5/F9 and has `verify_jwt = true`. It would reintroduce
  the refresh cron's 401s and drop F9. Their last-known-good is `2dd699f` or `<MERGE>`.
- **Mobile:** 1.0.0 binaries keep working throughout. Nothing in steps 1–6 requires them
  to update.
