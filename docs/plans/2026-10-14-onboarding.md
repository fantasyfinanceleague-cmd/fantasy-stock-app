# Onboarding: the invited friend's first minute

Status: Approved (Giorgio, 2026-10-14: "approved")
Planner session: "Planner" (Fable 5.1), 2026-10-14 · Orchestrator hand-off: —

## Goal

Make the first minute work for the person who matters most: a friend who just got an invite.
Today that friend has to find the app, install it, sit through three cards, invent a password,
pick a username, and type a 10-character code by hand. After this plan: tap the link, one tap
with Apple or Google (or email), keep the suggested username, and they're in the league. The
commissioner's path (create a league, share a link) stays a short guided setup. The three
cards survive only where they help (a cold install with no invite), and the ideas the game
needs to teach are taught in place, not on a launch screen. Built on the research in
[`../design/reviews/onboarding-best-practices-2026-10-14.md`](../design/reviews/onboarding-best-practices-2026-10-14.md).

## Giorgio's rules

All 2026-10-14, in the Planner session; verbatim in `docs/PRODUCT_RULES.md` ("Onboarding").

- Why plan it: "that onboarding is going to be very important when a when a user first
  downloads the app. And I don't want it to be done without our clear plan implemented."
- Who arrives: "this app would mainly be shared through like invited friends. One person
  finds it, thinks of the idea, and they share it with their group of friends to join. I think
  that's going to be the main way in which users are like discover the app and join."
- The invite is a link: "just sending a text code isn't going to do anything if they don't
  have the app downloaded. So it should be a link that then would... do like one of two
  things. If they already have the app downloaded, it'll automatically like bring them to
  the app. And then from there, once they make their account and onboard, it'll
  automatically have them join that league. Or if they don't have the app, it'll redirect
  them to like the web page version just on a browser. And the same thing, if they make,
  once they make an account, they join the league. And then there's going to obviously be
  something on that web page that prompts them to download the app."
- Sign-in: "we should absolutely give the option. So there should be three options. One is
  just like email and password. Then we absolutely need to add sign in with Apple and
  Google. Because I feel like most users are going to just want to click that and then have
  their thing linked."
- Username: "when they get to that, like creating their username screen, I feel like one
  good practice is to, when possible, give like a pre-generated thing so they don't have to
  type out something long… we're already going to have like a pre-set username that they
  can just go with and they can change later."
- The cards: "B, cards only for cold installs."
- Email confirmation: "Apple and Google sign-ins are already verified, but if you just do
  email and password, you have to confirm your email. I think that way we can block fake
  addresses. I think it's still good for security's sake."
- Took the recommendations on: the push ask after joining/creating a league with one line of
  why; one pre-filled username screen after any sign-in; the inviter's name on the invite
  ("Roberto invited you to Stock Scudetto"); automatic join from a link, no extra tap; the
  web page's one job is joining, then "Get the app"; the same no-league empty state on every
  tab.

## Decisions

