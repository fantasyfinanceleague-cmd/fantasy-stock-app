# Account deletion: the functions' effect test (Giorgio's steps)

For W3 of `docs/plans/2026-10-21-account-deletion.md`: `delete-account`,
`heal-account-deletions`, and the `takeover` action on `join-league`. Everything here is
**prod-mutating and yours to run**; no worker applied or deployed anything. Verify every
claim **by data**, never by a status string (CLAUDE.md "Success signals"): `net.http_post`
is async, `cron.job_run_details` says `succeeded` on enqueue, and `net._http_response`
times out at 5 s.

Use **throwaway test accounts only**. A deletion cannot be undone.

## The order, in short (details below)

1. **Secrets** (section 0): `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_BUNDLE_ID`. Names only here.
2. **Dashboard checks** (section 0): "Single session per user" off, CAPTCHA on password sign-in off, **"Secure password
   change" ON**, **manual identity linking OFF**.
3. **Deploy the functions FIRST** (section 1; each byte-verified against its commit, the expected upload files are listed there):
   1. `delete-account`
   2. `heal-account-deletions`
   3. `join-league`
   4. `preview-league`
   5. `draft-autopick-sweep`
   Functions go first because the two migrations below only SCHEDULE calls to them (the heal cron posts to
   `heal-account-deletions`), so the first tick after the push must find live code. Everything the functions call
   already exists: W2's `20261125000000`-`09` are applied (STATUS, 2026-10-21, #306), `league_invites.kind` included
   (`06`), so `preview-league`'s `kind` filter is safe before the push.
4. **Check the no-credential 401s** (section 1): `heal-account-deletions` and `draft-autopick-sweep` must answer OUR
   401 (`{"error":"Unauthorized"}`), not the gateway's; `delete-account` must answer the gateway's 401.
5. **`supabase db push --dry-run`, expecting EXACTLY two files**: `20261125000010` (the heal cron) and `20261125000011`
   (the deleted-seat cron guard). If it lists anything else, stop and look. Then `supabase db push`.
6. **Grants**: the `proacl` query in section 1 (service_role only on every new function).
7. **Curl and data checks**: sections 2-5 (refusals, a real deletion), 6 (the heal, by data), 6b (a deleted seat in an
   unclocked draft), 7 (Apple pending/unrevoked), 8 and 8b (takeover and its preview).
8. **TestFlight, with an Apple account** (section 9): the one check curl cannot do.

## 0. Before anything (names only, no values here)

**Supabase secrets** (the `.p8` is the one the onboarding plan already needs for web
Apple sign-in; mind its 6-month expiry reminder):

| Secret | What |
|---|---|
| `APPLE_TEAM_ID` | the Apple developer Team ID |
| `APPLE_KEY_ID` | the Sign in with Apple key's id |
| `APPLE_PRIVATE_KEY` | the `.p8` file's full PEM text (a pasted one-liner with literal `\n` also works) |
| `APPLE_BUNDLE_ID` | the app's bundle id (`client_id` for the native flow) |

```bash
supabase secrets set --project-ref haiaaifjcclsvmkfqgmd APPLE_TEAM_ID=… APPLE_KEY_ID=… APPLE_BUNDLE_ID=…
supabase secrets set --project-ref haiaaifjcclsvmkfqgmd APPLE_PRIVATE_KEY="$(cat /path/to/AuthKey_XXXX.p8)"
```

Until all four are set, an **Apple-linked** account's deletion refuses with
`server_config_error` BEFORE changing anything (fail closed); email and Google accounts
are unaffected. `supabase secrets list` shows names only: confirm all four appear.

**Dashboard settings to check** (the function signs the person in once to prove them, so
these can break it):
- **Single session per user** (Auth → Sessions, Pro): if on, the proof sign-in would end
  the caller's own session. Keep it off, or tell me.
- **CAPTCHA on sign-in** (Auth → Attack protection): the server cannot solve one, so every
  password proof would fail `bad_proof`. Must be off for password sign-in.
