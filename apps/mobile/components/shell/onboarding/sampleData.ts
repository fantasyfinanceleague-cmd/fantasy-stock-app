// Phase 3b-1 — the onboarding vignettes' demo data, taken from the board's
// canonical sample league (docs/design/screens/data.js + inventory.jsx
// "Onboarding"). Illustrative only: never a real user's league or money.
// Pure (no React), so the tests read it directly.

import type { Category, ScoreSide } from '../../sp/logic/gameNight';

export const ONBOARDING_CARDS = [
  'Fantasy football, but with stocks.',
  'Draft real stocks. Face one friend each week.',
  "Best performance by Friday's close wins.",
] as const;

/** Card 1: the roster filling round by round (inventory.jsx ONBOARD[0]), each pick with the
 * category the draft board's tile carries (Giorgio's 11 categories, 2026-10-12). */
export const ROSTER_PICKS: readonly { ticker: string; category: Category }[] = [
  { ticker: 'NVDA', category: 'tech' },
  { ticker: 'AAPL', category: 'tech' },
  { ticker: 'CRM', category: 'tech' },
  { ticker: 'TSLA', category: 'transport' },
  { ticker: 'COST', category: 'retail' },
  { ticker: 'V', category: 'finance' },
];

/** Card 2: Roberto B. (you) vs Gianluigi B., before and after the lead change. */
export const VERSUS = {
  you: { name: 'Roberto B.' },
  opp: { name: 'Gianluigi B.' },
  before: { you: 90.44, opp: 128.1 },
  after: { you: 213.6, opp: 90.44 },
} as const;

/** The two scoreboard sides at a moment of card 2: Gianluigi B. leads, then you do. */
export function versusSides(moment: 'before' | 'after'): { you: ScoreSide; opponent: ScoreSide } {
  const score = VERSUS[moment];
  return { you: { name: VERSUS.you.name, gain: score.you }, opponent: { name: VERSUS.opp.name, gain: score.opp } };
}

/** Card 3: the Friday final (inventory.jsx ONBOARD[2]). */
export const FINAL = {
  you: 351.77,
  opp: -38.88,
  winner: 'You win Week 6',
} as const;
