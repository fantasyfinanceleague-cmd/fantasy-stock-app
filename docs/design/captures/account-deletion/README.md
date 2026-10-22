# Account deletion W4 on the app: gate captures (`feat/account-deletion-app`)

**Screenshots stay out of the repo.** Every still is in **`~/fantasy-stock-design-review/feat-account-deletion-app/`**
(248 stills, 31 frame ids, plus `diffs/` and `not-reachable/`). This file is the index.

**Build.** Branch `feat/account-deletion-app`. Captured on `1c82faa4` (F06-F27, F29-later and the F20-F23 re-shoot), `4260fee3` (F29-moment and the baseline diffs) and
`aec957b3`..`86635477` (F01-F05, F16, F17, shot while the build session was still committing copy and contract
changes). `4260fee3` (delete-account reply handling) changes no pixel on any delete frame.
Dev-only capture knobs (this commit, `lib/game/seamAccountDeletion.ts` + the seam files): `DELETED_SEAT=1`,
`TAKEOVER_FIXTURE=found|taken|dead|unknown|member|rate_limited_moment|rate_limited_later`, the
`create_takeover_invite` fixture, and `DELETE_FIXTURE=password_rejected|apple_rejected|google_rejected|limited`
(`lib/account/deleteCapture.ts`). All `__DEV__` / capture-seam only; the Supabase URL is a dead port.

**Method.** Two simulators of mine (iPhone 17e, iPhone 17 Pro, iOS 27.0, Expo Go), Metro `--clear` per state, status bar
9:41, `.env.local` rewritten per state (unset knobs empty), one clean terminate + launch per device x size x theme,
15-30 s settle, `simctl io screenshot`. Sizes `l` (Large) and `xxxl` (Accessibility XXXL), themes `dark` / `light`.
File name: `<id>-<state>-<17e|17pro>-<l|xxxl>-<dark|light>.png`.

## Frames (8 stills each: 2 phones x 2 sizes x 2 themes)

| Id | State | Notes |
|---|---|---|
| F01 | Standings, the seat reads "Former manager" | non-commissioner fixture (`leagues-member`) |
| F02 | Matchup, the opponent is the seat | |
| F03 | History, Season 1 | |
| F04 | League settings > Members, no pill | non-commissioner view (Paolo M. is commissioner) |
| F05 | Profile, Delete account under Sign out | |
| F06 | Delete screen, password, empty | button dimmed, proof line above it |
| F07 | password typed | button live |
| F08 / F09 | Apple before / confirmed | native Apple button; "Confirmed with Apple" |
| F10 / F11 | Google before / confirmed | |
| F12 | the native "Are you sure?" alert | iOS-drawn; follows the sim appearance |
| F13 | "Couldn't delete your account. Try again." | |
| F14 | running (spinner in the pill) | |
| F15 | Sign in with "Your account is deleted." | |
| F16 | Members with "Find a new manager" | commissioner (you) |
| F17 | Standings as commissioner | uniform rows, no link |
| F18 | the seat's team view with the button | |
| F19 | the iOS share sheet over it | message "Take over a team in Stock Scudetto" |
| F20-F23 | takeover: found, taken, dead, unknown | |
| F24-F26 | password / Apple / Google refused | |
| F27 | proof limit "Too many tries. Try again later." | |
| F29 | takeover rate-limited, `-moment` and `-later` | two lines |

`not-reachable/F28-*`: the already-in-league panel (8 stills). The live server answers an already-member
link with only `{ok:false, reason}`, so the app opens Home; the panel is a fallback. Not part of the review set.

## Baseline diffs (L, both phones, both themes; `diffs/`)

A detached `origin/main` (`6e1b8345`) against this branch, identical fixtures (`leagues-member`, `LEAVE_LEAGUE=1`),
`DELETED_SEAT` / `DELETE_FIXTURE` unset. Standings and Matchup: **identical (0 px)** in all four pairs each.
Profile: only the Sign-out card region and below changed (y 1767-2074 px on 17e; everything above identical).
League settings: only from the new "Members" section down (y 966-2357 px on 17e; everything above identical).
Side-by-sides: `sidebyside-*.png`; per-pair images `diff-*.png` (left main, right branch).

## Re-shoot on `eb0c27be` (after `133cbd30`: a refused password scrolls its line above the keyboard; the capture seed no longer fills refused/limited states; the screen honours `SHELL_SCROLL_END=1`)

New simulators, same method, plus a settle check (the shot is taken once two consecutive screenshots match).
Replaced stills are in `superseded-run2/` (inside the stills directory).

| Frames | What was re-shot |
|---|---|
| F24 | all 8 (L and XXXL, both themes, both phones), keyboard up; re-shot again on `b5924d44`, see below |
| F25, F26, F27 | all 8 each (the field is empty now; L too) |
| F06, F07, F08, F09, F10, F11, F13, F14 | XXXL only (4 stills each), with `SHELL_SCROLL_END=1`: the foot of the page (proof, line, button) |