- **Anonymous sign-ins**: an anonymous user has no email or identities, so can never prove
  and never delete. Confirm there are none in the app.
- **"Secure password change"** (Auth → Providers → Email) ON, and **manual identity linking** OFF. The server
  enforces the proof order itself (below), but these two close the email-only residual: with secure password change
  on, a stolen session cannot set a new password without re-authenticating, and with manual linking off a stolen session
  cannot attach a Google or Apple identity it controls to an email account to change which proof is required.

**The proof order the server enforces** (plan decision 10; the client's order is not trusted): an account with an
**Apple** identity must prove with Apple (`apple_proof_required` otherwise); else an account with a **Google** identity
must prove with Google (`google_proof_required` otherwise); a **password** proof is accepted only when the account has
neither, AND its identities are non-empty and all email (an allow-list: `proof_not_supported` otherwise). Reason: a session can set a new password with `updateUser({password})` without knowing the old one, so a stolen
session could otherwise "prove" a Google account by password and delete it.

## 1. Deploy, check, then push (from the deploy checkout, per CLAUDE.md)

Refresh the deploy checkout to a `main` that CONTAINS this branch, then deploy the functions (nothing is pushed yet):

```bash
git -C /Users/giorgio/fantasy-stock-deploy fetch origin && git -C /Users/giorgio/fantasy-stock-deploy checkout --detach origin/main
cd /Users/giorgio/fantasy-stock-deploy
supabase functions deploy delete-account --project-ref haiaaifjcclsvmkfqgmd
supabase functions deploy heal-account-deletions --project-ref haiaaifjcclsvmkfqgmd
supabase functions deploy join-league --project-ref haiaaifjcclsvmkfqgmd
supabase functions deploy preview-league --project-ref haiaaifjcclsvmkfqgmd
supabase functions deploy draft-autopick-sweep --project-ref haiaaifjcclsvmkfqgmd
```

`supabase/config.toml` carries each function's `verify_jwt` (`false` for `heal-account-deletions` and
`draft-autopick-sweep`, `true` for the rest), so no flag is needed. Adding `--no-verify-jwt` to those two is harmless
belt-and-braces; the **401 check below is the proof either way** (CLAUDE.md: a `verify_jwt` flip may not take on the first deploy).

`draft-autopick-sweep` (cron-only) now also auto-picks for a **deleted seat in an UNCLOCKED draft** (section 6b). It is the
only function whose behaviour changes for this: the other draft functions (`validate-and-record-pick`, `draft-control`)
bundle the edited `_shared/auto-pick.ts` but never pass the new option, so they behave exactly as before and need no
redeploy. It calls W2's `unclocked_deleted_seat_turns()` (already live).

`preview-league` filters `league_invites` on `kind = 'invite'` (so a takeover code pasted into the join preview reads like an
unknown code). `kind` is W2's column, live since `20261125000006`/`08`, `NOT NULL DEFAULT 'invite'` and backfilled, so this is
safe before the push. After deploying, confirm with a REAL ordinary invite code in the app's join preview (it must show the
league), not with the deploy output.

