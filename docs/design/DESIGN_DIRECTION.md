# Stockpile Design Direction (Phase 1)

> Author: Design Lead. Date: 2026-09-26. Status: **APPROVED: Direction B
> "Game Day"** (Giorgio, 2026-09-26, relayed by Orchestrator). Phase 2 may start.
>
> Inputs: [`AUDIT-2026-09.md`](AUDIT-2026-09.md) (Phase 0), Giorgio's mandate
> of 2026-09-25 (complete overhaul; richer landing motion allowed), and his
> answers of 2026-09-26: explore **both light and dark**; **refine the mark
> and show new options**; target feel = **calm fintech + live sports
> broadcast + premium dark terminal**.
>
> **Visual board (open this first):** `docs/design/directions/direction-board.html`,
> also published privately at https://claude.ai/artifact/3z398TKdY3vrbaZYk8ZxnM.
> It shows each direction on the matchup screen and the landing hero, with one
> replayable signature animation each, plus four mark options.

---

## Decisions — 2026-09-26 (Giorgio)

| # | Question | Decision |
|---|---|---|
| 1 | Direction | **B · Game Day.** A and C below are kept for the record only; workers build B. |
| 2 | Mark | **1 · Bars, refined.** Giorgio chose the S-curve monogram *if it wasn't already another company's logo*. It collides: an existing US investing app is already called **Stockpile** (stockpile.com, a family investing app since 2010, "stockpile™"), and its logo is an **orange S-shaped mark** beside the wordmark. An S-monogram for a stock app named Stockpile would sit on top of it. The refined bars are name-agnostic. |
| 3 | Rename Portfolio → Team | **No.** The tab stays **Portfolio**. |
| 4 | Profile out of the tab bar | **Yes.** Four tabs plus an avatar button on Home. |

**Name caveat (open, Giorgio deciding separately).** The *name* "Stockpile"
itself collides with that same existing ™ in the same category. Until he
decides:
- The product name and wordmark are **one swappable token**:
  `brand.name` / `brand.wordmark` in `apps/mobile/constants/brand.ts` and
  `apps/web/src/brand.ts`. No new asset, screen or copy string hard-codes
  "Stockpile".
- **On hold:** the promo storyboard's closing card (§8, 0:41–0:45) and any
  wordmark-heavy landing work (a large wordmark lockup, name-driven hero copy).
  The landing hero copy in §6 doesn't depend on the name.
- The refined-bars mark (icon only) is safe to build now.

---

## Decisions that were needed (answered above)

1. **Direction:** A Ledger, B Game Day (recommended), C After Hours, or a named
   blend ("B, but with C's dark scoreboard", etc.).
2. **Mark:** 1 Bars refined, 2 The pile, 3 S-curve monogram, 4 Wordmark with a
   tick. My recommendation is **3**: it's the strongest app icon and favicon,
   and its up-arrow echoes the product. Any of them works with any direction.
3. **Two navigation calls** (§3): rename the Portfolio tab to **Team**, and
   move Profile out of the tab bar to an avatar button. Both recommended.

Everything else in this document applies whichever direction wins.

---

## 1. Visual identity: three directions

All three use the same product facts. Matchups are won on **dollar gain**
(percent is only the tiebreak; `process-week-results/index.ts:1188`,
`:1245`), so every matchup leads with dollars. **Copy stays generic** ("best performance wins"), because stake modes vary capital per player; data displays show the scorer's metric via one helper (Giorgio, 2026-09-27). Every data colour passes WCAG AA
(4.5:1) on its own background; the ratios are measured and printed on the board.

### A. Ledger (light, calm fintech)

Stockpile as a well-made financial paper. Numbers are typeset in a serif,
the rest stays quiet: cool white (not cream), one deep harbor-teal accent,
hairlines instead of shadows. Motion only when a number changes.

| Token | Value | Contrast |
|---|---|---|
| paper | `#F7F9FA` | — |
| ink | `#12161B` | 17:1 |
| graphite (secondary text) | `#56606B` | 6.1:1 |
| harbor (accent) | `#0B6477` | 6.4:1 |
| gain / loss | `#16794A` / `#B4231B` | 5.4 / 6.6 |

Type: **Source Serif 4** (numbers, headlines; tabular lining figures),
**Schibsted Grotesk** (interface). Signature moment: the matchup "result
line", where the fill bar draws once and the leading amount settles in.
Good for: credibility, calm, consistency. Risk: reserved on game night; it
meets "cool animations" with restraint.

### B. Game Day (light base + broadcast scoreboards) — **recommended**

