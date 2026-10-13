# W4 Draft room + lobby on Game Night: gate captures (`feat/gn-w4-draft`)

Simulators "gn-draft 17e" (390×844 pt) and "gn-draft 17 Pro" (402×874 pt), iOS 27.0, Expo Go
SDK 54, status bar 9:41, Large text unless the row says otherwise. All DEV fixtures
(`apps/mobile/.env.local`, every fixture var written explicitly, Metro restarted with `--clear`
and the app reloaded per fixture). Every still exists in `-light` and `-dark` (theme set with
`simctl ui appearance`, shot with `simctl io screenshot`; the panel's own screenshots were stale
under load and were not used). Taps through the simulator panel (17e and 17 Pro).

**Recordings** live outside the repo in `~/fantasy-stock-design-review/gn-w4-draft/`; their frame
sheets are here.

**Host note:** the Mac ran at load averages of 90–550 for much of the session (other workers'
simulators); the Orchestrator shut five idle ones. Nothing here was shot while a frame was still
catching up: every still was checked by eye before it was kept.

## Stills

| # | Files | State | Env (plus `GAME_SEAM=1`) |
|---|---|---|---|
| 1 | `01-on_clock-{17e,17pro}-*` | **Your turn**: the ring running down, "You're on the clock", your column on its slab, the navy on-the-clock cell | `SHELL_FIXTURE=drafting`, `DRAFT_ROOM_FIXTURE=on_clock` |
| 1b | `01b-on_clock-search_roster-17e-*` | The search, your roster in context (TeamSoFarGrid: `you` fill + `onYou`, `sunken` empties), the pick log | same, scrolled |
| 1c | `01c-on_clock-log_queue-17e-*` | The pick log (tickers aligned at 64pt) and the queue: no up on the first row, no down on the last, **no Save until something changes** | same, scrolled |
| 2 | `02-selected_draft_shows-17e-*` | A stock selected: **Draft appears** (the one primary, full-width pill); it isn't drawn before (it was a disabled pill with no reason) | same, AAPL selected |
| 3 | `03-on_clock-xl-17e-*` | **XL**: the ring stacks over the title; "Round 2 of 6 ·" keeps its dot; the board scrolls sideways rather than clip | `on_clock`, `accessibility-extra-large` |
| 3b | `03b-on_clock-xxxl-17e-*` | **XXXL** sanity | `accessibility-extra-extra-extra-large` |
| 4 | `04-after_pick-{17e,17pro}-*` | **Someone else's turn after your pick** (pick confirmation): "Paolo M. is up", "You took AAPL · you're up in 2 picks" in `youText`, AAPL in your column and roster (2 of 6) | `after_pick` |
| 5 | `05-after_auto_pick-17e-*` | **Your auto-pick**: "Auto-picked AAPL for you · you're up in 2 picks" | `after_auto_pick` (new) |
| 6 | `06-theirs_first-17e-*` | **Someone else's turn, before yours**: "1 pick until you"; "Latest picks" hidden while empty | `theirs_first` (new) |
| 7 | `07-last10-17e-*` | **The last 10 s**: the arc and the clock in `loss` | `last10` (new) |
| 8 | `08-auto_picking-17e-*` | **Auto-picking**: no ring (B-4: no empty gap), the navy cell with no clock | `auto_picking` (new) |
| 9 | `09-complete-{17e,17pro}-*` | **Draft complete**: rows divided by space (the hairlines went), "See your Week 1 matchup" the one primary | `complete` |
| 10 | `10-stress_12-{17e,17pro}-*` | **Stress: 12 managers, 20-character names**; the board keeps its tile floor and scrolls sideways, opened on your on-the-clock column (pick 23 of 72) | `stress` (new) |
| 10b | `10b-stress_12-scrolled_right-17e-*` | The same board scrolled to its far end (NRG, HLT, RTL codes) | same, swiped |
| 11 | `11-loading-17e-*` | **Loading**: the skeleton in the room's shape (ring + two lines; six columns of tiles) | `loading` (new: the clock read never answers) |
| 12 | `12-failed-17e-*` | **Failed**: "The draft room didn't load." + Try again (secondary pill, re-reads) | `failed` (new: the clock read errors) |
| 13 | `13-lobby-room_open-17e-*` | **Lobby, room open**: the countdown card; the order as Standings-style tiles (your row tinted + ringed, bold name); your queue | `SHELL_FIXTURE=leagues`, `HOME_FIXTURE=pre_draft`, `DRAFT_START_FIXTURE=room_open`; pill → Serie A Traders |
| 14 | `14-lobby-waiting_scheduled-17e-*` | **Lobby, scheduled, order waiting** (3 of 4 managers) | `pre_draft_waiting`, `scheduled` |
| 15 | `15-lobby-at_risk-commissioner-17e-*` | **Lobby, commissioner, at risk**: the blockers card (one primary: Move forward with 7), then "Draft room opens in" | `pre_draft`, `at_risk` |
| 16 | `16-lobby-no_date-commissioner-17e-*` | **Lobby, no draft time**: "Set a draft time in League settings." | `pre_draft`, `no_date` |
| 17 | `17-draft_time_picker-17e-*` | **The draft-time picker** (behaviour kept): 15-minute steps, × closes, "Set draft time" commits | `no_date`, Home → Set draft time |
| 21 | `21-queue-moved_save_appears-17e-*` | The queue after a move: **Save queue appears** (secondary pill) with "Not saved yet." | `on_clock`, CRM moved down |

