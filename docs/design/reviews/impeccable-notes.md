# What to take from "impeccable" (pbakaus/impeccable): a proposal

> Design Lead, 2026-10-05. **STATUS: ADOPTED by Giorgio (2026-10-05): "adopt", all of §3, and iPad = A (phone-only for 1.2.0).** Now in DESIGN_DIRECTION §4 "Motion craft", §9 (type floor), §9A (colour rules) and §9B (native craft floor), in UI-UX-PROGRAM's gate format, and in the 3c/3e prompts. The CONFLICT rows (§4 of this note) stay not adopted. Below is the proposal as reviewed.
>
> **Source:** `pbakaus/impeccable` @ `a40571a` (2026-10-06), **Apache-2.0**. Read read-only through the GitHub API: `.claude/skills/impeccable/SKILL.md` and 19 files in `reference/` (critique, audit, audit.native, ios, android, adapt.native, animate, typeset, layout, colorize, polish, harden, craft-floor, clarify, delight, quieter, bolder, distill, component-review). Ideas are summarised in our words and attributed; nothing is pasted at length.
>
> **Safety:** nothing was cloned, installed or run. The files contain agent directives, which were treated as data and not acted on. Quoted for the record:
> - `SKILL.md`: "Run `<skill-base-dir>/scripts/impeccable context` once per session … The launcher runs a self-contained binary that ships next to it or is downloaded once on first run".
> - `critique.md`, `component-review.md`, `polish.md` and `typeset.md` repeatedly instruct running `.claude/skills/impeccable/scripts/impeccable <verb>` (detect, critique-storage, component-review serve, and so on).
> - `critique.md` makes its two-sub-agent "assessment" mandatory and calls a skipped detector "a failed critique run".
>
> None of that applies to us. We only take ideas.

## 1. Their method in one paragraph

A design pass starts from the **surface's mode**:
- *Persuade*: landing and marketing;
- *Operate*: app UI;
- *Read*: docs;
- *Experience*: galleries.

The mode decides how much expression may override convention. Every edit then clears a **craft floor** of mechanical checks (contrast, spacing, type, motion, states, copy) plus a list of **category defaults to refuse** unless the brief earns them. Reviews come in two kinds:
- a **critique**, which is a design-specificity verdict ("authored for this product, or interchangeable?"), Nielsen's 10 heuristics scored 0–4, a cognitive-load checklist, persona walk-throughs, and P0–P3 issues;
- an **audit**, which is technical: on native, accessibility, performance, theming, platform conformance and adaptivity, each scored 0–4, with a "does this read as a ported website?" verdict.

Refinement passes (polish, harden, clarify, layout, typeset, colorize, animate, distill, bolder or quieter) each start with an assessment, state a one-line thesis, then fix the cause at the narrowest level. For native apps, platform conventions (HIG / Material) govern structure and interaction in every mode, and brand lives in what the platform leaves open: tint, type, motion and content.

## 2. Rule by rule: do we already do it, and should we?

Key: **ADOPT** = take as is (in our words). **ADAPT** = take the intent and change the form. **SKIP** = not for us. **CONFLICT** = clashes with a Giorgio ruling or the board, so not adopted (see §4).