Calm by default, loud on game day. Money screens (Portfolio, stock
detail, trade) are light and calm. **Competitive screens** (matchup,
standings, draft, weekly results, Home's "this week" strip) switch into a
broadcast scoreboard: stadium navy, condensed numerals, your team colour against
your opponent's, a live tug-of-war, and chyrons that call the play ("NVDA just put
you ahead").

| Token | Value | Contrast |
|---|---|---|
| snow (app background) | `#F3F5F8` | — |
| stadium (scoreboard surface) | `#0D1B2E` | — |
| you (team colour) | `#2860F0` | 5.2:1 on white |
| opponent (team colour) | `#FF6A3D` | used as fills/bars, never as text on white |
| signal (live) | `#FFC53D` | 11:1 on stadium |
| gain / loss on light | `#12803F` / `#C8303A` | 5.0 / 5.3 |
| gain / loss on stadium | `#4ADE8B` / `#FF7A7A` | 10.0 / 6.9 |

Rule that keeps it disciplined: **team colours mark people; green/red mark
money.** They never swap roles.

Type: **Archivo**, one variable family with a width axis. 62% width / 900 for
scores, 125% / 800 for broadcast tags, 100% for everything you read. Signature
moment: opening a matchup wipes in the scoreboard, the tug bar overshoots to
the leader, the score "slams" and a chyron slides in.

Why I recommend it:
- It resolves the positioning tension in the old specs (investing-first vs
  game layer) by giving each its own register instead of averaging them.
- It gives motion a **job**: explaining who's winning and why. That makes
  it "cool" without being decoration.
- It fixes the audit's #3 finding (the matchup is weaker than the landing's own
  mock) most directly.
- It needs the least new backend: the live scoreboard needs current values
  only, not intraday history (§7).
- Risk: two registers need a strict rule for which screens are "game". The
  token system encodes it as two surface sets (`surface.money.*`,
  `surface.game.*`), so a worker can't mix them by accident.

### C. After Hours (dark, premium terminal)

A dark, precise pro-tool: deep blue-slate (not near-black) layered by
elevation, hairline borders, prices in monospace, one iris accent for
interaction. The matchup is two lines racing on one chart, with the leader lit.

| Token | Value | Contrast |
|---|---|---|
| deep / surface / raised | `#0E1220` / `#151A2B` / `#1C2236` | — |
| text / muted | `#E6EAF2` / `#8A93A8` | 15:1 / 6.1:1 |
| iris (interaction) | `#9B8CFF` | 6.7:1 |
| gain / loss | `#43D48F` / `#FF6E6E` | 9.8 / 6.8 |

Type: **Geist** (interface) and **Geist Mono** (prices, tickers only).
Signature moment: both lines draw in, then the leader's tip lights. Good for:
instantly premium, and motion reads beautifully on dark. Risks: dark finance
reads as crypto or day-trading; it's the largest departure from what's live;
and the racing chart needs **intraday history per participant**, a real
backend ask (§7).

### Marks (any direction)

| # | Mark | Note |
|---|---|---|
| 1 | Bars, refined | Today's icon, equalised; safest; keeps the landing's equity |
| 2 | The pile | Stacked slabs; most literal; reads as game chips |
| 3 | S-curve monogram | S path ending in an up-arrow, in an app tile; best app icon and favicon |
| 4 | Wordmark with a tick | "i" dot becomes an up-tick; landing and promo only |

The bull-and-bear crest (web login) retires in every option.

---

## 2. Token architecture (applies to every direction)

**One source per platform, same names on both.** The audit's core finding is
that tokens existed and were bypassed (mobile typography: 0 consumers, 416
raw sizes). So Phase 2 ships tokens **and the primitives that make bypassing
them harder than using them.**

| Layer | Mobile | Web |
|---|---|---|
| Source | `apps/mobile/constants/theme/*` (colors, type, space, radius, elevation, **motion**) | `apps/web/src/styles/tokens.css` (CSS custom properties on `:root`, **not** scoped to `.sp-landing`) + `tokens.ts` mirror for JS/motion |
| Names | `color.surface.money.base`, `color.surface.game.base`, `color.text.primary`, `color.data.gain.base`, `type.score`, `type.body`, `motion.duration.base`, `motion.ease.settle` … identical strings on both platforms |
| Enforcement | `<Text variant="…">`, `<Money value=… />`, `<Surface kind="money\|game">`, `Pressable` with built-in press motion; ESLint `no-restricted-syntax` on raw `fontSize` / hex in `app/` + `components/` (warning first, error after Phase 3) | Same primitives in React; a lint rule against raw hex outside `tokens.css` |

Non-negotiables carried from the audit: every text/background pair ≥ 4.5:1
(large display ≥ 3:1); tertiary text is never used for information; money
always uses `tabular-nums` and never wraps (`numberOfLines={1}` +
`adjustsFontSizeToFit` with a floor); zero is neutral, not green; the minus
sign precedes the currency (`−$3,000.00`, U+2212).

The legacy web `layout.css` / `App.css` / `index.css` are **not** imported
by the new landing, and are deleted when Phase 3d replaces the app pages.

---

## 3. Information architecture and navigation

### Mobile

