# Stockpile Landing Page — Build Spec

A pre-launch landing page for Stockpile, built from the Claude Design bundle.
The product is launching soon but is **not yet live**, so the page communicates
a "coming soon" state instead of offering signup or login.

---

## ⚠️ Current design bundle URL (disposable — regenerate if the design changes)

```
https://api.anthropic.com/v1/design/h/sBymhvQbwaiWVQGQX1awrg
```

> This URL points to one specific version of the design bundle. If the design
> system changes (e.g. button labels, tokens, layout), this URL goes stale.
> Get a fresh one from Claude Design → **Send to Claude Code** → copy command,
> and replace the line above. Everything below this section stays valid
> regardless of the URL.

---

## Goal

Build a real landing page for Stockpile, a fantasy-sports-style stock-market
game. The page will be linked from / embedded near my personal projects site
and may be viewed by recruiters as well as potential users. The product is
**pre-launch**: there is nothing to sign up for or download yet. The page must
make that obvious so no one goes hunting for a login that doesn't exist — while
still presenting the work confidently, not apologetically.

## Branch and safety rules (read first)

- Create and switch to a new branch called `landing-page-design-sync`.
  Do **all** work on that branch. **Never commit to `main`.**
- **Scope:** only create or modify landing page / web frontend files and
  design-token files (colors, type, components used by the landing page).
- **Do NOT touch** backend code, Supabase edge functions, cron functions,
  `config.toml`, `.env` files, or anything related to the in-progress
  Supabase API key migration. If applying the design seems to require touching
  any of those, **stop and ask me first.**
- After implementing, **summarize every file you created or changed and why,
  before I review the diff.** Do not consider the task done until I've reviewed.

## CTA changes (the main difference from a normal landing page)

- **Remove** all working signup, log in, "Download the App", and App Store /
  Google Play buttons — there is nothing live to sign up for or download yet.
- **Replace** them with a confident "Coming soon" / "Launching soon" treatment
  in the hero and in the bottom CTA section. Tone: a real product arriving
  soon, **not** an unfinished or abandoned project.
- **Do not** add an email-capture / waitlist field for now (no backend to
  collect them). A clean "Coming soon" state is enough.
- **Check the nav and footer specifically** for any leftover "Log in" or
  "Sign up" links and remove them — these are the sneakiest places a dead
  auth link survives.
- Make sure a visitor immediately understands the app isn't live yet.

## What to keep

- Hero (headline, subhead, product visual) — swap the CTA for the coming-soon
  state but keep the rest.
- "How it works" — three steps: Draft a team → Compete in weekly matchups →
  Climb the league.
- "Why Stockpile is different" — the investing-first, gamified-layer
  positioning. Keep the line that it's free-to-play with no money involved.
- "Leagues in action" — the mocked product UI (leaderboard, head-to-head
  matchup card, team card). Keep this as the **visual centerpiece**. Use
  realistic tickers (AAPL, NVDA, TSLA) and plausible numbers. No real user
  names or testimonials — there are no real users yet.
- FAQ — keep, but make it consistent with the pre-launch state. Adjust/add an
  entry like "When does it launch?" / "How do I get access?" with an honest
  short answer ("Stockpile is in development and launching soon"). Keep the
  "Is this real investing?" (no), "Does it cost anything?" (no), "Do I win
  money?" (no) answers.
- Footer — light consumer-app footer. Privacy Policy, Terms of Service,
  Contact, social links, short disclaimer line ("Stockpile is for
  entertainment purposes only. Not investment advice. Market data delayed."),
  and a `[MARKET DATA ATTRIBUTION PLACEHOLDER]`. Do not generate or invent
  legal text.
- The design tokens, typography, and motion from the bundle.

## Positioning (so copy stays consistent)

- Stockpile is an investing product first, with a gamified layer on top — NOT
  a game that happens to involve stocks. Visual credibility comes from fintech
  (Robinhood, Public, Coinbase), not gaming or fantasy sports.
- Stockpile **tracks** performance only — it does not buy, sell, or hold
  securities, and there are no entry fees, prizes, or payouts.

## Motion direction

- Motion should communicate liveness of data and interactivity of the product,
  not decorate the page. Reference: Robinhood / Public restraint plus
  Coinbase's data-in-motion feel.
- The mocked app screens may be lightly interactive (hover/click states, a
  live-feeling ticker or leaderboard re-sort) to demonstrate the work.
- Avoid: parallax, animated gradient hero washes, count-up number animations,
  scroll-jacking, pinned sections, cyan glow effects, hover effects that
  scale/rotate/tilt cards, animations that gate content.

## Constraints

- Desktop-first, mobile-responsive.
- Typography: editorial, closer to Public than a generic SaaS template.
- `#0891B2` cyan is an accent only — buttons, key emphasis, data highlights.
  Do not flood the page with it. Light theme, white / near-white backgrounds,
  dark text.
