# Run it back switch-flip blockers: device captures (`fix/rib-gs10-gs11`)

iPhone 17e (8CDB3007…), Expo Go SDK 54, 2026-10-11, default text size. All DEV fixtures,
nothing from prod. Spec: docs/design/reviews/ux-audit-2026-10.md, "Build spec · Run it back
switch-flip blockers" (GS-10, GS-11), plus GS-14 (Design Lead ruling, 2026-10-11; board frame
"1b · Member who said I'm out" on `design/rib-out-state`).

Base env for every row: `EXPO_PUBLIC_SHELL_FIXTURE=leagues-renewal`, `EXPO_PUBLIC_RUN_IT_BACK=1`
(the kill switch stays off by default), `EXPO_PUBLIC_GAME_SEAM=1` (the seam answers
`respond_to_renewal`, and its answer moves the fixture caller, so a flip can be captured).
`RENEWAL_FIXTURE` picks who you are; `HOME_FIXTURE` sets Home's phase.

| File | Shows | `RENEWAL_FIXTURE` / `HOME_FIXTURE` | Navigation |
|---|---|---|---|
| `gs10-member-list-{light,dark}` | GS-10: a member who's in. "You're running back" with Change; no commissioner draft card; the board's line under the list | `in` / `pre_draft` | Summer Cup (Season 2) → League |
| `gs10-change-sheet-{light,dark}` | GS-10: Change opens the ask itself (its copy verbatim, Paolo M.'s real name), "I'm in" selected (border + check) | same | League → Change |
| `gs10-member-list-draft-set-light` | GS-10: the draft is set (roster `draft_date` set, everyone replied): the banner stays, no Change, no "until then" line | `in-set` / `pre_draft` | Season 2 → League |
| `gs11-home-reply-pending-{light,dark}` | GS-11: the commissioner's Season 2 Home with one reply pending. No "No draft time yet", no Set draft time; Build your queue, Members and the invite code stay | `commissioner` / `pre_draft` | Home (Season 2) |
| `gs11-home-all-replied-light` | GS-11: every reply in. The draft block and Set draft time are back | `commissioner-ready` / `pre_draft` | Home (Season 2) |
| `gs14-home-out-{light,dark}` | GS-14: an out player on the finished league's Home. Chip "You're out", "I'm out" checked, "I'm in" one tap away | `out` / `complete` | Summer Cup (finished) → Home |
| `gs14-league-out-light` | GS-14 / board frame 1: the same card on the finished league's League tab | same | → League |
| `gs14-after-im-in-light` | GS-14: after tapping "I'm in" on Home, Season 2's member list (League tab) | same | Home → I'm in |

Not captured: a refused answer (the per-reason lines in place under the choice). The seam
always answers `replied`; the four lines are pinned by `run-it-back-switch-blockers.test.ts`.

## For the Design Lead

- **The selected answer's border is the text colour**, so on the filled "I'm in" (Light: navy
  on navy) only the check marks it; on the outlined "I'm out" the 2 pt border shows, as drawn.
- **The pending ask on Home still has no "Reply" chip** (the board's frame 1 has one). Only
  the out state's chip ("You're out") was in scope.
- **The commissioner's counts card stays on Home once every reply is in** ("0 no reply yet",
  no "Waiting on" line), above the returned draft block. Unchanged by this branch.
- **The member list has no "Season 2 / Who's running back" heading** (the board's
  RibMemberList has one under the banner). Unchanged by this branch.
