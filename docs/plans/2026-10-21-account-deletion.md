# In-app account deletion

Status: Draft (rulings taken 2026-10-21; approval pending)
Planner session: Planner (Fable 5.1) · Orchestrator hand-off: —

## Goal

A player can delete their account from inside the app, and it is gone when the request
returns. App Store guideline 5.1.1(v) requires this for any app with account creation, so
it blocks the 1.3 review; Sign in with Apple (onboarding W2) adds the server-side Apple
token revoke Apple requires of apps that use it. The league side follows fantasy football:
the team outlives the account. A deleted manager's seat stays in every league that has
started this season, keeps its record, and the commissioner can hand it to a new manager.

## Giorgio's rules

Each one is also in `docs/PRODUCT_RULES.md` under **Account deletion**.

- 2026-10-21, after the Orchestrator's note on 5.1.1(v): "lets work on where this should live
  and plan out the flow"; "research how espn fantasy football, yahoo fantasy football, and
  sleeper handle if someone deletes their account mid season".
- 2026-10-21, on the mid-season team (A = the team stays and keeps playing, C = the
  commissioner can hand it to a new member): "A plus C in this plan but we delete the account
  asap, not the 30 day window like sleeper".
- 2026-10-21, on the leaver rule's "No 'Former manager' label" colliding with deletion: "we
  stick with the plan and change the product rules. we need to comply with the apple rules."
- 2026-10-21, on the team after a takeover: "keep the teams record just the owner is gone".
- 2026-10-21, on a commissioner who deletes: "lets just make the first person to join the
  league (besides the commissioner) to auto become the commissioner".
- 2026-10-21, on the flow: "we also need to decide where the account deletion button and
  process lives. and i want to add a 'are you sure, this cant be reversed' kinda thing to
  ensure the user isnt misclicking or is sure of their action".
- 2026-10-21, picking the location from the A/B mockup: "last row in profile works but we
  shouldnt have it be highlighted, that draws attention to it. the flow is also good".

