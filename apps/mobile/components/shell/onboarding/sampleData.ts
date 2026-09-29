// Phase 3b-1 — the onboarding vignettes' demo data, taken from the board's
// canonical sample league (docs/design/screens/data.js + inventory.jsx
// "Onboarding"). Illustrative only: never a real user's league or money.

export const ONBOARDING_CARDS = [
  'Fantasy football, but with stocks.',
  'Draft real stocks. Face one friend each week.',
  "Best performance by Friday's close wins.",
] as const;

/** Card 1: the roster filling round by round (inventory.jsx ONBOARD[0]). */
export const ROSTER_PICKS = ['NVDA', 'AAPL', 'CRM', 'TSLA', 'COST', 'V'] as const;

/** Card 2: Roberto B. (you) vs Gianluigi B., before and after the lead change. */
export const VERSUS = {
  you: { name: 'Roberto B.', initials: 'RB' },
  opp: { name: 'Gianluigi B.', initials: 'GB' },
  before: { you: 90.44, opp: 128.1 },
  after: { you: 213.6, opp: 90.44 },
  /** data.js CHYRONS.Tue, verbatim. */
  chyron: 'NVDA +2.9% puts Roberto B. ahead',
  tag: 'Week 6 · Mon–Fri',
} as const;

/** Card 3: the Friday final (inventory.jsx ONBOARD[2]). */
export const FINAL = {
  you: 351.77,
  opp: -38.88,
  winner: 'You win Week 6',
} as const;