The lobby's "Draft order set Thu …" vs the countdown's "Tue …" is two independent fixtures
(`HOME_FIXTURE` and `DRAFT_START_FIXTURE`) disagreeing, not the product.

## Recordings (frame sheets here, files in `~/fantasy-stock-design-review/gn-w4-draft/`)

| File | Shows |
|---|---|
| `18-flash-17e-light.mov` · `18-flash-17e-light-frames.png` | **The your-turn flash, Light**: the turn arrives after the first read (`turn_arrives`); two flashes (full teal at 2.7 s and 3.2 s, the text inked white on each rise), then the accent-tint rest with its ring running down. Metro log: `[your-turn] chime playing (0.42 s file)` |
| `18-flash-17e-dark.mov` · `18-flash-17e-dark-frames.png` | **Dark**: "Auto-picking…" (2.0 s) → two cyan flashes with navy ink (4.7 s, 5.2 s) → rest. Chime logged once |
| `19-reduce-motion-17e-dark.mov` · `-frames.png` | **Reduce Motion**: the turn arrives straight into the rest state (one change, no flash); the chime still logged |
| `20-tap-through-room-17e-dark.mov` | Tap-through: League tab → the search → AP → AAPL → **Draft appears** → Draft (sent; the room re-reads) → the queue: CRM ↓ → **Save queue appears** → Save |
| `20b-tap-through-complete-17e-dark.mov` | Draft complete → "See your Week 1 matchup" → Matchup |

Not a product state: after Save, the pill stays in the capture because the seam's queue fixture is
static (the re-read returns the old order). In a real league the re-read returns the saved order.

## Measurements (from pixels, 3× → pt)

- **Accent by area** (`accent-split.txt`, every still; `app_accent_area.py`'s colour rule, split
  into the primary pill and the rest): **rest ≤ 2.22%** everywhere (highest: XL on the clock,
  where the title and ring are larger); no frame over 5%. The primary, where there is one:
  Draft complete 4.90–5.03%, the picker's "Set draft time" 5.18%. (My split also files the
  your-turn card's 2pt top/bottom edges as "primary", which is the 0.40% on frames with no
  pill.) The official tool's totals: on the clock 1.5%; Draft complete 5.28% (5.03% of it the
  one primary); at-risk lobby 3.76%.
- **Block rhythm** (17e, Light and Dark identical): clock card → the board's first glyph (the
  avatars) **26.0pt**; tile → tile **4.0pt** both ways; the last tile → the search card
  **18.0pt** (the 16pt gap + the column's 2pt pad); card → card **16.0pt** (the board frame's
  Body gap, `gap={16}`).
- **The tile's ticker**: a six-across 17e tile leaves 43pt of text width; GOOGL drew at 13pt
  as ≈47pt (clipped "GO…" before the fix), so it shrinks to fit at ≥ 0.85 (11.05pt, ≈40pt).
  `GOOGL` and `CMCSA` draw whole in `01`, `10`. iOS can shrink past `minimumFontScale` when
  text still doesn't fit (gameNight.ts's note on `stackedNameCap`); the tile floor
  (`TILE_MIN` 54) keeps five letters inside 11pt, and a narrower board scrolls instead.

## For the Design Lead

- **First names truncate at 20 characters** on the board's header ("Barthol…", "Robert…" in
  `10`): the column is a tile wide and the name is 12pt with an 11pt floor. The board frame
  draws first names; initials would fit. Your call.
- **The block gap is the board frame's 16** (Body `gap={16}`), not calm Home's 24.
- **"YOUR TURN · 0:42"** from the brief isn't copy anywhere; the room keeps the existing
  "You're on the clock" with the clock in the ring. No new copy was added.
- **The tile no longer shows the old "Auto" tag** (no room in a §9C tile); an auto-pick is
  said in VoiceOver ("auto-picked") and in the pick log's words.
