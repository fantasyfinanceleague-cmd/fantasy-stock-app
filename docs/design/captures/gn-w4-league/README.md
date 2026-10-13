# gn-w4-league captures (W4 League on Game Night)

Gate evidence for **League** on Game Night (`feat/gn-w4-league`): Standings, Schedule,
Playoffs and History, the renewal (Run it back) surfaces, League settings and the empty,
loading and failed states. Every state is shot in **both themes** (`-light` / `-dark`).

## How these were captured

The stills are **cold launches** straight into each state (headless: no tap between launch and
shot), so they're reproducible. The tap-through recordings, the in-sheet flows and the four
mid-scroll stills were made with device access (Giorgio's grant for this session's panel),
tapping in the simulator.
- Simulators: "W4 League 17e" (390×844 pt) and "W4 League 17 Pro" (402×874 pt), iOS 27.0,
  Expo Go, Metro on port 8099, status bar 9:41.
- Appearance and text size come from `simctl ui … appearance` / `content_size` (Large =
  `large`; XL = `accessibility-extra-large`; XXXL = `extra-extra-extra-large`).
- Expo Go is opened with `--initialUrl` (no "Open in Expo Go?" prompt). The DEV-only capture
  knobs open the state without a tap (`lib/shell/fixtureRoute.ts`, `lib/shell/devFixture.ts`;
  all `__DEV__`-gated and pinned by `league-game-night.test.ts`):
  - `EXPO_PUBLIC_SHELL_INITIAL_ROUTE`: the route (`/league?segment=history`, `/league-settings?leagueId=…`);
  - `EXPO_PUBLIC_SHELL_ACTIVE_LEAGUE`: the fixture league (`fx-scudetto` by default, `fx-summer`, `fx-seriea`, `fixture-season-2`);
  - `EXPO_PUBLIC_SHELL_SCROLL_END=1`: scrolls once to the bottom (the `-bottom` frames).
- The League states come from `EXPO_PUBLIC_LEAGUE_FIXTURE` (`lib/game/leagueFixture.ts`):
  `twelve`, `sixteen`, `loading`, `error`, `history_error`, `bracket_error`, `playoffs_live`.
  Unset, League reads the SAME Home fixture Home does (`EXPO_PUBLIC_HOME_FIXTURE`, default
  `scored`), so Home's Standings card and League's full standings always agree.
- Supabase points at a dead local port (`http://127.0.0.1:9`): every read on these screens
  is a fixture, and nothing in a capture run can reach the project.
- A shot is taken once two consecutive screenshots match (settled). The loading skeleton
  and the live chip animate, so those frames are the last poll ("unsettled" in the log).

## Frames

