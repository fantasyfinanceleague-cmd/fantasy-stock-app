# W8 follow-up: F3 (Profile's back link), F4 (Renewal review's Schedule), P3 copy, on `chore/w8-f3-f4`

**Screenshots stay out of the repo (Giorgio, 2026-10-14).** The stills are in
**`~/fantasy-stock-design-review/chore-w8-f3-f4/`**; this file is the index. Rulings are the Orchestrator's of
2026-10-16 (the Design Lead's F3 / F4 calls from the W8 tap-through).

**Build.** Branch `chore/w8-f3-f4`, on top of `4abacfbc` (#287). Every still was taken on the working tree of this
branch before the commit (the commit carries exactly these files). iPhone 17e simulator, iOS 27.0, Expo Go, status
bar pinned at 9:41, a dead Supabase URL, dev fixtures only. Large text unless a row says XXXL; XXXL was a cold launch.

## F3: Profile's back link names where it goes back to

The avatar (`ShellHeader`) pushes `/profile?from=<tab>` for home, matchup, league or portfolio (the pathname at the
moment of the tap). Profile labels its link from the param and still calls `router.back()`. No param or an unknown one
(a deep link, a cold start) reads "‹ Back"; the param is checked against the four values only (`lib/shell/profileBack.ts`).

| File | State | Link reads |
|---|---|---|
| `F3-profile-from-league-17e-l-light.png` / `…-dark.png` | Profile opened from the League tab | ‹ League |
| `F3-profile-from-home-17e-l-light.png` / `…-dark.png` | Profile opened from Home | ‹ Home |
| `F3-profile-no-param-17e-l-light.png` | a cold-start route to `/profile` (no `?from=`) | ‹ Back |
| `F3-check-back-to-league.png` | after tapping "‹ League": back on League (the action is unchanged) | n/a |

## F4: Renewal review

| File | State | Shows |
|---|---|---|
| `F4-no-time-17e-l-light.png` / `…-dark.png` | no draft time | Draft row: **Pick a draft time**; "Schedule the draft" disabled with **Pick a future draft time.** directly under it, in the footnote's place and style |
| `F4-past-time-17e-l-light.png` / `…-dark.png` | a time that is already past (the date picker's "today" at an earlier minute) | Draft row shows the date ("Fri, Oct 16"); the button is disabled and the **same reason line** shows. The picker's `minimumDate` is not relied on |
| `F4-future-time-17e-l-light.png` / `…-dark.png` | a time later today | the button is enabled and the original footnote is back: "Everyone who's in gets a notification. Season 1 stays in History." |
| `F4-no-time-17e-xxxl-{light,dark}-row.png` | XXXL, no time, the Draft row | "Pick a / draft time" wraps at the space, right-aligned; nothing truncated |
| `F4-no-time-17e-xxxl-{light,dark}-button.png` | XXXL, no time, the button | disabled button, then "Pick a future draft / time." at the caption size, two lines, nothing clipped |

The line is NEW copy (marked in `lib/game/renewalReview.ts`). The gate is `canSchedule({ repliesPending, draftDate, now })`;
`now` ticks every 15 s in the component, so a time that was future when picked and has since passed disables Schedule
and says why. A past pick is shown rather than silently ignored (the picker callback used to drop it).

**Observed, not touched:** at XXXL the Stakes row's value wraps as "$1,000. / 00 a / slot" (a break inside a number).
It is an existing row; listed for the Design Lead.

## P3 copy

`SLOT_CHECK_FAILED` is now "Couldn't check availability. Try again." (no em dash, no "Could not"); its test pin is updated.
`P3-slot-check-failed-17e-l-light.png`: the slot builder's check-failed state (the check reads a dead backend).

## Pins and mutations (Deno)

`tests-deno/w8-f3-f4.test.ts` (param → label for all four values, unknown / empty / array / wrong case / `__proto__` →
"Back", pathname → tab, the avatar's href, the source wiring; no time / past / exactly now / future / a future time that
has since passed / replies pending; the strings; the component pins). 12 mutations, all killed (restored, `git diff`
checked): label ignores the param; unknown does not fall back to Back; validation accepts anything; the header pushes a
bare `/profile`; Profile's label fixed to Home; `canSchedule` ignores the clock; the reason ignores a past time; the row
back to "Not set"; the line always the footnote; the clock never ticks; the picker drops a past pick again; the copy back
to the em-dash string.

## §4 Every tappable element

| Element | Where | Does | Evidence |
|---|---|---|---|
| Avatar | every tab header | opens Profile, remembering the tab | the F3 stills; tapped from League and Home |
| ‹ {tab} | Profile | `router.back()` to that tab | `F3-check-back-to-league.png` |
| Draft row, date and time pickers | Renewal review | sets the draft time | the F4 stills (a past and a future time set by hand) |
| Schedule the draft | Renewal review | enabled only for a future time; disabled with its reason otherwise | the F4 stills |