**Check the no-credential 401s** (a request that reaches OUR code, not the gateway's generic one):

```bash
for fn in heal-account-deletions draft-autopick-sweep; do
  curl -s -w "  <- $fn %{http_code}\n" -X POST https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/$fn
done
# EXPECT 401 and the body {"error":"Unauthorized"} (ours) for both; the gateway's own message would mean verify_jwt did not flip
curl -s -w "  <- delete-account %{http_code}\n" -X POST https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/delete-account
# EXPECT 401 from the gateway (verify_jwt = true: no token, never reaches the function)
```

Then the two cron migrations:

```bash
supabase db push --dry-run     # EXPECT exactly two pending files: 20261125000010 (heal cron) and 20261125000011 (deleted-seat cron guard)
supabase db push               # HUMAN ACTION. Applies EVERY pending file, so read the dry-run first.
```

(Both need W2's functions, already in prod: `heal_account_deletions_due()` for the heal cron, `unclocked_deleted_seat_turns()` for
the cron guard. plpgsql resolves names at run time, so without them each would create cleanly and then fail or degrade every tick.)

**Verify each deploy**: the "Uploading asset" list must include every local file the new
code imports, then `supabase functions download <fn> --workdir <scratch>` and diff against
the commit. Expected import sets:

- `delete-account`: `delete-account/run.ts`, `_shared/account-deletion.ts`,
  `_shared/account-deletion-db.ts`, `_shared/apple-revoke.ts`, `_shared/jwt-claims.ts`,
  `_shared/deletion-notices.ts`, `_shared/notice-delivery.ts`, `_shared/push.ts`
- `heal-account-deletions`: `heal-account-deletions/run.ts`, the same `_shared` set,
  plus `_shared/cron-auth.ts`, `_shared/job-status-io.ts`, `_shared/job-status.ts`,
  `_shared/run-job.ts`
- `preview-league`: its own files only (`reason.ts`, `inviter.ts`, `shape.ts`, `index.ts`); no new imports.
- `draft-autopick-sweep`: `_shared/deleted-seat.ts` (new), `_shared/auto-pick.ts` (changed), plus the files it already imports
  (`_shared/draft-write.ts`, `_shared/draft-start.ts`, `_shared/cron-auth.ts`, ...). Compare the upload list with the previous deploy: the only new file is `deleted-seat.ts`.
- `join-league`: `join-league/takeover.ts`, `invite-preview/respond.ts` (its `clientIp`; it imports
  `_shared/web-origin.ts` and `preview-league/reason.ts`), `_shared/notice-delivery.ts`, `_shared/push.ts`

Then the grants (W2's functions; `REVOKE FROM PUBLIC` alone does not clear Supabase's
default `anon`/`authenticated` grants, CLAUDE.md):

```sql
SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname IN (
  'scrub_deleted_manager','account_deletion_open','account_deletion_cancel','account_deletion_set_apple',
  'account_deletion_stash_apple_token','account_deletion_apple_token','account_deletion_apple_revoked',
  'account_deletion_apple_unrevoked','account_deletion_fail','account_deletion_mark_done',
  'heal_account_deletions','heal_account_deletions_due','take_over_team','takeover_preview',
  'unclocked_deleted_seat_turns');
-- EXPECT every row's proacl to list service_role=X and NOT anon=X or authenticated=X
-- takeover_preview matters most: it takes p_user_id, so if anon/authenticated can execute it, any
-- signed-in client can call it straight through PostgREST with a forged user id and no edge limiter.
-- (deleted_manager_label and create_takeover_invite are meant to be callable by authenticated)
```

## 2. Get a session for the test account

```bash
export SB=https://haiaaifjcclsvmkfqgmd.supabase.co
export PUB='<the publishable key, from the Supabase dashboard>'
export EMAIL='<throwaway test account email>'
export PW='<its password>'
export JWT=$(curl -s -X POST "$SB/auth/v1/token?grant_type=password" -H "apikey: $PUB" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "${JWT:0:12}…"
export DEL="$SB/functions/v1/delete-account"
```

## 3. Refusals: nothing changes

```bash
# 3a. No token → the gateway's 401 (verify_jwt = true)
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$DEL" -H "apikey: $PUB" -H 'Content-Type: application/json' -d '{}'
# EXPECT 401

# 3b. Malformed bodies → 400 bad_request
curl -s -X POST "$DEL" -H "apikey: $PUB" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{}'
curl -s -X POST "$DEL" -H "apikey: $PUB" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"proof":{"kind":"password"}}'
# EXPECT {"ok":false,"reason":"bad_request"} twice

# 3c. A user id in the body changes nothing: it is ignored, the JWT's user is the only one
curl -s -X POST "$DEL" -H "apikey: $PUB" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"user_id":"00000000-0000-4000-8000-000000000000","proof":{"kind":"password","password":"wrong"}}'
# EXPECT {"ok":false,"reason":"bad_proof"} (and the OTHER user is untouched)

# 3d. Wrong password → bad_proof, five an hour, then locked EVEN FOR THE RIGHT PASSWORD.
#     3c already counted ONE failure, so this loop sees FOUR bad_proof and the fifth call is
#     already the lock. (Sections 3a-3d send ~9 requests; the per-minute limiter allows 10, so
#     `sleep 60` before 3d if you also re-ran anything.)
for i in 1 2 3 4 5; do
  curl -s -X POST "$DEL" -H "apikey: $PUB" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
    -d '{"proof":{"kind":"password","password":"wrong"}}'; echo
done
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$DEL" -H "apikey: $PUB" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{\"proof\":{\"kind\":\"password\",\"password\":\"$PW\"}}"
# EXPECT four {"ok":false,"reason":"bad_proof"} (3c was the first), then 429 {"ok":false,"reason":"rate_limited"}
# for the fifth loop call and for the right-password call
```

Heads-up: **3d locks this account's deletion for the rest of the clock hour**
(`rate_limit_counters`, bucket `delete-account-proof`). Use a different throwaway account
for step 4, or wait for the next hour. The 3c call counts as one of the five.

Data check after section 3 (nothing may have changed):

```sql
SELECT count(*) FROM auth.users WHERE email = '<EMAIL>';                       -- EXPECT 1
SELECT count(*) FROM public.account_deletions;                                 -- EXPECT 0 (no ledger row for a refusal)
```

An Apple 4xx also refuses BEFORE any change, ledger included (a ledger row would make the
heal finish a deletion the response called `bad_proof`); that case needs a phone (step 9).

## 4. A real deletion (password account, a second throwaway)

First give it something to leave behind: join a league that has started (so a seat is
marked) and one that has not (so the member row goes), and register a push token.

```bash
curl -s -X POST "$DEL" -H "apikey: $PUB" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{\"proof\":{\"kind\":\"password\",\"password\":\"$PW\"}}"
# EXPECT {"ok":true,"stage":"done","apple_revoke":"none"}
```

`ok` is true only at stage `done`. Then **by data**:

```sql
SELECT id FROM auth.users WHERE email = '<EMAIL>';                              -- EXPECT 0 rows
SELECT stage, apple_revoke, last_error FROM public.account_deletions WHERE user_id = '<UID>';
                                                                                -- EXPECT stage done, apple_revoke none, last_error NULL
SELECT count(*) FROM public.user_profiles WHERE id = '<UID>';                   -- EXPECT 0
SELECT count(*) FROM public.push_tokens   WHERE user_id = '<UID>';              -- EXPECT 0
SELECT league_id, deleted_at, frozen_username, frozen_avatar
  FROM public.league_members WHERE user_id = '<UID>';
  -- EXPECT: started-league seats have deleted_at set and frozen_* NULL; the pre-draft league has no row
SELECT count(*) FROM public.trades WHERE user_id = '<UID>';                     -- EXPECT unchanged from before (the FK is gone)
```

And the sessions died with the auth row:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$SB/auth/v1/user" -H "apikey: $PUB" -H "Authorization: Bearer $JWT"   # EXPECT 401
curl -s "$SB/auth/v1/token?grant_type=password" -H "apikey: $PUB" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}"                                                              # EXPECT invalid_credentials
```

The commissioner side (run on a test commissioner): the earliest-joined remaining member is
now `leagues.commissioner_id` (in a started league too), and an empty league is gone.

## 5. A retry is safe

Repeat the exact call from step 4 with a fresh JWT of a second account that failed
midway, or simply re-run it: the call re-enters at the ledger's stage. Once the account is
gone the JWT no longer verifies, so a repeat returns the gateway's 401; that is the
expected end state, not an error.

## 6. The heal, by data (the cron)

```sql
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'heal_account_deletions';
-- EXPECT schedule '23 * * * *', command containing timeout_milliseconds := 180000,
--        heal_account_deletions_due() and vault 'cron_apikey' (no key-shaped literal)
SELECT public.heal_account_deletions_due();      -- EXPECT false on a clean system, no error
-- (true iff: a 'requested' row older than 10 min, any 'scrubbed', any 'pending', a 'required' row
--  older than 10 min, or a purgeable 'done' row)
```

Interrupt a deletion on purpose (a THIRD throwaway; `<UID>` is its auth id). Each variant
should reach `done` on the next `:23` pass **after the row is 10 minutes old**:

```sql
-- (a) died right after the ledger opened
SELECT public.account_deletion_open('<UID>', false);
-- (b) died after the scrub, before the auth delete
SELECT public.account_deletion_open('<UID>', false);
SELECT public.scrub_deleted_manager('<UID>');
```

Wait past 10 minutes and the next `:23`, then:

```sql
SELECT stage, apple_revoke, last_error, updated_at FROM public.account_deletions WHERE user_id = '<UID>';
                                                                -- EXPECT stage done (or the row purged after 7 days)
