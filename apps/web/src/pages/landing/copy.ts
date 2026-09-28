// The landing's words: the live landing page's copy (origin/main
// pages/LandingPage.jsx before phase 3a), VERBATIM, at Giorgio's request
// (2026-09-27): "I want the same verbiage and phrases that are on the
// current landing page." The product name is always `brand.name`.
//
// The ONLY deviations, all Giorgio's decisions of 2026-09-27 (relayed by the
// Orchestrator), marked `CHANGED` below:
//   1. Scoring claims are generic ("performance", not "return") so they
//      hold for any league setting or scoring mode.
//   2. "Real-time market data" → "Real market data" (don't over-promise;
//      the footer keeps its delayed-data disclaimer).
//   3. The mock's "Win prob 72%" is replaced by a dollar lead (there is no
//      win-probability model) — see sampleData.ts, not copy.
//   4. "[MARKET DATA ATTRIBUTION PLACEHOLDER]" is not rendered (TODO in
//      LandingPage.tsx) — flagged to Giorgio.
// Footer links that pointed at `#` (Privacy, Terms, Contact, X, Instagram,
// GitHub) stay hidden until real pages exist (pre-launch rule: no dead
// links). copy.test.ts pins every string here against the old page.

export const nav = {
  links: [
    { href: '#how', label: 'How it works' },
    { href: '#why', label: (name: string) => `Why ${name}` },
    { href: '#faq', label: 'FAQ' },
  ],
  status: 'Launching soon',
} as const;

export const hero = {
  eyebrow: 'Launching soon',
  /** The last line is the <em> accent. */
  lines: ['Draft stocks.', 'Beat your friends.', 'Win the league.'],
  lede: (name: string) =>
    `${name} is fantasy sports for the stock market. Build a portfolio, go head-to-head with friends, and prove who really knows the market.`,
  status: 'Coming soon',
  link: { href: '#how', label: 'See how it works' },
  // CHANGED (Giorgio, 2026-09-27): was "<b>Real-time</b> market data".
  meta: [
    { strong: 'Free to play', rest: '' },
    { strong: 'No real money', rest: '' },
    { strong: 'Real', rest: ' market data' },
  ],
} as const;

export const inside = {
  label: (name: string) => `A look inside ${name}`,
};

export const how = {
  kicker: '/ 01 — How it works',
  /** h2 line 1, then line 2 split around the <em> accent. */
  title: { line1: 'Draft a team. Compete weekly.', line2: 'Climb the ', em: 'league.' },
  // CHANGED (Giorgio, 2026-09-27): "your portfolio’s actual return" → "… actual performance".
  lede: 'Three steps. No fantasy points, no proxies — your score is your portfolio’s actual performance, pulled from real market data every weekday.',
  steps: [
    {
      num: '01',
      title: { em: 'Draft', rest: ' a team', emFirst: true },
      body: 'Snake-draft real stocks with friends. Pick order reverses each round — build a portfolio you actually believe in.',
    },
    {
      num: '02',
      title: { em: 'weekly', rest: 'Compete ', emFirst: false },
      // CHANGED (Giorgio, 2026-09-27): "Best return wins the matchup." → "Best performance wins the matchup."
      body: 'Monday to Friday, your portfolio runs head-to-head against an opponent. Best performance wins the matchup.',
    },
    {
      num: '03',
      title: { em: 'Climb', rest: ' the league', emFirst: true },
      body: 'Stack up wins, rise through the standings, and make a playoff run for the season trophy.',
    },
  ],
} as const;

export const leagues = {
  kicker: '/ 02 — Leagues in action',
  title: { text: 'A scoreboard for your ', em: 'portfolio.' },
  lede: 'Watch standings move with the market. Real prices, real volatility, real bragging rights — every minute the bell is open.',
  bullets: [
    'Live prices stream from the open to the close',
    'Records, streaks, and W/L history per player',
    'Playoff seeding, weekly matchups, season trophy',
  ],
} as const;

export const why = {
  kicker: (name: string) => `/ 03 — Why ${name}`,
  title: { line1: 'The rigor of investing,', line2: 'the rhythm of ', em: 'fantasy.' },
  cells: [
    {
      id: 'prices',
      title: { line1: 'Real prices.', em: 'Real consequences.' },
      // CHANGED (Giorgio, 2026-09-27): "Every score is a portfolio return" → "Every score is your portfolio’s real performance".
      body: 'Every score is your portfolio’s real performance — pulled from live market data. No fantasy points, no proxies. If your picks go up, you win.',
    },
    {
      id: 'gamified',
      title: { line1: 'Investing, ', em: 'gamified.' },
      body: 'The discipline of managing a portfolio, with the snake drafts, matchups, and playoffs of a fantasy league layered on top.',
    },
    {
      id: 'free',
      title: { line1: 'Free to play. ', em: 'No money.' },
      body: (name: string) =>
        `${name} tracks performance only — it never holds securities, and there are no entry fees, prizes, or payouts. Just bragging rights.`,
    },
  ],
} as const;

export const faq = {
  kicker: '/ 04 — FAQ',
  title: { text: 'Questions, ', em: 'answered.' },
  items: (name: string) => [
    {
      q: `When does ${name} launch?`,
      a: `${name} is in development and launching soon. This page is a preview of what’s coming — there’s nothing to sign up for just yet.`,
    },
    {
      q: 'How do I get access?',
      a: 'There’s no signup right now. When we launch, you’ll be able to create a league and invite friends right here. Check back soon.',
    },
    {
      q: 'Is this real investing?',
      a: `No. ${name} tracks the performance of real stocks, but it never buys, sells, or holds any securities. It’s a game built on market data, not a brokerage.`,
    },
    {
      q: 'Does it cost anything?',
      a: `No. ${name} is free to play. There are no entry fees and no subscriptions.`,
    },
    {
      q: 'Do I win money?',
      a: 'No. There are no cash prizes or payouts — just standings, trophies, and bragging rights.',
    },
  ],
};

export const cta = {
  title: { text: 'Launching ', em: 'soon.' },
  body: (name: string) => `${name} is almost ready. The first opening bell is just around the corner.`,
  status: 'Coming soon',
} as const;

export const footer = {
  tagline: 'Fantasy sports for the stock market. Draft real stocks, compete weekly, climb your league.',
  productHeading: 'Product',
  productLinks: [
    { href: '#how', label: 'How it works' },
    { href: '#why', label: (name: string) => `Why ${name}` },
    { href: '#faq', label: 'FAQ' },
  ],
  disclaimer: (name: string) => `${name} is for entertainment purposes only. Not investment advice. Market data delayed.`,
  copy: (name: string, year: number) => `© ${year} ${name} · Simulated portfolios, real market data.`,
} as const;

export const linkLabel = (label: string | ((name: string) => string), name: string) =>
  typeof label === 'function' ? label(name) : label;
