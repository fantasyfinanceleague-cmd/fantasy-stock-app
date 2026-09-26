# Stockpile Design Direction (Phase 1)

> Author: Design Lead. Date: 2026-09-26. Status: **AWAITING GIORGIO'S PICK.**
> Nothing in Phase 2+ starts until this is approved (charter checkpoint).
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

## Decisions needed from Giorgio

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
`:1245`), so every matchup leads with dollars. Every data colour passes WCAG AA
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

Calm by default, loud on game day. Money screens (Team/portfolio, stock
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
| Names | `color.surface.money.base`, `color.surface.game.base`, `color.text.primary`, `color.data.gain`, `type.score`, `type.body`, `motion.duration.base`, `motion.ease.settle` … identical strings on both platforms |
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
Tab bar (4):   Home      Matchup      League      Team
Header:        [league pill ▾]  on Matchup / League / Team      [avatar] on Home
```

- **Home**: cross-league overview (the planned 3b rebuild). Total value,
  an honest performance chart (§7 ask 3), "This week" matchup strip (one card
  per live league), your leagues grouped by phase. Avatar → Profile & settings.
- **Matchup**: your matchup in the active league, with a segmented control
  for **All matchups this week** in that league.
- **League**: standings, schedule, history, league settings (commissioner).
  While the league is pre-draft or drafting, the tab **becomes the draft room
  entry** (a phase takeover, not a banner). After the draft, **Draft recap**
  lives under History.
- **Team** (renamed from Portfolio): your holdings in the active league,
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
| 3 | **Daily portfolio value series** per user per league (week snapshots are weekly only) | Honest Home/Team performance chart | All (without it the chart shows weekly points) |
| 4 | **Intraday value samples** per matchup participant (e.g. every 15 min during market hours) | C's racing lines; B's optional "momentum" sparkline | **C required**, B optional |
| 5 | Trade history view that **unions draft picks with trades** (text/uuid + numeric casts per CLAUDE.md) | Team → history | All |
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
| 0:00–0:04 | Cold open | Black → the S-curve mark draws its arrow | Single hit |
| 0:04–0:09 | The premise | Split screen: two phones, two friends' names | "Your portfolio." / "Their portfolio." |
| 0:09–0:15 | The draft | Draft room: five picks snap into a team, tickers flying in | "Draft real stocks." |
| 0:15–0:20 | Monday open | Scoreboard wipes in at 0.00 vs 0.00; the bell | "Every week is a matchup." |
| 0:20–0:30 | The week (drop) | Tug-of-war swinging across days, chyrons: "NVDA +4.1% puts you ahead", "TSLA drags Priya" | Beat-synced cuts |
| 0:30–0:36 | Friday close | Clock hits 4:00 PM ET; scores lock; the Friday reveal | Silence, then the win beat |
| 0:36–0:41 | The league | Standings re-sort; you move up to 2nd | "Climb the league." |
| 0:41–0:45 | Close | Mark + "Stockpile. Launching soon." Disclaimer line | Tail |

Real simulator footage can replace the 0:09–0:15 and 0:36–0:41 beats.
Remotion's licence is confirmed before anything is published.

---

## 9. What happens after approval

1. I update this document to the chosen direction only: the full token table,
   the component list, and anything Giorgio changed.
2. I draft the **Phase 2 Foundation** worker prompt (tokens + primitives +
   motion hook + lint rules + `.claude/launch.json` web entry) for the
   Orchestrator to spawn.
3. Phases 3a–3d and 4 prompts follow in order after Phase 2 merges.