| # | Question | Decision | Board section / date |
|---|---|---|---|
| 1 | Who the first-time user is | Mostly the invited friend; the commissioner second. The plan optimises the invited path first | Planner chat, 2026-10-14 |
| 2 | How an invite travels | A **link** carrying the code. App installed → opens the app → account → auto-joined. Not installed → a web page for that league → account → joined → "Get the app". The share text keeps the code too | Planner chat, 2026-10-14 |
| 3 | Sign-in methods | **Email + password, Sign in with Apple, Sign in with Google**, on the app and the web page | Planner chat, 2026-10-14 |
| 4 | Username | **One screen after any sign-in, pre-filled with a generated name**, one tap to keep; the email form loses its username field; changeable in Profile | Planner chat, 2026-10-14 |
| 5 | The three cards | **B: only on a cold install (no invite)**, with Skip remembered forever; never on the invited path; the titles stay Giorgio's. **Scenes: the Game Night redraw** (real draft tiles with category lines; the real scoreboard with a lead change; the real FINAL) chosen over the 2026-09-29 scenes (Giorgio, 2026-10-14, on the W1 board) | board, 2026-10-14 |
| 6 | Push permission | **After joining or creating a league**, with one line of why, then the iOS prompt | Planner chat, 2026-10-14 |
| 7 | Inviter's name | Shown on the invite page and the link-arrival preview: "{inviter} invited you to {league}". The inviter only; nobody else | Planner chat, 2026-10-14 (amends the 2026-10-11 "no commissioner name" rule for link arrivals) |
| 8 | Auto-join from a link | **Automatic**; the preview becomes the welcome "You're in {league}" | Planner chat, 2026-10-14 |
| 9 | Email confirmation | **Required for email + password**; Apple and Google are verified identities | Planner chat, 2026-10-14 |
| 10 | The web page after joining | "You're in {league}. Get the app to draft and play." + App Store; the web does one job | Planner chat, 2026-10-14 |
| 11 | No-league state | The **same empty state on every tab** (Home, Matchup, League, Portfolio) | Planner chat, 2026-10-14 |
| 12 | Theme in onboarding | **No**: System by default, changeable in Profile (all four sources agree) | Planner chat, 2026-10-14 |
| 13 | Teaching the unfamiliar | **In place**, one line, once: the week window and "dollars decide" on the first pre-draft Home and in the first draft room; never a launch card | Planner chat, 2026-10-14 |
| 14 | The held W4 onboarding branch | Reskin and bug fixes kept (auth errors never raw; "Enter a league name."; Share rule; unified share text); the redrawn card scenes go to Giorgio as A/B before anything ships | Planner chat, 2026-10-14 |
| 15 | W2 auth review (2026-10-14) | (A) Google/Apple may share a name/photo: stored in auth metadata, never read or shown, never used for the username ("I meant never show it… It was mainly just changing how the username is automatically generated"). (B) Confirmation and reset links use one-time codes (PKCE) now. (C) Google is a native one-tap with the nonce check skipped for Google only, Apple's kept; risk documented and bounded to our client IDs ("option 1") | Planner chat, 2026-10-14 |
| 16 | After an email confirmation that can't sign this device in | Phone: when the link reached THIS phone but the code couldn't be exchanged here (reinstall, replaced verifier, opened in another app), Sign in shows once "Your email is confirmed. Sign in with your password." (W2 'confirm-failed' only; never for expired/error links). Laptop or other device: the confirm redirect is the https universal link (W3, + its dashboard Redirect URL), so a device without the app lands on the W5 page: "Your email is confirmed. Open the app and sign in." (with a pending invite: "…to finish joining {league}."). Ruled by the Planner under UX rules 8 and 9 | Planner ↔ Orchestrator, 2026-10-14 |
| 17 | The invite code and the confirmation email | **No invite code in the confirmation email** (a mistyped address would hand a stranger a join capability). The confirmation redirect is the plain `https://<domain>/auth/confirm`; the phone finishes the join from the invite it stored on the device. The laptop / app-path page shows only "Your email is confirmed. Open the app and sign in."; the "…to finish joining {league}" variant stays on the web sign-up path. Planner, 2026-10-14 | Planner ↔ Orchestrator, 2026-10-14 |
| 18 | Which link auto-joins | **Only the shared https link auto-joins**; a `fantasystockapp://join` link arriving while signed in shows the Join {league} preview and waits for a tap (closes silent joins fired by other apps or redirects); a join never switches the active league without a tap. A signed-out arrival behaves the same either way (capture, then sign in, then join). Planner, 2026-10-14 | Planner ↔ Orchestrator, 2026-10-14 |

## Open questions

None blocking the design work. One the build settles (the second is decided):

1. **The invite domain.** The product name is deferred, so the link uses the current web
   domain for now; universal links (the `apple-app-site-association` file + the app's
   associated domain) must be redone once the real domain exists. The plan builds it so the
   domain is one config value.