```
Tab bar (4):   Home      Matchup      League      Portfolio
Header:        [league pill ▾]  on Matchup / League / Portfolio      [avatar] on Home
```

- **Home**: **the one league picked in the pill** (Giorgio, 2026-09-29,
  Concept B; this supersedes the earlier cross-league overview). There are no
  cross-league totals and no leagues list: the pill shows "+N" and opens the
  league sheet. Home has one hero card per league phase (pre-draft → drafting
  → pre-season → live → closed → scoring → final → complete), the this-week
  scoreboard, the season chart and a standings excerpt. Built in 3b-2.
  Avatar → Profile & settings.
  - **Chart decision (2026-09-26): plot cumulative gain, not value.** The
    line is `value − cost basis + realized P/L` for the selected window,
    with a **zero baseline**. It sits in the gain colour above zero and the
    loss colour below (§9 data tokens). Reason: the game is scored on dollar
    gain, and the header already shows cash-flow-adjusted gain. A value line
    turns every draft, buy or league join into a fake rally (seen by the P/L
    worker: +$5,000 of in-window drafts made the line climb while the header
    correctly read +$25.14, and flagged as the "staircase chart" in the
    audit). Deposits (drafts, league joins) therefore produce **no jump**. An
    optional small marker on the axis may note "joined Friday Night Stocks";
    it's never a step in the line. **Portfolio value** stays the big number
    in the header, not the chart. Data: this needs the daily series in §7
    ask 3, with per-day cost basis.
- **Matchup**: your matchup in the active league, with a segmented control
  for **All matchups this week** in that league.
- **League**: standings, schedule, history, league settings (commissioner).
  While the league is pre-draft or drafting, the tab **becomes the draft room
  entry** (a phase takeover, not a banner). After the draft, **Draft recap**
  lives under History.
- **Portfolio** (name kept, per decision 3): your holdings in the active league,
  budget, trade history (which **includes draft picks**).
- **Stock detail (new)**: every ticker row anywhere opens a stock sheet with
  price chart, your position, who in your league owns it, and **Buy / Sell,
  with Sell pre-selected when you hold it** (fixes the buy-mode default).
- **League pill → league sheet (replaces the unreachable Leagues screen)**:
  all leagues grouped by phase (Live this week / Upcoming / Drafting /
  Finished), each showing rank and record, with **Create** and **Join** at the
  bottom. The active league **persists** across launches.
- **Profile** leaves the tab bar (avatar on Home). Password change becomes its
  own screen, not an always-open form.

Tap targets for the core jobs (today → proposed): my matchup 1 (+2 if wrong
league) → **1, and the league persists**; standings 1 + scroll → **1**; trade a
holding ~5 with the wrong default → **2 + confirm**; draft 2 when the banner
shows → **1 when active** (League is the draft room); another league:
unreachable list → **2** (pill → sheet).

### Web (Phase 3d)

Same four destinations as a left rail on desktop and a bottom bar under 768px,
the same league pill, and the same stock sheet as a side panel. `/` stays the
landing for logged-out users. The landing is a separate bundle that never
imports app CSS.

### One league-lifecycle model (fixes the audit's honesty findings)

Every surface reads **one** phase from a shared helper (extending PR #26's
`getSeasonPhase`) and renders that phase's state. No screen infers phase on
its own.

| Phase | Game surfaces show | Money surfaces show |
|---|---|---|
| `pre_draft` | "Draft on Sat, Oct 3 at 7 PM", members/bots, draft room entry | No Buy; "Your team is set at the draft" |
| `drafting` | Live draft room | No Buy |
| `pre_season` | "Season starts Tue, Sep 29"; opponent for week 1; **no leader, no gains** | Holdings at entry price; Buy per league rules |
| `live_open` | Live scoreboard, tug-of-war, chyrons | Live prices |
| `live_closed` (nights/weekends mid-week) | Scoreboard frozen at last close, "Resumes Mon 9:30 AM ET" | Last close; trading closed state |
| `week_final` (Fri close → scored) | Final score + reveal; "Scoring…" until processed | — |
| `playoffs` / `season_complete` | Bracket / champion | Final |

Each phase has **one visual treatment** (a phase chip + an empty/hero
pattern) defined once in the component library.

---

## 4. Motion language

Same token names on web (`motion` library) and mobile (Reanimated 4.1).

### Durations

| Token | ms | Use |
|---|---|---|
| `instant` | 90 | Press feedback, toggles |
| `quick` | 160 | Small state changes, chip swaps, reduced-motion crossfades |
| `base` | 240 | Sheets, cards entering, list items |
| `slow` | 380 | Screen transitions, scoreboard wipe |
| `feature` | 700 | Once-per-view moments: Friday reveal, landing hero sequence |

Nothing that blocks input runs longer than `slow`. `feature` never blocks
input.

