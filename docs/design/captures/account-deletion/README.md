# Account deletion W4 on the app: gate captures (`feat/account-deletion-app`)

**Screenshots stay out of the repo.** Every still is in **`~/fantasy-stock-design-review/feat-account-deletion-app/`**
(232 stills, 29 frame ids, plus `diffs/` and `not-reachable/`). This file is the index.

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

`not-reachable/F28-*`: the already-in-league panel (2 stills, 17e L only). The live server answers an already-member
link with only `{ok:false, reason}`, so the app opens Home; the panel is a fallback. Not part of the review set.

## Baseline diffs (L, both phones, both themes; `diffs/`)

A detached `origin/main` (`6e1b8345`) against this branch, identical fixtures (`leagues-member`, `LEAVE_LEAGUE=1`),
`DELETED_SEAT` / `DELETE_FIXTURE` unset. Standings and Matchup: **identical (0 px)** in all four pairs each.
Profile: only the Sign-out card region and below changed (y 1767-2074 px on 17e; everything above identical).
League settings: only from the new "Members" section down (y 966-2357 px on 17e; everything above identical).
Side-by-sides: `sidebyside-*.png`; per-pair images `diff-*.png` (left main, right branch).

## Known notes

- Frames F19 (share sheet) and the F24 refused line need a gesture or a scroll the headless run cannot make: F19 was
  opened by a capture-script action (a dev-only hook, since reverted and not committed); the keyboard that the refused
  state raises hides the error line in F24 (see the report).
- XXXL stills of the delete screens are the top of the scroll; the proof, line and button sit below the fold (no
  scroll handle is reachable without a release-code change).
- A pending takeover link persists in AsyncStorage: a capture that leaves one (`unknown`) reopens the landing on the
  next launch of this build; the baseline run cleared it first.
