# Onboarding W4 on Game Night: gate captures (`feat/onboarding-w4`)

**Screenshots stay out of the repo (Giorgio, 2026-10-14).** Every still, recording and frame
sheet is in **`~/fantasy-stock-design-review/feat-onboarding-w4/`** (180 stills, 13 recordings
with a de-duplicated frame sheet each, `accent-split.txt` + the script). This file is the index.
A preliminary set from the middle of the build is in `…/feat-onboarding-w4-prelim/`; it is
superseded and not part of the review.

**Builds.** Rebased on `origin/main` `e3dadc36` (#278, the Design Lead's arrival redraw board; main
had not moved when this was written). Six commits carry the shots. The earlier frames the later ones did not change were left; every frame the later ones DID change was re-shot, and the superseded versions are in `superseded-pre-gate/` (outside the set):

| Build | What it is | Shot on it |
|---|---|---|
| **`af84a87f`** | The full W4 build (all screens below) | The first full set (20:11–20:57 PDT; the frames later commits changed were re-shot, see below), except the How it works sheet, and `rec-01`…`rec-07` |
| `64213957` | + How it works thumbnails 96 pt (the FINAL scene's winner line was clipped at 88 pt) | `rec-08`, `rec-09`, `rec-10` and the whole S01 sheet set |
| **`1b825edb`** | + the DEV-only capture knobs raise the real notice/chip stores once (so a dismiss and a keep act on camera). No release code path changed | `rec-11`, `rec-12`, `rec-13`, `R01`, `R02`, `T01`, and the S01 clean-launch frames |
| **`b89aeb92`** | + a dead link centres its panel and Sign in (the decided board) | **X06 only** (12 stills, re-shot 21:30 PDT; the before-centring set is in `…-prelim/x06-before-centring/`) |
| **`24b54e8c`** | + the Design Lead's gate fixes (neutral inviter disc; league-name fit; links at the WarnPanel's cap; fitted gamertag; push-out) and the draft-room first-time tip | The re-gate set: **X01–X06, X10 at L and XXXL, X07 L/XXXL (re-shot on the next row), W01 and W02 at XL/XXXL**, both phones, both themes, plus **D01** |
| **`12599265`** | + a dot starts a line (the no-break space goes AFTER the dot) | **X07** (8 stills) |

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
| W01 | Pick a username, first run (a generated tag) | 17e + 17 Pro at L / XL / XXXL | "FrostyCrane249" pre-filled, the field's check, "You can change it later in Profile.", **Keep** the one accent pill, **Change** a secondary; Sign out under. The seed is fixed (151) so the frames repeat. **The tag takes the SYSTEM size and shrinks only as far as it needs to stay on one line** (a hidden probe measures it; floor 22 pt, which holds the 19-character worst case on the narrowest phone). At XL and XXXL on the 17e/17 Pro it fits at the system size, so it is the same size as the labels around it |
| W02 | Same, with the EMAIL CONFIRMED chip | 17e L / XL, 17 Pro L | The chip above the title: `gainTint` pill, drawn check, the approved words; sits on `bg` (pair added and tested at 4.5:1) |
| W03 | A taken name | 17e + 17 Pro L | "roberto" taken → the error, the rules, "Available" chips (typed variants first: `roberto26`, `roberto_1`, `roberto_3`; never anything from the email) |
| W04 | Push pre-prompt | 17e + 17 Pro at L / XL / XXXL | A bell on an `accentTint` disc, Giorgio's line, **Continue** the one primary, "Not now" a 44 pt text link under it. Drawn above where the iOS sheet appears |
| W05 | Sign in after a link that could not sign in here | 17e + 17 Pro at L / XL / XXXL | The one-time line in a rimmed Card with a drawn check and a 44 pt ×, above Apple / Google / the form. At XXXL the text is capped at 2× (it was a column of single words) |
| W06 | Home, no leagues | 17e + 17 Pro at L / XL / XXXL | "No leagues yet", "Create or join a league to get started.", Create a league / Join with a code |
| W07–W09 | League / Matchup / Portfolio, no leagues | 17e L / XL, 17 Pro L | The SAME state as Home, each with its own title and the header, pill and tab bar around it. Matchup and Portfolio were blank before (a 1.3 must-fix) |
| W10 | Pre-draft Home with the week-window tip | 17e + 17 Pro at L / XL / XXXL | "Your week runs Monday's open to Friday's close. Best performance wins." in a rimmed card, the info icon in the accent, a 44 pt ×. Capped at 2× |
| W11 | Profile with the "How it works" row | 17e L / XL, 17 Pro L | The row after Appearance, a chevron |
| **X01** | **Invite arrival** (inviter + league) | 17e + 17 Pro at L / XXXL | The inviter's initial on a **neutral** disc (`inset` + `text`, as on the board; it was the "you" blue), "Roberto invited you to / Stock Scudetto" centred above Apple, Google, Use email docked at the bottom. **The name is one line at L and XXXL** (it shrinks to ~0.84× at XXXL); the lead wraps and ends without a lone word |
| X02 | …no inviter | 17e + 17 Pro L | The league icon on an `inset` disc, "You're invited to Stock Scudetto" |
| X03 | …nothing usable (the preview was unavailable) | 17e + 17 Pro L | The generic "You're invited to / a league" (the orphan "league" is gone: `lineBreakStrategyIOS` push-out), Join's "Couldn't reach the league…" line, **Try again** (capped at 1.6×; a tap, never a loop), every sign-in option still there |
| X04 | Refusal: full | 17e + 17 Pro at L / XXXL | WarnPanel + "Sign in" in the buttons' place: "Stock Scudetto is full. Ask whoever invited you if they can make room." **"Sign in" is capped at the panel's 1.6×**, so it never outranks its message |
| X05 | Refusal: not taking players (draft started or season over) | 17e + 17 Pro L | "Stock Scudetto isn't taking new players right now." |
| X06 | A dead link | 17e + 17 Pro at L / XXXL | **No heading** (the Planner) and **centred** (the decided board): the panel and "Sign in" (capped at 1.6×) in the middle of the screen |
| X07 | You're in {league} + the facts card (C1) | 17e + 17 Pro at L / XXXL | "You're in / Serie A Traders": **the heading breaks BEFORE the name**, which is fitted the same way as on the arrival. The draft sentence puts each "·" at the START of a line ("Sat, Oct 10 / · 7:00 PM ET"): see the note below. Managers `7 of 8`, Stakes, Season; no Draft row; read after the join as a member |
| X08, X09 | A full league at join: typed code / invited | 17e L (+ X09 XL), 17 Pro L | X08 keeps "Ask your commissioner…"; X09 (a pending invite) reads "Ask whoever invited you…" |
| X10 | Stress: a 39-character league and a 26-character inviter | 17e + 17 Pro at L / XXXL | The league name wraps at spaces, never mid-word, at ≥ 0.75×: **2 lines at L** ("The Wall Street / Wolves of Provo Valley"), **3 lines at XXXL** (2 cannot hold it at 0.75× at that size; see the note below). The lead wraps; the disc carries both initials |
| S01 | How it works sheet | 17e + 17 Pro at L (dark, light), XL (light), XXXL (dark) | Three rows: a still draft board, the Scoreboard with a lead change, the FINAL; the lines are Giorgio's. XL and XXXL were shot from a clean launch (see the P3 below) |
| **D01** | **Draft room, first time** (nobody has picked) | 17e + 17 Pro at L / XXXL | The first-time tip above the board and the clock card, the same card as Home's week-window line: "Out of time? We pick for you: your queue first, then the best stock that fits your league's rules." (the Planner's words), info icon, 44 pt ×. Capped at 2×, so at XXXL it is a six-line card. The clock numbers differ between frames because the ring animates (the matrix flags these frames "unsettled" for that reason; each is a real moment of the same fixture, `DRAFT_ROOM_FIXTURE=theirs_first`) |
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