**List stagger (token, 2026-09-29).** `motion.stagger = { step: 30, max: 8 }`:
item *i* waits `min(i, max) × step` ms, so a long list never waits more than
240 ms to finish starting. Read it through `useMotion().stagger.delayFor(i)`,
which returns 0 under Reduce Motion (items appear together). Screens never
hand-roll stagger delays.

### Easings

| Token | Curve | Use |
|---|---|---|
| `settle` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | Default for things arriving and settling |
| `exit` | `cubic-bezier(0.4, 0, 1, 1)` | Things leaving |
| `spring.snappy` | damping 26, stiffness 320, mass 1 (no overshoot) | Press, drag, sheets, shared elements |
| `spring.lively` | damping 14, stiffness 220, mass 1 (slight overshoot) | **Game surfaces only**: tug-of-war lead change, score slam (B); unused in A |

Per direction, the dial changes and the tokens don't: A uses `settle` +
`snappy` only; B adds `lively` on game surfaces; C uses `snappy` everywhere with
shared-element transitions.

### What animates

| Moment | Motion | Tokens |
|---|---|---|
| Screen / route enter | Crossfade + 8px rise (A, B money) · scoreboard wipe (B game) · shared element (C) | `slow`, `settle` |
| Card / row press | Scale 0.98 + haptic | `instant`, `spring.snappy` |
| Money value changes | Digit roll to the new value (only on **change**, never on first paint) | `base`, `settle` |
| Lists (standings, holdings) | Stagger in, 30ms apart, max 8 items; re-sort animates position | `base` |
| Matchup live | Tug bar / fill bar tracks value; lead change → overshoot + chyron (B) | `lively` (B) |
| Friday final | One reveal per week per matchup: scores lock, winner emphasised, one celebratory beat on a win | `feature` |
| Sheets (league, stock, trade) | Spring up, dim behind | `spring.snappy` |
| Charts | Draw once on first view; afterwards update in place | `feature` then `base` |
| Tab change | Icon fill + label colour | `quick` |

### Ambition (added 2026-09-27)

Restraint was over-applied in the first pass. **Motion should be abundant
wherever it explains state or place**: scores changing, standings moving, a
screen handing off to the next, the market being live. Every screen should have
at least one moment people would show a friend. The limits below still hold,
and every animation keeps its reduced-motion fallback.

### What never animates

- Money on first render (it appears; it only rolls when it **changes**).
- Anything looping, except the live dot while the market is open.
- Parallax on data, and any animation that hides content until it finishes
  (binding: accessibility, not style).
- Error and destructive-confirmation states (they appear instantly).

---

## 5. Reduced motion (binding)