**F24 final (HEAD `b5924d44`, "a refused password scrolls on the keyboard's own events").** F24 was re-shot a third time,
2 stills per combination ~2 s apart after the screen settled (the second of each pair differs only in the caret's blink;
the first is kept). All 8 combinations (17e and 17 Pro, L and XXXL, dark and light) show the refusal line "That password
isn't right. Try again." AND the dimmed "Delete my account" fully above the keyboard, with the empty red-rimmed field
above them. The earlier passes (hidden in 5 of 16 shots with the single-timer scroll) are in `superseded-run2/`
(`runA-F24-*`, `runB-F24-*`).

## F30, F31 and the spot check on `364198b7` (scheme-origin takeover links wait for a tap; no code is the dead view)

| Frame | State | Result |
|---|---|---|
| F30 | takeover **tap view** (`TAKEOVER_FIXTURE=tap`, a scheme-origin link): the default avatar, then "Find league" (primary) and "Not now" docked at the bottom | 8 stills. The avatar is centred horizontally and sits in the middle of the space above the docked buttons; no heading, no text. At XXXL the buttons grow, nothing clips or overlaps |
| F31 | takeover with **no pending code** (`SHELL_INITIAL_ROUTE=/takeover`, no knob, fresh simulators so nothing stored) | 8 stills: the dead-link view ("This invite link doesn't work anymore. Ask for a new one." + "Go to Home", no heading, centred), never a spinner. Two stills (17e and 17 Pro, L, light) were first caught on Home with a "No native module" dev toast, because the DEV initial-route push did not land on that launch; they were re-shot and the first versions are in `superseded-run2/F31-NOTROUTED-*` |
| F20, F21 | spot check, 17e L dark and light (also 17 Pro) | unchanged: F20 shows the found question with the record and "Take the team" / "Not now" (no tap view); F21 shows "Someone already took this team." + "Go to Home" |

## Re-gate on `60b36a1c` (shot from `d8c960dd`, docs-only on top): sm Button ceiling 1.6x, proof lines in the Field styles, names that never split, no "Try again" on the hour's lockout

Origin/main for the diffs: `4e24ea92`. Replaced stills are in `superseded-run3/`.

| Frames | What |
|---|---|
| F16 | Members with "Find a new manager", L and XXXL (all 8): the pill at XXXL is one line, about 230 pt wide under the seat's name (it was a two-line pill at about 2x body size); on the 17 Pro at L it sits inline on the seat's row, on the 17e at L it wraps under the name |
| F32 (new) | League settings, member view before the draft: the invite Share pill (L and XXXL, all 8): inline right of "Invite code" at L; at XXXL it drops under the code, a one-line sm pill |
| F33-commissioner-settings-foot (new, L only, 4) | the commissioner's pre-draft League settings scrolled to the foot (Roster slots "Add slot" sm pill, League info, Save). The commissioner's invite row has no Share pill (and F33 at XXXL cannot be shot, see below; those stills are in `not-reachable/`) |
| F06 (XXXL foot), F06-top (new, XXXL), F08, F09, F25 (XXXL foot) | the proof prompt and refusal lines in the password field's label/error styles |
| F20, F29-later, F29-moment, F30, F31 | all 8 each on this build |

**Judgements.**
- Proof prompt: "Enter your password to continue" (F06) and "Confirm it's you to continue" (F08, F25) are now the same size and weight (headline weight, full size). "Confirmed with Apple" (F09) is the same size in green: it wraps to "Confirmed with / Apple" with a small check mark at the left of the first line (the check looks small and low next to the text). The refusal line in F25 ("Couldn't confirm it's you. Try again.", coral dark / red light) is as large and as heavy as the prompt above it, so it competes with it. The native Apple button stays at its fixed height and text size beside this large text.
- Names that never split: the F06 league lines and the "Past seasons keep your results under “Former manager”." line hold at XXXL ("Stock Scudetto", "Friday Night Stocks", "Paolo M." and "“Former manager”" each stay on one line). F20 does not at XXXL: "Take over / Former / manager's / team in / Stock / Scudetto?" splits both "Former manager's" and "Stock Scudetto" across lines (at L it is "Take over / Former manager's / team in / Stock Scudetto?").
- F29-later shows only "Not now" (no "Try again"); F29-moment keeps both. F30 and F31 as before (avatar centred above the docked "Find league" / "Not now"; the dead view for no code, no spinner).
- F33 at XXXL: the commissioner's League settings crash in dev with a red "Cannot read property 'layout' of null" screen (SetupRows.tsx line 58, `onLayout` reads `e.nativeEvent` inside the `setBrokeAt` updater after the event is released). It reproduces on `origin/main` too, so it is not from this branch.

