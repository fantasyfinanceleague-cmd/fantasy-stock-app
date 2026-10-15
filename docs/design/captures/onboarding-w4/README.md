# Onboarding W4 on Game Night: gate captures (`feat/onboarding-w4`)

**Screenshots stay out of the repo (Giorgio, 2026-10-14).** Every still, recording and frame
sheet is in **`~/fantasy-stock-design-review/feat-onboarding-w4/`** (182 stills, 13 recordings
with a de-duplicated frame sheet each, `accent-split.txt` + the script). This file is the index.
A preliminary set from the middle of the build is in `…/feat-onboarding-w4-prelim/`; it is
superseded and not part of the review.

**Builds.** Rebased on `origin/main` `e3dadc36` (#278, the Design Lead's arrival redraw board; main
had not moved when this was written). Four commits carry the shots, and the later three never touch a
pixel of the frames shot before them (except the one state they re-shot, X06):

| Build | What it is | Shot on it |
|---|---|---|
| **`af84a87f`** | The full W4 build (all screens below) | All 182 stills except the How it works sheet (20:11–20:57 PDT), and `rec-01`…`rec-07` |
| `64213957` | + How it works thumbnails 96 pt (the FINAL scene's winner line was clipped at 88 pt) | `rec-08`, `rec-09`, `rec-10` and the whole S01 sheet set |
| **`1b825edb`** | + the DEV-only capture knobs raise the real notice/chip stores once (so a dismiss and a keep act on camera). No release code path changed | `rec-11`, `rec-12`, `rec-13`, `R01`, `R02`, `T01`, and the S01 clean-launch frames |
| **`b89aeb92`** | + a dead link centres its panel and Sign in (the decided board) | **X06 only** (12 stills, re-shot 21:30 PDT; the before-centring set is in `…-prelim/x06-before-centring/`) |

`HowItWorksSheet.tsx` is on no still before S01, the knob change is `__DEV__`-only, and the dead-link change is inside the `!view.title` branch that only X06 reaches, so the set
is one build in every pixel that matters. The status bar is pinned at 9:41; times above are the real ones
(file times). Two sims, both mine: **W4 Onboarding 17e** and **W4 Onboarding 17 Pro**, both Expo Go on a
dead Supabase port (fixtures only), shut down at hand-back.

**What W4 contains (the plan's scope, `docs/plans/2026-10-14-onboarding.md`).** Gamertag username
with Keep / Change; "✓ EMAIL CONFIRMED" chip; "Your email is confirmed. Sign in with your password."
on Sign in (only after W2's `confirm-failed`); the push pre-prompt with "Not now"; the first-run
week-window tip; one no-league state on all four tabs (Matchup and Portfolio were blank); Skip
remembered and a link arrival counts as seen; Profile › How it works; and, added by the Orchestrator and
Giorgio's B + C1 ruling during the build: the **signed-out invite arrival** (against W3's stubbed
`usePendingInvite()`), the **facts card on "You're in"**, and the invite-only "full" line on Join.

## States (stills)

The file name is `<id>-<state>-<device>-<size>-<theme>.png`; device `17e` or `17pro`; size `l` (Large),
`xl` (Accessibility XL), `xxxl` (Accessibility XXXL); both themes for every state.

| # | State | Frames | Shows |
|---|---|---|---|
| W01 | Pick a username, first run (a generated tag) | 17e + 17 Pro at L / XL / XXXL | "FrostyCrane249" pre-filled, the field's check, "You can change it later in Profile.", **Keep** the one accent pill, **Change** a secondary; Sign out under. The seed is fixed (151) so the frames repeat. At XL and XXXL the tag shows whole: the suggested name's text is capped at 1.3× (22 pt) so the longest possible tag (19 characters) still fits one line on the narrowest phone; the labels around it stay at the system scale |
| W02 | Same, with the EMAIL CONFIRMED chip | 17e L / XL, 17 Pro L | The chip above the title: `gainTint` pill, drawn check, the approved words; sits on `bg` (pair added and tested at 4.5:1) |
| W03 | A taken name | 17e + 17 Pro L | "roberto" taken → the error, the rules, "Available" chips (typed variants first: `roberto26`, `roberto_1`, `roberto_3`; never anything from the email) |
| W04 | Push pre-prompt | 17e + 17 Pro at L / XL / XXXL | A bell on an `accentTint` disc, Giorgio's line, **Continue** the one primary, "Not now" a 44 pt text link under it. Drawn above where the iOS sheet appears |
| W05 | Sign in after a link that could not sign in here | 17e + 17 Pro at L / XL / XXXL | The one-time line in a rimmed Card with a drawn check and a 44 pt ×, above Apple / Google / the form. At XXXL the text is capped at 2× (it was a column of single words) |
| W06 | Home, no leagues | 17e + 17 Pro at L / XL / XXXL | "No leagues yet", "Create or join a league to get started.", Create a league / Join with a code |
| W07–W09 | League / Matchup / Portfolio, no leagues | 17e L / XL, 17 Pro L | The SAME state as Home, each with its own title and the header, pill and tab bar around it. Matchup and Portfolio were blank before (a 1.3 must-fix) |
| W10 | Pre-draft Home with the week-window tip | 17e + 17 Pro at L / XL / XXXL | "Your week runs Monday's open to Friday's close. Best performance wins." in a rimmed card, the info icon in the accent, a 44 pt ×. Capped at 2× |
| W11 | Profile with the "How it works" row | 17e L / XL, 17 Pro L | The row after Appearance, a chevron |
| **X01** | **Invite arrival** (inviter + league) | 17e + 17 Pro at L / XL / XXXL | The inviter's initial on a disc, "Roberto invited you to Stock Scudetto" **centred in the space above the actions**; Apple, Google, Use email docked at the bottom (Giorgio's B). The league's name sits on its own line and is fitted to one line, so it never breaks (non-breaking spaces alone did not hold at XXXL) |
| X02 | …no inviter | 17e + 17 Pro L | The league icon on an `inset` disc, "You're invited to Stock Scudetto" |
| X03 | …nothing usable (the preview was unavailable) | 17e + 17 Pro L | The generic "You're invited to a league", Join's "Couldn't reach the league…" line, **Try again** (a tap, never a loop), every sign-in option still there |
| X04 | Refusal: full | 17e + 17 Pro at L / XL / XXXL | WarnPanel + "Sign in" in the buttons' place: "Stock Scudetto is full. Ask whoever invited you if they can make room." |
| X05 | Refusal: not taking players (draft started or season over) | 17e + 17 Pro L | "Stock Scudetto isn't taking new players right now." |
| X06 | A dead link | 17e + 17 Pro at L / XL / XXXL | **No heading** (the Planner) and **centred** (the decided board, Giorgio's B): the WarnPanel "This invite link doesn't work anymore. Ask for a new one." and "Sign in" sit in the middle of the screen, since with no invite block above them docking them would leave an empty phone. Every other arrival state keeps the invite centred and the actions docked |
| X07 | You're in {league} + the facts card (C1) | 17e + 17 Pro at L / XL / XXXL | Managers `7 of 8`, Stakes, Season; the draft sentence stays, so no Draft row. Read after the join, as a member (here, a fixture reads the held preview with one member added) |
| X08, X09 | A full league at join: typed code / invited | 17e L (+ X09 XL), 17 Pro L | X08 keeps "Ask your commissioner…"; X09 (a pending invite) reads "Ask whoever invited you…" |
| X10 | Stress: a 39-character league and a 26-character inviter | 17e L / XXXL, 17 Pro L | The lead sentence wraps; the name stays whole by shrinking to fit; both initials on the disc |
| S01 | How it works sheet | 17e + 17 Pro at L (dark, light), XL (light), XXXL (dark) | Three rows: a still draft board, the Scoreboard with a lead change, the FINAL; the lines are Giorgio's. XL and XXXL were shot from a clean launch (see the P3 below) |
| R01, R02 | **Reduce Motion** | 17e L | "You're in" without the pop; the sheet's vignettes at their final frame |
| T01 | The tip after a relaunch | 17e L dark | Gone (it was dismissed, and the choice persisted) |

## Recordings (real taps; `.mov` + `*-frames.png`, 17e, dark)

| Recording | Taps and what it proves |
|---|---|
| `rec-01-invite-arrival` | The arrival → **Use email** → Create account |
| `rec-02-invite-unavailable-try-again` | **Try again** → exactly one `retryPreview()` (a dev log line; the frame is the same because the fixture's retry is a log) |
| `rec-03-username-change-then-continue` | **Change** → the field takes focus with the keyboard and the rules → Continue (a real submit, to Home) |
| `rec-04-username-taken-chip-continue` | A taken name → the chip → the field fills and checks → Continue |
| `rec-05-push-ask-not-now` / `rec-06-push-ask-continue` | **Not now** → Home; **Continue** → Home |
| `rec-07-no-leagues-buttons` | **Create a league** → Create league step 1 → Cancel → **Join with a code** → Join |
| `rec-08-profile-how-it-works` | Profile → **How it works** → the sheet → **×** |
| `rec-09-skip-is-remembered` | A cold launch shows the cards → **Skip** → Get started (it stays open) → a cold relaunch goes straight to Sign in; the stored flag `sp.onboarding.seen.v1` was written (read from the sim's AsyncStorage) |
| `rec-10-first-time-tip-dismiss-stays-gone` | **×** on the tip → Home closes up → a relaunch: still gone |
| `rec-11-confirm-failed-notice-dismiss` | **×** on the Sign in line → gone |
| `rec-12-email-confirmed-chip-keep` | The chip shows with the suggestion → **Keep** |
| `rec-13-how-it-works-reduce-motion` | Reduce Motion on: the sheet opens with no motion |

## Measurements and accent

- **Accent by area** (`accent-split.txt`, the script `accent_split.py`; the same metric and the same 75% rule for "the screen's one primary" as the earlier W4 sets, ΔRGB 45, every 2nd pixel). **182 frames: all `ok`; none over 5% without the primary; the highest total is 5.74%, and it is the primary pill alone (W01/W02 at 17e L: rest 0.01%). The highest "rest" is 1.52% (the How it works sheet in Light, which has no primary pill by design).** Screens with no accent pill (the sheet, the refusals, the dead link) read 0% primary by design.
- **Wrapping.** The XL and XXXL frames were read one contact sheet at a time for W01, W02, W04 to W11, X01, X04, X06, X07, X09, X10 and S01 (both devices where shot); X02, X03, X05, X08, R01 and R02 are Large only. What the reading found and fixed: a league name that broke at XXXL, a truncated gamertag at XL, an uncapped tip and Sign in line, and the clipped thumbnail. In the final set no word breaks mid-letter, the league's name is never split, the gamertag shows whole, and the tip, the notice and the "You're in" sentence are capped at 2× so each stays a card. Only X07 at XXXL on the 17e scrolls (to Go to the league), as the earlier W4 sets did at that size.

## §5 mechanical checks

| Check | Result |
|---|---|
| Mobile deno suite | 2255 passed, 0 failed (46 tests in `onboarding-w4.test.ts`; the stale structure pins in `gn-sweep`, `league-game-night`, `pkce-auth-links`, `onboarding-game-night` updated, intent kept) |
| Root suite | 1021 passed (566 steps), 0 failed |
| `tsc` (fresh `npm ci`, no `.expo`, `--incremental false`) | 0 errors |
| Lint | 0 errors, 8 warnings (all pre-existing files; none mine) |
| Tokens only | `git diff` of `apps/mobile` for `#hex` / `rgba(`: none added |
| Uppercase in the string | `textTransform`: none added (the three hits are existing comments) |
| Package diff | empty (`git diff origin/main..HEAD -- '*package.json' '*package-lock.json'`) |
| No-op handlers | `no-op-handlers.test.ts` green; `docs/design/reviews/tappables.md` regenerated (219 tappables, 0 findings) and committed. The fixture's retry was a `noop`; it is now a real dev log |
| Generated, never hand-merged | `sourceManifest.generated.ts`, `docs/architecture/*` (regenerated after the rebase), `tappables.md`, the board (`build.mjs`, unchanged by the rebase) |
| gitleaks | clean on every commit |
| Mutations (from copies, restored) | 10 + 6 + 8, all caught: the notice raised by `confirm-ignored`; a re-ask after "Not now"; the tip shown on a failed read; an open redirect through `next`; the chip not cleared on Keep; a gamertag that reads an email; Skip not remembered; Matchup ungated; a link not counting as seen; the chip glyph not stripped; and for the arrival: the name breaking, a dead link with a heading, the invited line ignored, "full" reading "closed", an expired link not dead, a Draft row, the preview feeding "You're in", the body not centred, polling |

## §2 Reference check

| Trait | Reference | Present? | Evidence |
|---|---|---|---|
| The invitation names the person who sent it | Yahoo's "Marvin has invited you…" (the plan; I do not have the screenshot) | present | X01: the inviter's initial and name over the league, "{inviter} invited you to {league}" |
| One primary per step | the gate's §6 | present | Keep (W01), Continue (W04), the three sign-ins (X01: Apple is Apple's own button, the other two secondary) |
| A friend never sees what only a member may see | Planner's security condition | present | X01 to X06 carry the name, the inviter and the refusal only; the facts appear on "You're in" (X07), read as a member |
| First-run help is one line, in place, once | the plan's Decision 13 | present | W10 (the tip), S01 (How it works lives in Profile) |

## §3 Hallmark self-critique (1–5)

Philosophy 4 (the arrival and the first screens say who invited you and what you are about to keep) ·
Hierarchy 4 (one heading and one primary per step; the name is the loudest thing on the arrival) ·
Execution 4 (found by eye and fixed on the way: a clipped thumbnail, a name that broke at XXXL, a
truncated tag at XL, an uncapped tip and notice) · Specificity 4 (the generated tag and the inviter's
initial carry the identity) · Earned 4 · Variety 4. No score under 3.

Punch list (by hand): minor (P3) **changing the text size live with a sheet open** (Settings → Display
while the app is open on Profile) can leave the sheet's header clipped ("How it w") until the next
layout; a clean launch at any size is correct (S01 was shot that way). Not new in W4 (the Sheet's
measure), left. Minor (P3) at XXXL the suggested name is capped (22 pt) beside labels at the system scale, so
the name reads smaller than its label: the price of never truncating the thing the person keeps. Minor
(P3) at XXXL on a very long league name the fit shrinks it to ~0.4× (X10), below the lead line.

## §4 Every tappable element

| Element | Where | Does | Evidence |
|---|---|---|---|
| Continue with Apple / Google | invite arrival, Sign in, Create account | sign in (W2's; the fixture signs in) | W2's captures; unchanged here |
| Use email | invite arrival | Create account | rec-01 |
| Try again | invite arrival (unavailable) | re-asks the preview once per tap | rec-02 |
| Sign in | under a refusal | Sign in (`router.push('/login')`) | source-pinned; not on camera |
| Keep / Change / chips / Continue | username | save / focus the field / fill it / save | rec-03, rec-04, rec-12 |
| Continue / Not now | push pre-prompt | ask iOS and record it / record it; never asked again | rec-05, rec-06; the policy is tested over every record × OS state |
| × | the tip, the Sign in line | hides it (the tip for good on the device) | rec-10, rec-11 |
| Create a league / Join with a code | no-league state, all four tabs | Create league / Join | rec-07 |
| Skip / Next | onboarding | Get started, remembered | rec-09 |
| How it works / × | Profile / its sheet | opens / closes the sheet | rec-08, rec-13 |
| Go to the league | You're in | the league's Home, through the push ask when it is due | source and policy tests; not re-recorded this round (the earlier W4 `rec-02` covers the join, before the ask existed) |

## Deferred, and for the hand-back

- The draft-room first-time tip (the plan mentions "dollars decide / your turn") has no approved
  text, so it is not built.
- W3 supplies the real `usePendingInvite()`: `lib/invite/usePendingInvite.ts` is a stub that returns
  null; W3 replaces it whole and keeps its exported types. Until then the arrival is reachable only
  through the DEV fixture `EXPO_PUBLIC_INVITE_FIXTURE`.
- The arrival's `invite_expired` reason is treated as a dead link (the same line as not found); W3
  should map it to `not_found` or pass `invite_expired` through, both work.
- The chip draws its check as an icon (the constant keeps the "✓" glyph).
