# gn-sweep: the old-skin sweep before 1.3 (`feat/gn-sweep`), gate captures

**The after-frames are on app code `a967325f`, and the item-4 failed-state set (`a0*`, `rec-a0*`) on
`62bb6ea6`** (both on `origin/main` `0fa519bf`). `62bb6ea6` changes one constant, `LEAGUES_LOAD_FAILED`,
to Giorgio's approved "Your leagues didn't load."; it renders only in the failed state, so every other
frame is pixel-identical on either build. The `a0*` set was re-shot in full on `62bb6ea6`.
**The reset form at XL and XXXL (`b06-*-xl-*`, `b06-*-xxxl-*`) is on `178d1339`** (the DL's P3: no
autoFocus at large text); its Large frames are unchanged (autoFocus stays on below 1.3×).
The before-frames are `origin/main` `0fa519bf` itself, plus the same DEV-only capture plumbing
patched into a throwaway checkout (the `type`/`typeq` search actions, `scrollto`, and the gallery's
gn-sweep section), so each pair is driven the same way. Nothing else differs.

**Where the files are:** `~/fantasy-stock-design-review/feat-gn-sweep/` (checklist §1: captures
stay out of the repo). 112 stills (96 after, 16 before), 4 recordings, 1 frame sheet.

**Capture times (2026-10-14, local):** after A 12:51–12:55 · B 12:18–12:21 · D1/D2 12:22–12:26 ·
E 12:26 · Q 12:27 · C 12:28; before 12:37–12:41.

**How (headless).** Device access for my simulators wasn't granted, so no finger taps anything:
- two simulators of my own, "gn-sweep 17e" and "gn-sweep 17 Pro" (iOS 27.0, clones of the W4
  Portfolio pair), Expo Go, Metro on port 8093; every configuration is a Metro restart (`--clear`)
  plus a cold Expo Go launch; stills are `xcrun simctl io … screenshot`; recordings are
  `simctl io … recordVideo`. Theme switches live (`simctl ui … appearance`); text size relaunches.
- `.env.local` points Supabase at a dead port on purpose (no prod reads or writes); the shell
  fixture fakes the session and the league list; `EXPO_PUBLIC_GAME_SEAM=1` plays the board's league.
- New DEV-only switches this branch adds (each inert in a release build and without the seam):
  `EXPO_PUBLIC_SHELL_FIXTURE=leagues-failed-once` (the league-list read fails on the first try);
  `EXPO_PUBLIC_RESET_CAPTURE=form|success` (which reset-password state RENDERS; never sets the
  recovery flag, never touches auth); capture-script actions `retry` (the re-read Try again runs),
  `type` / `typeq` (types into the room's / the queue's search field, as a finger would), `scrollto`.
- Large = `large`; XL = `accessibility-extra-large`; XXXL = `accessibility-extra-extra-extra-large`.

## States

