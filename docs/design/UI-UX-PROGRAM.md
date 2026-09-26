# UI/UX Program — design arm of the orchestrator setup

> Authored 2026-09-25. Tracks the UI/UX overhaul, landing-page motion work, and
> promo video. The Orchestrator owns this file's **Status** table; the Design
> Lead owns everything under **Direction**. Prod state still lives in
> [`docs/STATUS.md`](../STATUS.md) — this file tracks design work only.

## Goal

Make Stockpile look and feel like a real, modern fintech product: sleek,
consistent, with deliberate transitions and animation, and navigation that is
easy and intuitive. The landing page comes first, because while
`APP_PAUSED = true` it is the **only** live web surface. Then the full mobile
app and the full web app. Then a promo video that shows the vision.

**Mandate (Giorgio, 2026-09-25): complete overhaul is on the table.** What
exists today is judged "really basic". The current visual identity, light
theme, palette, typography, specs (`STOCKPILE_UI_OVERHAUL.md`,
`landing-page-spec.md`) and navigation structure are **inputs, not
constraints**. A new identity, a new theme (dark, light or both) and a new
information architecture on both platforms are all allowed. What stays fixed
are the *engineering* rules (the UI worker contract below), the product facts
(e.g. web is pre-launch, so the landing page is "coming soon" with no signup)
unless Giorgio changes them, and the Phase 1 approval checkpoint.

## Roles

| Role | Session title | Model | Owns | Never does |
|---|---|---|---|---|
| **Orchestrator** | `Orchestrator` | Opus | Spawning every worker (one spawn authority), branches, merge order, independent verification, push/PR under the standing approval | Judge visual quality alone |
| **Design Lead** | `Design Lead` (exact — it is a SendMessage address) | Opus, long-lived | Audit, `DESIGN_DIRECTION.md` (visual + motion language), drafting UI worker prompts, reviewing every UI branch's screenshots **before** the Orchestrator pushes | Spawn workers, write feature code, push, merge |
| **UI workers** | per branch | Sonnet after an approved plan | One surface each | Touch another worker's surface, add migrations |

**Design review gate:** a UI branch is pushable only when the Orchestrator's
usual checks pass **and** the Design Lead has replied `DESIGN-APPROVED <branch>`
to the Orchestrator. For the landing page this gate is the last line before
prod — merging to `main` deploys it to Vercel immediately.

## Plugin skills in use

Installed at **user scope** on 2026-09-25 (in `~/.claude/`, not the repo), so
every local session on this machine has them regardless of branch or worktree.
Cloud/remote sessions do not.

