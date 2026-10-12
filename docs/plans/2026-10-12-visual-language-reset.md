# Visual language reset: captivating, not bland

Status: Approved (Giorgio, 2026-10-12: "approved, resume and push")
Planner session: "Planner" (Fable 5.1), 2026-10-12 · Orchestrator hand-off: —

## Goal

Replace the app's visual language, not its structure. 1.2.0 shipped the right skeleton
(one standout per screen, sections that breathe, the UX rulebook) with a bland skin:
grey cards, hairlines, a thin teal line for a chart. Giorgio's bar is the feeling of
opening Sleeper or ESPN on game night and Robinhood on a green day. This plan gets three
fully rendered directions in front of him (Home, Matchup, Draft room; Light and Dark together), lets him
pick by seeing, then rebuilds the screens to the chosen direction with every gate judged
against the real reference apps side by side.

## Giorgio's rules

All 2026-10-12, in the Planner session; recorded verbatim in `docs/PRODUCT_RULES.md`
("Captivating, not bland").

- "everything I'm seeing is just so bland. It's not creative. It's not inspiring. It's, you
  know, you're not opening up an app and being like, wow. You're opening up an app and just
  seeing bland charts and bland everything. I want something that is captivating, something
  that is creative. I want to emulate other fantasy football apps and and make that bridge
  between them and investing apps. I want to create a, a kind of a, a blend between a, a, a
  sleeper and ESPN fantasy football with a Robin Hood or... Another sort of app like that.
  That's what I want."
- "Even the chart, like that's such an ugly chart."
- "let's maybe not use Sleek, especially if it's going to charge us. Let's just maybe try to
  figure this out just in Claude Code."
- References, his list: "Fantasy Football: Sleeper, ESPN Fantasy Football, and Yahoo Fantasy
  Football. Stock: Robinhood and E*trade."
- Still in force from 2026-10-12 morning ("A calm Home"): same content, calmer structure,
  one standout number, sections never touch. This plan changes the *skin*, never that.