| State | Frames | Shows |
|---|---|---|
| `standings-6` | 17e-l-dark, 17e-l-light, 17e-xl-dark, 17e-xl-light, 17e-xxxl-dark, 17e-xxxl-light, 17pro-l-dark, 17pro-l-light | Standings in full, 6 managers, week 6 scored (`HOME_FIXTURE=scored`, Home's own fixture). Column head "# · Through Week 5 · W–L · Season gain"; your row (2nd) tinted and ringed; movement up/down/held |
| `standings-12-stress` | 17e-l-dark, 17e-l-light, 17e-xl-dark, 17e-xl-light, 17e-xxxl-light, 17pro-l-dark, 17pro-l-light, 17pro-xl-dark | Stress (`LEAGUE_FIXTURE=twelve`): 12 managers, 20-character names, ≥ $1M gains and losses, tied records, your row in the MIDDLE (7th). The list stacks; at XL your row is pinned at the bottom |
| `standings-16-you-last` | 17e-l-dark, 17e-l-light | 16 managers (`sixteen`), your row LAST: pinned at the bottom (UX rule 7), no shadow, the rim as its edge |
| `standings-16-scrolled-to-you` | 17e-l-dark, 17e-l-light | The same, scrolled to the end: your row in the list, the pinned copy gone |
| `standings-16-mid-scroll-pinned` | 17e-l-dark, 17e-l-light | Tapped/swiped (device access): mid-scroll, the pinned copy over the list |
| `standings-16-your-row-in-view-unpinned` | 17e-l-dark, 17e-l-light | Swiped on: your row arrives, the pinned copy goes (no duplicate) |
| `standings-week1-no-label` | 17e-l-dark, 17e-l-light | Week 1, before the first close (`week1_monday`): "Through Week 0" hidden, movement blank (no last week), $0.00 flat |
| `standings-in-playoffs` | 17e-l-dark, 17e-l-light | A league in its playoffs (`playoffs_live`): "Through Week 14" on one line beside W–L and Season gain |
| `standings-reduce-motion` | 17e-l-dark, 17e-l-light | Reduce Motion on: League has no entrance motion of its own, so the frame equals `standings-6` |
| `final-standings` | 17e-l-dark, 17e-l-light, 17e-xl-light, 17pro-l-dark | Summer Cup, season over (commissioner): Run it back (the one primary), "Final standings · After the playoffs", medal discs, Champion / Runner-up, no movement |
| `schedule` | 17e-l-dark, 17e-l-light, 17e-xl-dark, 17e-xl-light, 17pro-l-dark, 17pro-l-light | Schedule: tiles, the opponent's avatar, the result letter by outcome and the score by sign, "Next"; at XL every line stops at the score's 1.3× |
| `schedule-live-week` | 17e-l-dark, 17e-l-light | Schedule mid-week (`live_open`): the §9C live chip on Week 6 |
| `history` | 17e-l-dark, 17e-l-light, 17e-xl-dark, 17e-xl-light | History (a current season): Season 2 "Not finished yet"; Season 1 ordered by the playoffs with medals and tags, "After the playoffs" |
| `history-final` | 17e-l-dark, 17e-l-light | History on the finished Summer Cup |
| `history-final-bottom` | 17e-l-dark, 17e-l-light | The same, scrolled to the end (all six rows) |
| `playoffs-final` | 17e-l-dark, 17e-l-light, 17e-xl-dark | Playoffs, finished (GS-6): ONE heading per round; the byes are rows of the Wild card with "Advances to the Semifinals"; your side shaded; the winner bold, the loser in text2 |
| `playoffs-final-bottom-champion` | 17e-l-dark, 17e-l-light, 17e-xl-dark | Scrolled to the end (GS-7): under the Final, the trophy and "Roberto B. · Champion" as ManagerRow's your-row tile (surface + tint + the 1.5pt ring; DL: "the ring, yes"). Game cards tightened toward the board's ≈64pt |
| `playoffs-live` | 17e-l-dark, 17e-l-light | Playoffs in progress (`playoffs_live`): the Wild card scored, the Semifinals unscored, no champion row |
| `loading` | 17e-l-dark, 17e-l-light | The standings read in flight (`loading`): the tiles' skeleton under the tabs |
| `error` | 17e-l-dark, 17e-l-light | The standings read failed (`error`): "Couldn't load the standings · Pull down to try again." (the pull now re-reads) |
| `history-failed` | 17e-l-dark, 17e-l-light | History's read failed (`history_error`): "Your league's history didn't load." + Try again (Giorgio, 2026-10-13) |
| `playoffs-failed` | 17e-l-dark, 17e-l-light | The bracket's read failed (`bracket_error`): "The bracket didn't load." + Try again (Giorgio, 2026-10-13) |
| `no-leagues` | 17e-l-dark, 17e-l-light | No leagues (`SHELL_FIXTURE=no-leagues`): Home's own empty state, word for word; Create a league / Join with a code |
| `lobby-wrapper` | 17e-l-dark, 17e-l-light | Pre-draft (`fx-seriea`): League's lobby frame on the 16pt block gap (Draft gate item 4) around the Draft worker's components (merged #259: ManagerRow order rows) |
| `renewal-roster-commissioner` | 17e-l-dark, 17e-l-light | Season 2, commissioner, replies pending: champion banner, "Who's running back", Nudge again · Remove, the draft card disabled with its reason |
| `renewal-review-gs13` | 17e-l-dark, 17e-l-light | Season 2 review (GS-13): "Teams" sub-line under the label, full width |
| `renewal-ask-on-season1` | 17e-l-dark, 17e-l-light | The member's ask on the finished Season 1 (P3): I'm out / I'm in as two equal-width buttons |
| `renewal-member-list` | 17e-l-dark, 17e-l-light | Season 2, a member who's in: "You're running back · Change", the list, the member line |
| `settings-commissioner-top` | 17e-l-dark, 17e-l-light | League settings, commissioner, mid-season: locked, with the reason; rows divided by space |
| `settings-commissioner-locked-no-share` | 17e-l-dark, 17e-l-light | Commissioner, teams LOCKED (mid-season), scrolled to League info: the invite code in plain text, **no Share** (Giorgio, B, #call-share-locked); the Commissioner row without a chevron; Leave league disabled with its reason |
| `settings-commissioner-open-share-season2` | 17e-l-dark, 17e-l-light | Commissioner, teams OPEN (the renewed Season 2, before its draft): the same InviteRow **with Share**; Commissioner → (transfer allowed) |
| `settings-member-locked-no-share` | 17e-l-dark, 17e-l-light | A member, LOCKED (mid-season): the code, no Share; Leave league disabled with its reason |
| `settings-member-open-share` | 17e-l-dark, 17e-l-light | A member, OPEN (Serie A before its draft order is set): the code with Share; Leave league enabled with its window |
| `create-league-shared-rows` | 17e-l-dark, 17e-l-light | Create league (gate 6's screen, NOT edited): the shared SetupRows now divide by space (RowDivider is space) |
| `create-league-shared-rows-bottom` | 17e-l-dark, 17e-l-light | The same, scrolled to the end |

**Recordings** (device access; the `.mov`s are in `~/fantasy-stock-design-review/gn-w4-league/`, their de-duplicated frame sheets here):

| Frame sheet | Flow (both themes: `-light` / `-dark`) |
|---|---|
| `rec-league-tap-through-{light,dark}-frames.png` | Standings → Schedule → History → Standings, pull to refresh (the bars; every read re-runs), League settings → Cancel. The tabs hold still as the selection moves |
| `rec-run-it-back-and-nudge-{light,dark}-frames.png` | Summer Cup as commissioner: Playoffs, scroll to the champion row, Run it back → Season 2's "Who's running back", Nudge again · Remove → the native sheet → Nudge again |
| `rec-change-answer-sheet-{light,dark}-frames.png` | A member who's in: Change → the ask sheet (two equal-width buttons, the answer checked) → × (dark) / the current answer closes it (light) |
| `rec-leave-sheet-stay-{light,dark}-frames.png` | A member after the season: Leave league → the sheet (Leave league red, Stay a button) → Stay; Share → the iOS share sheet (light) |
| `rec-transfer-sheet-{light,dark}-frames.png` | The commissioner after the season: Commissioner → "Make someone else commissioner" → pick (Hand over enables) → Cancel |
| `rec-pinned-row-scroll-{light,dark}-frames.png` | 16 managers: scroll; your row pinned at the bottom until it arrives, then the copy goes |

## Measurements and checks

### Measured from pixels (3× → pt)

- **Manager tiles:** every tile 56.0pt tall and **6.0pt apart** (`standings-6-17e-l-light`,
  measured down the tile column), the §9C ManagerRow spec; no rule line between tiles.
- **Stress (`standings-12-stress-*`):** at Large and XL the list stacks (name over record and
  gain); every 20-character name is whole on one line, every ≥ $1M gain whole on its line.
  **The open P3 holds on League:** a stacked row's name, record and tag are capped at the
  gain's fitted size (`stackedRowTextCap`, ≤ 1.3×), so no figure or line outgrows the row's
  gain at XL; League has no shrink-to-fit number (the list stacks first).
- **Accent by area** (`app_accent_area.py`, every frame): see `accent-area.txt`. Two frames read
  5.16%, `settings-commissioner-open-share-season2-*`: ALL of it is the screen's one primary
  ("Save changes", the full-width pill), measured apart (rest 0.00%), so they pass §5 as
  amended. Every other frame is ≤ 4.86% WITH its primary (Run it back) in it; ≤ 0.61% where
  there is no primary.

### §5 mechanical checks

| Check | Result |
|---|---|
| Tokens only | `grep -E "#[0-9A-Fa-f]{3,8}\b\|rgba\("` over the changed components: none |
| Uppercase in the string | `grep textTransform` over the changed files: none (the column head, the tags and the tab labels uppercase in the string or through `Text`'s JS uppercase) |
| Shrink-to-fit floor | no `adjustsFontSizeToFit` left on League (a guard pins it); none can shrink under 11pt |
| Every fill has its own ink | your row: `youTint` over `surface`, text in `text` (pairs exist); the live chip: `accentTint` + `liveText`; Run it back / I'm in: `primaryBg` + `primaryFg`; medal discs: `onMedal` |
| No rule lines between rows | Standings, Schedule, History, Playoffs, renewal rows, settings rows (RowDivider is now space): none |
| Depth | Dark: tiles are `surface` on `bg`, cards with the rim, the pinned row has the rim and NO shadow; Light: white tiles on the tinted page |
| Numbers | gains `score.sm` (15/800, tabular), rank `score.md`; nothing condensed |
| The standout stays loudest | per row, the gain: stacked names/records/tags capped at its fitted size; Schedule and bracket rows capped at the score's 1.3×; the line under the list 1.6× (19.2pt < 19.5pt); League's settings row 1.5× (= 19.5pt). Section headings ("Final standings", "Season 1") keep their own ramp |
| Wrapping at XL | names wrap whole words onto two lines in one-line rows, never a letter per line; "Through Week 14" sits on one line (the label starts over the avatar column) |
| Labels that can read as nonsense | "Through Week 0" is hidden (`standings-week1-no-label`) |
| 11pt floor, 44pt targets | tabs: 44pt boxes (`minWidth`/`minHeight`), never shifting with the selection; Try again / Share `sm` buttons are 44pt; settings rows ≥ 44pt |

### Reference check (League › Standings, in full; board `#call-game-night`, direction A)

| Borrowed trait (board note) | Reference | Present? | Evidence |
|---|---|---|---|
| Rows divided by space and surface, not grid lines | s1 (Dark) | present | tiles 6.0pt apart, measured |
| Your row tinted and ringed | board A frame | present | `standings-6-*`: `youTint` + 1.5pt `you` ring, name bold, no "(you)" |
| Movement as a drawn chevron + number | board A frame | present | "^1" / "v1" in gain/loss; en dash for held; blank when last week is unknown (Week 1) |
| Avatars on every row | board A frame | present | 32pt discs, yours in `you` |
| White cards, right-aligned tabular numbers | s5 (Light) | present | `standings-6-17e-l-light`: W–L and gain right-aligned under their heads |
| Column head "# · Through Week N · W–L · Season gain" | board A frame | present | normal-width caps (not the Expanded face) so "SEASON GAIN" fits its column |
| Sections as text tabs with an accent underline | board A frame (`.dr-seg`) | present | `SegmentTabs`, the RangePills look; scroll sideways at XL |
| Schedule, Playoffs, History | not drawn in Game Night on the board | built on the same tiles and cards | listed for Giorgio, not invented: no new elements beyond the tiles |

### Every tappable element (the §4 table)

| Element | Where | What it does | Evidence |
|---|---|---|---|
| Standings / Schedule / Playoffs / History | League in season | switches the section; the selected tab doesn't re-fire | `rec-league-tap-through-*` |
| Pull to refresh | every League state | re-reads standings, schedule, history, the bracket and the league list (reloadKey) | `rec-league-tap-through-dark` |
| League settings row | season, lobby | opens League settings | `rec-league-tap-through-*` |
| Cancel | League settings | closes it | `rec-league-tap-through-*` |
| Run it back | finished season, commissioner | starts Season 2 and lands on its roster | `rec-run-it-back-and-nudge-*` |
| Nudge again · Remove | non-reply rows (commissioner) | the native sheet: nudge / remove | `rec-run-it-back-and-nudge-*` |
| I'm in / I'm out | the member's ask (League and the Change sheet) | answers (respond_to_renewal); the current answer closes the sheet | `renewal-ask-on-season1-*`, `rec-change-answer-sheet-light` |
| Change, × | "You're running back" | opens / closes the ask sheet | `rec-change-answer-sheet-*` |
| Leave league / Stay | member settings, after the season | opens the leave sheet / closes it | `rec-leave-sheet-stay-*` |
| Leave league (disabled) | commissioner; mid-season member | not tappable, reason beside it ("Make someone else commissioner first.", "Teams are locked in…") | `settings-commissioner-locked-no-share-*`, `settings-member-locked-no-share-*` |
| Commissioner row | commissioner, after the season | opens the transfer sheet (chevron); mid-season it has no chevron and isn't pressable | `rec-transfer-sheet-*` |
| A candidate / Hand over / Cancel | transfer sheet | picks / hands over (disabled until a pick) / closes | `rec-transfer-sheet-*` |
| Share | settings, commissioner AND member, only while teams aren't locked (Giorgio, B) | the iOS share sheet ("Join my league with code …"); hidden while locked (one condition, `inviteShareShown`) | `rec-leave-sheet-stay-light`, `settings-*-open-share-*` |
| Try again | History / Playoffs failed | re-reads (reloadKey) | `history-failed-*`, `playoffs-failed-*`; a test pins the handler |
| Create a league / Join with a code | no leagues | routes to /create-league and /join-league | `no-leagues-*`; a test pins both |
| Standings, schedule, bracket and pinned rows | — | not tappable, and drawn with no press affordance (no chevron) | — |

### Hallmark self-critique (1–5)

Philosophy 4 (the board's frame, the ESPN/Sleeper standings shape) · Hierarchy 4 (gains lead each
row; your row is the one tinted, ringed tile) · Execution 4 (6.0pt rhythm measured, no shrink-to-fit,
the tabs never shift) · Specificity 4 (League's own column head, medals, tags, the champion row) ·
Earned 4 (every element is a rule's; nothing decorative added) · Variety 4 (the same ManagerRow as
Home's excerpt; the same tab look as Home's range tabs). No score under 3.

**Punch list (`hallmark audit` by hand; its scripts are not run):**
- minor (P3): the champion row's tint sits on the page, not on a tile, so in Light it reads
  paler than your Standings row; it has no ring. GS-7 asked only for "your tint if it's you".
- minor (P3): Schedule's future weeks with no matchup yet are empty tiles (only "W8"); real
  leagues schedule every week, so this shows only in the fixture.
- minor (P3): "History" repeats as a title under the History tab (kept from 1.2.0).

## The W4 DL gate pass (BLOCK on 89274804), what changed in the captures

- **P1 (Run it back flashed "No leagues yet"):** re-recorded in both themes, checked at 10 fps:
  Season 1 → the tiles' skeleton → Season 2's roster → the nudge sheet, never the empty state
  (`rec-run-it-back-and-nudge-{light,dark}-frames.png` are the 10 fps sheets).
- **P1 XL caps:** `final-standings-17e-xl-light`, `playoffs-final-17e-xl-dark`, `history-17e-xl-*`.
- **P2 pinned row:** pinned only while your row is entirely out of view, on an opaque `bg` band
  to the tab bar: `standings-12-stress-*-xl-*` (your partly visible row is NOT doubled any more),
  `standings-16-you-last-*`, `standings-16-mid-scroll-pinned-*`, `rec-pinned-row-scroll-*`.
- **P2 champion tile, GS-13, the P3s:** every still was re-shot on this build (the gain column
  now matches its head, so every standings frame moved). The other tap-through sheets
  (`rec-league-tap-through-*`, `rec-change-answer-sheet-*`, `rec-leave-sheet-stay-*`,
  `rec-transfer-sheet-*`) are from the previous build: their flows didn't change.

## Not captured, and why

- **VoiceOver**: can't be driven from here; the row labels are pinned by tests
  (ManagerRow's label reads medal, rank, name, "you", tag, movement, record, gain).
- **The pre-draft lobby's own components** (DraftLobby, QueueEditor, DraftCountdownCard,
  AutoStartBlockers) belong to the Draft worker (Orchestrator, 2026-10-13). `lobby-wrapper`
  shows them as merged in #259, inside League's frame on the 16pt block gap (16.0pt, the Design
  Lead's measurement at the W4 gate, block edge to block edge).
- Removing or nudging for real, handing over and leaving: each would write. The fixture
  answers them, so the recordings stop at the sheet (Stay / Cancel), except the nudge, whose
  fixture write is harmless.

## Fixture artefacts (not defects)

- Every schedule week is "vs Gianluigi B." and W8+ have no opponent: the Home fixture only
  schedules your seven matchups against one manager.
- Summer Cup (`fx-summer`) says 14 weeks but reuses the 6-week standings, so its final
  standings read "Through Week 14" over 5–1 records.
- History's "Season 2 · Not finished yet" is the renewal fixture's successor season.
