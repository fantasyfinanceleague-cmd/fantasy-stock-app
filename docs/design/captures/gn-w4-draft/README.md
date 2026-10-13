# W4 Draft room + lobby on Game Night: gate captures (`feat/gn-w4-draft`)

Simulators "gn-draft 17e" (390×844 pt) and "gn-draft 17 Pro" (402×874 pt), iOS 27.0, Expo Go
SDK 54, status bar 9:41, Large text unless the row says otherwise. All DEV fixtures
(`apps/mobile/.env.local`, every fixture var written explicitly, Metro restarted with `--clear`
and the app reloaded per fixture). Every still exists in `-light` and `-dark` (theme set with
`simctl ui appearance`, shot with `simctl io screenshot`). Recordings live outside the repo in
`~/fantasy-stock-design-review/gn-w4-draft/`; their frame sheets are here.

**Gate pass 2 (the Design Lead's BLOCK, 5 items):** re-shot 01, 02, 03, 03b, 04, 05, 06, 07,
08, 13–16; new 07b, 08b, 10/10b at 16 managers, 13b, 19 (Light). The 12-manager stills and the
old self-contradicting lobby 13 are gone.

## Stills

| # | Files | State | Env (plus `GAME_SEAM=1`) |
|---|---|---|---|
| 1 | `01-on_clock-{17e,17pro}-*` | **Your turn**: the ring, "You're on the clock", "60-second picks" in the text column (P3); header names at 11pt read whole ("Alessandro", "Francesco") | `SHELL_FIXTURE=drafting`, `DRAFT_ROOM_FIXTURE=on_clock` |
| 1b, 1c | `01b-…search_roster-17e-*`, `01c-…log_queue-17e-*` | The search, your roster, the pick log, the queue (pass 1) | same, scrolled |
| 2 | `02-selected_draft_shows-17e-*` | **AAPL selected with the clock RUNNING** (the on-clock cell at 0:19 / 0:16): Draft offered | `on_clock_90` (new: a 90 s league clock, 88 s left, so a selection can be made by hand) |
| 3, 3b | `03-on_clock-xl-17e-*`, `03b-on_clock-xxxl-17e-*` | XL / XXXL: the ring over the title, the board scrolls sideways | `on_clock_90`, `accessibility-extra-large` / `-extra-extra-extra-large` |
| 4 | `04-after_pick-{17e,17pro}-*` | Someone else's turn after your pick (pick confirmation) | `after_pick` |
| 5 | `05-after_auto_pick-17e-*` | Your auto-pick | `after_auto_pick` |
| 6 | `06-theirs_first-17e-*` | Someone else's turn before yours | `theirs_first` |
| 7 | `07-last10-17e-*` | **Your** last 10 s | `last10` |
| 7b | `07b-theirs_last10-17e-*` | **Someone else's** last 10 s: Paolo's arc and clock in `loss`; no search (not your turn) | `theirs_last10` (new) |
| 8 | `08-auto_picking-17e-*` | Auto-picking: no ring, no search, no Draft | `auto_picking` |
| 8b | `08b-clock_ran_out-no_draft-17e-*` | **The P1 fix**: the same session as 02, 20 s later, after YOUR clock ran out: the search and Draft are gone, the selection with them | `on_clock_90`, waited out |
| 9 | `09-complete-{17e,17pro}-*` | Draft complete (pass 1) | `complete` |
| 10 | `10-stress_16-{17e,17pro}-*` | **16 managers** (max_teams), 20-character names: the board opens on your on-the-clock column (pick 31); the columns widen to the widest first name, so "Bartholomew" and "Robertino" read whole | `stress` (now 16 seats) |
| 10b | `10b-stress_16-far_end-{17e,17pro}-*` | The board scrolled to its far end (Evangeline … Ferdinando, columns 13–16) | same, swiped |
| 11, 12 | `11-loading-17e-*`, `12-failed-17e-*` | Loading skeleton; failed + Try again (pass 1) | `loading`, `failed` |
| 13 | `13-lobby-room_open_16-{17e,17pro}-*` | **Lobby, room open, 16 managers**: "Draft order set Tue 3:43 PM ET" = the 4:43 PM draft − 1h; "You pick 2nd, then 31st, 34th…"; the order rows are **ManagerRow itself** | `SHELL_FIXTURE=leagues`, `DRAFT_ROOM_FIXTURE=stress`, `DRAFT_START_FIXTURE=room_open` (no `HOME_FIXTURE`: the lobby reads the seam's order); pill → Serie A Traders |
| 13b | `13b-lobby-room_open_16-end-{17e,17pro}-*` | The end of the 16-row order, then the queue | same, scrolled |
| 14 | `14-lobby-scheduled-17e-*` | **Scheduled**, ≥ 4 managers, order not set yet ("Draft order · waiting"; the "6 of 4 managers" caption it showed is now hidden) | `DRAFT_START_FIXTURE=scheduled` |
| 14 | `14-lobby-waiting_scheduled-17e-*` | Scheduled, **3 of 4 managers** (pass 1; coherent) | `HOME_FIXTURE=pre_draft_waiting`, `scheduled` |
| 15 | `15-lobby-at_risk-commissioner-17e-*` | **At risk**: "8 playoff teams, but 7 teams are in" with the stepper at **8**; the order not set (the room hasn't opened) | `DRAFT_START_FIXTURE=at_risk` |
| 16 | `16-lobby-no_date-commissioner-17e-*` | **No draft time**: no order line (the order isn't set) | `DRAFT_START_FIXTURE=no_date` |
| 17 | `17-draft_time_picker-17e-*` | The draft-time picker (pass 1) | `HOME_FIXTURE=pre_draft`, `no_date` |
| 21 | `21-queue-moved_save_appears-17e-*` | The queue after a move: Save appears (pass 1) | `on_clock` |

**The lobby's 20pt gaps** (countdown card ↔ draft order ↔ queue ↔ settings) are `league.tsx`'s
`BarsRefresh` `gap: space[6]`, not this branch's files; asked of the Orchestrator (the League
worker owns `league.tsx`). `DraftLobby`'s own blocks are 16.

## Recordings (frame sheets here)

| File | Shows |
|---|---|
| `18-flash-17e-{light,dark}.mov` · `-frames.png` | The your-turn flash, both themes (pass 1) |
| `19-reduce-motion-17e-light.mov` · `-frames.png` | **Reduce Motion, Light** (new): straight into the rest state (one change, no flash); the chime logged once |
| `19-reduce-motion-17e-dark.mov` · `-frames.png` | Reduce Motion, Dark (pass 1) |
| `20-tap-through-room-17e-dark.mov` | Search → AAPL → Draft appears → Draft → queue ↓ → Save appears → Save (pass 1) |
| `20b-tap-through-complete-17e-dark.mov` | Draft complete → "See your Week 1 matchup" → Matchup (pass 1) |

## What the server does (item 2, read-only: `validate-and-record-pick`, `_shared/auto-pick.ts`)

- **Auto-picking** (past the deadline): the room has already asked the server to auto-pick
  (`action: 'auto_pick'`, 0–3 s jitter; the sweep cron backs it). A manual pick is NOT refused by
  any clock check: the manual path prices, gates (`gatePick`: turn, rules, feasibility) and
  inserts; it lands only if it commits before the auto-pick, and the loser of that race gets
  `pick_conflict` (the unique `(league_id, pick_number)` index).
- **Stalled**: the auto-pick walked the whole pool and nothing passed the gate; the ruled card
  says "No stock left fits …'s next slot" and the clock is stopped. A manual pick runs the same
  `gatePick`, so it is refused for the same reason, except the documented residual (a stock
  whose live price is in its bracket while its cache is > 10% outside).
- **So the room offers search + Draft only on your RUNNING clock** (`draftOffered(kind)`, kind
  `yours`): not while auto-picking (a race against the auto-pick the room itself requested, and
  "a missed turn is always auto-picked"), not while stalled (the ruled copy). A selection left
  when the clock ends is dropped.

## Measurements (from pixels, 3× → pt)

- **Accent by area** (`accent-split.txt`, all 66 stills): rest **≤ 2.33%** (XL on the clock);
  none over 5%. (The split files the your-turn card's 2pt top/bottom edges under "primary".)
- **GOOGL / CMCSA at 16 managers**: the columns widen to the widest first name
  (`headerNameWidth`: "Bartholomew" ≈ 74pt at 11pt), so the tile is ≈ 70pt and both tickers draw at
  their **full 13pt** (`10`): no longer at the 11pt floor. At six across on the 17e (55pt tiles)
  GOOGL shrinks toward the floor as in pass 1.
- **Header names**: 11pt, sized in code (`headerNamePt`, never under 11, then the ellipsis;
  `adjustsFontSizeToFit` can go under `minimumFontScale`, so it isn't used).
- **Block rhythm** (room, pass 1): card → card 16pt; tile → tile 4pt.

## §2 Reference check (board `#call-game-night`, "Draft room, on the clock", A amended)

| Reference | Trait | Present? | Evidence |
|---|---|---|---|
| Sleeper (Dark), the draft board | One column per manager under an avatar + name | Present | `01`, `10` |
| Sleeper | The on-the-clock cell dark and singled out | Present (navy `clockCell`, cyan ring, the clock in it; navy in Light too) | `01-*-light` |
| Sleeper | Colour-FILLED tiles by position | **Absent by ruling** ("not a carbon copy of Sleeper"): a 3pt category line + code | `01`, measured 3pt |
| ESPN (the Broadcast touch) | The panel's coloured bottom edge | Present (the category line) | `01` |
| Sleeper | A "YOUR TURN" pill | Absent: the board draws the ring + "You're on the clock" (kept; no new words) | `01` |
| Yahoo (Light) | Your turn as a filled pill with white ink, on white | Partly: the filled teal + white ink is the **flash**; at rest the card is the accent tint (§9C) | `18-flash-17e-light-frames` 2.7 s / 3.2 s |
| Squint test vs Sleeper | The your-turn card is the loudest thing; the board second | Holds | `01`, `03` |

The Yahoo rest state (filled at rest) is a trait the board did not draw for Game Night; listed for
Giorgio, not added.

## §3 Self-critique (Hallmark, 1–5)

| Philosophy | Hierarchy | Execution | Specificity | Earned | Variety |
|---|---|---|---|---|---|
| 4 | 4 | 4 | 4 | 4 | 4 |

Philosophy: Game Night's draft as the board drew it, the line not the fill. Hierarchy: the clock
card, then the board, then search; XL/XXXL keep it (the card's lines are capped under its
headline). Execution: one tile height, names whole at 16, edges single. Specificity: the app's
categories, real states from the server's own rules (item 2). Earned: nothing decorative; the
slab marks you. Variety: the same rimmed cards, `youTint` slab, ManagerRow and pills as Home and
Matchup. Nothing under 3.

## §4 Tappables (element → what it does; the recordings are in `~/fantasy-stock-design-review/gn-w4-draft/`)

| Element | What it does | Evidence |
|---|---|---|
| Search field (room) | Keyboard + results; only on your running clock | `20`, `02`, `08b` |
| A result row | Selects it; Draft appears | `20`, `02` |
| Draft | Sends the pick ("Sending…" while waiting), the room re-reads | `20` |
| Queue ↑ / ↓ | Moves the stock; hidden where it can't move | `20`, `01c` |
| Queue × | Removes the stock (the same Pressable kind; not in a recording) | `01c` |
| Queue search + result | Adds to the queue | `01c` (not recorded) |
| Save queue | Saves; only when there is something to save | `20`, `21` |
| Try again (room failed) | Re-reads the room | `12` (not recorded) |
| See your Week 1 matchup | Opens Matchup (All matchups on a bye) | `20b` |
| Draft-time picker × / Set draft time | Closes / commits | `17` (pass 1) |
| Blockers: Move forward, Invite, stepper −/+, Share invite code, Pick a new time | Existing actions (unchanged); "+" disabled at the cap, "Pick a new time" disabled with its reason | `15` (not recorded) |
| League pill, avatar, tab bar, League settings row | Shell / `league.tsx` (not this branch) | — |
| Board tiles, headers, avatars, clock card | Not tappable; nothing on them looks tappable | — |

Hidden when they can't act: Draft before a selection; search + Draft off your running clock; ↑ on
the first queue row, ↓ on the last; Save queue when clean; "Latest picks" when empty; the managers
progress once the minimum is met; "Draft order set …" with no draft time.

## For the Design Lead

- **"Draft order set …" + no draft time IS reachable**: the order only moves forward (a DB
  trigger refuses any step back), and a postponement at the `start` stage clears `draft_date`
  after the room opened. The line now hides without a draft time (`orderSetLine`); the order stays.
- **New, found in this pass:** "6 of 4 managers" in the order-waiting card once the league had
  enough managers (reachable: scheduled, ≥ 4, before T−1h). Hidden (`managersProgressShown`).
- First names at six across on the 17e can still ellipsize for long ones; at 16 the columns
  widen, so none do.