2. ~~The username generator's style~~ **DECIDED (Giorgio, 2026-10-14): gamertag style, never a
   name.** "I want the username to be generated not by putting someone's first name and then
   two digits, but doing it in the style that kind of like Xbox does for their gamer tags…
   some sort of adjective or word and then like a animal. So it'll be like helpedhornet151 or
   something like that. Something kind of playful and also unique… we don't know if users want
   to keep their name visible. So let's not expose their first names." So the generator is
   {adjective}{Animal}{digits}; it never reads a name or an email from any sign-in (including
   the "Change" path's suggestions); every candidate passes the format and content checks.
   The helper line "You can change it later in Profile." stays.

## Scope

**In:**
- The invite link: share text + web route + universal link + app handling + auto-join.
- Sign in with Apple and Google (app + web), email confirmation on for email sign-ups.
- The username screen, pre-filled.
- The two first-run paths (invited / cold), with the cards only on the cold path and Skip
  remembered; "How it works" in Profile.
- The push-permission moment after a league exists.
- In-place first-time tips (week window, dollars decide).
- The shared no-league empty state.
- The web invite page (sign in / create / join / get the app), Game Night in both themes.
- Metrics: install → joined (invitee), install → league created + link shared (commissioner),
  day-7 retention per path.

**Out (and why):**
- Any other web-app screen (the web stays paused; "app first").
- Keeper/deferred deep links through a third-party SDK (Branch etc.): the web join makes
  them unnecessary, and they cut against the lockdown direction.
- Feature tours, tooltips on standard controls, a theme picker (the research says no).
- Opening sign-ups to the public: the server gate (`app_config.signups_paused`) stays
  Giorgio's switch; invite links work for allow-listed testers until he flips it.

## How it works

### The player's side

**Invited, app installed.** Tap the link → the app opens on "{Roberto} invited you to
{Stock Scudetto}" with the league's facts (managers, draft time, stakes, season) and three
buttons: Continue with Apple · Continue with Google · Use email. Apple/Google: one tap →
the username screen with a suggested name and a single "Keep" → "You're in {league}" → the
league's pre-draft Home, which carries one line: "Your week runs Monday's open to Friday's
close. Best dollar gain wins." Then, once: "Turn on notifications so you don't miss the draft
room opening or your turn." → iOS prompt. Email: email + password → "Check your email" →
tapping the confirmation link reopens the app and continues exactly here (username → in).

**Invited, app not installed.** The same link opens the web page: "{Roberto} invited you to
{Stock Scudetto}" + the facts + the same three sign-in options → username → "You're in
{league}. Get the app to draft and play." + App Store. In the app later: sign in (any of
the three) → username already set → straight to the league.

**Cold install (App Store, no link).** Three cards (Skip, remembered forever) → Get started:
Create a league / Join with a code / Sign in → account → username → Create league (4 steps,
"Step N of 4") → "{name} is ready" with **Share** (the link) → push ask. "How it works" lives
in Profile for anyone who skipped the cards.

**Returning user, new device.** Sign in → the tabs (or the pending link). Never the cards.

**Already a member who taps the link again:** the app opens the league. **A link to a league
that has started / is full / is over:** the existing refusal copy, on the page or in the app.

### The system's side

- **Routing** (`apps/mobile/app/_layout.tsx`, `lib/shell/pendingRoute.ts`,
  `resumeTarget.ts`, `firstRun.ts`): the cards gate becomes "cold install AND no pending
  invite"; a pending invite is stored with its code (today the allow-list drops query params
  for join-league: fix) and survives sign-in, the username step, and an email confirmation
  round-trip; `markOnboardingSeen()` is set on Skip and on any link arrival, not only on
  Get started's `leave()`.
- **Universal links**: `app.json` gains `ios.associatedDomains` (`applinks:<domain>`); the
  web serves `/.well-known/apple-app-site-association` for `/join/*`; `+native-intent.tsx`
  maps `/join/<code>` to the pending invite. The scheme `fantasystockapp://join/<code>`
  stays as a fallback. One config value for the domain (open question 1).
- **Auto-join**: on reaching `ready` with a pending invite, the client calls the existing
  `join-league` edge function with the code (it already validates draft state, capacity,
  season, membership), then opens the league; refusals render the existing join copy. The
  web page uses the same function with the web session.
- **Inviter's name**: `preview-league` gains `inviter` (the commissioner's display name) **only
  when called with a code** (both surfaces arrive with one), keeping the 2026-10-11 rule for
  any other preview; `get_league_display_names`/`participant_display_name` already exist for
  the name.