| Files | State | Shows |
|---|---|---|
| `a01-home-failed-{17e,17pro}-{light,dark}` | **Item 4.** The league-list read failed (`leagues-failed-once`) | Home: header (title, avatar → Profile), the sp alert in the EmptyState disc, "Your leagues didn't load." (Giorgio approved, 2026-10-14), "Check your connection, then try again.", **Try again** (the screen's one primary). Never "No leagues yet". |
| `a02-league-failed-*` | same, League tab | The same state with League's header. |
| `rec-a01-home-try-again-{17e,17pro}-light.mov`, `rec-a01-…-17e-light-frames.png` | Try again (scripted: the same `refresh` Try again calls) | Failed → the header alone while the re-read runs (the tap visibly acts) → Home loads with its entrance. |
| `rec-a02-league-try-again-{17e,17pro}-dark.mov` | same, League | Failed → standings. |
| `a03-home-after-try-again-*`, `a04-league-after-try-again-*` | after the retry | The league's real screens. |
| `b01-home-live-*` | **Item 2.** Home, live | The tab bar (sp/Icon `tab*`, 24pt, outline/filled crossfade in `accent`/`text2`); the league pill's chevron (`chevronDown`, caption); ThisWeek's and Standings' chevrons (`chevronRight`, callout). |
| `b02-not-found-*` (Large, XL, XXXL) | **Item 3.** `+not-found` | The sp medallion (search in a `sunken` disc), "Nothing here", the line, **Go to Home**. At XXXL the title stays at least as large as the body. |
| `b03-reset-invalid-*` (Large, XL, XXXL) | **Item 3.** reset-password, invalid (`?status=invalid`) | The sp alert in the disc, "This link didn't work", the line, **Request a new link** / Back to sign in. **XXXL: the message now caps at the title's size** (it was larger, see before). |
| `b04-reset-verifying-*` (Large, XL, XXXL) | reset-password, verifying | Spinner in `accent`, "Checking your reset link…", Cancel. |
| `b06-reset-form-*` (Large, XL, XXXL) | reset-password, valid (the form; `RESET_CAPTURE=form`) | "Set a new password", the rule line, the two fields, the rules, Update password (disabled until both fields have text; the rules list sits beside it), Cancel. Large: the first field focused, keyboard up. **XL / XXXL (`178d1339`): no autoFocus, so the title is read first and one tap opens the field** (DL P3). |
| `b07-reset-success-*` (Large, XL, XXXL) | reset-password, success | sp `checkCircle` in the disc, "Password updated", the line, **Continue**. |
| `b05-player-portfolio-*` | **Item 1.** Another manager's portfolio (`/player-portfolio?userId=gianluigi`) | `moneyBg`; the holdings divide by space at the 56pt rhythm; no rules. |
| `c01-room-search-*` | **Item 1.** Draft room search, your running clock (`on_clock_90`, typed "A") | The results on the rimmed `surface` dropdown, divided by space; "Already owned" rows dimmed with the badge (now 11pt). |
| `c02-queue-search-*` | **Item 1.** The lobby's queue search (QueueEditor, typed "A") | The same field and results inside the queue card. |
| `c03-season-complete-row-*` | **Items 1 + 2.** Home, season complete | "See the final standings": sp/ListRow with no rule, its chevron the drawn `chevronRight`. |
| `g01-gallery-button-checks-salepicker-*` | **Items 1 + 2.** Dev gallery (no live path) | Button's two checks as sp/Icon in the label's ink (selected: I'm out / I'm in; done); SalePicker with two sales: rows on an `inset` panel, no hairline edge, idle radio ring in `borderStrong`. SalePicker's live path needs two open sales, which no fixture has (the seam's `sold` variant has one), so it is shown here. |

## Before / after, per item

| Item | Before (`origin/main`) | After (`a967325f`) |
|---|---|---|
| 1 · room search | `before-c01-room-search-17e-*`: a 1pt `line` rule under every result | `c01-room-search-*`: space only; the dropdown edge is the card rim |
| 1 · queue search | `before-c02-queue-search-17e-*`: the same rules | `c02-queue-search-*` |
| 1 · SalePicker | `before-g01-…`: a `surface` card with a hairline `border` edge on the sheet's `surface`; idle radio ring in `border` (≈1.3:1) | `g01-…`: an `inset` panel (a lightness step), no hairline; idle ring `borderStrong` (≥ 3:1) |
| 1 · their portfolio | `before-b05-player-portfolio-17e-*`: hairline under every holding, page on `bg` | `b05-player-portfolio-*`: space, `moneyBg` |
| 1 · ListRow | sp/ListRow drew a hairline by default (`divider` prop); the season card passed `divider={false}`, so that frame looked the same | the prop and the line are gone from the primitive (no caller can turn it back on); `c03-…` |
| 2 · icons | `before-b01-home-live-17e-*`, `before-g01-…`: raw Ionicons, same glyphs | `b01-…`, `g01-…`: the same glyphs through sp/Icon. Visible differences: Button's done check 22 → 20pt (`headline`), and the chevrons and checks now scale with Dynamic Type within their role's cap; the tab icons stay 24pt at every size (new `tab` role) |
| 3 · reset-password | `before-b03-reset-invalid-xxxl-17e-*`: at XXXL the message (≈47pt) outgrew its title (35pt) | `b03-reset-invalid-*-xxxl-*`: the message caps at the title's ceiling (EmptyState, every caller) |
| 4 · read failure | `before-a01-home-no-leagues-17e-*`, `before-a02-league-no-leagues-17e-*`: what a FAILED read rendered on main (LeagueContext set `leagues = []` on an error, so Home and League said "No leagues yet" with Create / Join) | `a01-…`, `a02-…`: the load-failed state with Try again; "No leagues yet" only after a successful read with zero memberships |

