# Phase 3a worker prompt — Web landing (`ui/landing-gameday`)

> **Superseded in part on 2026-09-27 by the Orchestrator's round-3 brief**,
> after Giorgio called the first build "still very basic": (1) the **current live
> landing's copy is kept VERBATIM** (except the "Win prob 72%" mock and the
> attribution placeholder); this prompt's new headline is withdrawn. (2)
> **Far more ambition:** multiple pinned, scroll-scrubbed chapters, a sticky app
> mockup changing screens, light↔stadium background morphs between sections,
> mask reveals, parallax, a nav progress indicator, live scorecard updates,
> standings FLIP re-orders with ▲/▼, a draft pick-snap, a FINAL reveal, and
> micro-interactions. GSAP/ScrollTrigger allowed; JS budget 220 KB gz;
> LCP/CLS, reduced motion and JS-off completeness unchanged. The bar is
> **Apple / Stripe / Linear product pages**.

> Drafted by Design Lead, 2026-09-26. **Live on merge**: merging to `main`
> deploys this page to Vercel production. Backend asks: **none**. Can start
> now (web foundation merged in PR #35). Suggested model: plan on Opus; this is
> the showpiece, so consider staying on Opus for the motion work.

---

You are the UI worker for **Phase 3a · the web landing page**, the only live
public surface and the product's first impression. Your branch is
`ui/landing-gameday`. You report to `Orchestrator` (status) **and**
`Design Lead` (design review) via `SendMessage`.

**The bar, in Giorgio's words:** when someone loads it, *"it's not just a
basic website… it's really high end."*

## Read first

`CLAUDE.md` and `docs/STATUS.md`. `docs/design/UI-UX-PROGRAM.md` (the UI
worker contract applies verbatim). `docs/design/prompts/phase3-plan.md`
("Shared rules"). `docs/design/DESIGN_DIRECTION.md`: **§1 B (Game Day)**,
**§4 motion**, **§5 reduced motion**, **§6 landing concept**, **§9 tokens**.
`docs/design/AUDIT-2026-09.md` §3 (what's wrong with today's landing, and why
it must not load app CSS). The web foundation in `apps/web/src/design/`,
especially `game/Scoreboard`, `TugBar`, `ScoreDigits`, `Chyron`, `LiveDot`,
`useMotion` and `lib/*`, and its dev gallery (`/design`, dev only).

## Product facts you must keep

- **Pre-launch**: "Launching soon" is a **status, never a button that looks
  clickable**. No signup, no login link, no email capture.
- **Name-agnostic**: use `brand.name` (placeholder "Stockpile") and the
  refined-bars `BrandMark`. **No wordmark-heavy composition** (naming is
  deferred); the mark plus `brand.name` at normal weight is fine.
- Matchups are won on **dollar gain** (percent is the tiebreak). Sample data
  must obey that.
- **No win probability** anywhere (there's no model; backend ask #8).
- Keep the disclaimer: entertainment only, not investment advice, market data
  delayed. **Hide** Privacy / Terms / Contact / social links until they
  exist; no `href="#"`.

## Scope

Rebuild `apps/web/src/pages/LandingPage.jsx` (you may convert it to `.tsx`)
on the Game Day tokens and foundation primitives, and **retire**
`styles/stockpile-tokens.css` (the landing's old scoped Manrope/Jakarta
system).

**Isolation (required, and structural):** the landing must load **none** of
the legacy app CSS (`layout.css`, `App.css`, `index.css`) and **run none of
the app providers' side effects** (e.g. `PriceProvider` fetching quotes).
Today `App.jsx` statically imports every app page plus `layout.css`, and
`main.jsx` wraps everything in app providers. Fix it with route-level code
splitting: lazy-load the app routes and move the legacy CSS imports and app
providers inside the lazy app shell, so the landing chunk contains only
landing code. Keep `APP_PAUSED = true`; don't change what the paused app
does once loaded.

### Sections (DESIGN_DIRECTION §6, direction B)

| # | Section | Content | Motion |
|---|---|---|---|
| 1 | **Nav** | `BrandMark` + `brand.name`; anchors: How a week works · Leagues · FAQ; "Launching soon" **status chip** | None, apart from the anchor underline on hover/focus (`quick`) |
| 2 | **Hero** | Condensed headline (`type.score`-family display: Archivo 62%/900) "Your portfolio vs. your friends. Every week.", a one-line explainer, and the **live Scoreboard module as the hero visual** (sample: You vs Priya, Week 3, `+$56.80` vs `+$39.40`, "You lead by $17.40", "2d 5h to Friday close"). **Ticker strip** of sample matchups below, with a visible **pause/play control** | **One `feature` sequence on load:** the stadium band wipes in (`slow`, `settle`) → scores **count up once** from 0 (`ScoreDigits`, `feature`) → the TugBar settles with a `spring.lively` overshoot to 0.59 → a Chyron slides in ("NVDA +4.1% puts you ahead"). The ticker scrolls (a linear loop) with **pause on hover, focus, and the control** |
| 3 | **How a week works** | A real sequence: **Draft → Monday open → the week → Friday close** (numbered, because it is one) | **The one pinned, scroll-scrubbed section.** Pinned for **≤ 200vh** of scroll; progress drives the scoreboard from Monday 0.00 through the week to Friday's final, and each step's caption highlights in turn. The scrub uses `motion`'s `useScroll` (no scroll-jacking: native scroll speed, no snapping). All four step texts are **in the DOM and readable** at every scroll position |
| 4 | **Leagues in action** | A standings board (6 sample rows, on the game surface) | On first entering view: rows stagger in (30ms, max 8). Then a **lead-change re-sort every ~6s while visible** (animated reorder, `base`), with a Chyron naming the move. **Stops when off-screen or tab-hidden**, pauses on hover/focus |
| 5 | **The money side** | A calm, light portfolio card with a cumulative-gain line (zero baseline, per PR #38): real market data, free to play, no real money | The chart **draws once** on enter (`feature`) |
| 6 | **FAQ** | Today's pre-launch answers | Accordion (`base`, `settle`); `aria-expanded` |
| 7 | **Launch band** | "Launching soon" + a one-line promise | None |
| 8 | **Footer** | Mark, `brand.name`, the disclaimer; no dead links | None |

**Micro-interactions** (restrained): buttons and chips press at scale 0.98
(`instant`, `spring.snappy`); Scoreboard / standings rows get a 1px
border-brighten on hover (`quick`); focus rings in `color.brand` everywhere.
**No** cursor followers, card tilt, parallax on data, gradient-washed
headlines, or glow.

### Reduced motion (binding; each row needs evidence)

| Full motion | Reduced |
|---|---|
| Hero wipe, count-up, tug overshoot, chyron slide | Final state shown immediately; chyron visible, static |
| Ticker loop | **Paused**, scrollable by hand; the pause control stays for everyone (WCAG 2.2.2) |
| Pinned scroll-scrub (section 3) | **Not pinned**: a static four-panel sequence (Mon / Tue–Thu / Fri close / final) |
| Standings stagger + periodic re-sort | Rows appear together; **no automatic re-sort** |
| Chart draw | Drawn |
| Accordion | Instant open/close |

**Never gate content:** every heading and paragraph is visible with JS off,
under reduced motion, and in a screenshot taken mid-load. Reveal animations
start from a **visible** resting state (transform only); nothing sits at
`opacity: 0` waiting for an observer.

## Performance budget (Lighthouse, mobile preset, on `vite preview`)

- **LCP ≤ 2.0s**, **CLS ≤ 0.05**, **TBT ≤ 200ms**, Performance score ≥ 90.
- The landing route's JS is **≤ 170 KB gzipped** (report the actual figure),
  and its CSS contains **no** legacy app rules.
- Fonts: preconnect, `display=swap`, and a size-adjusted fallback so the
  font swap causes **no layout shift**.
- Animations run on transform/opacity only (no layout-thrashing properties).
  The ticker and re-sort timers pause when the tab is hidden.

## Verify, then report DONE

- `npm run build`, `npm run lint`, `npm test` in `apps/web`: pass counts in the report.
- **Isolation proof:** on the built landing, list its loaded CSS and JS
  chunks and grep them for a known `layout.css` selector (expect none), and
  record the landing's network requests (expect **no** Supabase or quote calls).
- **Paused-app proof:** with `APP_PAUSED` flipped **locally only** (never
  committed), the app pages still load and look exactly as before
  (screenshots of `/login` and one app page, before and after). Flip it back.
- **Screenshots** at **320, 375, 414, 768, 1024, 1280, 1440** (browser pane;
  headless Chrome fakes overflow under ~500px) → `~/fantasy-stock-design-review/ui-landing-gameday/`.
- **Recordings** (a frame sequence is fine) of the hero sequence, the section-3
  scrub, and a standings re-sort, **each with reduced motion off and on**.
- **Lighthouse** JSON/HTML for mobile and desktop.
- **Keyboard pass**: tab order, visible focus, the ticker pause reachable,
  the accordion operable, no trap in the pinned section.

## DESIGN-APPROVED criteria (what the Design Lead will check)

1. The first viewport at 1440 **and** 375 reads as high-end: typography-led,
   with the scoreboard as the clear hero, and nothing template-like
   (no gradient headline text, no triple "coming soon").
2. The hero sequence plays once, lands on correct numbers (dollar-gain
   winner), and completes in ≤ 1.4s.
3. The pinned scrub feels native (no hijacked scroll speed) and reads correctly
   at every point; reduced motion shows the four static panels.
4. All motion comes from tokens, and every row of the reduced-motion table
   is evidenced.
5. The performance budget is met, with numbers in the report.
6. Isolation is proven: no legacy CSS and no app network calls on the landing.
7. Contrast: every text pair meets AA (use §9's measured tokens), including
   the ticker and the chyron.
8. Name-agnostic: `brand.name` and the refined bars; "Launching soon" is not
   clickable; no dead links; no win probability.

Report your PLAN first and wait for "go".
