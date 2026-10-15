# Key screens (source of truth)

The app's five key screens as real React components on the Game Day tokens.
They define what the mobile app (phases 3b-1, 3b-2, 3c, 3e) builds and what
the landing's phone (3a) shows. If a screen here and a screen in the app or
the landing disagree, this folder wins until Giorgio changes it.

| File | What it is |
|---|---|
| `data.js` | Canonical sample data. One league (Stock Scudetto, Week 6 of 14), one moment (Thu 1:37 PM ET), one week of closes. Every displayed number is derived from share quantities and prices, so the screens reconcile by construction. |
| `screens.jsx` | `HomeScreen`, `MatchupScreen` (live/final), `LeagueScreen` (before/after the re-sort), `DraftScreen` (on the clock / after the pick), `PortfolioScreen` (+ the stock sheet). |
| `screens.css` | Component styles, `ks-` prefix, only `--sp-*` token values. |
| `themes.css` | The two themes (Light / Dark) as semantic `--c-*` tokens, one value per theme (DESIGN_DIRECTION §9A). Every screen reads only these. |
| `tokens.css` | A copy of `apps/web/src/styles/tokens.css`. |
| `inventory.jsx` | Step 2: every other screen (3b-1 sign in and first run, 3b-2 Home in every phase, 3c game, 3e trading, 3d web) built from the same blocks (`window.KSKit`). |
| `inventory-board.jsx` | Board part 2, grouped by the phase that builds each screen. |
| `home-calm.jsx` | "Your call: a calmer Home" (2026-10-12): 1.2.0's Home today vs A (same content, calmer) vs B (fewer things), in season, before the draft and season over. Rendered first on the board. |
| `directions.jsx`, `directions.css`, `refs.js` | "Your call: the direction" (W1 of the visual-language reset, 2026-10-12): directions A Game Night, B Broadcast, C Terminal, Dark, six frames each beside the reference image they borrow from, plus the 1.1.0 matchup and two later calls (row order, centre column). Each direction is ONE token block in `directions.css` that re-points the board's `--c-*` roles. `refs.js` holds the hotlinked reference URLs with crops and the 1.1.0 capture as a data URI; it is generated, don't hand-edit. Rendered first on the board. |
| `board.jsx`, `index.html` | The review board: each screen with its notes, playable motion moments, open questions, and a ledger computed from `data.js`. |
| `key-screens.html` | Single-file build of the board for publishing (`node docs/design/screens/build.mjs`). |

## How the board is laid out (Giorgio, 2026-10-12)

1. **Waiting on you:** the top nav (`OPEN` in `board.jsx`) and the opening sections list ONLY the "Your call" sections still awaiting Giorgio, newest first.
2. **Approved screens:** the key screens and every other screen, the reference the app is built from.
3. **Archive:** every decided call, collapsed, newest first, stamped with the decision, the date and the PR that recorded it (`ARCHIVE` in `board.jsx`; the sections themselves live in `window.KSArchivedCalls` in `inventory-board.jsx`, `KSHomeCalm`, `KSRowOrder`). A call moves to the Archive the moment its decision is recorded in PRODUCT_RULES: remove it from `OPEN`, add its stamp to `ARCHIVE`.

**Review notes go under the phone, never inside it** (Giorgio, 2026-10-14). A label drawn inside a device mock reads as something users will see: he read the "Can't be built: no data before sign-in" stamp on `#call-ob-arrival`'s A as UI ("Is that going to be popping up on the screen?"). So every phone and web frame shows only what the screen shows. A reviewer note is a caption under the frame, in the separate dashed `.b-annot` style (`fig(key, cap, node, note)` in `onboarding.jsx`), prefixed "Review note:" and written in plain words that name what it points at ("The box with Managers, Draft, Stakes and Season can't be filled before sign-in: privacy rule.").

## Using them

- **Landing (3a):** port `screens.jsx` into `apps/web/src/pages/landing/` as TSX (drop the IIFE, `export` each screen, turn `data.js` into the landing's `sampleData.ts`). Use the foundation's `ScoreDigits` and `TugBar` where they exist. The phone shows these screens and nothing invented.
- **Mobile (3b–3e):** these are the visual spec: layout, hierarchy, copy, states, motion moments. Rebuild them in React Native on `components/sp`; use `data.js` values as dev fixtures.
- **Rules carried in the data:** money via `formatMoney` (U+2212 minus, zero never green); matchups in dollars with percent as the tiebreak; standings sorted by win %, then wins, then season gain (as `league.tsx` does); scoring copy stays generic ("best performance wins").

Preview locally: `python3 -m http.server` in this folder, then open `index.html` (Babel compiles the JSX in the browser).
