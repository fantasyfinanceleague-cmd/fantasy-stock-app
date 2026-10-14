# W4 Onboarding, create, join and invite on Game Night: gate captures (`feat/gn-w4-onboarding`)

**Screenshots stay out of the repo (Giorgio, 2026-10-14).** Every still, recording and frame
sheet is in **`~/fantasy-stock-design-review/feat-gn-w4-onboarding/`**; this file is the index.

**One build:** every frame was shot on app code **`fa420806`** (the large-text pass on top of
`516a38d7`), based on `origin/main` `8cac3563` (#266 merged). Stills from the earlier build were
re-shot; none in the folder predates `fa420806` (checked by file time against the shoot start).

## How it was captured

- Two simulators of my own: "W4 Onboarding 17e" (390×844 pt) and "W4 Onboarding 17 Pro"
  (402×874 pt), iOS 27.0, Expo Go, Metro on port 8111, status bar 9:41. Shut down at hand-back.
- Supabase points at a dead port (`http://127.0.0.1:9`) and every state is a fixture: nothing in
  a capture run can reach the project or write anything. No credential was typed anywhere; the
  only typed values are fixture ones (`roberto@example.com`, a league name, "26").
- **Stills** are cold launches straight into each state (no tap between launch and shot), shot
  once two consecutive screenshots match; every still settled. Text size via
  `simctl ui … content_size`: Large = `large`, XL = `accessibility-extra-large`, XXXL =
  `accessibility-extra-extra-extra-large`. The knobs (all `__DEV__`-gated):
  - existing: `EXPO_PUBLIC_SHELL_FIXTURE` (`onboarding`, `no-username`, `leagues`,
    `leagues-member`, `no-leagues`), `EXPO_PUBLIC_SHELL_INITIAL_ROUTE`,
    `EXPO_PUBLIC_SHELL_ACTIVE_LEAGUE`, `EXPO_PUBLIC_HOME_FIXTURE=pre_draft`,
    `EXPO_PUBLIC_JOIN_FIXTURE` (every preview-league / join-league answer),
    `EXPO_PUBLIC_GAME_SEAM=1` (Create answers locally, writes nothing);
  - new in this branch (`lib/shell/captureKnobs.ts`, read only in `lib/shell/captureDev.ts`,
    tests pin both): `EXPO_PUBLIC_ONBOARDING_CARD`, `EXPO_PUBLIC_CREATE_FIXTURE`,
    `EXPO_PUBLIC_JOIN_AUTO` (presses Find league / Join by itself), `EXPO_PUBLIC_SIGNUP_PAUSED`,
    `EXPO_PUBLIC_USERNAME_PREFILL`.
- **Tap-throughs are real taps** (device access granted by Giorgio for this session's panel),
  recorded with `simctl io recordVideo`, both themes, on the 17e at Large.
- File names: `<state>-<17e|17pro>-<l|xl|xxxl>-<dark|light>.png`. Every cold-launch state is in
  both themes; the five mid-flow stills taken during a recording (18b, 19b, 19c, 20b, 20c) are in
  one theme each, and their recording covers the other.

## States (stills)

| # | State | Frames | Shows |
|---|---|---|---|
| 01–03 | Onboarding cards 1–3 | 17e L/XL/XXXL (card 3), 17 Pro L, both themes | The vignettes are the app's own pieces: card 1 the draft board's tiles filling (category line at the bottom, never a fill); card 2 Matchup's Scoreboard with a lead change ("Gianluigi B. leads by $37.66" → "Roberto B. leads by $123.16"); card 3 the FINAL chip, the Scoreboard (your half shaded), "You win Week 6". The art panel is the page's own depth with its rim. The line is `display`, wrapping whole words at XXXL ("Best performance by / Friday's close wins.") |
| 03b | Reduce Motion | 17e L, both | Card 3 after two Next presses: crossfades, the vignette at its final frame |
| 04 | Get started | 17e L/XL/XXXL, 17 Pro L | Two §9C Cards (surface + rim, no shadow), icons on `inset` in `text` (no accent), drawn chevrons; "Sign in" the one accent link |
| 05 | Sign in | 17e L/XL, 17 Pro L | Forgot password? a 44 pt target |
| 06–07 | Create account; **signups closed** | 17e L/XL, 17 Pro L | The paused refusal in the shared WarnPanel (`warnTint`, `warnText` ink, no icon), Giorgio's text verbatim; "Sign in instead" replaces the primary. At XL the cold launch shows the form top (the real refusal scrolls the panel into view) |
| 08, 08b | Forgot password; sent | 17e L | "Check your email" carded (rim), one primary + secondary pill. 08b comes from the tap-through |
| 09–10 | Pick a username (first run); taken | 17e L/XL, 17 Pro L | Rules check off; "roberto" taken (case-insensitive) → the error. At XL the keyboard covers the suggestions (they're in the field's scroll view) |
| 11 | Profile | 17e L/XL/XXXL, 17 Pro L | Two §9C Cards, rows divided by space (8 pt), drawn chevrons, your avatar on `you`. Rows capped at 2× so the username heading stays loudest at XXXL |
| 12 | Appearance | 17e L/XL | System / Light / Dark; selected = accent ring + radio |
| 13, 13b | Profile › Username unchanged; changed | 17e L/XL; L | Unchanged: **no Continue** (nothing to save, no words to say so), Cancel stays. Changed ("roberto_b26"): available ✓, Continue appears |
| 14 | Change password | 17e L | Update password disabled with the unmet rules beside it |
| 15–18 | Create league, steps 1–4 | 17e L/XL/XXXL (step 2), 17 Pro L | Step 1: Next is live with an empty name (its press says "Enter a league name."). Step 2 at XL: the Stepper box goes under its label (no "Manager/s"). Step 3: pick clock 30–90 s (60 default), Draft time row, Random / Manual, rounds. Step 4: stake modes, summary |
| 16b | 16 managers (stress) | 17e L, both | 16 managers, 15 weeks, 6 playoff teams: "the top 2 seeds get first-round byes" |
| 18b | Summary, stress | 17e L light | The 20-character name and 16 teams whole; "·" lines kept whole (keepDots) |
| 19, 19b, 19c | Price tiers, no slot; tapped; a slot added | 17e L, 17 Pro L | Create disabled with "Price tiers need at least one slot with a price range." on screen; SlotBuilder's capacity reason in `danger` |
| 20, 20b, 20c, 21 | Done (league created); the share sheet; long name; no date | 17e L/XL, 17 Pro L | The invite code and **Share** (a new league is before its draft, so the ruled condition shows it); the iOS sheet carries "Join my league with code …" |
| 22–24 | Join: code entry; finding; bad code | 17e L, 17 Pro L | Find league above the keyboard; the spinner; the only error under the field |
| 25 | Join preview | 17e L/XL/XXXL, 17 Pro L | Names nobody (no commissioner). Rows on the rimmed Card divided by space; at accessibility sizes each row stacks (label over value), capped at 2× under the league name |
| 26–34 | Refusals | 17e L (+XL/XXXL for full) | full ("Ask your commissioner if they can make room."), drafted, drafting, already a member (Open the league), **season_completed**, expired, left (Join disabled, the reason above it), offline, rate-limited: each in the WarnPanel |
| 35, 36 | Joined; full at join (race) | 17e L/XL, 17 Pro L | Joined: the trade-done medallion (check in `onYou` on `you`). Race: the same preview now carrying the refusal |
| 37 | No leagues | 17e L, 17 Pro L | Home's empty state: Create a league / Join with a code |
| 38, 39 | Home pre-draft: Share shown; **Share hidden** | 17e L, 17 Pro L | 38: three days before the draft, the invite row has Share. 39: past the draft time (inside T−1h), the code shows and Share is gone (`inviteShareShownFor`) |

**Recordings** (`.mov` + a de-duplicated frame sheet `*-frames.png`, both themes):

| Recording | Taps |
|---|---|
| `rec-01-signed-out-flow` | Onboarding Next ×3 → Get started → Sign in → Sign in empty (the inline refusal) → Forgot password? → the fixture email → Send → "Check your email" → Back to sign in → Create an account → Create account empty ("Please enter a username") |
| `rec-02-league-sheet-join-flow` | League pill → the league sheet → Join with code → Find league → preview → Join Serie A Traders → Joined → Go to the league |
| `rec-03-create-league-flow` | Next with no name ("Enter a league name.") → a 20-character name → Managers + ×4 (16), Playoff teams + ×2 → 30s, Manual, Draft time → Set draft time → Price tiers (Create disabled, reason) → Add slot → remove → Equal stakes → Create (seam) → done → Share → the iOS sheet → dismiss → Go to the league |
| `rec-04-profile-flow` | Avatar → Profile → Username (unchanged, no Continue) → "26" (Continue appears) → Cancel → Appearance → Light / Dark / System → back → Change password → back |
| `rec-05-onboarding-reduce-motion` | Reduce Motion on: Next ×2 crossfades, vignettes static |

## Measurements (pixels, 3× → pt)

- **Profile rows** (`11-profile-17e-l-light`): label glyph to glyph 42.7 / 42.7 / 41.0 pt (even
  pitch, no line between); card to card 64.3 pt.
- **Join preview rows** (`25-join-preview-17e-l-light`): 32.0 / 34.3 / 34.7 pt glyph to glyph,
  divided by space only.
- **Accent by area** (`accent-split.txt` in the folder; same metric as
  `tools/game-night/app_accent_area.py`, ΔRGB 45, every 2nd pixel; the screen's one full-width
  primary pill measured apart): **175 frames, none over 5% without the primary.** Highest "rest":
  4.68% (Home pre-draft, 38/39: its primary "Build your queue" sits inside the card, so it counts
  as rest; still under). Highest totals with the primary: sign in at XL 6.2% (all of the extra
  is the full-width Sign in pill), Create step 1 5.87% (Next).

## §5 mechanical checks

| Check | Result |
|---|---|
| Tokens only | `grep -E "#[0-9A-Fa-f]{3,8}\b\|rgba\("` over every changed component: none |
| Uppercase in the string | `grep textTransform` over the changed files: none |
| Every fill has its own ink | WarnPanel / WarnNote → `warnText` on `warnTint` (pairs exist over `bg` and `surface`); Joined medallion `onYou` on `you`; primary `primaryFg` on `primaryBg`; your avatar `onYou` on `you`; draft tiles via `draftTileLook` |
| No rule lines between rows | Join preview, Profile, the league sheet, Get started: none (a test pins no `hairlineWidth` / `borderTopWidth`) |
| Depth | Cards are `surface` + rim, no shadow (Dark lightness steps; Light white on the tinted page); only the sheets keep the Light shadow |
| One button shape | every Button is a pill (Find league, Join, Share, Add slot, Continue, Set draft time) |
| 44 pt targets | Chip (min 44), Forgot password?, Skip (min width 44), the league sheet's close (44×44) |
| Wrapping at XL | onboarding lines wrap whole words; the join and summary "·" lines wrap only between segments (keepDots); Stepper stacks; no word broken mid-letter |
| The standout stays loudest | Profile rows ≤ 2× (30 pt) under the 35.2 pt name; join rows ≤ 2× under the league name's 51.2 pt; the winner line under the totals (1.3×) |
| Labels that read as nonsense | none in these flows |

## §2 Reference check

The board has no Game Night frames for these flows (its 3b-1 / Join frames are the pre-reset
inventory). Built on the approved Game Night pieces instead; traits listed for Giorgio, not added.

| Trait | Reference | Present? | Evidence |
|---|---|---|---|
| Warmth in copy and avatars only (Yahoo, gate §6) | Light: Yahoo | present | Copy unchanged and verbatim; your avatar in `you`; no decorative colour on icons (Get started) |
| One primary per step | gate §6 | present | Every step: one full-width pill (Next / Create / Find / Join / Continue / Send / Go to the league) |
| The product shown working in onboarding | Sleeper's first run | present | Vignettes are the draft tile and the Matchup Scoreboard, not illustrations |
| Pre-join preview with no people | PRODUCT_RULES 2026-10-11 | present | 25, 26: count only, no commissioner |

## §3 Hallmark self-critique (1–5)

Philosophy 4 (the first run shows the real app) · Hierarchy 4 (one heading and one primary per
step; caps keep it at XXXL) · Execution 4 (rhythm measured; one XXXL bug found and fixed) ·
Specificity 3 (auth screens are still generic forms; the vignettes carry the identity) · Earned 4
(nothing added beyond the rules) · Variety 4 (same Card, Scoreboard, DraftTile, WarnPanel as the
approved screens). No score under 3.

Punch list (by hand): minor (P3) — the Managers "+" at 16 and Playoff "+" at the league size are
disabled with no stated reason; minor (P3) — "first-round" can wrap at its hyphen; minor (P3) —
SetupScaffold's subtitle and "Back · Step N of 4" row are uncapped at XXXL (shared with League
settings).

## §4 Every tappable element

| Element | Where | Does | Evidence |
|---|---|---|---|
| Skip / Next / Get started | onboarding | Get started / next card / Get started | rec-01, rec-05 |
| Create a league / Join with a code / Sign in | Get started | Create account (resumes to create/join) / Create account / Sign in | rec-01 |
| Sign in, Forgot password?, Create an account | Sign in | sign in (inline refusal when empty) / Forgot password / Create account | rec-01 |
| Create account / Sign in / Sign in instead | Create account | create (inline errors) / Sign in / Sign in (paused) | rec-01, 07 |
| Send reset link / Back to sign in / Send again | Forgot password | sends (fixture) / Sign in / resends | rec-01, 08b |
| Continue / suggestion chips / Sign out / Cancel | username | save / fill the field / sign out / back. Continue is hidden while unchanged | rec-04, 10, 13 |
| Rows (Username, Change password, Appearance), Sign out, Home | Profile | open each / sign out / back. Email has no chevron and isn't pressable | rec-04 |
| System / Light / Dark | Appearance | switch the theme live | rec-04 |
| Update password / Cancel | Change password | disabled with the rules beside it / back | rec-04, 14 |
| League pill, a league row, ×, Create league, Join with code | league sheet | open / switch league / close / Create / Join | rec-02 |
| Next / Back / Cancel; Steppers; ChoiceRows; pick clock; Draft time; Random / Manual; Add slot / × / Check availability; Create league | Create league | each acts; disabled "+"/"−" sit at a bound (reason shown for weeks; P3 for the 16 cap) | rec-03 |
| Set draft time / Set later / × | Draft time sheet | commit / clear / close | rec-03 |
| Share / Go to the league | done | the iOS share sheet / League | rec-03, 20b |
| Find league / Join … / Open the league / Try another code / Invite code (back) | Join | look up / join / open / back to code entry; Join disabled for "left" with its reason | rec-02, 25–36 |
| Share | Home pre-draft | the iOS sheet; hidden from T−1h | 38, 39 |

## Not captured, and why

- **VoiceOver**: not drivable here; labels are pinned by tests (preview rows read "label, value";
  the tiles and Scoreboard keep their own tested labels).
- **The notifications prompt**: the app has no in-app prompt; iOS asks on a physical device only
  (`lib/notifications.ts` skips simulators).
- **Delete account**: not present in the app.
- **Real sign-in / sign-up / password change**: would need credentials; the fixture answers, and
  the change-password flow stops before typing a password.

## Fixture artefacts (not defects)

- After Joined / Create → "Go to the league", Home / League stay on their skeleton: the joined
  fixture league has no data behind the dead Supabase port.
- 39 is "past the draft time" because the fixture's draft date (Oct 3) is in the past.
- `rec-03-create-league-flow-dark` names the league "G" (the typing tool dropped characters); the
  Light run has the full 20-character name.