- **Sign in with Apple / Google**: Supabase Auth providers configured in the dashboard
  (Apple Services ID + key; Google OAuth client); app: `expo-apple-authentication` and
  Google via `expo-auth-session` (or `@react-native-google-signin`) → `signInWithIdToken`;
  web: `signInWithOAuth`. Apple's "Hide My Email" relay addresses are fine (email is not
  shown anywhere). The signup trigger (`20261005000001_signup_username_trigger.sql`) keeps
  creating the profile; username arrives from the username screen.
- **Email confirmation**: enabled for the email provider only; the confirmation redirect is
  the universal link `/auth/confirm?...` → app, which resumes the pending route. The
  "Check your email" screen exists (`forgot-password.tsx` pattern); the create-account
  outcome at `create-account.tsx:107-113` becomes the normal email path.
- **Username**: `pick-username.tsx` pre-fills from a generator (`lib/shell/usernameApi.ts`
  + server `check_usernames` for availability): a first-name-based or game-style candidate
  that passes the format (3–20, letters/numbers/underscore) and the content check; "Keep"
  calls `set_username`. The email form drops its username field.
- **Push**: `setupPushNotifications` moves off `SIGNED_IN` (`SessionProvider.tsx:87-115`)
  to a `requestPushAfterLeague()` called from the join/create endings, gated by "asked
  before?" in AsyncStorage; the pre-prompt is one line + Continue; `lib/notifications.ts`
  unchanged.
- **Tips in place**: a `FirstTimeTip` primitive (one line, dismiss once, keyed in
  AsyncStorage): Home pre-draft (week window), draft room (dollars decide / your turn).
- **Empty state**: one `NoLeagueState` component mounted by all four tabs (Home/League
  already share the copy).