Mobile: Reanimated's `useReducedMotion()` + `ReduceMotion.System` on every
animation config; one `useMotion()` hook returns the token set already
reduced. Web: `motion`'s `useReducedMotion()` + `@media
(prefers-reduced-motion: reduce)` for CSS.

| Full motion | Reduced |
|---|---|
| Translate / scale / wipe | Opacity crossfade at `quick` |
| Digit roll | Instant swap |
| Tug bar overshoot, score slam | Set to final value, no overshoot |
| Stagger, re-sort | Appear together; re-sort without movement |
| Chart draw | Appear drawn |
| Celebration beat | Static "Won" badge |
| Landing ticker | Paused (and a **pause control for everyone**, WCAG 2.2.2) |
| Scroll-scrubbed landing section | Static four-panel sequence |

Every UI worker's DONE report includes a Reduce Motion screenshot or
recording of each animation it added.

---

## 6. Landing concept (written for B; A and C variants noted)

> **Superseded in part (2026-09-27).** Giorgio judged the first build "still very
> basic". The **"one pinned section" limit is lifted**: the landing now has
> **multiple** scroll-scrubbed chapters, a sticky app mockup, background morphs,
> mask reveals, parallax and live standings/scoreboards (see the 3a round-3 brief
> in `prompts/phase3a-landing.md`). **The copy stays the current live landing's,
> verbatim.** The table below is kept for history.

The landing stays **pre-launch**: "Launching soon" is a status, never a
button that looks clickable. It doesn't import app CSS.

| # | Section | Content | Motion |
|---|---|---|---|
| 1 | Nav | Mark, How a week works, Leagues, FAQ, "Launching soon" status | None |
| 2 | Hero | Condensed headline "Your portfolio vs. your friends. Every week." over a stadium band; **the live scoreboard module is the hero visual** (sample matchup) | One `feature` sequence on load: scoreboard wipes in, scores count up once, tug bar settles, chyron slides. Ticker below with a pause control |
| 3 | How a week works | Real sequence: draft → Monday open → the week → Friday close (numbered because it is one) | **One pinned, scroll-scrubbed section** (now allowed): scrolling moves Monday → Friday and the scoreboard updates. Reduced motion: static four panels |
| 4 | Leagues in action | A standings board that re-sorts with a lead-change chyron | Re-sort on enter, then every ~6s while visible; stops when off-screen |
| 5 | The money side | Calm, light portfolio card: real market data, free to play, no real money | Chart draws once |
| 6 | FAQ | As today (pre-launch answers) | Accordion `base` |
| 7 | Launch band | "Launching soon" + one-line promise | None |
| 8 | Footer | Real links only; hide Privacy/Terms/Contact/socials until they exist; keep the disclaimer | None |

Variants: **A** swaps the scoreboard hero for the typeset result card and
drops the pinned section in favour of a still timeline. **C** uses the racing
chart as the hero, and section 3 scrubs the two lines across the week.

---

## 7. Backend asks (for the Orchestrator; UI workers add no migrations)

| # | Ask | Needed by | Direction |
|---|---|---|---|
| 1 | **Home summary RPC**: per league → phase, rank, record, this week's matchup (opponent display name, both dollar gains) in one call | Home rebuild (3b), the "This week" strip | All |
| 2 | **Opponent display names** on matchup reads (today: "Opponent --") | Home, Matchup | All |
| 3 | **Daily portfolio value series** per user per league (week snapshots are weekly only) | Honest Home/Portfolio performance chart | All (without it the chart shows weekly points) |
| 4 | **Intraday value samples** per matchup participant (e.g. every 15 min during market hours) | C's racing lines; B's optional "momentum" sparkline | **C required**, B optional |
| 5 | Trade history view that **unions draft picks with trades** (text/uuid + numeric casts per CLAUDE.md) | Portfolio → history | All |
| 6 | Username captured at signup is persisted (Home greeted "Trader") | Home, Profile | All; verify first, may be client-only |
| 7 | Market-session status beyond open/closed (next open time) | `live_closed` phase copy | All |
| 8 | Drop "win probability" from the landing mock unless a model is built | Landing honesty | All |

Asks 1–2 and 5 unblock the Home rebuild; 3 and 4 are what separate a
"live-feeling" product from a static one.

---

## 8. Promo video treatment (Phase 4, Remotion)

**45 seconds, direction B**, reusing real tokens and components; 16:9 master
with a 9:16 cut. Music: one driving track with a clear drop at 0:20.

| Time | Beat | Picture | Type / audio |
|---|---|---|---|
| 0:00–0:04 | Cold open | Black → the refined bars rise one by one | Single hit |
| 0:04–0:09 | The premise | Split screen: two phones, two friends' names | "Your portfolio." / "Their portfolio." |
| 0:09–0:15 | The draft | Draft room: five picks snap into a team, tickers flying in | "Draft real stocks." |
| 0:15–0:20 | Monday open | Scoreboard wipes in at 0.00 vs 0.00; the bell | "Every week is a matchup." |
| 0:20–0:30 | The week (drop) | Tug-of-war swinging across days, chyrons: "NVDA +4.1% puts you ahead", "TSLA drags Priya" | Beat-synced cuts |
| 0:30–0:36 | Friday close | Clock hits 4:00 PM ET; scores lock; the Friday reveal | Silence, then the win beat |
| 0:36–0:41 | The league | Standings re-sort; you move up to 2nd | "Climb the league." |
| 0:41–0:45 | Close | **ON HOLD (name caveat).** Mark + `brand.name` + "Launching soon". Disclaimer line | Tail |

Real simulator footage can replace the 0:09–0:15 and 0:36–0:41 beats.
Remotion's licence is confirmed before anything is published.

---

## 9. Game Day token spec (approved; Phase 2 implements exactly this)

> **Amended 2026-09-29 (Giorgio): the money/game surface axis below is
> SUPERSEDED as a colour axis by §9A, "One design, two themes".** Type,
> space, radius, motion and the data/team colour *rules* in this section still
> hold. Every `surface.money.*`, `surface.game.*` and `*.onGame` leaf is
> replaced by §9A's semantic tokens, one value per theme. Nothing inverts inside
> a screen any more.

Names are identical on both platforms (dot paths in TS; `--sp-` kebab custom
properties on web, e.g. `color.surface.game.base` → `--sp-color-surface-game-base`).
Web names are all lowercase kebab, with camelCase split: `color.data.gain.onGame`
→ `--sp-color-data-gain-on-game`. **A token is never both a leaf and a parent**:
where a variant exists, the default lives at `.base` (amended 2026-09-26 at
ui/foundation-mobile's request).
Every text pair below is measured; "on" means the background it may sit on.

### Colour

| Token | Value | Notes / contrast |
|---|---|---|
| `color.bg.app` | `#F3F5F8` | Snow, the app background |
| `color.surface.money.base` | `#FFFFFF` | Cards on money screens |
| `color.surface.money.sunken` | `#EBEFF4` | Inputs, segmented tracks |
| `color.surface.game.base` | `#0D1B2E` | Stadium: scoreboards, standings header, draft board |
| `color.surface.game.raised` | `#16263D` | Cards inside game surfaces |
| `color.surface.game.line` | `#22334D` | Dividers on game |
| `color.border.default` | `#DDE3EA` | Decorative hairlines only |
| `color.border.control` | `#76828F` | Input/control outlines: 3.9 on white, 3.6 on snow (≥3:1, 1.4.11) |
| `color.text.primary` | `#0D1B2E` | 17:1 |
| `color.text.secondary` | `#5B6678` | 5.8 on white, 5.3 on snow. **The lowest informational level** |
| `color.text.disabled` | `#A3ACBA` | Disabled only; never information |
| `color.text.onGame.primary` | `#FFFFFF` | 17:1 on stadium |
| `color.text.onGame.secondary` | `#8DA0BD` | 6.5 on base, 5.7 on raised |
| `color.brand` | `#2860F0` | Mark accent bar, focus ring. 5.2 on white |
| `color.team.you.base` | `#2860F0` | **Fills/bars only** on light; as text on game use `team.you.onGame` |
| `color.team.you.onGame` | `#6E9BFF` | 6.4 on stadium |
| `color.team.opponent` | `#FF6A3D` | **Fills/bars only** (2.9 on white fails as text; 6.1 on stadium ok) |
| `color.live` | `#FFC53D` | Live dot/tag, on game only (11:1) |
| `color.data.gain.base` / `color.data.loss.base` | `#12803F` / `#C8303A` | On money: 5.0 / 5.3 |
| `color.data.gain.onGame` / `color.data.loss.onGame` | `#4ADE8B` / `#FF7A7A` | 10.0 / 6.9 |
| `color.data.zero.base` / `color.data.zero.onGame` | = `text.secondary` / = `text.onGame.secondary` | Zero is never green; on game it must use the light-on-dark grey (6.5:1), not the light-surface one (~3:1) |
| `color.status.warning` | `#B45309` | 5.0 on white |
| `color.status.danger` | `#B42318` | 6.6 on white (destructive buttons, errors) |
| `color.action.primary.bg` / `.fg` | `#0D1B2E` / `#FFFFFF` | Primary buttons are stadium navy: neutral, and not a team colour |
| `color.action.secondary.bg` / `.border` / `.fg` | `#FFFFFF` / = `border.control` / = `text.primary` | Money-surface secondary, explicit for parity with `.onGame` |
| `color.action.ghost.fg` | = `text.primary` | Money-surface ghost |
| `color.action.primary.onGame.bg` / `.fg` | `#FFFFFF` / `#0D1B2E` | **On game surfaces the primary inverts** to a white "broadcast chip" (17:1). Navy-on-navy would be invisible |
| `color.action.secondary.onGame.border` / `.fg` | `#8DA0BD` / `#FFFFFF` | Transparent fill, light outline (6.5:1 against stadium) |
| `color.action.ghost.onGame.fg` | `#FFFFFF` | Text-only action on game surfaces |