SELECT count(*) FROM auth.users WHERE id = '<UID>';              -- EXPECT 0
SELECT status, error_message FROM public.cron_job_status
 WHERE job_name = 'heal-account-deletions' ORDER BY run_date DESC LIMIT 3;
-- EXPECT 'success' rows reading work=N scrubbed=… auth_deleted=…. A 'failed' row means a step errored:
-- its message has counts only; the row's last_error says which stage.
```

The cron status row is a one-row-per-day summary, not the evidence; **the evidence is the
`account_deletions` row and the missing `auth.users` row.**

## 6b. A deleted seat in an UNCLOCKED draft must not stall it (the sweep)

An unclocked draft (`pick_clock_enabled = false`) never auto-picks, so a deleted manager's seat would wait
forever. Giorgio's rule ("there can never be an instance where a player doesn't get a pick") decides it: the
sweep picks for a DELETED seat in an unclocked live draft as soon as it is that seat's turn, through the same
auto-pick (queue first, then best available, same legality gate). A **live** manager's seat in the same draft is
never auto-picked, and a clocked draft is unchanged (its clock expiry covers a deleted seat).

```sql
SELECT proname, proacl FROM pg_proc WHERE proname IN ('unclocked_deleted_seat_turns','draft_auto_start_work_due');
                                                       -- EXPECT service_role=X, no anon=X / authenticated=X