- **Web page**: `apps/web` route `/join/:code` (and `/auth/confirm`): Supabase web auth with
  the three methods, the same preview + join calls, Game Night tokens (the board's
  `themes.css` is generated from the app's `color.ts`), both themes. Behind `APP_PAUSED` it
  is the ONLY unpaused route besides the landing.
- **Metrics**: three events in the existing activity/analytics path (invite_opened,
  joined_from_invite, league_created_and_shared) + a weekly query.

### The board brief (W1), for the Design Lead

Game Night, Light AND Dark, each frame beside its reference where one exists:
1. **Invite arrival (app)**: "{Roberto} invited you to {Stock Scudetto}" + facts + three
   sign-in buttons (Apple first on iOS, then Google, then email). Reference: Yahoo's "Marvin
   has invited you…" invite screen.
2. **Username, pre-filled**: one suggested name, "Keep" primary, "Change" secondary; three
   generator samples for Giorgio's pick (open question 2).
3. **"You're in {league}"** ending → the pre-draft Home with the week-window tip.
4. **Push pre-prompt**: one line + Continue, drawn above the iOS sheet.
5. **The cards, A/B**: the approved 2026-09-29 scenes vs the Game Night scenes the W4
   worker drew (draft tiles; scoreboard lead change; FINAL + "You win Week 6"). Titles
   unchanged. Giorgio picks.
6. **Get started** (cold path) with Create / Join / Sign in.
7. **Web invite page**: arrival, sign-in, username, "You're in… Get the app" (App Store
   button), and the three refusals (started, full, over). Phone-width and desktop.
8. **"How it works"** row in Profile and its sheet (the three cards, static).
9. **Email path**: "Check your email" and the return into the flow.
10. **NoLeagueState** on all four tabs (one frame, labelled "same on every tab").

## Risks and edge cases

- **The web page is a prod change** (merging to `main` deploys Vercel): it goes out behind
  the paused gate with only `/join/*` and `/auth/*` unpaused; the landing's "coming soon"
  stays. Requires the `apple-app-site-association` to be served with the right content type.
- **Universal links need the domain**: until the name is settled, links use the current
  domain; a rename means re-associating (one config value + Apple file). Called out so the
  rename plan includes it.
- **Sign in with Apple is an App Review condition** once Google exists; both ship together.
  Apple gives the name only on the FIRST sign-in: capture it then or the generator has only
  the relay email to work from.
- **Email confirmation vs the pending invite**: the confirmation link must reopen the app
  (universal link) with the session; if the user confirms on another device, the web page
  completes the join and says "Get the app". Tested explicitly.
- **Auto-join races the league state**: a league can start or fill between the tap and the
  join; the server's `join-league` is the only truth; the client shows the refusal copy.
  The new "joins close when the room opens" server rule (2026-10-14) applies.
- **Partial state**: a pending invite stored but the join failed → the invite stays pending
  with the refusal shown, never silently dropped (the recoverable-refusal rule).
- **Skip must be remembered** (today's bug); link arrivals mark seen too.
- **Inviter's name exposure**: only the commissioner's display name, only with a valid code;
  no other member names (profile-visibility stage 2 rules hold).
- **Push ask moved later**: existing users who already granted are unaffected; a user who
  denies at the pre-prompt is not asked again (Settings path is explained once).
- **Security review** (`security-reviewer`) on: the web auth flow, the AASA file, the
  preview's inviter field, the confirmation redirect, and any new RPC grants (`proacl`).

## Done means

- [ ] `PRODUCT_RULES.md` carries the "Onboarding" rulings above.
- [ ] Board frames 1–10 drawn, both themes; Giorgio picked the cards A/B and the username
      style; recorded.
- [ ] Apple + Google sign-in work on the app and the web page; email sign-up requires
      confirmation and the confirmation link resumes the pending invite.
- [ ] An invite link opens the installed app on the arrival screen with the inviter's name
      and auto-joins after sign-in; the same link on a phone without the app opens the web
      page, joins, and shows "Get the app".
- [ ] A cold install sees the cards once; Skip is never shown again; "How it works" is in
      Profile.
- [ ] The push prompt appears only after a league exists, preceded by the one-line reason.
- [ ] One `NoLeagueState` on all four tabs.
- [ ] The three metrics are recorded and a weekly query exists.
- [ ] Security review clean; `gen-architecture` current; `db-snapshot` re-captured if grants
      changed.
- [ ] Giorgio's check by hand: send himself an invite link from a test league; on a phone
      with the app: tap → Apple → keep the username → in the league → the notifications line
      → the week-window tip. On a phone without it: tap → web → email → confirm → "Get the
      app" → install → sign in → in the league.

## Suggested workstreams

| # | Workstream | Depends on | Who |
|---|---|---|---|
| W0 | Push this branch; docs PR | — | Orchestrator |
| W1 | Board frames 1–10 (Light + Dark) + the cards A/B + username samples → Giorgio picks → rules | W0 | Design Lead, Planner |
| W2 | Auth: Apple + Google providers (dashboard, Giorgio), app sign-in, email confirmation on, confirmation redirect | — | backend/mobile worker; Giorgio for dashboard settings |
| W3 | Invite link: share text, universal links (app.json + AASA), `+native-intent` → pending invite with code, auto-join, `preview-league` inviter field | W2 | mobile + backend worker |
| W4 | Username screen (generator + Keep), push moment, first-time tips, NoLeagueState, cards on cold path only, Skip remembered, Profile "How it works"; the kept parts of `feat/gn-w4-onboarding` | W1, W2 | mobile worker |
| W5 | Web invite page `/join/:code` + `/auth/confirm`, AASA served, behind the paused gate | W1, W2 | web worker |
| W6 | Security review; `gen-architecture`; snapshot; metrics query | W3–W5 | reviewers, Giorgio |
| W7 | Gates (ux-reviewer + Design Lead, both themes), Giorgio's hand check, ships with 1.3 | W6 | Design Lead, Giorgio |

## Models

| Role / workstream | Model | Why |
|---|---|---|
| Planner | Fable 5.1 | The plan and the brief |
| Orchestrator | Opus 5.5 | Verification; the web deploy is a prod change |
| W1 board | Design Lead on Opus; JSX on Sonnet | Judgement vs well-specified |
| W2 auth, W3 links | Turn 1 on **Opus** (auth, universal links and the confirmation redirect are security-adjacent), then Sonnet; `security-reviewer` on every diff | CLAUDE.md: auth stays on Opus for design |
| W4 mobile | Opus plan turn, then Sonnet | Well-specified from the board |
| W5 web | Opus plan turn, then Sonnet | New surface, small |
| W6 reviews | Sonnet reviewers; Opus for the Orchestrator's own pass | Checklist vs judgement |
| Recon | Haiku | Read-only |