- On approving this plan: "the main thing is that I don't want bland. I want every section
  to, in its own way, elevate the, the app, right?" With named failures in 1.2.0:
  standings ("a basic table with not even good … dividing the columns and rows. It's
  ugly"), the matchup chart ("doesn't even load"), the stock rows ("so ugly"); and one
  thing the previous build did better: "even in the last one … it captured that better
  head to head matchup look way better. And that should really be shown. And that's a huge
  part because of … that fantasy football style". Full quotes in `PRODUCT_RULES.md`.

**What those four examples mean for the board (binding on W1):**
- **Standings** is a design object, not a table: rank, avatar with ring, name (yours bold on
  the tint), record, season gain with sign, movement arrow, and rows that read as a league
  table on game night (Sleeper/ESPN's standings density, Robinhood's tabular numerals).
  No bare grid lines; row separation by surface and rhythm.
- **Matchup** is a fantasy-football matchup page (Giorgio, 2026-10-12, verbatim in
  `PRODUCT_RULES.md`): a head-to-head scoreboard first (the Sleeper/ESPN header shape: two
  scores, avatars at the edges, win-% chips and bars, record and status under each, the lead
  bar), then **a mirrored two-column roster**: your stocks down the left, theirs down the
  right, row by row, each row showing that stock's week performance (gain with sign, and
  the price line in green/red), **no position labels** ("obviously without the positions,
  because that's not a thing"). The middle column, where Sleeper puts the position pill,
  carries nothing or at most the tier/category pill (the board shows both; Giorgio picks).
  "The matchup page should be one of the simpler ones": no extra modules; the scoreboard
  and the roster are the page. **Row order is an open decision for later** (see Open
  questions). The 1.1.0 matchup screen is pulled up as a reference frame on the board
  ("what the last one got right") beside the new direction.
- **Stock rows** (holdings, search results, watchlist): ticker + name, price, change with a
  sign, a sparkline (Robinhood), the tier/category pill (Sleeper's position colour), and
  the row tinted by outcome where there is one (ESPN).
- **The matchup chart not loading** is a defect, routed to the Orchestrator for triage in
  1.2.x (likely S-1/S-5 territory), separate from the design work.

## Decisions

| # | Question | Decision | Board section / date |
|---|---|---|---|
| 1 | Design tool | Sleek rejected (bland result; paid plan); design on the board, built in Claude Code | Planner chat, 2026-10-12 |
| 2 | What the references are and what we take | `docs/design/REFERENCES.md`: Sleeper **fantasy side only** (flat deep navy + cyan, the matchup header with win-% bars, mirrored lineup with a colour-coded middle column, colour-coded draft tiles, "YOUR TURN" pill; Giorgio: the picks/betting screenshots "arent as relevant to us"), ESPN (scoreboard header, row tints, dense tables), Yahoo (invites, "your turn", warmth), Robinhood (number + chrome-less line as hero, one meaningful accent, range pills, sparklines), E*TRADE (key-figures list, tabular numbers) | Planner chat, 2026-10-12 |
| 3 | Theme order | ~~Dark first~~ **Both themes together, neither first** (Giorgio, 2026-10-12, overruling the morning's "dark first": "it doesn't matter what mode you're in, it's going to be built for either"). Every board frame, token, screen and gate in Light AND Dark; nothing approved in one theme without the other; the System / Light / Dark setting stays | Giorgio, 2026-10-12 (revised) |
| 4 | First screens | **Home (in season) + Matchup (live and final) + Draft room**, each in all three directions, so a *system* is judged, not a screen | AskUserQuestion, 2026-10-12 |
| 5 | Who draws | A **fresh "Design Lead" session with a handoff note** from the current one (Giorgio: "2, fresh design lead with a handoff"). Reason: skills load at session start, so the paused Design Lead cannot invoke Hallmark; a fresh one also carries no memory of the quiet-and-grey vocabulary. The Orchestrator relays; it stays as is | Giorgio, 2026-10-12 (revised from "resume") |
| 6 | How screens are judged from now on | Against a reference screenshot side by side on the board and in every gate ("reference check"); adjectives never decide | `PRODUCT_RULES.md`, 2026-10-12 |
| 7 | The three directions and the winner | To Giorgio as "Your call: direction" (brief below) | pending |
| 8 | Hallmark (github.com/nutlope/hallmark, MIT, pure markdown) | **Adopted as a tool for the Design Lead, never as the designer** (Giorgio, 2026-10-12): (a) `hallmark study` on the five reference screens first, producing a DNA diagnosis + `design.md` the token spec builds on (its gate 57 then forbids drifting back to a generic theme); (b) its slop gates and six disciplines adopted into our gate via an adopt/adapt/skip table, like impeccable; (c) `hallmark audit` on every board frame before Giorgio sees it, beside the `ux-reviewer`. Installed at `~/.agents/skills/hallmark`; `.hallmark/` gitignored. Its own web themes and page machinery are not used | Planner chat, 2026-10-12 |

## Open questions

None blocking the board work. Two for Giorgio when he picks a direction (the row order is decided):

0. ~~Matchup roster row order~~ **DECIDED (Giorgio, 2026-10-12):** by week gain, best first on
   each side. In SLOTTED leagues (category slots and price tiers alike) the roster is grouped by
   slot group in slot order, the group as the position label, best-first within each group;
   unslotted leagues (per-slot, budget-cap) are one list per side, best first. The order is
   recomputed once at each market close and holds through the next day; never live. Verbatim
   in `PRODUCT_RULES.md`. The W1 Matchup frames show both a slotted (grouped) and an unslotted
   (flat) roster.
1. **Release target.** 1.2.0 is out. The reset lands as **1.3** unless Giorgio wants a 1.2.x
   with Home + Matchup only. Recommendation: 1.3, every screen, so the app never mixes two
   languages (the "no screen mixes themes" rule applied to skins).
2. **Supersession.** `DESIGN_DIRECTION.md` §1 (Direction B "Game Day"), §9 (tokens) and §9A
   (two themes) are superseded by the chosen direction's token spec. The motion language
   (§4), Reduce Motion (§5) and the native craft floor (§9B) stay. Confirm when choosing.

## Scope

**In:**
- `REFERENCES.md` (done) and the ruling (done).
- The board: three directions × three screens, each in Light AND Dark, each next to its reference, with a
  recommendation. A fourth frame per direction shows the money treatment (Portfolio hero)
  so the brokerage half is judged too.
- The chosen direction's **token spec v3**, both themes at once: the same roles with a Light
  and a Dark value each (surfaces, the display type, the accent system (team colour vs
  money colour), tiles, row tints, chart style); the contrast PAIRS check runs on both.
- Rebuilding the screens to it, in order: Home → Matchup → Draft room → League → Portfolio
  and the stock sheet → the watchlist/claims surfaces (when built) → onboarding/invites.
- The gate: a "reference check" step and the rule that the squint test runs against the
  reference, not the previous build.

**Out (and why):**
- Any structure change (what's on each screen, in what order): the calm-Home ruling, the
  UX rulebook and the approved product rules stand.
- The web app and landing (3d, 3a): after the app, per "app first".
- Sleek or any paid design tool.
- A product rename (deferred to pre-launch; `brand.name` stays a token).

## How it works

### The player's side (what changes when it ships)

Opening the app in season feels like game night: a deep gradient surface with glow, your
team value in big display type with a chart that is a bright single line in the colour of
your day, the matchup a real scoreboard with avatars and bars, your row lit in your colour.
The draft room has colour-coded tiles, a turn clock that looks like a turn clock, and a
"YOUR TURN" moment with presence. Money screens go Robinhood: the number and the line, one
accent that means something, sparklines on rows. Nothing moves on the page; the same
content sits in the same order (the calm-Home ruling); it just stops being grey.

### The system's side

0. **Hallmark `study` pass** (Design Lead, before any frame is drawn). Run `hallmark study`
   on, in order: Sleeper's matchup view, Sleeper's mobile draft board, ESPN's matchup
   scoreboard, Robinhood's portfolio screen, E*TRADE's account header (the screenshots
   linked in `REFERENCES.md`; public references for our own product, so emission is
   allowed). Each yields a diagnosis (surface lightness band, accent hue + chroma,
   type-pairing roles, density, motion, rhythm, and the two anti-patterns NOT to carry).
   The Design Lead merges them into one `docs/design/design.md` ("studied-DNA, source:
   the five references"), which the three directions and the token spec build on.
   `REFERENCES.md` stays the human-readable record; `design.md` is the machine-readable one.
1. **Board, "Your call: direction"** (Design Lead; brief below). Three directions, each
   rendered for Home, Matchup, Draft room and a Portfolio hero, in Light AND Dark, with real data from
   `docs/design/screens/data.js`, each frame beside the reference screenshot it borrows
   from, with the trait named. The Design Lead recommends one. Giorgio picks on the board.
2. **Token spec v3** (Design Lead → `DESIGN_DIRECTION.md` new §9C, superseding §9/§9A):
   named roles, contrast PAIRS re-run for the new palette (the 108-pair check exists in
   `constants/tokens/contrastPairs.ts`), the display typeface decision (Archivo's 62%/900 may
   already serve as the condensed display face; the board decides), chart style, tile
   colours mapped to price tiers / categories, row tint rules, avatar ring rules.
3. **Primitives** (one mobile worker, after the spec): `apps/mobile/constants/tokens/*`,
   `ThemeProvider`, `Card`, `sp/*`, the chart component (`SeasonChart`, the stock chart),
   `ManagerRow`, `PhaseChip`, the tab bar. Gradients via `expo-linear-gradient`; glow via
   layered radial gradients or a pre-rendered image, measured on device (§9B performance
   score). Every token change passes the contrast test before any screen uses it.
4. **Screens**, one worker per group, each gated: Home (in season, pre-draft, post-season),
   Matchup (live/final/reveal), Draft room + lobby, League (standings/schedule/history),
   Portfolio + stock sheet + search, onboarding/invite/join, then the watchlist/claims
   surfaces when their plan builds.
5. **Both themes at every step** (Giorgio, 2026-10-12): there is no "Light pass". Every
   primitive, screen and gate ships Light and Dark together; a screen is DESIGN-APPROVED only
   with both captured. Light is judged against E*TRADE/Yahoo light surfaces, Dark against
   Sleeper/ESPN/Robinhood; no screen mixes.
6. **Gate change** (`UI-UX-PROGRAM.md`): step (3) squint test is run against the reference
   screenshot named for that screen; a new step "reference check" lists, per screen, the
   reference and the borrowed traits present/absent; the `ux-reviewer` adds a row
   "resembles its reference?" with evidence. Plus, from Hallmark: (a) every board frame
   gets a `hallmark audit` punch list before Giorgio sees it (read-only, HTML); (b) the
   Design Lead writes `docs/design/reviews/hallmark-notes.md`, an adopt/adapt/skip table
   over its 58 gates and six disciplines (the impeccable pattern), and the adopted ones
   join the gate: at least the pre-emit self-critique scores, tinted neutrals (no
   zero-chroma greys), accent-by-area, section rhythm variety, decoration-with-purpose,
   honest copy, locked tokens, no italic headers. Hallmark's page/web machinery
   (macrostructures, nav/footer archetypes, its 21 themes, responsive-web gates) is
   skipped; §9B stays the native authority.

### The board brief: "Your call: direction" (W1)

Sent to the Orchestrator for the Design Lead on 2026-10-12. Read `REFERENCES.md` first.

- **Three directions, named so they can be discussed:**
  - **A "Game Night"** (Sleeper-led, fantasy side only): flat deep navy with lighter navy
    cards; one cyan accent for the primary action and live state; the matchup header
    exactly in Sleeper's shape (two scores, projections, avatars at the edges with win-%
    chips and bars, names + records, a live line); the mirrored lineup with a colour-coded
    middle column; colour-coded draft tiles with the on-the-clock cell in yellow; "YOUR
    TURN" as a cyan pill with the clock; avatars with rings; money screens on near-black
    with a bright single-colour line. (The picks-side gradient glow is NOT this direction.)
  - **B "Broadcast"** (ESPN-led): near-black surfaces with ONE league/team colour as the
    frame; a true scoreboard header (scores, avatars, a bar each, record, status) pinned
    over scrolling lineups; row tints by outcome; dense tabular lists; display numerals;
    money screens the same black with the chart line in the performance colour.
  - **C "Terminal"** (Robinhood-led): pure black; one neon accent for the line, selected
    pills and emphasis; the number and the chrome-less line as every hero; sparklines on
    rows; game screens get the scoreboard but in the same minimal chrome; Sleeper's energy
    only in type scale and avatars.
- **Per direction, five frames, each in Light AND Dark (ten renders):** Home in season (the calm-Home structure: pill +
  status, hero + change line, chart, This week card, Standings card, tab bar); Matchup live
  (scoreboard header + two lineups) and the Final reveal state; Draft room on the clock
  ("YOUR TURN · 0:42", the board, the queue strip); **League › Standings in full** (the
  table Giorgio called "awful" is the one to redeem: 6 managers, avatars, movement, your
  row); Portfolio hero (number + line + range pills + two holdings rows with sparklines and
  tier pills). Beside the Matchup frames, one reference frame of the **1.1.0 matchup screen**
  (the look Giorgio says the last build captured better), so the direction is judged
  against it too.
- **Real data** from `data.js` (Stock Scudetto, week 6, Roberto B. vs Gianluigi B.,
  $12,343.59, +$343.59 · +2.86% · +$121.26 today; the draft moment round 2 pick 11).
- **Each frame sits beside the reference screenshot** it borrows from (the App Store
  images linked in `REFERENCES.md`), with the borrowed trait named in one line.
- **Keep:** the structure (calm Home), UX rules 2–11, the 11pt floor, 44pt targets, colour
  never the only code, Reduce Motion fallbacks, Archivo unless the board argues a second
  display face (then name it and its cost).
- **Motion notes per direction** (one line each; no recordings yet): what the hero number
  does on load, what the chart does, what "YOUR TURN" does.
- **Recommend one**, with the reasoning on the board. Giorgio picks; the Planner records.

## Risks and edge cases

- **Contrast in dark.** Gradients and glow change the background under text; every PAIR
  is re-measured against the *darkest and lightest* point of the gradient, not one colour.
  Team colours on dark need their own gain/loss variants (the §9A lesson).
- **Performance.** Gradients, blur and glow on React Native cost frames; the §9B
  performance score is measured on a device at the first screen, not assumed. Fallback: a
  pre-rendered gradient image per surface.
- **Regressing the rulebook.** "Captivating" is not a licence to add things; the structure
  rules and the one-primary-action rule hold; the `ux-reviewer` still runs. A direction
  that needs a second hero fails on arrival.
- **Vocabulary drift.** The words "quiet", "restrained", "hairline", "calm" are banned from
  visual rulings (allowed for structure). The Design Lead's gate template is updated.
- **Token churn across live branches.** The watchlist/claims work (approved plan) and any
  P2 follow-ups build on the current tokens; the primitives worker lands first, and
  screens rebase on it, so no screen is built twice.
- **Two themes, one effort.** Designing both at once roughly doubles the frames and the
  captures per gate; the trade is deliberate (Giorgio's ruling) and removes the risk of a
  Light user ever seeing a half-skinned app. Gates reject a branch that captures one theme.
- **The Sleek key.** `~/.sleek_api_key` and `~/.agents/skills/sleek-design-mobile-apps`
  remain on Giorgio's machine; harmless, free tier; removable on request.

## Done means

- [ ] `REFERENCES.md` and the ruling are on `main`.
- [ ] Board "Your call: direction": 3 directions × 4 frames, dark, each beside its reference;
      Giorgio has picked; the pick and any edits are recorded in `PRODUCT_RULES.md`.
- [ ] Token spec v3 in `DESIGN_DIRECTION.md` §9C; contrast PAIRS test green for Dark, then
      Light.
- [ ] Primitives rebuilt and gated; the first screen (Home) on device measured for frame
      rate with the new surfaces.
- [ ] Every key screen rebuilt and DESIGN-APPROVED with a reference check; `ux-reviewer`
      row "resembles its reference" present in each gate.
- [ ] Every screen approved in Light AND Dark (both captured at its gate); no screen mixes skins.
- [ ] Giorgio's check by hand, on his phone, Dark then Light: Home in season, Matchup live,
      the draft room on his turn, Portfolio. His word is the acceptance: it either makes him
      go "wow" or it isn't done.

## Suggested workstreams

| # | Workstream | Depends on | Who |
|---|---|---|---|
| W0 | Push this branch (+ the two earlier unpushed ones, with Giorgio's go); docs PR | Giorgio's go | Orchestrator |
| W0b | Hallmark `study` on the five reference screens → `docs/design/design.md` (studied DNA); `hallmark-notes.md` adopt/adapt/skip table | W0 | Design Lead (resumed) |
| W1 | "Your call: direction" board: 3 × 4 frames beside references, each frame `hallmark audit`-ed; recommendation | W0b | Design Lead (resumed) |
| W2 | Giorgio picks; Planner records; token spec v3 (§9C) + contrast PAIRS | W1 | Design Lead, Planner |
| W3 | Primitives + tokens + charts rebuilt; device frame-rate check | W2 | mobile worker |
| W4 | Screens in order (Home → Matchup → Draft → League → Portfolio/sheet → onboarding); one gate each with the reference check | W3 | mobile workers (2 in parallel max) |
| W5 | ~~Light theme~~ (folded into W2–W4: both themes at every step) | — | — |
| W6 | Gate template + `ux-reviewer` "reference check" row; `UI-UX-PROGRAM.md` | W2 | Orchestrator (docs), Giorgio (`.claude/agents/ux-reviewer.md` edit by hand) |
| W7 | 1.3 cut: Giorgio's device check in BOTH themes, EAS build | W4 | Giorgio |

## Models

| Role / workstream | Model | Why |
|---|---|---|
| Planner | Fable 5.1 | Direction, briefs, recording |
| Orchestrator | Opus 5.5 | Verification and gates |
| W1 board directions | **Design Lead on Opus** throughout | This is the judgement work of the whole plan; a cheaper model produced the bland pass |
| W2 token spec | Design Lead on Opus; contrast script runs are mechanical (Haiku worker) | Judgement vs mechanical |
| W3 primitives | Worker turn 1 on Opus (gradient/perf design), then Sonnet | The performance trade-offs need judgement; the token plumbing doesn't |
| W4 screens | Turn 1 on Opus, then Sonnet; **Opus for the gate** (Design Lead) | Well-specified from the board; the gate is judgement |
| `ux-reviewer` | Sonnet | Checklist |
| Recon | Haiku | Read-only |