- **Accent by area** (`accent-split.txt`, the script `accent_split.py`; the same metric and the same 75% rule for "the screen's one primary" as the earlier W4 sets, ΔRGB 45, every 2nd pixel). **180 frames: all `ok`; none over 5% without the primary; the highest total is 5.74%, and it is the primary pill alone (W01/W02 at 17e L: rest 0.01%). The highest "rest" is 1.52% (the How it works sheet in Light, which has no primary pill by design).** Screens with no accent pill (the sheet, the refusals, the dead link) read 0% primary by design.
- **Wrapping.** The XL and XXXL frames were read one contact sheet at a time for W01, W02, W04 to W11, X01, X04, X06, X07, X09, X10 and S01 (both devices where shot); X02, X03, X05, X08, R01 and R02 are Large only. What the reading found and fixed: a league name that broke at XXXL, a truncated gamertag at XL, an uncapped tip and Sign in line, and the clipped thumbnail. In the final set no word breaks mid-letter, the league's name is never split, the gamertag shows whole, and the tip, the notice and the "You're in" sentence are capped at 2× so each stays a card. Only X07 at XXXL on the 17e scrolls (to Go to the league), as the earlier W4 sets did at that size.

## §5 mechanical checks

| Check | Result |
|---|---|
| Mobile deno suite | 2266 passed, 0 failed (57 tests in `onboarding-w4.test.ts`; the stale structure pins in `gn-sweep`, `league-game-night`, `pkce-auth-links`, `onboarding-game-night` updated, intent kept) |
| Root suite | 1021 passed (566 steps), 0 failed |
| `tsc` (fresh `npm ci`, no `.expo`, `--incremental false`) | 0 errors |
| Lint | 0 errors, 8 warnings (all pre-existing files; none mine) |
| Tokens only | `git diff` of `apps/mobile` for `#hex` / `rgba(`: none added |
| Uppercase in the string | `textTransform`: none added (the three hits are existing comments) |
| Package diff | empty (`git diff origin/main..HEAD -- '*package.json' '*package-lock.json'`) |
| No-op handlers | `no-op-handlers.test.ts` green; `docs/design/reviews/tappables.md` regenerated (219 tappables, 0 findings) and committed. The fixture's retry was a `noop`; it is now a real dev log |
| Generated, never hand-merged | `sourceManifest.generated.ts`, `docs/architecture/*` (regenerated after the rebase), `tappables.md`, the board (`build.mjs`, unchanged by the rebase) |
| gitleaks | clean on every commit |
| Mutations (from copies, restored) | 10 + 6 + 8 + 13, all caught (the last 13: the inviter disc back to the "you" tone; the fit's 0.75× floor lowered; "You're in" unsplit; a link uncapped; the flat gamertag cap back; the gamertag floor removed; the push-out removed; a dot at the end of a line; the draft-room tip never dismissed on a pick; no dismissal effect; the tip below the board; the tip sharing Home's storage key; a REFUSED pick dismissing it; two of those first hit the wrong line and were redone), and the earlier ones: the notice raised by `confirm-ignored`; a re-ask after "Not now"; the tip shown on a failed read; an open redirect through `next`; the chip not cleared on Keep; a gamertag that reads an email; Skip not remembered; Matchup ungated; a link not counting as seen; the chip glyph not stripped; and for the arrival: the name breaking, a dead link with a heading, the invited line ignored, "full" reading "closed", an expired link not dead, a Draft row, the preview feeding "You're in", the body not centred, polling |

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
measure), left. **X01 17e L Light was re-shot** (the Design Lead found the first one blank: a flat page below the status bar). It was a capture glitch, not an app bug: the settle check accepted two identical blank frames at a cold launch. The re-shoot on the same build shows the arrival; the blank frame is kept as `superseded-pre-gate/X01-invite-found-17e-l-light-BLANK.png`, and every still in the set was scanned for a blank body afterwards (it was the only one). Notes from the gate round: (1) **A league name that cannot fit two lines at 0.75×** (X10 at XXXL) takes a third line, still at spaces and still ≥ 0.75×: two lines would need a size under the floor. The rule is one line to 0.75×, else 2, and 3 only then. (2) **The dot.** The gate said a no-break space BEFORE every "·" so the dot starts a line. A no-break space before the dot glues it to the end of the previous word, so the break falls AFTER the dot (the frame still showed "Oct 10 ·" ending a line). I put the no-break space AFTER the dot instead (a normal space before it), which is what makes it start a line; X07 shows it. The same "·" in the Stakes row of the facts card still ends a line at XXXL (that row uses `keepDots`, the Join preview's rule, not touched here). (2b) The same dot rule is NOT applied to `keepDots` here: it is a one-line change, but it reverses the earlier ruling "no line starts with a dot" that Home, the draft room, the lobby and Create league were gated on, and two tests pin that rule by name (`gn-w4-draft`, `onboarding-game-night`); left for W8. (3) The draft-room tip has tests and a mutation but no tap recording yet; its dismissal paths (tap, first pick) are source- and policy-pinned.

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
