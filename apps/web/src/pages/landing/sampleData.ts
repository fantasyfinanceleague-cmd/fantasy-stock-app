// Illustrative sample data for the landing: a preview of the product, not
// real users. Product rules it must obey (phase3a-landing.md):
//   - a matchup is won on DOLLAR gain (percent only breaks a tie);
//   - everyone in a league starts from the same budget, so the dollar and
//     percent orders always agree here (Design Lead, 2026-09-26);
//   - no win probability, anywhere.
// sampleData.test.ts checks these invariants.

/** Every sample league uses the same starting budget. */
export const BUDGET = 10_000;

export const LEAGUE_NAME = 'Friday Night Stocks';
export const WEEK = 3;

export interface Team {
  name: string;
  gain: number;
}

// ── Hero: Week 3, Wednesday mid-morning ──────────────────────────────────
export const HERO = {
  week: WEEK,
  you: { name: 'You', gain: 56.8 },
  opponent: { name: 'Priya', gain: 39.4 },
  chyron: 'NVDA +4.1% puts you ahead',
  /** The prerendered / JS-off state: the week hasn't moved yet. */
  kickoff: { tag: 'Monday open', clock: '4d 6h 30m to Friday close' },
  live: { tag: 'Wednesday', clock: '2d 5h to Friday close' },
} as const;

// ── Ticker: other Week 3 matchups around the leagues ─────────────────────
export const TICKER: ReadonlyArray<readonly [Team, Team]> = [
  [{ name: 'Marco', gain: 112.4 }, { name: 'Dana', gain: 98.15 }],
  [{ name: 'Kenji', gain: -12.75 }, { name: 'Sofia', gain: 44.3 }],
  [{ name: 'Ava', gain: 23.1 }, { name: 'Luis', gain: 21.85 }],
  [{ name: 'Noor', gain: 67.9 }, { name: 'Theo', gain: -5.2 }],
  [{ name: 'Omar', gain: 31.45 }, { name: 'Ines', gain: 38.7 }],
  [{ name: 'Maya', gain: -18.3 }, { name: 'Eli', gain: -9.95 }],
  [{ name: 'Hana', gain: 84.6 }, { name: 'Ravi', gain: 79.05 }],
];

// ── How a week works: the same You-vs-Priya week, day by day ─────────────
// Priya takes the lead Monday and stretches it Tuesday; NVDA puts you back
// in front on Wednesday (the hero's moment); you hold on to Friday's close.
export type StepId = 'draft' | 'open' | 'week' | 'close';

export interface WeekState {
  id: string;
  step: StepId;
  /** Scoreboard tag, e.g. "Tue close". */
  label: string;
  you: number;
  opponent: number;
  /** Lead-change call, shown as a chyron when this state is reached. */
  chyron?: string;
}

export const WEEK_STATES: readonly WeekState[] = [
  { id: 'draft', step: 'draft', label: 'Rosters set', you: 0, opponent: 0 },
  { id: 'open', step: 'open', label: 'Mon 9:30 open', you: 0, opponent: 0 },
  { id: 'mon', step: 'week', label: 'Mon close', you: 18.2, opponent: 24.6, chyron: 'AMD +3.2% puts Priya ahead' },
  { id: 'tue', step: 'week', label: 'Tue close', you: 12.4, opponent: 31.1 },
  { id: 'wed', step: 'week', label: 'Wed close', you: 56.8, opponent: 39.4, chyron: HERO.chyron },
  { id: 'thu', step: 'week', label: 'Thu close', you: 61.3, opponent: 58.9 },
  { id: 'fri', step: 'close', label: 'Fri close', you: 71.25, opponent: 64.1, chyron: 'Final: you take Week 3' },
];

export const STEPS: ReadonlyArray<{ id: StepId; title: string; body: string }> = [
  {
    id: 'draft',
    title: 'Draft',
    body: 'Your league takes turns picking real stocks in a snake draft. Once a stock is taken, it’s off the board for everyone else.',
  },
  {
    id: 'open',
    title: 'Monday open',
    body: 'At the opening bell you’re matched against one leaguemate, and both scores start at $0.00.',
  },
  {
    id: 'week',
    title: 'The week',
    body: 'Your score is your portfolio’s dollar gain since Monday’s open, tracked with real prices. Trade any day to chase the lead.',
  },
  {
    id: 'close',
    title: 'Friday close',
    body: 'At the closing bell, the bigger dollar gain wins the matchup. Percent gain only breaks a tie. The result goes into your league standings.',
  },
];