SELECT * FROM public.unclocked_deleted_seat_turns();   -- a live unclocked draft with a deleted seat: EXPECT it listed, with its next pick_number
SELECT public.draft_auto_start_work_due();             -- EXPECT true while one is listed (the cron guard)
```

By data, with a throwaway **unclocked** draft of 3 managers where one has been deleted (section 4):
1. When it is the deleted seat's turn, within about 15 s a `drafts` row appears for that user with
   `pick_source` `auto_queue` or `auto_best`. Re-run after each round: the draft keeps advancing to the end.
2. While it is a LIVE manager's turn, **no** pick is made for them, however long you wait.
3. The sweep's JSON (`results`) shows `seat_live` for the live turn and `picked` for the deleted seat;
   `errors` lists `seat_read_failed` only if `league_members` could not be read (it never picks then).

Cost: while such a draft is live, the cron guard is true every tick, so the sweep makes one cheap read of that
league every 10 s (no Alpaca call unless it is the deleted seat's turn). It stops when the draft completes.

## 7. Apple pending / unrevoked (plumbing; the real revoke needs a phone, step 9)

Stash a bogus token against an interrupted test row. **Unverified:** Apple should answer
4xx to `/auth/revoke` for a token it never issued, which settles the row `unrevoked`; but
it may answer 200 (revoke is idempotent), which settles it `done`. Either outcome proves the
plumbing, so accept either. On `unrevoked` the pass drops the vault entry and logs
the constant line `account deletion: apple revoke unresolved (unrevoked)` plus a 12-hex
hash (never the user id):

```sql
SELECT public.account_deletion_open('<UID>', true);
SELECT public.account_deletion_stash_apple_token('<UID>', 'not-a-real-apple-token');
```

After the next `:23` pass:

```sql
SELECT stage, apple_revoke FROM public.account_deletions WHERE user_id = '<UID>';   -- EXPECT 'unrevoked' (or 'done' if Apple answered 200)
SELECT count(*) FROM vault.secrets WHERE name = 'apple_revoke:<UID>';                -- EXPECT 0 (token dropped)
```

and, on `unrevoked`, in the `heal-account-deletions` function logs: the constant line above,
once. If the APPLE secrets are missing, or Apple answers `invalid_client` (our `.p8` is wrong
or expired), the row stays `pending` with its token and the run records `failed`, so a broken
Apple setup cannot look healthy. The heal also refuses the WHOLE auth-delete list when it holds more than 25 entries, or any
entry that is not a uuid (a bug upstream): it deletes none, still runs the Apple half, and records
`failed` with `auth_refused=N` and the response reason `auth_delete_refused`. It asks the SQL for at
most 25 per pass, oldest first, so a real backlog drains in chunks and never trips this. If it does
trip: look at `SELECT user_id, stage, requested_at FROM public.account_deletions WHERE stage = 'scrubbed'
ORDER BY requested_at;`; if those rows are real, the SQL ignored `p_limit` (a W2 bug to fix), and a
human can clear them by calling `delete-account`'s own path per user or by deleting the auth users by
hand and calling `account_deletion_mark_done` for each.

## 8. Takeover (`join-league`, `action: takeover`)

The commissioner creates a takeover code in the app (`create_takeover_invite`, W4's button).
For a curl test, a second throwaway user `$JWT2` who is NOT in the league:

```bash
export JOIN="$SB/functions/v1/join-league"
curl -s -X POST "$JOIN" -H "apikey: $PUB" -H "Authorization: Bearer $JWT2" -H 'Content-Type: application/json' \
  -d "{\"action\":\"takeover\",\"code\":\"$TAKEOVER_CODE\"}"     # the body carries ONLY the code: the league comes from it