Rules: team colours mark **people**, data colours mark **money**, and they
never swap. **Every colour a component uses must resolve per surface**: a
component on a `game` surface takes its `.onGame` token automatically through
the `Surface` context (amended 2026-09-26 after ui/foundation-web found the
primary button invisible on stadium navy). The hierarchy holds on both
surfaces: primary is the most prominent, then secondary, then ghost. Opponent orange never appears as text on light.

### Type (Archivo)

| Token | Width / weight | Size / line | Use |
|---|---|---|---|
| `type.hero` | 62% / 900 | web: `clamp(56px, 7.6vw, 112px)` / 0.92; mobile: 56 / 52 | **Landing display family**: the hero headline, plus the landing's section heads and launch title at sizes derived from it (Phase 3a). Tracking −0.01em; **`type.hero.wordSpacing` = 0.12em** (added 2026-09-27; at 62% width the word gaps otherwise collapse, e.g. "Yourportfolio"). Web: `--sp-type-hero-word-spacing` |
| `type.score.xl` | 62% / 900 | 56 / 52 | Matchup scoreboard |
| `type.score.lg` | 62% / 900 | 40 / 38 | Standings, Home "this week" |
| `type.score.md` | 62% / 900 | 28 / 28 | Compact scores |
| `type.tag` | 125% / 800 | 11 / 14, +0.04em, uppercase | Broadcast tags (LIVE, FINAL, WEEK 3). **The only uppercase in the app**, game surfaces only |
| `type.display` | 100% / 800 | 32 / 36, −0.5 | Screen hero numbers on money screens |
| `type.title` | 100% / 700 | 22 / 28 | Screen titles |
| `type.headline` | 100% / 600 | 17 / 22 | Section heads, tickers |
| `type.body` | 100% / 400 | 15 / 22 | Running text |
| `type.callout` | 100% / 500 | 13 / 18 | Secondary lines |
| `type.caption` | 100% / 500 | 12 / 16 | **Smallest informational size** |

Money always uses `tabular-nums`.