## §2 Reference check

**What I could and couldn't check.** The references for these screens are the checklist's (Dark:
Sleeper / ESPN / Robinhood; Light: E*TRADE / Yahoo), but `~/fantasy-stock-design-review/references/`
holds only ESPN's player card, and none of these screens has a reference capture there. So the
borrowed traits below are checked against the **board frame**, and the squint test against the
reference itself is left to the Design Lead (not claimed here).

| Screen | Board frame | Traits the frame draws: present / absent (evidence) |
|---|---|---|
| Home / League, list didn't load | inventory.jsx `Empty` (the carded empty state Matchup's and Portfolio's load failures already use) | **Present:** one card on the page, the icon in a soft disc, a one-line reason, one full-width action (`a01`, `a02`). |
| reset-password (4 states) | inventory-board "Check your email" (`Empty` with two actions) | **Present:** the carded Empty with disc, title, line, primary + secondary stacked full width (`b03`, `b07`); the form is the shell's Field set (`b06`). |
| +not-found | inventory-board `#not-found` | **Present:** 72pt `sunken` disc with the search glyph, "Nothing here", the line, full-width Go to Home, no tab bar, no back (`b02`). |
| Search results (room, queue) | the Draft room on the Game Night board (search under the board) | **Present:** rows divided by space, ticker over company, price right, owned rows dimmed with the reason (`c01`, `c02`). **Absent (W8):** the Game Night type (the field still sets Inter 16/12/14, not Archivo `ticker` / `caption`) and a pill badge (it's an outlined box). |
| SalePicker | key-screens / inventory-board `#money` ("Which sale pays for this?") | **Present:** radio rows on a step-up panel, amounts right, one primary under them (`g01`). |
| Their portfolio | none (a 3e screen, never on the Game Night board) | **Present:** `moneyBg`, rows by space (`b05`). **Absent (W8):** the W4 Portfolio row anatomy (ticker disc, `ticker` type, 700 value), a close control, and any route that opens it. |

`ux-reviewer` row "resembles its reference?": not measured against a reference capture (none on
disk for these screens); against the board frame: yes for the failed state, reset-password and
+not-found; partly for search and their portfolio (type and row anatomy are still 3e's, for W8).

## §3 Hallmark

**Self-critique (1–5):** Philosophy 4 (separation by space and surface, as the six rules say) ·
Hierarchy 4 (one primary per state; the XXXL inversion fixed) · Execution 4 (tokens only, every
fill reads its own ink, the 11pt floor on the badge) · Specificity 4 (the failed state names what
failed: "Your leagues didn't load.", Giorgio's string) · Earned 4 (nothing added that wasn't asked; the capture
switches are DEV-only) · Variety 4 (reads as the same system as W4's approved screens). None < 3.

**`hallmark audit` punch list:**

| Tell | Where | Severity | Fix |
|---|---|---|---|
| Old-skin type in the search field (Inter 16/12/14, an outlined uppercase badge) | `c01`, `c02` | major → P2 | Move SymbolSearchField to sp/Text (`ticker`, `caption`) and a pill badge (W8; out of this sweep's scope, which was its rule lines) |
| Their portfolio's rows are still 3e's anatomy; no close control; no route opens the screen | `b05` | major → P2 | Decide if the screen lives (nothing navigates to it); if so, the HoldingRow anatomy without the tap, and an X (W8) |
| The reset form at XL/XXXL: the keyboard and the focused field pushed the title off-screen | `b06-…-xl/xxxl` | minor → P3 | **Fixed in `178d1339`** (DL P3): no autoFocus from `isLargeText` (≥ 1.3×); shared with Change password |
| +not-found's total accent 5.0–5.2% | `b02` | minor → P3 | All of it is the one primary (without it: 0.02%), so it passes the rule as written |

## §4 Nothing tappable does nothing

| Element (screen) | What it does | Evidence |
|---|---|---|
| Try again (Home / League, failed) | Re-reads the league list (`refresh`); the header shows while it runs, then the screen | `rec-a01-*`, `rec-a02-*`, the frame sheet; test `gn-sweep.test.ts` ("Try again (it re-reads)") |
| Pull to refresh (same) | The same re-read (`onRefresh={refresh}`) | source guard + mutation M22 |
| Avatar (failed states) | Profile (the header's existing control) | `a01`, `a02` |
| Go to Home (+not-found) | Dismisses the stack, replaces it with `/` | source guard (`goHome`) |
| Request a new link / Back to sign in / Continue / Cancel (reset-password) | forgot-password / `handleCancel` (ends a recovery session it started) / `/` / `handleCancel` | source guard (`gn-sweep.test.ts`); headless, so not tapped |
| Update password (form) | Disabled until both fields have text; the rule list beside it says what's needed | `b06` |
| Search results (room / queue) | A selectable row selects (Draft appears in the room; the queue adds it); an owned row is disabled with its badge | `c01`, `c02`; W4 Draft's tap-through covers the select |
| Tab icons, league pill, ThisWeek / Standings chevrons, "See the final standings" | Unchanged handlers (only the glyph's component changed) | `b01`, `c03`, `a03`, `a04` |
| SalePicker rows / Use the … sale / X | Choose / buy from it / close (unchanged) | `g01` (gallery handlers are dev no-ops) |

Not tapped by a finger anywhere (no device grant); every handler named above is guarded in source.

## §5 Mechanical checks

- **Tokens only:** no `#hex`/`rgba(` in any changed component (two hits are PR numbers in comments).
- **No `textTransform`** in the changed files. **`minimumFontScale`:** the one hit is ThisWeekCard's
  existing `NAME_MIN_SCALE`, untouched.
- **No rule lines** on the touched mounted screens: `hairlineWidth|borderBottomWidth|borderBottomColor|RowDivider|colors.line`
  absent from SymbolSearchField, QueueEditor, sp/ListRow, SeasonCompleteCard, SalePicker,
  PlayerPortfolioScreen (a test per file).
- **Accent by area** (`app_accent_area.py`, cross-checked with a PIL port of the same rule that also
  drops the largest accent region, the one primary: 96 of 96 frames of the first pass agree to 0.01; the
  re-shot `a0*` rows below are from the port):

  Every product frame is ≤ 5% WITHOUT its one primary (the rule as the checklist states it). Over 5% in
  total: +not-found (5.05–5.20%, all but 0.02% of it the Go to Home pill) and the dev gallery `g01`
  (several accent buttons side by side on purpose; not a product screen).

| Frame | Theme | Accent % (all) | Accent % (without the one primary) | Gain % | Loss % |
|---|---|---|---|---|---|
| `a01-home-failed-17e-dark` | dark | 4.81 | 0.12 | 0.00 | 0.00 |
| `a01-home-failed-17e-light` | light | 4.81 | 0.12 | 0.00 | 0.00 |
| `a01-home-failed-17pro-dark` | dark | 4.68 | 0.11 | 0.00 | 0.00 |
| `a01-home-failed-17pro-light` | light | 4.68 | 0.11 | 0.00 | 0.00 |
| `a02-league-failed-17e-dark` | dark | 4.81 | 0.12 | 0.00 | 0.00 |
| `a02-league-failed-17e-light` | light | 4.80 | 0.12 | 0.00 | 0.00 |
| `a02-league-failed-17pro-dark` | dark | 4.68 | 0.11 | 0.00 | 0.00 |
| `a02-league-failed-17pro-light` | light | 4.68 | 0.11 | 0.00 | 0.00 |
| `a03-home-after-try-again-17e-light` | light | 0.31 | 0.25 | 0.67 | 0.01 |
| `a03-home-after-try-again-17pro-light` | light | 0.29 | 0.23 | 0.62 | 0.01 |
| `a04-league-after-try-again-17e-dark` | dark | 0.16 | 0.09 | 0.28 | 0.25 |
| `a04-league-after-try-again-17pro-dark` | dark | 0.15 | 0.09 | 0.26 | 0.23 |
| `b01-home-live-17e-dark` | dark | 0.31 | 0.25 | 0.67 | 0.01 |
| `b01-home-live-17e-light` | light | 0.31 | 0.25 | 0.67 | 0.01 |
| `b01-home-live-17pro-dark` | dark | 0.29 | 0.23 | 0.63 | 0.01 |
| `b01-home-live-17pro-light` | light | 0.29 | 0.23 | 0.62 | 0.01 |
| `b02-not-found-17e-dark` | dark | 5.20 | 0.02 | 0.00 | 0.00 |
| `b02-not-found-17e-light` | light | 5.20 | 0.02 | 0.00 | 0.00 |
| `b02-not-found-17e-xl-dark` | dark | 5.00 | 0.06 | 0.00 | 0.00 |
| `b02-not-found-17e-xl-light` | light | 5.00 | 0.06 | 0.00 | 0.00 |
| `b02-not-found-17e-xxxl-dark` | dark | 1.75 | 0.00 | 0.00 | 0.00 |
| `b02-not-found-17e-xxxl-light` | light | 1.75 | 0.00 | 0.00 | 0.00 |
| `b02-not-found-17pro-dark` | dark | 5.05 | 0.02 | 0.00 | 0.00 |
| `b02-not-found-17pro-light` | light | 5.06 | 0.02 | 0.00 | 0.00 |
| `b02-not-found-17pro-xl-dark` | dark | 4.86 | 0.05 | 0.00 | 0.00 |
| `b02-not-found-17pro-xl-light` | light | 4.86 | 0.05 | 0.00 | 0.00 |
| `b02-not-found-17pro-xxxl-dark` | dark | 3.01 | 0.09 | 0.00 | 0.00 |
| `b02-not-found-17pro-xxxl-light` | light | 3.01 | 0.09 | 0.00 | 0.00 |
| `b03-reset-invalid-17e-dark` | dark | 4.46 | 0.02 | 0.00 | 0.00 |
| `b03-reset-invalid-17e-light` | light | 4.46 | 0.02 | 0.00 | 0.00 |
| `b03-reset-invalid-17e-xl-dark` | dark | 4.12 | 0.05 | 0.00 | 0.00 |
| `b03-reset-invalid-17e-xl-light` | light | 4.12 | 0.05 | 0.00 | 0.00 |
| `b03-reset-invalid-17e-xxxl-dark` | dark | 4.12 | 0.05 | 0.00 | 0.00 |
| `b03-reset-invalid-17e-xxxl-light` | light | 4.12 | 0.05 | 0.00 | 0.00 |
| `b03-reset-invalid-17pro-dark` | dark | 4.35 | 0.02 | 0.00 | 0.00 |
| `b03-reset-invalid-17pro-light` | light | 4.35 | 0.02 | 0.00 | 0.00 |
| `b03-reset-invalid-17pro-xl-dark` | dark | 4.04 | 0.04 | 0.00 | 0.00 |
| `b03-reset-invalid-17pro-xl-light` | light | 4.04 | 0.04 | 0.00 | 0.00 |
| `b03-reset-invalid-17pro-xxxl-dark` | dark | 4.04 | 0.04 | 0.00 | 0.00 |
| `b03-reset-invalid-17pro-xxxl-light` | light | 4.04 | 0.04 | 0.00 | 0.00 |
| `b04-reset-verifying-17e-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b04-reset-verifying-17e-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b04-reset-verifying-17e-xl-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b04-reset-verifying-17e-xl-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b04-reset-verifying-17e-xxxl-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b04-reset-verifying-17e-xxxl-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b04-reset-verifying-17pro-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b04-reset-verifying-17pro-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b04-reset-verifying-17pro-xl-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b04-reset-verifying-17pro-xl-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b04-reset-verifying-17pro-xxxl-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b04-reset-verifying-17pro-xxxl-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b05-player-portfolio-17e-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b05-player-portfolio-17e-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b05-player-portfolio-17pro-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b05-player-portfolio-17pro-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b06-reset-form-17e-dark` | dark | 0.48 | 0.01 | 0.00 | 0.00 |
| `b06-reset-form-17e-light` | light | 0.47 | 0.00 | 0.00 | 0.00 |
| `b06-reset-form-17e-xl-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b06-reset-form-17e-xl-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b06-reset-form-17e-xxxl-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b06-reset-form-17e-xxxl-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b06-reset-form-17pro-dark` | dark | 0.46 | 0.01 | 0.00 | 0.00 |
| `b06-reset-form-17pro-light` | light | 0.46 | 0.01 | 0.00 | 0.00 |
| `b06-reset-form-17pro-xl-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b06-reset-form-17pro-xl-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b06-reset-form-17pro-xxxl-dark` | dark | 0.00 | 0.00 | 0.00 | 0.00 |
| `b06-reset-form-17pro-xxxl-light` | light | 0.00 | 0.00 | 0.00 | 0.00 |
| `b07-reset-success-17e-dark` | dark | 4.57 | 0.01 | 0.00 | 0.00 |
| `b07-reset-success-17e-light` | light | 4.57 | 0.01 | 0.00 | 0.00 |
| `b07-reset-success-17e-xl-dark` | dark | 4.40 | 0.02 | 0.00 | 0.00 |
| `b07-reset-success-17e-xl-light` | light | 4.40 | 0.02 | 0.00 | 0.00 |
| `b07-reset-success-17e-xxxl-dark` | dark | 4.40 | 0.02 | 0.00 | 0.00 |
| `b07-reset-success-17e-xxxl-light` | light | 4.40 | 0.02 | 0.00 | 0.00 |
| `b07-reset-success-17pro-dark` | dark | 4.46 | 0.01 | 0.00 | 0.00 |
| `b07-reset-success-17pro-light` | light | 4.46 | 0.01 | 0.00 | 0.00 |
| `b07-reset-success-17pro-xl-dark` | dark | 4.30 | 0.02 | 0.00 | 0.00 |
| `b07-reset-success-17pro-xl-light` | light | 4.30 | 0.02 | 0.00 | 0.00 |
| `b07-reset-success-17pro-xxxl-dark` | dark | 4.30 | 0.02 | 0.00 | 0.00 |
| `b07-reset-success-17pro-xxxl-light` | light | 4.30 | 0.02 | 0.00 | 0.00 |
| `c01-room-search-17e-dark` | dark | 0.11 | 0.04 | 0.00 | 0.00 |
| `c01-room-search-17e-light` | light | 0.11 | 0.04 | 0.00 | 0.00 |
| `c01-room-search-17pro-dark` | dark | 0.11 | 0.04 | 0.00 | 0.00 |
| `c01-room-search-17pro-light` | light | 0.11 | 0.04 | 0.00 | 0.00 |
| `c02-queue-search-17e-dark` | dark | 0.12 | 0.06 | 0.00 | 0.00 |
| `c02-queue-search-17e-light` | light | 0.12 | 0.05 | 0.00 | 0.00 |
| `c02-queue-search-17pro-dark` | dark | 0.11 | 0.05 | 0.00 | 0.00 |
| `c02-queue-search-17pro-light` | light | 0.11 | 0.05 | 0.00 | 0.00 |
| `c03-season-complete-row-17e-dark` | dark | 0.28 | 0.22 | 0.16 | 0.00 |
| `c03-season-complete-row-17e-light` | light | 0.28 | 0.22 | 0.16 | 0.00 |
| `c03-season-complete-row-17pro-dark` | dark | 0.26 | 0.21 | 0.16 | 0.00 |
| `c03-season-complete-row-17pro-light` | light | 0.26 | 0.21 | 0.16 | 0.00 |
| `g01-gallery-button-checks-salepicker-17e-dark` | dark | 6.60 | 2.64 | 0.00 | 0.00 |
| `g01-gallery-button-checks-salepicker-17e-light` | light | 6.60 | 2.64 | 0.00 | 0.00 |
| `g01-gallery-button-checks-salepicker-17pro-dark` | dark | 6.37 | 2.47 | 0.00 | 0.00 |
| `g01-gallery-button-checks-salepicker-17pro-light` | light | 6.37 | 2.48 | 0.00 | 0.00 |