# EXPECT {"ok":true,"status":"taken_over","league":{"id":"…","name":"…"}}
# A SECOND taker (a third user, or the same call again):
# EXPECT {"ok":false,"reason":"taken"}
```

By data: `league_members` for the seat now carries the taker's uuid with `deleted_at` NULL
and the old record intact (`league_standings`, `matchups`, `week_snapshots`, `drafts`,
`trades` all moved); `league_participant_display_name` shows the taker's name on the past
weeks; the commissioner has one `seat_taken_over` row in `league_notifications` whose
`push_status` settled (`sent` or `no_device`, never left `pending`/`sending`). Other
reasons (`gone`, `invalid_code`, `not_deleted`, `window`, `already_member`,
`not_eligible`) come back as `{"ok":false,"reason":…}` with HTTP 200. The user id is the
JWT's and the league is the code's: a `user_id` or `league_id` field in the body is ignored. A code is
exactly ten of `A-Z0-9`, matched exactly: a lowercase or malformed code is answered
`{"ok":false,"reason":"invalid_code"}` at the edge, with no database lookup.

## 8b. Takeover preview (the read before the take)

```bash
curl -s -X POST "$JOIN" -H "apikey: $PUB" -H "Authorization: Bearer $JWT2" -H 'Content-Type: application/json' \
  -d "{\"action\":\"takeover_preview\",\"code\":\"$TAKEOVER_CODE\"}"
