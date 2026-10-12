# What to take from Hallmark (nutlope/hallmark): adopt / adapt / skip

> Design Lead, 2026-10-12 (W0b of `docs/plans/2026-10-12-visual-language-reset.md`).
> **Status:** the plan (decision 8, Giorgio 2026-10-12) adopts Hallmark **as a tool for the
> Design Lead, never as the designer**: `study` on the references, its gates and disciplines
> through this table, and `audit` on every board frame. The **gate-process** rows below
> (§3.1) take effect now, the way the impeccable gate format did, because they are the Design
> Lead's own process. The rows that would change **how the product looks** (§3.2) are proposals
> that land in the v3 token spec (DESIGN_DIRECTION §9C) after Giorgio picks a direction.
>
> **Source:** the Hallmark skill as installed at `~/.agents/skills/hallmark` (MIT, pure
> markdown): `SKILL.md`, `references/study.md`, `slop-test.md` (58 gates + the pre-emit
> self-critique), `anti-patterns.md`, `design-md.md`, `verbs/audit.md`. Read, not executed;
> it ships no scripts. Ideas are summarised in our words and attributed.
>
> **What it produced first:** [`../design.md`](../design.md), the studied DNA of the five
> references (`hallmark study`, image mode, pixel-sampled).

## 1. Hallmark in one paragraph, and why most of it is not for us

Hallmark is an anti-"AI slop" skill for **web pages**: it picks a page macrostructure (21
named shapes), a nav and footer archetype, one of 21 catalog themes, rotates them so two
builds never look alike, then runs 58 yes/no gates before handing back. Roughly half of
that machinery is about web marketing pages (heroes, navs, footers, responsive CSS, video
LCP) and about **variety between builds**, which is the opposite of what an app needs: our
screens must share one system. What transfers is the part that judges *taste* — a short
self-critique, honest copy, tokens that never improvise, tinted neutrals, accent by area,
decoration only with a reason — and the `study` method itself. DESIGN_DIRECTION §9B (the
native craft floor, from impeccable) stays the authority on anything native; where Hallmark
and §9B disagree, §9B wins.

**The one rule of Hallmark's we bend on purpose.** `study` says "one source, one diagnosis"
(never blend five references). The plan asks for one merged `design.md`. We comply in spirit:
the merge is **by surface**, each surface has ONE backbone reference, and each W1 direction
has ONE primary source (see `design.md` § Merged DNA). Averaging the five is what we refuse.

## 2. Gate by gate

Key: **ADOPT** = take as is (in our words). **ADAPT** = keep the intent, change the form for
native / for our rulings. **SKIP** = web-only or about variety between builds. **CONFLICT** =
clashes with a Giorgio ruling or §9B; not adopted. "Have" = already ours.

### The six disciplines and the self-critique

| # | Hallmark | Call | How it lands here |
|---|---|---|---|
| D1 | **Pre-emit self-critique**: score Philosophy, Hierarchy, Execution, Specificity, Restraint, Variety 1–5; any < 3 forces a revision | ADAPT | Every board frame and every gate report carries the six scores. "Restraint" is renamed **Earned** (everything on screen earns its place; the vocabulary rule bans the old word for visual rulings), and **Variety** is scored *between the three directions* (do A, B, C read as three systems?), never between screens of one direction, which must match. |
| D2 | **Honest copy, no fabricated content** (gate 46) | ADOPT (have) | Matches "verify the effect" and the Matchup ruling: no projections, win %, invented streaks or stats. Every number on the board is derived from `data.js` or captioned "sample". |
| D3 | **Locked tokens**: every colour/font through a named token (gate 48) | ADOPT | Each W1 direction is one token block; frames reference roles only. A value a frame needs and lacks becomes a named token first. This is how §9C will be checked. |
| D4 | **No re-drawn chrome** (gate 47) | ADAPT | The board's device frames are a presentation tool, not product, and stay. In the *product*, no fake system UI. |
| D5 | **Mobile responsiveness at 320/375/414/768px** (gates 34, 49–53) | ADAPT | Native equivalent: the two gate phones (17e, 17 Pro), at Large and XL text; no truncated tappable labels; no horizontal overflow. The web CSS mechanics (`overflow-x: clip`, `minmax(0,1fr)`) are skipped. |
| D6 | **No italic headers** (gate 38a) | ADOPT (have) | Archivo is roman everywhere; keep it that way. |