**Money formatting** (both platforms, amended 2026-09-26):
- `sign: 'negative'` (default): no "+", negatives show U+2212 before the currency.
- `sign: 'always'`: "+" or "−" on any value that is non-zero *after rounding*
  (−0.004 → `$0.00`).
- `alignSign`: puts a U+2007 figure space in an empty sign slot so signed
  columns align. **Zero is never signed.**
- `compact`: ≥ 1,000 → two decimals plus K/M/B/T, with rollover (999,999.99 →
  `$1.00M`); below 1,000 in full; negatives as `−$1.23M`.

| input | options | output |
|---|---|---|
| 56.8 | `sign: 'always'` | `+$56.80` |
| −3000 | `sign: 'always'` | `−$3,000.00` |
| 0 | either | `$0.00` |
| 1234567.891 | `compact` (default sign) | `$1.23M` |
| −0.004 | `sign: 'always'` | `$0.00` |

**Pinned for byte-identical platforms** (Orchestrator, 2026-09-26; both
workers test these):
- **Rounding:** `cents = Math.round(Math.abs(v) * 100)`, with the sign reapplied
  after rounding (so a value that rounds to zero is unsigned). Plain JS float
  behaviour, no `Intl` rounding and no half-even: `1.005 → $1.00`,
  `2.675 → $2.68` (2.675 × 100 is exactly 267.5, which rounds up; `toFixed` would give $2.67, which is why it is excluded). Grouping and currency are formatted from the integer cents.
- **Tug ratio:** `p = 0.5 + 0.5 · (you − opp) / max(|you| + |opp|, 1)`,
  clamped to `[0.08, 0.92]` so the trailing colour is always visible; both
  zero → `0.5`. (Board example: $56.80 vs $39.40 → 0.59.)
- **Digit diff:** right-aligned character diff (units align, so `$999.99 →
  $1,000.00` rolls from the right). **Mobile font delivery:** React Native
can't drive a variable font's width axis, so Phase 2 bundles **static
instances** cut from Archivo's variable TTF (OFL): `Archivo-Condensed-Black`
(wdth 62, wght 900), `Archivo-Expanded-ExtraBold` (125/800), and Archivo
400/500/600/700/800 at wdth 100, loaded with `expo-font`. Web loads the
variable font from Google Fonts and uses `font-stretch`.

### Space, radius, elevation

- `space`: 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 (`space.1`…`space.11`).
  Screen gutter 20, card padding 16, section gap 32.
- `radius`: `sm` 6 (chips), `md` 10 (inputs, buttons), `lg` 14 (cards), `xl` 20
  (sheets), `pill` 999. Scoreboard bands on mobile run edge to edge (radius 0).
- `elevation.money.card`: 1px `border.default` + shadow y2 blur8 at 4%.
  Game surfaces are flat, with no shadow. Sheets: y8 blur24 at 12%.

### Motion

As §4, as tokens `motion.duration.{instant,quick,base,slow,feature}` and
`motion.ease.{settle,exit}`, `motion.spring.{snappy,lively}`. `lively` is
importable only from game components.

### Brand

`brand.name`, `brand.wordmark` (swappable, see the name caveat) and
`brand.mark` (refined bars as an SVG component with an `accent` prop).

---

## 9A. One design, two themes (2026-09-29, supersedes the surface axis)

**Decision (Giorgio):** one design everywhere (the same layout, features and
components) in two complete themes, **Light** and **Dark**. The user picks in
Settings. No screen mixes the two: in Light, Matchup, the Draft room,
scoreboards and onboarding are light; in Dark, Portfolio, sheets and forms are
dark. A dark card inside a light screen (the old "stadium" scoreboard) is
exactly what this removes.

**Tokens.** Semantic names, one value per theme. The web source of truth is
`docs/design/screens/themes.css` (`--c-*`), which becomes `tokens.css`
`[data-theme="light" | "dark"]` blocks and the mobile theme objects.