/** Four static panels shown instead of the scroll-scrub under reduced
 * motion, or with JavaScript off (DESIGN_DIRECTION §5). */
export const WEEK_PANELS: ReadonlyArray<{ title: string; stateId: string; note: string }> = [
  { title: 'Mon', stateId: 'open', note: 'Both scores start at $0.00.' },
  { title: 'Tue–Thu', stateId: 'wed', note: 'Priya led through Tuesday. NVDA put you ahead on Wednesday.' },
  { title: 'Fri close', stateId: 'fri', note: 'The closing bell locks both scores.' },
  { title: 'Final', stateId: 'fri', note: 'You win Week 3 by $7.15 and move to 3–0.' },
];

// ── Leagues in action: Week 3's live board ───────────────────────────────
// Ranked by this week's dollar gain, live. Each snapshot differs from the
// one before by exactly one move, which the chyron names.
export interface StandingsRow {
  id: string;
  name: string;
  record: string;
  you?: boolean;
}

export const STANDINGS_ROWS: readonly StandingsRow[] = [
  { id: 'marco', name: 'Marco', record: '2–0' },
  { id: 'dana', name: 'Dana', record: '1–1' },
  { id: 'you', name: 'You', record: '2–0', you: true },
  { id: 'sofia', name: 'Sofia', record: '1–1' },
  { id: 'priya', name: 'Priya', record: '1–1' },
  { id: 'kenji', name: 'Kenji', record: '0–2' },
];

export interface StandingsSnapshot {
  gains: Record<string, number>;
  /** The move this snapshot makes, relative to the previous one. */
  chyron?: string;
}

export const STANDINGS_SNAPSHOTS: readonly StandingsSnapshot[] = [
  { gains: { marco: 112.4, dana: 98.15, you: 56.8, sofia: 44.3, priya: 39.4, kenji: -12.75 } },
  { gains: { marco: 109.9, dana: 118.6, you: 58.1, sofia: 44.9, priya: 40.2, kenji: -10.4 }, chyron: 'Dana passes Marco for 1st' },
  { gains: { marco: 111.2, dana: 119.85, you: 60.45, sofia: 42.8, priya: 47.1, kenji: -8.9 }, chyron: 'Priya passes Sofia for 4th' },
  { gains: { marco: 121.35, dana: 117.95, you: 61.3, sofia: 43.6, priya: 47.65, kenji: -6.15 }, chyron: 'Marco takes 1st back from Dana' },
  { gains: { marco: 122.1, dana: 118.4, you: 63.9, sofia: 49.9, priya: 47.6, kenji: -1.6 }, chyron: 'Sofia passes Priya for 4th' },
];

// ── The money side: cumulative gain since joining (zero baseline) ────────
// DESIGN_DIRECTION §3 chart decision (PR #38): the line is value − cost
// basis + realized P/L, so joining the league or drafting never shows as a
// jump. Daily closes over three weeks; week 1 dips below zero.
export const PORTFOLIO = {
  value: BUDGET + 71.25 + 38.9,
  weekGain: 71.25,
  cumulative: [
    0, -14.2, -31.5, -22.8, -9.4, // week 1
    6.1, 18.7, 12.3, 29.8, 38.9, // week 2
    57.1, 51.3, 95.7, 100.2, 110.15, // week 3
  ],
} as const;

// ── FAQ: today's pre-launch answers ──────────────────────────────────────
export function faqItems(name: string): ReadonlyArray<{ q: string; a: string }> {
  return [
    {
      q: `When does ${name} launch?`,
      a: `${name} is in development and launching soon. This page is a preview of what’s coming; there’s nothing to sign up for yet.`,
    },
    {
      q: 'How do I get access?',
      a: 'There’s no signup right now. When we launch, you’ll be able to start a league and invite friends from this page.',
    },
    {
      q: 'How is a matchup won?',
      a: 'Whoever’s portfolio gains more dollars between Monday’s open and Friday’s close wins. If the dollar gains tie, the bigger percentage gain wins.',
    },
    {
      q: 'Is this real investing?',
      a: `No. ${name} follows the prices of real stocks, but it never buys, sells or holds any securities. It’s a game built on market data, not a brokerage.`,
    },
    {
      q: 'Does it cost anything?',
      a: `No. ${name} is free to play. There are no entry fees and no subscriptions.`,
    },
    {
      q: 'Do I win money?',
      a: 'No. There are no cash prizes or payouts, just standings, trophies and bragging rights.',
    },
  ];
}