**L diffs against a detached `origin/main` (`4e24ea92`)**, both phones, both themes, identical fixtures (`leagues-member` / `leagues`, `LEAVE_LEAGUE=1`), no `DELETED_SEAT` / `DELETE_FIXTURE`:

| Screen | Result |
|---|---|
| Profile | only the Sign-out card region and below (17e y 1767-2074 px, 17 Pro y 1812-2119); everything above identical |
| League Standings, League Matchup | identical, 0 px, all 4 combinations each |
| League settings (member, after the draft) | only from the new Members section down (17e y 966-2357; 17 Pro y 1056-2447) |
| League settings (member, before the draft): the invite Share pill | identical, 0 px, all 4 |
| League settings (commissioner, before the draft), top and scrolled to the foot (the "Add slot" sm pill) | identical, 0 px, all 4 each |
| League Standings, load failed ("Try again" sm pill) | identical, 0 px, all 4 |

## Re-gate round 2 on `b4d23ecd` (takeover heading ceiling 1.15x; SetupRows reads the layout event before its state updater)

Replaced stills are in `superseded-run4/`.

- **F20 takeover found, XXXL (4 stills).** Now wraps "Take over / Former manager's / team in / Stock Scudetto?": "Former manager's" and "Stock Scudetto" each stay on ONE line, on both phones, both themes (it was six lines splitting both names). The heading is smaller than before; the record pill, "Take the team" and "Not now" are unchanged.
- **F33 commissioner League settings (pre-draft; Roster slots / "Add slot"), XXXL: now reachable.** `F33-commissioner-settings-top-*` and `F33-commissioner-settings-foot-*` (`SHELL_SCROLL_END=1`), 8 stills, no crash (the red "Cannot read property 'layout' of null" screen is gone; that was `SetupRows.tsx` reading `e.nativeEvent` inside the state updater). The earlier crashed stills (`not-reachable/F33-share-pill-commissioner-*`) were moved to `superseded-run4/`. There is no Share pill on the commissioner's invite row at XXXL: the foot shows the code, then "Commissioner / You", with nothing between them (the same as at L). One top still (17e XXXL light) was first caught on the Expo Go splash and was re-shot.
- **L diffs vs `origin/main` (`4e24ea92`) for the SetupRows change**, both phones, both themes: League settings, commissioner pre-draft (top) and (scrolled to the foot), and member pre-draft (Share pill): identical, 0 changed pixels in all 12 pairs.

## Round 4 on `4a614aec` (scheme-link tap view has a heading; the "Confirmed with" check hangs on the first line)

17e only; replaced stills are in `superseded-run5/`.

- **F30 (takeover tap view), 17e L and XXXL, dark and light (4 stills).** The default avatar and the heading "Take over a team" are centred, one line, not clipped, with "Find league" and "Not now" docked below. **For the 17e these supersede the earlier F30 stills; the 17 Pro F30 stills are from an earlier build (no heading) and are NOT current.**
- **F09 (Apple confirmed, delete screen), 17e XXXL foot, dark and light (2 stills).** The check now sits on the first line, beside "Confirmed with", with "Apple" on the second line. The 17e L F09 stills and all 17 Pro F09 stills are unchanged from the earlier build.

## Known notes

- F19 (share sheet) was opened by a capture-script action (a dev-only hook, since reverted and not committed).
- A pending takeover link persists in AsyncStorage: a capture that leaves one (`unknown`) reopens the landing on the
  next launch of this build; the baseline run cleared it first.

## Phone-pass notes (the real-device checks no simulator can make)

Tick these on a TestFlight / dev-client build (the same list goes into `docs/testing/WALKTHROUGH_1.3.md`):

- **Delete with Apple:** the Apple sheet, "Confirmed with Apple", the alert, then Sign in with "Your account is deleted."; the app is gone from Settings › Apple ID › Sign in with Apple (the revoke).
- **Delete with email + password:** a wrong password shows "That password isn't right. Try again." above the keyboard; the right one deletes.
- **Share a takeover link for real:** as the commissioner, tap "Find a new manager" on a deleted seat (Members, and the seat's team view) and send the link through Messages. The text is "Take over a team in {league}" with the https `/take/<CODE>` link on its own line. (The simulator stills opened the share sheet through a capture-script action, not a tap.)
- **A real takeover between two phones:** open that link on a second phone with the app installed: https previews the seat by itself ("Take over Former manager's team in …?"); then "Take the team" lands in the league with the record kept. A second phone opening the same link sees "Someone already took this team."
- **A scheme link waits for a tap:** `fantasystockapp://take/<CODE>` (tapped from Notes or a page) shows only "Find league" and "Not now" until you tap; nothing is looked up before the tap.
- **The https link only opens the app once W5 ships** the `/take/*` entry in the apple-app-site-association file and the web "Get the app" page; until then the scheme link works in-app and the https link opens the web.