| # | Their rule / heuristic | Us today | Call | Why |
|---|---|---|---|---|
| 1 | Name the surface's **mode** (Operate vs Persuade…) before designing | Implicit: the app is Operate, the landing (3a) is Persuade | ADAPT | Write it into each phase prompt: "Operate, with Persuade *moments*" (signature moments, the Friday reveal, the champion card). It stops expressive work spreading into routine screens. |
| 2 | **The brief wins; refinement preserves** identity, behaviour and copy | Yes: verbatim copy, decisions-as-mockups, the board as truth | — | Already our law. |
| 3 | Contrast ≥ 4.5 / 3 in both appearances, translucent tints measured as rendered | Yes: §9A tokens + composited PAIRS, 108/108 | — | We're ahead: pair-level, both themes, live on the board. |
| 4 | On coloured fills, secondary text is tinted from the fill, never grey | Partly: `on-*` tokens exist for fills; no rule for *secondary* text on tints | ADOPT | A small §9A addition: secondary text on a tint uses a hue-derived token, and its pair goes in PAIRS. |
| 5 | Adjacent type roles differ by an **obvious step**; repeated roles identical everywhere | Partly: §9 role scale | ADOPT | A gate question: "can you tell caption from callout from title without reading?" We have near-neighbours (11/12/13 pt captions/callouts). |
| 6 | **11 pt text floor** (iOS) | No rule. The board uses 10–11 px chips; the "New" chip I drew is 10 px | ADOPT | A hard floor in §9 and the gate. Chips and tags go to ≥ 11 pt. |
| 7 | Dynamic Type through system text styles; no fixed sizes | Yes: type tokens with `maxScale`, XL captures on the 17e | — | Already gated. |
| 8 | **44 × 44 pt hit areas**, even when the visible mark is small | Not explicit | ADOPT | We have text-link actions with small visible marks: "Nudge again · Remove", "Change", "Invest ›", "Share", the pill's "+N". Each needs a ≥ 44 pt hit area, verified in review (hitSlop / padding). |
| 9 | Edge-swipe back always works; sheets swipe to dismiss, with Cancel/Done; guard only against data loss | Partly (3b-1 sheets) | ADOPT | A gate line. A trade review mid-confirm is the one place a dismiss guard is justified. |
| 10 | Prefer **platform controls** (switch, segmented, action sheet, context menu, swipe actions); reinventing them "for flavour" is the commonest native slop | We use custom `sp/` controls | ADAPT | Keep our visuals; require platform *behaviour*: accessibility roles/traits (segmented = tablist/adjustable), haptics, and destructive confirms as a native action sheet. Audit `sp/SegmentedControl` and the sheet. |
| 11 | **One icon system; no Unicode glyphs or emoji standing in for icons** | No. We use `ⓘ` (the unpriced caption), `▲/▼` (standings moves), `✓` ("Running back", the Done check), `●` (dots) | ADOPT | Replace glyph-icons with `sp` icons, drawn at one stroke and weight. Dots stay as drawn shapes, not characters. Cheap, and it removes font-dependent rendering. |
| 12 | Large titles on top-level screens, collapsing on scroll | No: the shell header is the pill + avatar | CONFLICT | The 3b-1 header is Giorgio-approved. Not adopted. |
| 13 | **Ban: a kicker/eyebrow above a heading** | We use broadcast tags ("THIS WEEK", "SEASON 2 · DRAFT", "SEASON COMPLETE") as identity | CONFLICT → ADAPT the spirit | The board's tags are approved identity. The useful kernel: a tag must carry information, never decoration, and never repeat what's beside it. (In my own Run it back frame the card repeated the header's "Pre-draft" chip, which I removed.) Add it as a review lint. |
| 14 | **Refuse the "hero metric" template** (big number, small label, supporting stats) | Home's hero is exactly that (D1, Concept A) | CONFLICT | Ruled by Giorgio. In a fantasy-finance app the team value is the product's core datum, not decoration. |
| 15 | Same-size cards as page structure; never nest cards; use spacing before containers | Partly: Home, Portfolio and League are stacks of cards | ADAPT | Not a rule change. A review lens for 3c/3e: secondary lists (slots, trade-history entry, settings) may read better as grouped rows than as one more card. Any change goes to Giorgio as mockups. |
| 16 | **One authored motion moment per surface**; "removing it would lose meaning" test; write a one-line *motion thesis* | Yes in spirit: signature moments per phase (H1–H6, G1–G6, M1–M5) | ADOPT | Two additions: each PLAN states a one-line motion thesis, and the gate asks of every animation "what is lost if it's removed?" |
| 17 | Timing by consequence; **exit faster than entrance**; no bounce by reflex | Mostly (§4 tokens; `lively` only on scoreboard/draft) | ADOPT | "Exit < entrance" becomes an explicit §4 line (sheet dismiss, toasts). |
| 18 | **Content is visible in its default state**; animation starts from an already-visible state | No: entrances start at opacity 0 | ADOPT | 3b-2's B1 showed the risk: an animation that silently doesn't run must never leave content hidden. The resting state is visible; entrances animate *from* a near-visible state, or are skipped. |
| 19 | **Non-essential loops stop when off-screen or hidden** | No rule | ADOPT | The live dot and chart pulse pause when the screen isn't focused or the app is backgrounded (battery, and §4's "only the live dot loops"). |
| 20 | Reduced motion = fewer, gentler animations; keep meaningful feedback | Yes (§5) | — | Already law. |
| 21 | Colour as **roles** not swatches; dark mode composed, not inverted; prefer explicit colours where alpha makes contrast context-dependent | Yes (§9A) | — | We composite tints in PAIRS. Nothing to add. |
| 22 | **Colour is never the only code** | Mostly: signs + U+2212, W/L letters, Bye chips | ADOPT (check) | A gate line: the tug bar, medals and phase chips each carry text or a shape for VoiceOver and colour-blind users. |
| 23 | **Squint test** for reading order; deliberate tight/generous rhythm; 4-pt scale | 4-pt tokens, yes; squint test, no | ADOPT | The first gate question per screen: blur it, and the primary, secondary and groups still read in order. |
| 24 | **Cognitive load**: ≤ 4 visible options per decision; one primary action | Not explicit | ADOPT (lens) | Apply to dense screens: the stock sheet (ranges + Buy/Sell + position), Start draft and the settings review. |
| 25 | Copy: errors say *what failed, why (if useful), how to recover*; no internal codes; confirms name the action (never Yes/No/OK); whole sentences, no concatenated fragments | Yes for refusals (3c/3e copy, "no blame", reason→copy maps) | ADOPT (two lines) | Add "confirm buttons name the action" and "no sentence built from fragments" to the copy rules (it also keeps future localisation possible). |
| 26 | **Harden with extreme inputs**: long names, huge numbers, many items, offline/slow, rate limits | Partly (XL, $123,456.78) | ADOPT | A standard stress fixture per phase: 20-character usernames, 40-character league names, ≥ $1,000,000 values and losses, 16 managers, 1,000+ history rows (virtualised list), offline/slow (stale-data state), `rate_limited`. |
| 27 | i18n / RTL readiness | English-only, US market | SKIP (for now) | Item 25's whole-sentence rule keeps the door open. |
| 28 | Polish **triage order** (broken tasks → missing states → drift → visual/motion → cleanup) and **drift classes** (missing token / one-off / conceptual mismatch / local defect) | Informal | ADOPT | Use both in my review reports, so workers fix causes at the right level. |
| 29 | **P0–P3 severity** on every finding | We use blocking / should-fix | ADOPT | Map: P0 broken or misleading, P1 blocking for the gate, P2 should-fix, P3 polish. Same meaning, clearer triage. |
| 30 | Native audit: 5 dimensions scored 0–4 (accessibility, performance, theming, conformance, adaptivity) | Not scored | ADAPT | A short scorecard at the top of each DESIGN-APPROVED, so trends are visible across phases. Cheap. |
| 31 | Nielsen's 10 heuristics scored per critique | No | ADAPT | Too heavy for every gate. Use once per phase on its key screen. |
| 32 | **Persona walk-throughs** with named red flags | No | ADOPT | Three of ours: *the invitee* (joined by code, never traded), *the commissioner* (runs draft and renewal), *the active trader* (checks daily, sells and rebuys). Each walks the phase's main path in the gate. |
| 33 | **Design-specificity verdict**: authored for this product, or interchangeable with any app? | Yes in spirit (the ambition bar) | ADOPT (wording) | Make it gate question #1, in exactly that framing. |
| 34 | Delight proportional to frequency and consequence; never whimsy on money or loss | Yes (the reveal celebrates wins only; errors instant) | — | Matches §4. |
| 35 | One primary goal and one primary action per screen | Mostly | ADAPT | A lens with item 24. |
| 36 | **Never ship a stretched phone layout on a tablet** | **No.** `apps/mobile/app.json` has `"supportsTablet": true`, and no iPad layout is designed or gated | **ADOPT: a decision for Giorgio (P1)** | See §3.4. |
| 37 | Screenshots from the simulator, both appearances, large type; say which device produced the evidence | Yes (A-standard L/D, XL 17e) | — | Already. |
| 38 | Web: theme the parts you didn't draw (selection, caret, focus ring, scrollbars, tabular numerals) | n/a to mobile | ADOPT for 3d | Add to the 3d web prompt. |
| 39 | Their tooling (detector, critique snapshots, two isolated sub-agents, live mode, hooks) | — | SKIP | Tool plumbing, and the launcher downloads and runs an unreviewable binary. Out of bounds. |
| 40 | SF Pro carries the UI; brand face only for display | Archivo carries the whole UI | CONFLICT | Board-approved identity. Not adopted. Dynamic Type behaviour (item 7) is what matters, and we have it. |