| Token | Light | Dark | Role |
|---|---|---|---|
| `bg` | `#F3F5F8` | `#0D1B2E` | App background |
| `surface` | `#FFFFFF` | `#16263D` | Cards, sheets, tab bar base |
| `inset` | `#F0F3F7` | `#1E3250` | Panels inside cards, chips, cells, inputs on cards |
| `sunken` | `#EBEFF4` | `#0A1524` | Segmented tracks, recessed wells |
| `line` / `border` | `#E3E8EF` / `#DDE3EA` | `#263A58` | Dividers / card borders |
| `border-strong` | `#76828F` | `#8DA0BD` | Control borders (≥3:1) |
| `text` / `text-2` / `text-3` | `#0D1B2E` / `#5B6678` / `#8A94A3` | `#F3F6FA` / `#9AAAC4` / `#6B7D99` | Primary / secondary / **disabled or decorative only** (≈3:1; never information) |
| `accent` | `#2860F0` | `#7FA6FF` | Links, selected states |
| `you` / `you-text` | `#2860F0` / `#2860F0` | `#3366FF` / `#8AB0FF` | Your fills (white text on them ≥4.5) / your text |
| `opp` / `opp-text` | `#E8541F` / `#B93C0E` | `#FF6A3D` / `#FF8F66` | Opponent fills / text |
| `live` / `live-text` | `#C07E00` / `#8A5B00` | `#FFC53D` / `#FFC53D` | Live dot, clock ring / live tags |
| `gain` / `loss` / `zero` | `#12803F` / `#C8303A` / `#5B6678` | `#4ADE8B` / `#FF7A7A` / `#9AAAC4` | Money up / down / flat (zero never green) |
| `danger` | `#B42318` | `#FF8A80` | Errors |
| `loss-fill` | `#C8303A` | `#D93A44` | Sell / destructive button fill (white label ≥4.5) |
| `on-opp` | `#0D1B2E` | `#0D1B2E` | Text on opponent fills (white fails on Light orange) |
| `primary-bg` / `primary-fg` | `#0D1B2E` / `#FFFFFF` | `#FFFFFF` / `#0D1B2E` | Primary button |
| `inverse-bg` / `inverse-fg` | `#0D1B2E` / `#FFFFFF` | `#F3F6FA` / `#0D1B2E` | FINAL chip, selected toggle |
| `medal-gold` / `medal-silver` / `medal-bronze` / `on-medal` | `#B07A00` / `#7C8898` / `#C27036` / `#1A1407` | `#E8AF2E` / `#B9C3CF` / `#DC8A55` / `#0D1B2E` | **Season complete only.** A medal is a filled disc with the rank numeral (`on-medal` ≥4.5:1 on each fill); the disc is a graphic (≥3:1 on `surface` and on the `you-tint` row). Never medal-coloured text; names stay `text`. Replaces the legacy light-only `gold`/`silver`/`bronze` (2026-10-05). |

Plus `accent-tint`, `accent-wash`, `you-tint`, `gain-tint`, `loss-tint`,
`warn-*`, `track`, `scrim`, `tabbar`, `shadow` / `sheet-shadow` (none in Dark),
and `on-accent` / `on-opp`. The full list with contrast is computed live on the
key-screens board. **Two tables, both themes, all passing (76/76 at v3.1; 108/108 with the medal pairs, 2026-10-05):** every
text token ≥ 4.5:1 and graphic token ≥ 3:1 on `surface`, AND every
foreground-on-fill pair the components render (text on `you`, `opp`,
`loss-fill`, `primary`, `inverse`, `inset`, `sunken`, the tints and the tab bar),
with translucent tints composited over what they sit on. A token-on-surface
check alone missed three failures (white on Dark `you`, white on Dark sell red,
white on Light `opp`); the pair table is the evidence that matches the claim. Yellow, orange and bright blue get darker
`*-text` cuts in Light because they fail as text on white.

**Emphasis without an inverted surface.** Scoreboards stand out through:
- the condensed 900 score type, the largest thing on any screen;
- the `scoreboard` card variant: the theme's surface with a faint accent wash
  at the top and a hairline border;
- the tug bar and live dot in colour, and broadcast tags (still the only
  uppercase);
- motion: digit rolls, lead changes, FLIP re-sorts.

**Settings.** Profile › Appearance offers System / Light / Dark, with System as
the default, saved on the device. The web has the same control under Settings ›
Appearance, saved in the browser. Giorgio asked for a simple light/dark switch.
System is the Design Lead's recommendation; cut it to two options if he
prefers.

**Component API changes** (foundation PR #53, then web):
- `<Surface kind="money" | "game">` is removed. A `ThemeProvider` at the root
  supplies `light | dark`: System resolves via `useColorScheme()` on mobile and
  `prefers-color-scheme` on web. One `<Card>` with `variant="scoreboard"`.
- Delete every `*.onGame`, `surface.money.*` and `surface.game.*` leaf; add the
  semantic set above.
- `Button` drops its on-game variant; `primary` reads the theme.
- `ScoreDigits`, `Scoreboard`/`TeamRow`, `TugBar`, `Chyron`, `LiveDot`,
  `PhaseChip`, `SegmentedControl`, `Sheet`, `EmptyState` and `Money` read theme
  tokens only. No component checks for a game surface.
- Tests: `tokens.parity.test.ts` covers both themes leaf by leaf, plus a new
  contrast test asserting BOTH tables (token-on-surface AND the full
  foreground-on-fill pair list, tints composited) for both themes. A new
  component that puts text on a fill adds its pair to the list.

## 10. What happens next

1. **Phase 2 Foundation** worker prompts (mobile + web) are drafted and sent
   to the Orchestrator. No backend asks block Phase 2.
2. Phases 3a–3d and 4 prompts follow after Phase 2 merges; 3b/3d depend on
   backend asks 1–2 and 5 (§7).