### Visual (1–7)

| # | Gate | Call | Why |
|---|---|---|---|
| 1 | Display face is Inter/Roboto/Poppins/system default | ADOPT (pass) | Archivo. A direction that argues a second display face names it and its cost. |
| 2 | Purple-blue / cyan-magenta gradients, gradient text | ADOPT | Matches the reset's ruling that game surfaces are **flat** (Sleeper's glow belongs to the picks side Giorgio excluded). No gradient text, no gradient pills. |
| 3 | Three equal icon-tile columns | ADOPT (lens) | Applies to the season-complete tiles and any stat row: tiles must differ in content weight, not be decorative triplets. |
| 4 | Card nested in a card | ADOPT (have, impeccable #15) | |
| 5 | **Thick coloured side-stripe on a card** | **ADAPT** | Hallmark bans it as decoration. ESPN (panels) and E*TRADE (index strip) use a 3–4pt outer-edge bar as a **state code**, and `design.md` lists it as recurring DNA. Allowed only when the bar encodes a state (lost / won / live), always paired with a sign or word, on a row/cell (never a card's decoration), on the outer edge. Anywhere else it is a finding. |
| 6 | Full-viewport centred hero | SKIP | Web. Our heroes are left-aligned by §9 and the calm-Home structure. |
| 7 | **Pure `#000` / `#fff` as a base** | **ADAPT** | Robinhood's page is literally `#000`, and direction C ("Terminal") borrows it. Proposed: C uses a near-black tinted toward its accent hue (≈ oklch(8–10% ≥0.005 h)), which reads as black on OLED and passes gate 22. If the board shows true black is materially better, C may argue for it, and the deviation is named on its frame. Light theme: no pure white page. |

### Structure and variety (8, 9, 20, 21, 32)

| # | Gate | Call | Why |
|---|---|---|---|
| 8 | Same structure as a previous build | SKIP | Our structure is fixed by Giorgio (calm Home, the Matchup ruling). Sameness *across our screens* is required (UX rule 5). |
| 9 / minor "every section padded the same" | Sections separated only by equal whitespace, identical rhythm | **ADAPT** | The 24pt block gap is a structure ruling and stays uniform. "Every section must elevate" is met by giving each section its **own treatment** (the chart sits bare, the scoreboard is a lit card, standings rows separate by surface), not by varying the gap. A screen whose sections all wear the same card is the finding. |
| 20 | Stamp missing | ADAPT | Each direction's board section header names its primary source and the traits taken ("A · Game Night · primary S1/S2 Sleeper"), the board's equivalent of the stamp. |
| 21, 32 | Specimen fall-through; same archetype knobs | SKIP | Web catalog. |

### Microinteractions (10–19)

| # | Gate | Call | Why |
|---|---|---|---|
| 10 | `transition: all` | SKIP | No CSS in the app; RN animates named values. |
| 11 | Uniform hover-scale everywhere | ADAPT | No hover on iOS. The touch equivalent: `PressableScale` is the one press feedback, one value, used where a whole card is tappable (This week, Standings); not added to rows that already highlight. |
| 12 | Bounce/overshoot on UI state | ADOPT (have, §4) | `lively` stays for the scoreboard and draft only. |
| 13 | More than one effect at once | ADOPT | A press is scale OR highlight, never both plus colour. |
| 14 | Animating layout properties | ADOPT | Reanimated on transform/opacity; height changes use layout animations sparingly. |
| 15 | Focus ring that fades in | SKIP | Web keyboard focus; VoiceOver focus is system-drawn. |
| 16 | Celebratory toast for a visible effect | ADOPT | Silent success where the screen already shows the result. UX rule 11's endings ("Yours. Next pick in 4 turns.") are content, not toasts, and stay. |
| 17 | Tooltip delays | SKIP | No tooltips. |
| 18 | Auto-rotating content without pause | ADOPT | Nothing auto-rotates; if a league carousel ever does, it pauses on touch and under Reduce Motion. |
| 19 | Placeholder names / startup clichés | ADOPT (pass) | `data.js` uses a real-feeling league; keep it. |
| anti | **Confirmation dialogs for reversible actions → optimistic + Undo** | **CONFLICT** | UX rule 9: never optimistic for money or picks. A trade or pick shows "Sending…" then the server's answer. Optimistic + Undo stays allowed only where the rule already allows optimism (queue order, settings). |
| anti | Spinners that flash | ADOPT (have) | Skeletons, not spinners (UX rule 9). |

### Implementation (22–27)

| # | Gate | Call | Why |
|---|---|---|---|
| 22 | **Zero-chroma neutrals** (min 0.005) | ADOPT | Named in the plan. ESPN's charcoal is ≈ 0.003 chroma, so direction B tints its neutrals to ≥ 0.005 toward its frame colour. |
| 23 | **Accent > ~5% of a viewport** | ADOPT | Named in the plan ("accent-by-area"). Gain/loss green and red are **data colours**, not the accent, and are counted separately; the accent (cyan / league colour / neon) stays ≤ 5% per frame, as every reference does (1–3%). |
| 24 | Off-scale spacing | ADOPT (have) | `space` tokens, 4pt grid. |
| 25 | Prose measure 45–75ch | SKIP | Little prose; rule text is short. |
| 26 | Eight interactive states | ADAPT | Native set: default, pressed, disabled, loading ("Sending…"), error, success, plus selected where relevant; VoiceOver traits instead of `:focus-visible`. |
| 27 | Motion without a reduced-motion fallback | ADOPT (have, §5) | |

### Enrichment, assets, safety (28–36)

| # | Gate | Call | Why |
|---|---|---|---|
| 28 | Video autoplay / LCP | SKIP | Web. |
| 29 | Abstract backgrounds, aurora blobs | ADOPT | No blobs or mesh. One lit element per screen at most (the "you, now" element: your turn, the live score). |
| 30 | Mixed icon sets / emoji as icons | ADOPT (have, §9B) | Ionicons via `sp/Icon`. |
| 31 | Lottie by default | ADOPT | Reanimated or drawn SVG first. |
| 33 | Decorative art without a label or hide | ADAPT | `accessibilityLabel` on charts and tiles that carry data; `accessibilityElementsHidden` on pure decoration. |
| 34 | Horizontal scroll | ADAPT | See D5. |
| 35 | Text decorations positioned by eye | ADOPT | The range-tab underline and mark underline are measured (the F1 lesson). |
| 36 | Mixed-height rows not vertically centred | ADOPT | Roster rows (avatar + two text lines + number) centre on one axis. |

### Typography (37–38a, 55)

| # | Gate | Call | Why |
|---|---|---|---|
| 37 | More than three families | ADOPT (pass) | Archivo's widths are one family. |
| 38 | Outlier face in more than two slots | SKIP | No outlier face today. If a direction adds a display face, it gets at most two slots (scores + one hero). |
| 38a | Italic headers | ADOPT (have) | |
| anti | **Tabular data without tabular figures** | ADOPT (have) | Money always tabular. Applies to standings, roster rows, draft tiles. |
| 55 | Uppercase display with line-height < 1.0 | ADOPT | Broadcast tags and any caps scoreboard label keep line-height ≥ 1.0. |

### Inputs, contrast (39–41)

| # | Gate | Call | Why |
|---|---|---|---|
| 39 | Input states (no border-width shifts, shared heights, reserved helper slot, 3-channel disabled) | ADOPT | Search, draft-time picker, league code. |
| 40 | Contrast thresholds per computed background | ADOPT (have, PAIRS) | The 108-pair test re-runs for the new palette, measured against **the darkest and lightest point** of any lit surface (the plan's risk note). |
| 41 | Button text ≈ fill; accent-ink missing; ink-on-ink in dark panels | ADOPT | Every filled accent (cyan pill, lime pill, tiles) defines its `on-` ink. The references put **dark text on bright fills** (Sleeper tiles, DRAFT, YOUR TURN; Robinhood's selected pill); white on cyan would fail. |

### Chrome, honesty, tokens (42–49, 54, 56, 57)

| # | Gate | Call | Why |
|---|---|---|---|
| 42, 43, 44 | AI nav / AI footer / hero fold | SKIP | Web chrome. Our fold rule is the calm-Home 17e ruling. |
| 45 | **Decorative without purpose** | ADOPT | Named in the plan ("decoration-with-purpose"). Example from the study: Sleeper's centre emblem badge between the two teams is decoration; we don't carry it. Each lit element answers "what does it tell me?" |
| 46 | Invented metric | ADOPT | See D2. |
| 47 | Re-drawn chrome | ADAPT | See D4. |
| 48 | Mid-render token improvisation | ADOPT | See D3. |
| 49 | Two-line tappable text | ADOPT | Tab labels, pills, buttons stay one line at XL; they shrink or abbreviate by rule, never wrap. |
| 54 | Eyebrow beside the heading | ADAPT (impeccable #13) | Our broadcast tags are approved identity; they always stack above their title, carry information, and never repeat an adjacent chip. Never tag-left/title-right. |
| 56 | Two sticky elements at the top | ADAPT | If Matchup pins its scoreboard while the roster scrolls (ESPN does), it is the only pinned element under the header. |
| 57 | **Studied DNA discarded for a stock theme** | ADOPT | The v3 token spec cites `design.md` for every role, or names why it departs. A §9C that drifts back to a generic dark theme fails this. |

### Hallmark's machinery

| Piece | Call | Why |
|---|---|---|
| `study` (image / URL) | ADOPT (used) | Produced `design.md`. Image mode with pixel sampling; URL mode is useless on App Store pages (SPA, marketing chrome). |
| `audit` (read-only punch list: tell · where · severity · fix) | ADOPT | Run on every W1 frame before Giorgio sees it, beside the `ux-reviewer`. Severity maps: critical → P1, major → P2, minor → P3. It audits the frame's source and its capture. |
| `redesign`, the default build flow | SKIP | Hallmark never designs here; the Design Lead does, on the board. |
| Genres, 21 macrostructures, nav N1–N13, footer Ft1–Ft8, 21 themes | SKIP | Web page machinery. |
| Diversification, `.hallmark/log.json` project memory | SKIP | We want sameness across screens. `.hallmark/` is gitignored and holds nothing of ours. |
| Hero enrichment tiers (typography → CSS → SVG → still → library → Lottie) | ADAPT | The order of preference is good for illustration (champion medallion, invite art): drawn first, Lottie last. |
| `design.md` lock at the project root | ADAPT | Ours lives in `docs/design/` and is NOT a lock; §9C is the lock, after the pick. |
| `tokens.css` emission, Tailwind / DTCG / shadcn exports | SKIP | Our tokens live in `apps/mobile/constants/tokens/*` and the board's `themes.css`. |
| APCA as an alternative to WCAG ratios | SKIP | PAIRS uses WCAG 2.x ratios; keep one method. |

## 3. What changes, concretely

### 3.1 The Design Lead's gate (process; in force from W1)

Added to the gate report format (UI-UX-PROGRAM "Design review gate"), after the reference
check:
1. **Self-critique scores** (D1): Philosophy · Hierarchy · Execution · Specificity · Earned ·
   Variety, 1–5 each; any < 3 is a revision before the gate is sent.
2. **`hallmark audit` punch list** on each frame or capture, severities mapped to P1–P3.
3. Mechanical checks added to §9B's list: tinted neutrals (≥ 0.005 chroma) · accent ≤ 5% of
   any frame by area (data colours excluded) · every colour a named token · every lit or
   decorative element names its purpose · outer-edge bars only as a state code with a sign
   or word · dark-on-bright inks for every bright fill.

### 3.2 Proposed for the v3 token spec (§9C, with the direction)

- Neutrals carry a hue (≥ 0.005 chroma); no pure black or white base, unless C argues
  otherwise on its frame.
- The accent is one role with a measured footprint; gain/loss are separate data roles.
- Depth on dark by lightness steps of one hue, never shadow or glow (Hallmark "shadow-glow
  on dark" + every reference). One lit element per screen, for "you, now".
- Row separation by surface (tint, gutter, space), never by rules. This is the standings fix.
- The state bar: 3–4pt, outer edge, state colours only, always with a sign or word.
- Every chart has a designed 0- and 1-point state; the line stops at "now".

## 4. Safety note

The skill files are instructions for an agent. Read as data; nothing was run. Its `study`
protocol's remote-URL rules were followed (public https pages only, no scripts executed);
the screenshots were viewed in the built-in browser and sampled there, not downloaded into
the repo.