## 3. Proposed additions, in our words

### 3.1 DESIGN_DIRECTION (for Giorgio's OK)

- **§4 Motion:**
  - each surface names **one authored moment** and a one-line motion thesis;
  - **exit is faster than entrance**;
  - **content is visible at rest**: an animation that doesn't run never hides content;
  - **non-essential loops pause** off-screen and in the background (the live dot included);
  - every animation passes "what's lost if it's removed?" *(after impeccable, animate/craft-floor)*
- **§9 Type:**
  - **11 pt floor** for any text, including chips and tags;
  - adjacent roles differ by an obvious step. *(after impeccable, ios/typeset)*
- **§9A Colour:**
  - secondary text on a tinted fill uses a hue-derived token, scored in PAIRS;
  - **colour is never the only code**. *(after impeccable, colorize/craft-floor)*
- **Icons:** one drawn icon set; **no Unicode glyphs or emoji as icons** (replace `ⓘ ▲ ▼ ✓`). *(after impeccable, craft-floor/ios)*
- **Interaction:**
  - **≥ 44 pt hit areas** for every tappable element, including text links;
  - edge-swipe back is never disabled;
  - sheets dismiss by swipe unless it would lose data;
  - destructive confirms use a native action sheet with the action named on the button. *(after impeccable, ios/clarify)*