# EXPECT {"ok":true,"league_name":"…","wins":N,"losses":N,"rank":N}   (a pure read: no seat moves, no push)
# a wrong code / taken seat / etc.: {"ok":false,"reason":"invalid_code"|"taken"|"gone"|…}
```

Both takeover actions sit behind the shared `join-league` limiter AND their own, **fail-closed**
limiter (bucket `join-league-takeover`: 10/min per user, 30/min per IP on the right-most forwarded
hop; a limiter error answers `503`, never lets the request through). **That limiter is not what
protects the codes**: the per-user bucket is farmable with free accounts, and the per-IP one is only
as good as the proxy's header. The protection is the code's entropy and W2's in-SQL miss accounting:
codes must be CSPRNG, at least 50 bits (the 10-char/32-symbol renewal-code format; never the
6-character join format, and never derived from a league or seat id), single-use, expiring, revoked
when the seat is taken, kept in `league_invites` with `kind='takeover'` only (the legacy join must
not accept them, nor the preview resolve ordinary invites), and ideally stored as a hash. A wrong
code must answer `invalid_code` identically whether the league exists, the seat is open, or the
seat is taken.

## 9. TestFlight, with an Apple account (the one thing curl cannot do)

On a TestFlight build signed in **with Apple**, delete the account from Profile.

- The Apple sheet appears, then the "Are you sure?" alert; **send nothing until Delete**.
  The authorization code lives about 5 minutes and the id token is refused after 10, so
  do not sit on the alert.
- Result: the app lands on sign-in with "Your account is deleted."
- By data: `account_deletions.apple_revoke = 'done'`, `stage = 'done'`, no `auth.users`
  row, no `vault.secrets` row named `apple_revoke:<UID>`.
- On the phone: **Settings → Apple ID → Sign in with Apple** no longer lists the app.
- Negative: with one throwaway, tap Delete, then immediately kill Wi-Fi mid-request and
  retry: the retry needs a NEW Apple sheet (an Apple-linked account must always re-prove
  with Apple), and ends at `done`.
- An Apple-linked account that proves by password (or Google) gets
  `{"ok":false,"reason":"apple_proof_required"}` and nothing changes; only Apple's fresh
  code can be revoked.

## Responses the app must handle (delete-account)

| HTTP | Body | Meaning | Counts against the 5 an hour? |
|---|---|---|---|
| 200 | `{ok:true, stage:'done', apple_revoke}` | deleted. `apple_revoke` is the LEDGER's value (`none`/`done`/`pending`/`unrevoked`), never a local guess: if an earlier attempt already settled it, that terminal value is what you get | no |
| 200 | `{ok:false, reason:'bad_proof'}` | wrong password; an account with no email trying a password; a token for another person or for a provider the account lacks; an undated token; Apple answering 4xx on the code exchange; or an Apple code not issued to this Apple user | **yes** |
| 200 | `{ok:false, reason:'proof_expired'}` | the Apple/Google token is over 10 minutes old: sign in again | no |
| 200 | `{ok:false, reason:'apple_proof_required'}` | an Apple-linked account must prove with Apple | no |
| 200 | `{ok:false, reason:'google_proof_required'}` | a Google-linked account (with no Apple identity) must prove with Google, never by password | no |
| 200 | `{ok:false, reason:'proof_not_supported'}` | a password proof for an account whose identities are not ALL email ones (none at all, or a provider this app does not use): refused rather than waved through | no |
| 429 | `{reason:'rate_limited'}` | 5 failed proofs this hour, or the per-minute limit | n/a |
| 503 | `{reason:'try_again'}` | GoTrue was down or throttled during the proof: retry | no |
| 400 | `{reason:'bad_request'}` | malformed body | no |
| 500 | `{reason, stage}` | a server fault; a `stage` means the ledger row exists and the heal finishes it within the hour | no |

## What `ok` means

`ok:true` appears only at ledger stage `done`, where `account_deletion_mark_done` has
itself confirmed `auth.users` no longer has the id. `apple_revoke` (`none` / `done` /
`pending` / `unrevoked`) is reported **next to** `ok`, never folded into it. A `500` that
carries a `stage` means "deletion in progress": the ledger row exists and the heal will
finish it (typically within about 70 minutes). One exception to know: for an Apple account
whose request died BEFORE the revoke settled, the heal can only settle the row as `unrevoked`
(the single-use code is long gone), so that Apple revoke is lost; the `unrevoked` log line is
the only trace.