Research the rulings rest on (2026-10-21): Sleeper's help centre says deleting your account
does not remove you from your leagues ("your teams stay in place because they affect other
users"); the commissioner unassigns or removes the team; deletion completes within 30
business days. Yahoo: after the draft, teams can't be added or removed without resetting the
draft, but a team can be transferred to a new manager. ESPN: after the draft only the league
manager can remove or reassign a team, and it otherwise keeps running. All three: the team
outlives the account.

## Decisions

| # | Question | Decision | Who / date |
|---|---|---|---|
| 1 | Where it lives | **A: the last row in Profile, below Sign out.** A plain row like the others, danger-coloured text only: no tinted background, no highlight, nothing that draws the eye to it. | Giorgio 2026-10-21 |
| 2 | The mid-season team | **A + C.** The seat stays in every league whose draft has started this season, keeps playing on what it holds (no trades, no claims), and the commissioner can hand it to a new manager. | Giorgio 2026-10-21 |
| 3 | Timing | **Immediate.** The auth account, profile, push tokens and every private row are gone when the request returns. No grace period, no restore. | Giorgio 2026-10-21 |
| 4 | The name on the seat | The leaver rule (frozen name and avatar, no label) gets its one exception: a *deleted* manager's name and avatar are scrubbed everywhere and the seat shows a placeholder label with the default avatar. Label wording = board call (§Open questions). | Giorgio 2026-10-21 ("change the product rules") |
| 5 | A takeover | The new manager inherits the whole seat: roster, cash, win/loss record, waiver position, and the past weeks under their name. "The owner is gone", nothing else changes. | Giorgio 2026-10-21 |
| 6 | A commissioner who deletes | No picker, no refusal: the title passes automatically to the earliest-joined remaining human member (`league_members.joined_at`, then `user_id` as the tiebreak). A league with no other member is deleted with the account. | Giorgio 2026-10-21 |
| 7 | Before the draft | Same as leaving: the member row goes, the roster reconfirmation fires for the commissioner (`leave_league`'s pre-draft branch), the league stays joinable. | Planner, standing (leave rules) |
| 8 | During a live draft | The seat stays and auto-picks for the rest of the draft, exactly as a manager who closed the app ("Out of time? We pick for you"). Takeover opens once the draft is complete. | Planner, standing (draft liveness rules) |
| 9 | After the season | The seat stays in history under the placeholder; nothing to take over. | Planner, standing (history is kept) |
| 10 | Confirming | Re-authenticate, then the destructive button, then a final **"Are you sure?"** alert ("This can't be undone.") with "Keep my account" as the safe default and "Delete" as the destructive action; nothing is sent to the server until that alert is answered. Email: password. Apple: Sign in with Apple again (this also yields the authorization code the Apple revoke needs). Google: Google sign-in again. The server checks the proof's subject is the caller. | Giorgio 2026-10-21 (the are-you-sure step); Planner (re-auth) |
| 11 | After deletion | Every device is signed out (sessions die with the auth row). The sign-in screen shows once: "Your account is deleted." (UX rules 8/9: say what happened, where the person lands.) | Planner |
| 12 | Signing up again | The same email can sign up again at once; it is a new account with no history (subject to the signup gate). | Planner |
| 13 | How a takeover is offered | The commissioner sees "Find a new manager" on the placeholder seat (League › Members and the standings row). It shares a takeover link of the same https universal-link shape as an invite. The first signed-in person to open it who is not in the league takes the seat. | Planner rec; screen = board call |
| 14 | Takeover window | From draft complete through the end of the playoffs. Not before the draft (no seat exists) and not after the season (nothing to take). Any join window rule for new seats is untouched. | Planner |
| 15 | Web | Deletion is in-app only (the guideline is about the app; the web is a paused landing plus the join page). The web profile lookup must show the same placeholder. A takeover link opened without the app lands on the W5 page's "Get the app" path. | Planner |

## Open questions

Board calls for Giorgio (the Design Lead draws them; none block the backend):

1. **The placeholder label.** A: "Former manager" (already drawn as the unchosen option B
   on the inventory board) · B: "Open team". Planner recommends A: after the season there is
   nothing open about it, and "Former manager" reads the same in standings, matchups and
   history.
2. **The delete screen.** One frame: title, what happens to your leagues, the re-auth step,
   the destructive button. The Planner's copy draft is in §How it works; the board shows it
   in both themes at default and XXXL.
3. **"Find a new manager".** Where it sits on the Members list and the standings row, and the
   share sheet. Same frame family as Share league.

## Scope

In: the Profile entry; the delete flow with re-auth; the `delete-account` edge function
with the Apple revoke; the scrub (profile, push tokens, watchlist and claims when they
exist, invites sent, notifications, queue and renewal rows, frozen names); the seat
placeholder in every name seam (mobile and web); the automatic commissioner succession and
empty-league deletion; the takeover link, RPC and screens; a resumable deletion ledger with
a heal pass; tests; Giorgio's Apple secret and dashboard steps.

Out (and why): a grace period or restore (Giorgio: immediate); deletion from the web (the
guideline is for the app; the web has no account surface yet); an "unassign" or "kick"
tool for commissioners (not asked; the leave rules cover leaving); deleting a league from
the delete flow when it still has members (succession handles it); Google token revoke
(Apple requires only its own; Google access ends when the auth identity is deleted; noted
in the function's comments).

## How it works

### The player's side

1. **Profile › Delete account**: the last row, below Sign out, styled exactly like Sign out
   (danger text, plain row, no tint or highlight; decision 1). Tapping opens the delete
   screen.
2. **The delete screen** (copy draft; the board settles wording and layout):
   - Title: "Delete your account?"
   - Body: "This deletes your account right away. Your leagues keep playing: in any league
     that has already drafted this season, your team stays as '{placeholder}' and your
     commissioner can hand it to a new manager. Past seasons keep your results under that
     name too."
   - If they run a league with other members: "You run {League}. {Earliest member} becomes
     the commissioner." One line per league.
   - If they run a league with nobody else in it: "{League} has no other managers, so it is
     deleted with your account."
   - Re-auth block, by how they signed in: a password field ("Enter your password to
     continue"), or the Apple button, or the Google button. The button below stays disabled
     until the proof is in hand.
   - Button: "Delete my account" (destructive). No typed confirmation; the re-auth plus the
     final alert are the deliberate steps (decision 10).
3. **Are you sure?** A native alert (Giorgio: "to ensure the user isnt misclicking or is
   sure of their action"): title "Are you sure?", body "This can't be undone. Your account
   and sign-in are deleted for good.", buttons "Keep my account" (default, cancel style)
   and "Delete" (destructive). The request is sent only on "Delete". For Apple sign-ins the
   alert comes AFTER the Apple sheet, so the authorization code is in hand and is used
   within seconds; a cancel discards it.
4. **While it runs:** the button shows a spinner and nothing is tappable. On a failure the
   screen stays with a plain line ("Couldn't delete your account. Try again.") and the same
   button; the server is idempotent, so a retry is safe (§System, ledger).
5. **Done:** the app clears its session and lands on the sign-in screen with the one-time
   line "Your account is deleted." Every other device is signed out on its next refresh.

### The commissioner's side (C)

5. A placeholder seat shows "Find a new manager" to the commissioner only (League › Members
   and the standings row, decision 13). It opens the share sheet with a takeover link.
6. The takeover link is an https universal link carrying a takeover code (a fresh row in
   `league_invites` with `kind = 'takeover'` and the seat's id; one code per seat, revoked
   when the seat is taken or the season ends). With the app: the person signs in if needed
   and sees "Take over {placeholder}'s team in {League}?" with the record ("3–2, 4th") and
   a "Take the team" button. Without the app: the W5 page's "Get the app" path.
7. On "Take the team" the seat's rows in that league move to the new manager in one
   transaction (decision 5). Their name appears on the past weeks. The commissioner gets a
   push: "{Name} took over {placeholder}'s team." The seat's "Find a new manager" entry
   disappears.

### The system's side

**Identity model.** League rows keep the deleted manager's uuid. Every league table holds
the user id as plain text with no foreign key (`league_members`, `matchups`,
`league_standings`, `week_snapshots`, `drafts`, `league_draft_order`, `league_seasons`),
and once `auth.users` and `user_profiles` rows are gone the uuid links to nobody: it is an
opaque key, not personal data. So deletion does not rewrite league rows; it marks the seat.
The one exception is `trades.user_id`, the only league column with a real FK to
`auth.users`, and it is `ON DELETE CASCADE`: deleting the auth row would silently delete
the manager's trade history and make past weeks un-auditable for everyone else in the
league. **Migration 1 drops that FK** (keeping the column uuid), bringing `trades` in line
with every other league table.

**The seat mark.** `league_members.deleted_at timestamptz` (new, NULL = live manager or
leaver). It is the discriminator; the scrub sets it and NULLs `frozen_username`,
`frozen_avatar`, `frozen_at`. Never key the placeholder on "frozen_username IS NULL" (an
overloaded NULL). Leavers (`hidden_at`) are unchanged.

**The name seam.** `league_participant_display_name(p_league_id, p_user_id)`
(`20261119000000`) gains a first branch: `deleted_at IS NOT NULL` → the placeholder label
(a constant in one SQL function, `deleted_manager_label()`, so the board's pick changes one
place). Every mobile name comes through that seam (`get_league_display_names`,
`get_home_summary`, `get_season_result`, `get_renewal_roster`, `get_league_history`,
`get_season_matchups`, `get_home_league`). The web reads `get_visible_profiles`, whose
frozen branch gets the same `deleted_at` branch. Mobile avatars are initials from the name
(`components/sp/Avatar.tsx`): the placeholder renders the default avatar, not initials of
the label. `participant_display_name`'s `Player XXXX` fallback must never be what a deleted
seat shows; the PGlite test asserts the label.

**The function: `delete-account`** (`verify_jwt = true` plus in-code `getUser()`, the
`leave-league` pattern; the user id comes only from the JWT; rate-limited per user and ip).
Body: `{ proof: { kind: 'password', password } | { kind: 'apple', identityToken,
authorizationCode, nonce } | { kind: 'google', idToken } }`. Steps, in order:

1. **Prove it.** Password: `signInWithPassword` on a publishable-key client with the
   caller's email; any error → `bad_proof`. Apple / Google: `signInWithIdToken` on a
   publishable-key client; the resulting user id must equal the caller's, else
   `bad_proof`. (The sign-in's own session is discarded.) Five failed proofs per hour per
   user → `rate_limited`.
2. **Open the ledger.** Upsert `account_deletions (user_id pk, requested_at, stage,
   apple_revoke text, last_error, updated_at)`, stage `'requested'`. The ledger holds no
   email and no name; it exists so a crash between steps leaves a row a heal pass can
   finish, not a half-deleted account (CLAUDE.md: a refused or failed step must be
   recoverable).
3. **Apple revoke** (only when the auth identity list includes `apple`). Exchange the
   `authorizationCode` at `https://appleid.apple.com/auth/token` (`client_id` = the app's
   bundle id for the native flow; `client_secret` = an ES256 JWT signed with the team's
   `.p8` key, the same key the onboarding plan already requires Giorgio to create for web
   Apple sign-in, `sub` = the bundle id) for a refresh token, then `POST /auth/revoke`
   with `token_type_hint = refresh_token`. Success → ledger `apple_revoke = 'done'`.
   Apple unreachable or 5xx → store the refresh token in `vault` under
   `apple_revoke:<user_id>`, ledger `apple_revoke = 'pending'`, and continue: Apple being
   down must not keep someone from deleting their account. A 4xx on the exchange (code
   already used, wrong client) → `bad_proof` and stop before any data changes.
4. **Scrub, one transaction:** `scrub_deleted_manager(p_user_id)` (SECURITY DEFINER,
   service_role only, idempotent). In order:
   - Leagues they commission: for each, the earliest-joined other human member
     (`joined_at`, `user_id`) becomes commissioner (`leagues.commissioner_id`,
     `league_members.role`), in every window; the freeze trigger returns early for a
     service-role caller (`auth.uid()` IS NULL), which is the intended path. A league with
     no other member is deleted (cascades). Each succession writes a
     `commissioner_transferred` notice for the new commissioner.
   - Leagues whose draft has not started (`_league_membership_window` = `before_draft`):
     the pre-draft branch of `leave_league` (member row deleted, roster reconfirm upserted
     with no name snapshot, `member_left` notice), factored into a shared internal
     function rather than duplicated.
   - Every other membership: `deleted_at = now()`, `frozen_* = NULL`.
   - `league_roster_reconfirm.departed`: replace their `name` with the placeholder label.
   - Delete: `user_profiles`, `push_tokens`, `draft_queue`, `league_notifications` for them,
     `league_renewal_responses`, pending `league_invites` they sent (the
     `invited_identifier` is free text and may be an email), the watchlist and pending
     claims rows when those tables exist (the claims plan's `cancel_claim` semantics: a
     claim that is already `processing` is left to finish and then ignored because its
     user has no session; `claims-run` must treat a deleted seat as "no claim").
   - Ledger stage `'scrubbed'`.
5. **Delete the auth user**: `auth.admin.deleteUser(user_id)` (hard delete). Sessions and
   refresh tokens cascade, so every device is signed out. Ledger stage `'done'`.
6. Return `{ ok: true }`. On any failure after step 2, return `{ ok: false, reason }` with
   the ledger stage; the client's retry re-enters at the right step because every step is
   idempotent (the proof is re-required on retry, since the first one was consumed).

**Heal pass.** `heal_account_deletions` (cron, hourly, `timeout_milliseconds := 180000`,
the `runJob` bracket): for every ledger row not at `'done'` older than 10 minutes, re-run
the scrub and the auth delete (an auth user that is already gone counts as done); for every
`apple_revoke = 'pending'` row, retry the revoke from the vault token, then delete the vault
entry. Rows at `'done'` with no pending revoke are deleted after 7 days. Verify by data:
the test asserts a row interrupted at each stage reaches `'done'` on the next pass.

**Takeover: `take_over_team(p_league_id, p_code, p_user_id)`** (SECURITY DEFINER,
service_role only, called by a new `takeover` action on `join-league`, user id from the
JWT). Locks the seat row (`FOR UPDATE`), checks: the code matches an unrevoked takeover
invite for this league; the seat has `deleted_at IS NOT NULL`; the league's draft is
complete and the season is not over; the caller is not a member. Then, in the transaction,
every row of the old uuid in this league moves to the caller's: `league_members`
(`deleted_at = NULL`, `joined_at` kept, role member), `matchups` (team1, team2, winner),
`league_standings`, `week_snapshots`, `drafts`, `trades`, `league_draft_order`,
`league_seasons` (champion, runner-up), and the invite is marked accepted. A second caller
gets `'taken'`. The push to the commissioner goes through `_shared/push.ts` after commit.
`league_participant_display_name` then resolves the live username, so past weeks show the
new manager (decision 5).

**Why a service-role edge function and not a client-called RPC:** the freeze release treats
any `auth.uid() IS NOT NULL` caller as a user session and would refuse the commissioner
succession mid-season; and `auth.admin.deleteUser` needs the secret key. Same reasoning as
`leave-league`.

## Risks and edge cases

- **Partial state.** Six steps across two systems (Apple, Postgres, GoTrue). The ledger plus
  idempotent steps plus the heal pass make every interruption recoverable; the tests drive
  a crash after each step. Verdict scope: `ok: true` is returned only at stage `'done'`;
  `apple_revoke = 'pending'` is reported separately in the response and never folded into
  `ok`.
- **Apple revoke needs a fresh code.** Supabase keeps no Apple refresh token for the native
  flow, so the revoke is only possible with the authorization code from the re-auth in the
  same request. The code is single-use and short-lived: the client must send the delete
  request right after the Apple sheet closes, and a retry needs a new Apple sign-in.
- **The proof sign-in creates a session.** `signInWithPassword` / `signInWithIdToken` on the
  server mint a session for the caller; it is discarded, and the auth delete two steps later
  kills it anyway. On a `bad_proof` path nothing has changed.
- **Race: delete vs takeover vs commissioner deleting the league.** The seat lock and the
  league cascade settle it: a takeover after the league is deleted finds no seat
  (`'gone'`); a league deletion mid-takeover waits on the row lock.
- **Deletion during a claims run / mid-trade.** Trading needs a session, so no trade can
  follow the auth delete; a claim already `processing` finishes and is then ignored. Ruled
  in step 4; `claims-run` must not fail a run on a deleted seat (partial-state rule: per
  participant).
- **The freeze trigger.** It returns early for a NULL `auth.uid()`; the scrub runs as the
  service role on purpose. The `security-reviewer` must confirm no other trigger refuses
  the succession mid-season.
- **`trades` FK drop.** `trades.funded_by_trade_id` is `NO ACTION` and irrelevant once the
  cascade is gone; nothing else references `auth.users`.
- **Signup gate.** `signup_allowlist` is keyed by email, so a deleted person stays allowlisted
  and can re-register while signups are paused; acceptable, documented.
- **What Supabase keeps.** `auth.audit_log_entries` and database backups retain the email for
  their retention windows; the privacy policy should say so (Giorgio's step, not code).
- **Display regressions.** Every surface that renders a name must come through the seam; a
  grep for `username` reads outside `league_participant_display_name` /
  `get_visible_profiles` is part of W5's review. The leaver rule's frozen path must be
  untouched (its tests stay green).
- **Migrations.** New files only, provisional range `20261125000000`–`09`, re-stamped at
  release after prod's latest; re-created functions carry their full body and re-assert
  grants (`REVOKE FROM anon, authenticated` + `proacl` check); no bare `atomic`; cron with
  `timeout_milliseconds`; `cron_timeouts` and `migration_cli_split` tests cover them.

## Done means

- "Delete account" is the last Profile row, plain, danger text only (decision 1); the flow runs re-auth → "Are you
  sure?" → the sign-in screen with "Your account is deleted." once. "Keep my account" on the
  alert sends nothing (verified by the function's request log staying empty).
- After deleting a test account: no `auth.users`, `user_profiles` or `push_tokens` row;
  `league_members.deleted_at` set and `frozen_*` NULL in each started league; the seat
  reads the placeholder in standings, matchups, history, Home and the web lookup; trade
  history for that seat intact; the pre-draft league no longer lists them and its
  commissioner got the reconfirm; their old sessions on a second device are signed out.
- A commissioner's deletion: the earliest-joined member is commissioner (verified by query,
  in a mid-season league too); an empty league is gone.
- Apple: deleting an Apple-signed-in account removes the app from Settings › Apple ID ›
  Sign in with Apple on the phone, and the ledger reads `apple_revoke = 'done'`. With the
  Apple endpoint stubbed as down: deletion still completes, the ledger reads `'pending'`,
  and the heal pass clears it.
- Takeover: the link gives the seat to the first taker with its record; a second taker gets
  "already taken"; the new name shows on past weeks; the commissioner is pushed.
- Hermetic tests: the Apple client-secret JWT and revoke client; the function's step order
  and every exit (the `cron_status_handlers` style); PGlite tests for the scrub, succession,
  takeover, the name seam and the `trades` FK; the heal pass from each interrupted stage.
- `node scripts/gen-architecture.mjs` run; `db-snapshot.json` re-captured after the grants
  and cron land.
- Giorgio by hand: one real deletion on TestFlight with an Apple account, one with
  email/password, one takeover between two phones.

## Suggested workstreams

- **W0 docs** (Orchestrator): push this plan and the PRODUCT_RULES change.
- **W1 board** (Design Lead): the three Open questions as "Your call" sections, both
  themes, XXXL stills; Giorgio picks.
- **W2 database:** migrations 1–n: `trades` FK drop; `league_members.deleted_at`;
  `account_deletions` ledger (service_role only, RLS on, no client access);
  `deleted_manager_label()`; the seam and `get_visible_profiles` branches;
  `scrub_deleted_manager`; the shared pre-draft-leave internal; `take_over_team`;
  `league_invites.kind`; the heal cron. `supabase-reviewer` + `security-reviewer` before
  hand-back. Depends on W1 only for the label constant (ship with "Former manager", change
  the constant if Giorgio picks B).
- **W3 edge functions:** `delete-account` with `_shared/apple-revoke.ts` (hermetic tests
  for the ES256 secret and both endpoints), `join-league` `takeover` action, the heal
  handler on `runJob`. Depends on W2's function signatures.
- **W4 mobile:** Profile row, delete screen with the three proofs (reuses
  `lib/auth/socialSignIn.ts`, which must also return `authorizationCode` and the raw nonce),
  the signed-out line, "Find a new manager" + share, the takeover landing from the
  universal link (W3 links code). Depends on W1 for the frames and W3 for the contract;
  can start on the contract from this plan.
- **W5 web:** the `get_visible_profiles` branch is W2; W5 checks the join page's takeover
  fallback copy and the display.
- **W6 verification** (Orchestrator): byte-verified deploys from the deploy checkout;
  Giorgio's steps below; the by-hand checks.

**Giorgio's steps (prod, in order):** add Supabase secrets `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
`APPLE_PRIVATE_KEY` (the `.p8`, shared with the web Apple sign-in; note its 6-month
expiry reminder already in the onboarding plan) and `APPLE_BUNDLE_ID`; `db push`;
deploy `delete-account`, `join-league`, the heal function; confirm the cron row and the
`proacl` of every new function; one TestFlight deletion with an Apple account; update the
App Store Connect privacy answers and the privacy policy's retention line.

## Models

| Role / workstream | Model | Why |
|---|---|---|
| Planner | Fable 5.1 | The plan |
| Orchestrator | Opus 5.5 | Verification; deploys are prod changes |
| W1 board | Design Lead on Opus; JSX on Sonnet | Judgement vs well-specified |
| W2 database | **Opus** for the whole workstream | Grants, SECURITY DEFINER, partial-state ledger, a multi-table identity move: all on CLAUDE.md's Opus list |
| W3 edge functions | Turn 1 on Opus (auth proof, Apple secret handling), then Sonnet; `security-reviewer` on every diff | Security-adjacent design, then well-specified |
| W4 mobile | Opus plan turn, then Sonnet | Well-specified from the board and the contract |
| W5 web | Sonnet | Small, well-specified |
| Reviews | Sonnet reviewers; Opus for the Orchestrator's own pass | Checklist vs judgement |
| Recon | Haiku | Read-only |