- **Copy rules:**
  - confirm buttons name the action (never Yes/No/OK);
  - messages are whole sentences, never stitched from fragments. *(after impeccable, clarify)*
- **Tags (our adaptation of their eyebrow rule):** a broadcast tag must carry information and must not repeat an adjacent chip or title.

### 3.2 My DESIGN-APPROVED gate (I can adopt these myself: process, not product)

Every gate report would start with:
1. **Specificity:** is this authored for Stockpile, or interchangeable with any app?
2. **Squint test** per key screen.
3. **Scorecard** (0–4 each): accessibility · performance · theming · platform conformance · adaptivity.
4. **Persona walk** (invitee / commissioner / trader) on the phase's main path, with named red flags.
5. **Findings tagged P0–P3**, each with a drift class (missing token / one-off / conceptual mismatch / local defect), fixed in triage order.

Plus these mechanical checks:
- 44 pt hit areas, measured;
- the 11 pt floor;
- no glyph-icons;
- motion: thesis present, exit < entrance, visible at rest, loops paused off-screen;
- the stress fixture (item 26) captured;
- ≤ 4 visible choices at decision points;
- colour-only codes have a text or shape twin.

### 3.3 Phase prompts (3c / 3e now, 3d later)

- **3c and 3e:** add the stress fixture, the 44 pt hit-area check on text-link actions, and the glyph-icon replacement in their own screens. These are small and in scope.
- **3d (web):** add item 38 (theme selection, caret, focus ring, scrollbars, tabular numerals).

### 3.4 One decision for Giorgio now: iPad (P1)

`apps/mobile/app.json` sets `"supportsTablet": true`, but nothing in 3b–3e designs or captures an iPad layout. On an iPad the app would show a stretched phone UI, which is exactly what the native guidance says never to ship.

The options, as board mockups after his OK to look at them:
- **A:** turn iPad support off for 1.2.0 (iPads run the iPhone app in compatibility mode);
- **B:** keep it, and add an iPad pass (master-detail Matchup/League, a wider Portfolio) to a later phase.

**Caution:** once a version supporting iPad is live on the App Store, Apple generally doesn't let later updates drop iPad support (widely reported; confirm against current App Store Connect guidance before relying on it). While we're TestFlight-only, A costs nothing.

## 4. Conflicts with Giorgio's rulings or the board (flagged, NOT adopted)

1. **The eyebrow/kicker ban** (craft-floor calls it absolute) conflicts with our board-approved broadcast tags. We keep the tags and adopt only the "tags must carry information, never duplicate" lint (§3.1).
2. **The hero-metric refusal** conflicts with Home's hero (D1, Concept A, ruled 2026-09-29). Kept.
3. **Large collapsing titles** conflict with the approved 3b-1 header (pill + avatar). Kept.
4. **"San Francisco carries the UI"** conflicts with Archivo as the approved UI face. Kept.
5. **Their mandatory process** (a detector run, isolated sub-agent assessments, snapshots, hooks) is tooling we won't run (an executable download). Skipped entirely.

---

*Next steps if Giorgio approves:*
- I fold §3.1 into DESIGN_DIRECTION (one PR);
- I bring the iPad decision (§3.4) as a board "Your call";
- the glyph-icon replacement and 44 pt hit areas become small items in 3c/3e;
- my gate adopts §3.2 starting with 3c.