- **Examine:** `design:design-critique`, `design:accessibility-review`, `design:design-system`, `design:ux-copy`
- **Decide:** `superpowers:brainstorming`, `frontend-design:frontend-design`
- **Plan/build:** `superpowers:writing-plans`, `superpowers:test-driven-development` (for logic, e.g. count-up formatting)
- **Finish:** `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, `design:design-handoff`

Project rules win over skill defaults: CLAUDE.md's push/merge/deploy
boundaries, the worker contract below, and the mobile conventions still apply
when a superpowers skill suggests otherwise.

## Phases

### Phase 0 — Audit (Design Lead, read-only)

Screenshot the current state and examine it. The existing specs are useful
context about past decisions, but the audit judges the product against "modern,
sleek, intuitive", not against those specs:

- Web landing: `apps/web/src/pages/LandingPage.jsx` + `.css` (rebuilt from the
  Claude Design bundle; spec in `docs/design/landing-page-spec.md`).
- Mobile: every tab screen. The light theme and design-system pass (PR #15) are
  already on `main`; the spec is `docs/design/STOCKPILE_UI_OVERHAUL.md` —
  its §8 "Animations & Transitions" is only four bullet points; that gap is
  Phase 1's main job.
- Web app: every page behind `APP_PAUSED` (Dashboard, Leagues, LeagueDetail,
  Draft, Matchup, Portfolio, Leaderboard, TradeHistory, Profile, Login, the
  league setup wizard). Flip `APP_PAUSED` to `false` locally only.
- Navigation and flows on both platforms, not just individual screens: how
  many taps to the core jobs (see my matchup, make a trade, draft, check
  standings), and where users get lost.
- Run `design:design-critique`, `design:accessibility-review`,
  `design:design-system` over the screenshots.

**Output:** `docs/design/AUDIT-2026-09.md` — what's good, what reads as "side
project", navigation and flow friction, accessibility failures.

### Phase 1 — Direction (Design Lead → **Giorgio approves**)

`superpowers:brainstorming` + `frontend-design`, producing
`docs/design/DESIGN_DIRECTION.md`:

1. **Visual identity** — unconstrained by the current one: palette, theme
   (dark / light / both), typography, iconography, depth and surface style.
   Offer Giorgio **2–3 distinct directions** (a mood description plus one
   hero screen each, e.g. Home and the landing hero) and let him pick, rather
   than presenting a single option.
2. **Information architecture and navigation** for mobile and web: tab /
   nav structure, the path to each core job, and how league context works
   across screens. Any new data or backend change the IA needs goes in a
   "Backend asks" list for the Orchestrator. UI workers never add migrations.
3. **Motion language** — the part that makes it feel "sleek": 3–4 named
   durations, 2–3 named easing curves, and a table of *what* animates (route /
   screen transitions, shared-element-style transitions where they help, card
   press, number count-up, list stagger, matchup reveal, landing hero +
   scroll-driven sections) and what never animates.
4. **Reduced motion** — every animation has a `prefers-reduced-motion` (web) /
   `AccessibilityInfo.isReduceMotionEnabled` (mobile) fallback. Non-negotiable.
5. **Landing page concept** — section-by-section, with the motion for each.
   Richer motion is allowed per Giorgio (2026-09-25): the "Avoid" list in
   `landing-page-spec.md` § Motion direction (parallax, count-ups, pinned
   sections, etc.) is lifted, not binding. Propose freely; Giorgio judges at
   the checkpoint. Reduced-motion fallbacks and "never gate content behind an
   animation" still apply.
6. **Promo video treatment** — 30–60s storyboard, beat by beat.

**Checkpoint:** Design Lead sends the direction to the Orchestrator, which
relays it to Giorgio. Nothing in Phase 2+ starts until Giorgio approves — every
later worker bakes this document in.

### Phase 2 — Foundation (one UI worker, alone)

Turn the direction into shared code before any screen work fans out (UI
workers otherwise collide on `constants/theme/*` and `components/ui/*`, and
each invents its own timings).

- **Tokens:** replace the token values with the approved identity (palette,
  type, spacing, radii, elevation) in each platform's single token source —
  `apps/mobile/constants/theme/*` and a web equivalent. If the new identity
  changes fonts, load them here.
- **Navigation shell:** if the approved IA changes tabs / routes, the shell
  (mobile tab layout, web router + layout) is rebuilt here so screen workers
  build into it.
- **Mobile:** motion tokens (`constants/theme/motion.ts`) + primitives on
  `react-native-reanimated` 4.1 (already installed): pressable-scale,
  fade/slide enter, count-up number, stagger list.
- **Web:** add the `motion` library to `apps/web` (declare it in
  `apps/web/package.json` — the PR #10 lesson: an undeclared import passes
  locally via the root install and breaks Vercel). Same token names as mobile.
- **Verification tooling:** add a `.claude/launch.json` entry for the web dev
  server (`apps/web`, vite) so later workers can use the browser pane.

### Phase 3 — Surfaces (parallel after Phase 2 merges; one worker each)

- **3a. Web landing page** — highest leverage. Hero animation, scroll-driven
  section reveals, product mock with live-feeling numbers.
- **3b. Mobile Home** — rebuilt per the approved direction (the old
  `STOCKPILE_UI_OVERHAUL.md` Home concept is one input). The one job CLAUDE.md
  says may justify Fable (session-scoped, not security-adjacent).
- **3c. Mobile screens** — full redesign of the remaining screens, after 3b
  lands (3b sets the league-context pattern the others use). The Design Lead
  may split this into several workers by screen group.
- **3d. Web app** — full redesign of the pages behind `APP_PAUSED`. They stay
  paused in prod; this makes them ready for launch. May also be split.

### Phase 4 — Promo video (after 3a is approved)

**Remotion** in `apps/promo/` — the video is React code rendered to MP4, so it
reuses the real tokens, fonts, logo assets (`docs/design/*.png`), and landing
components, and re-renders in one command when the UI changes.

- `apps/promo/` stays **outside** the root `workspaces` (`apps/web`,
  `packages/*`) so it never touches the Vercel build or churns the root
  lockfile. Its own `package.json`, own lockfile.
- Confirm Remotion's license terms fit before anything is published.
- Real app footage (iOS Simulator recordings) can be composited in as clips.

## UI worker contract (in addition to the standard worker contract)

The standard contract still applies verbatim — start from `origin/main`, read
CLAUDE.md + STATUS.md, own branch, `git branch --show-current` before commits,
never push / merge into main / deploy, report plan → wait → done/blocked; and
the carve-out: **merging `origin/main` INTO your own branch locally is allowed
(it prompts Giorgio via the ask tier).** Plus:

1. **Screenshots are the proof.** DONE reports include before/after
   screenshots (and a short screen recording for anything animated), saved to
   `~/fantasy-stock-design-review/<branch>/` (outside the repo — never
   committed), with absolute paths in the report. Typecheck/lint passing is
   necessary, not sufficient. Web: the browser pane. Mobile: the iOS Simulator.
2. **The `APP_PAUSED` trap:** to see any web page other than the landing page,
   flip `APP_PAUSED` to `false` **locally only** — never commit the flip.
   `npm run build` with it `true` proves nothing about other pages.
3. **Tokens only** (mobile conventions from PR #15): no raw hex outside
   `constants/theme/colors.ts`, `fontFamily` not `fontWeight`,
   `tabular-nums` on money, action buttons use `components/ui/Button`, new
   files get the CLAUDE.md eslint header. Motion values come from the motion
   tokens — no inline durations.
4. **Reduced motion** on every animation.
5. **Migration range: none.** A UI worker that believes it needs a migration
   stops and reports BLOCKED.
6. **Report to both** `Orchestrator` (status) and `Design Lead` (design review).
7. **Architecture map:** if you touch any `.from` / `.rpc` /
   `functions.invoke` call site (e.g. the Home rebuild's aggregation), run
   `node scripts/gen-architecture.mjs` and commit the result.

## Status

| Phase | Owner | Branch | State |
|---|---|---|---|
| 0 Audit | Design Lead | — (docs on `docs/ui-ux-program` or its own) | not started |
| 1 Direction | Design Lead → Giorgio | — | not started |
| 2 Foundation | UI worker | `ui/motion-foundation` | not started |
| 3a Landing | UI worker | `ui/landing-motion` | not started |
| 3b Mobile Home | UI worker | `ui/mobile-home-rebuild` | not started |
| 3c Mobile screens | UI worker(s) | `ui/mobile-screens*` | not started |
| 3d Web app | UI worker(s) | `ui/web-app*` | not started |
| 4 Promo video | UI worker | `promo/remotion-video` | not started |

## Appendix A — Design Lead spawn prompt

> You are the **Design Lead** for Stockpile's UI/UX program. Your session
> title must be exactly `Design Lead` — UI workers and the Orchestrator send
> messages to that name. You report to the session titled `Orchestrator` via
> `SendMessage to: "Orchestrator"`.
>
> **Read first:** `CLAUDE.md`, `docs/STATUS.md`, `docs/design/UI-UX-PROGRAM.md`
> (your charter — roles, phases, UI worker contract), then
> `docs/design/STOCKPILE_UI_OVERHAUL.md` and `docs/design/landing-page-spec.md`.
>
> **Your job:** Phase 0 (audit) and Phase 1 (direction) yourself; after that,
> draft each UI worker's prompt for the Orchestrator to spawn (you never spawn
> workers), and review every UI branch's screenshots. Reply to the Orchestrator
> with `DESIGN-APPROVED <branch>` or `DESIGN-CHANGES <branch>: <list>`. You
> are the quality bar for how it looks and moves; the Orchestrator remains the
> bar for correctness and the only one who pushes.
>
> **Skills:** use `design:design-critique`, `design:accessibility-review`, and
> `design:design-system` for the audit; `superpowers:brainstorming` and
> `frontend-design:frontend-design` for direction. Project rules override skill
> defaults — in particular, you never push, merge, or deploy.
>
> **Boundaries:** you write only under `docs/design/` on your own branch (start
> from `origin/main`; `git branch --show-current` before every commit; merging
> `origin/main` INTO your own branch locally is allowed — it prompts Giorgio via
> the ask tier). No feature code, no migrations, no pushes. Screenshots go in
> `~/fantasy-stock-design-review/audit/`. To see non-landing web pages, flip
> `APP_PAUSED` to `false` locally only and never commit it.
>
> **Turn 1:** read, then send the Orchestrator your audit plan (which screens,
> how you'll capture them, which skills) and WAIT for "go". **Phase 1 ends with
> a hard checkpoint:** send `DESIGN_DIRECTION.md` to the Orchestrator for
> Giorgio's approval and do not draft any UI worker prompt until it is approved.
