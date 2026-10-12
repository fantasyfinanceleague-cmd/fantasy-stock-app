// Illustrative mock data for the landing's product scenes — the live
// landing page's own mock (Stock Scudetto, Week 6, Roberto B. vs
// Gianluigi B., the tape, movers and standings), reused inside the richer
// animated components, plus the extra frames those animations need.
// A preview of the product, not real users. sampleData.test.ts checks the
// invariants (no win probability anywhere; the matchup lead is in dollars;
// every standings frame is a consistent ranking).

export const LEAGUE = 'Stock Scudetto';
export const WEEK = 6;
export const WEEKS = 14;

// ── Price tape (top of page), verbatim ───────────────────────────────────
export const TAPE: ReadonlyArray<{ t: string; p: string; d: string; up: boolean }> = [
  { t: 'NVDA', p: '318.37', d: '+3.81%', up: true },
  { t: 'AAPL', p: '211.42', d: '+1.24%', up: true },
  { t: 'MSFT', p: '421.62', d: '+0.88%', up: true },
  { t: 'TSLA', p: '248.36', d: '−0.52%', up: false },
  { t: 'GOOGL', p: '179.01', d: '+0.41%', up: true },
  { t: 'META', p: '498.50', d: '+1.92%', up: true },
  { t: 'AMZN', p: '236.40', d: '−1.18%', up: false },
  { t: 'AMD', p: '172.95', d: '−0.31%', up: false },
  { t: 'AVGO', p: '1124.20', d: '+0.84%', up: true },
  { t: 'COIN', p: '212.07', d: '+2.04%', up: true },
  { t: 'PLTR', p: '34.18', d: '+5.12%', up: true },
  { t: 'JPM', p: '215.45', d: '+0.22%', up: true },
];

// ── "A look inside": portfolio card ──────────────────────────────────────
/** The card's live frames: value + today's change, and the holdings. The
 * first frame is the old page's static mock; the rest tick it around. */
export const PORTFOLIO_FRAMES: ReadonlyArray<{
  value: number;
  today: number;
  todayPct: number;
  holdings: ReadonlyArray<{ t: string; co: string; sh: number; value: number; pct: number }>;
}> = [
  {
    value: 12430.55,
    today: 284.1,
    todayPct: 2.34,
    holdings: [
      { t: 'NVDA', co: 'NVIDIA', sh: 12, value: 3820.4, pct: 3.81 },
      { t: 'AAPL', co: 'Apple', sh: 10, value: 2114.22, pct: 1.24 },
      { t: 'TSLA', co: 'Tesla', sh: 6, value: 1490.18, pct: -0.52 },
    ],
  },
  {
    value: 12468.9,
    today: 322.45,
    todayPct: 2.65,
    holdings: [
      { t: 'NVDA', co: 'NVIDIA', sh: 12, value: 3851.16, pct: 4.64 },
      { t: 'AAPL', co: 'Apple', sh: 10, value: 2118.6, pct: 1.45 },
      { t: 'TSLA', co: 'Tesla', sh: 6, value: 1485.36, pct: -0.84 },
    ],
  },
  {
    value: 12451.3,
    today: 304.85,
    todayPct: 2.51,
    holdings: [
      { t: 'NVDA', co: 'NVIDIA', sh: 12, value: 3838.2, pct: 4.29 },
      { t: 'AAPL', co: 'Apple', sh: 10, value: 2109.9, pct: 1.03 },
      { t: 'TSLA', co: 'Tesla', sh: 6, value: 1493.82, pct: -0.28 },
    ],
  },
];

/** Sparkline points from the old mock (320×80 viewBox, y down). */
export const SPARKLINE = '0,76 24,72 48,66 72,68 96,58 120,52 144,55 168,42 192,38 216,32 240,28 264,18 288,12 320,6';

export const RANGES = ['1D', '1W', '1M', '3M', 'YTD', 'ALL'] as const;

// ── "A look inside": this week's matchup ────────────────────────────────
// The old card showed percent and "Win prob 72%". Win probability is out
// (no model); the foot shows the lead in DOLLARS, which is what matchups
// are decided on. Percent stays in the rows, as on the old card.
export const MATCHUP_FRAMES: ReadonlyArray<{ you: number; youPct: number; opp: number; oppPct: number }> = [
  { you: 284.1, youPct: 2.34, opp: -96.4, oppPct: -0.91 },
  { you: 322.45, youPct: 2.65, opp: -71.2, oppPct: -0.67 },
  { you: 304.85, youPct: 2.51, opp: -38.9, oppPct: -0.37 },
];
export const MATCHUP = {
  you: { name: 'Roberto B.', init: 'RB', role: 'you' },
  opp: { name: 'Gianluigi B.', init: 'GB', role: 'opponent' },
  left: '3d 4h left',
} as const;

// ── "A look inside": this week's movers ─────────────────────────────────
export const MOVERS_FRAMES: ReadonlyArray<ReadonlyArray<{ t: string; co: string; pct: number }>> = [
  [
    { t: 'NVDA', co: 'NVIDIA', pct: 3.81 },
    { t: 'PLTR', co: 'Palantir', pct: 5.12 },
    { t: 'META', co: 'Meta', pct: 1.92 },
    { t: 'TSLA', co: 'Tesla', pct: -0.52 },
    { t: 'AMZN', co: 'Amazon', pct: -1.18 },
  ],
  [
    { t: 'NVDA', co: 'NVIDIA', pct: 4.64 },
    { t: 'PLTR', co: 'Palantir', pct: 4.87 },
    { t: 'META', co: 'Meta', pct: 1.61 },
    { t: 'TSLA', co: 'Tesla', pct: -0.84 },
    { t: 'AMZN', co: 'Amazon', pct: -0.95 },
  ],
  [
    { t: 'NVDA', co: 'NVIDIA', pct: 5.02 },
    { t: 'PLTR', co: 'Palantir', pct: 4.66 },
    { t: 'META', co: 'Meta', pct: 1.73 },
    { t: 'TSLA', co: 'Tesla', pct: -0.28 },
    { t: 'AMZN', co: 'Amazon', pct: -1.31 },
  ],
];
/** The old page listed movers in this order; the live card ranks them. */
export const moversRanked = (frame: number) =>
  [...MOVERS_FRAMES[frame]].sort((a, b) => b.pct - a.pct);

// ── /02 Leagues in action: the Stock Scudetto board ──────────────────────
// The old board's six players, ranked by season gain (as it was). Each
// frame changes the order by the move its chyron names; the last frame is
// Friday's close, where records update and the week locks.
export interface Player {
  id: string;
  name: string;
  init: string;
  you?: boolean;
}
export const PLAYERS: readonly Player[] = [
  { id: 'paolo', name: 'Paolo M.', init: 'PM' },
  { id: 'roberto', name: 'Roberto B.', init: 'RB', you: true },
  { id: 'alessandro', name: 'Alessandro D.', init: 'AD' },
  { id: 'francesco', name: 'Francesco T.', init: 'FT' },
  { id: 'gianluigi', name: 'Gianluigi B.', init: 'GB' },
  { id: 'andrea', name: 'Andrea P.', init: 'AP' },
];

export interface BoardFrame {
  pct: Record<string, number>;
  rec: Record<string, string>;
  final?: boolean;
  chyron?: string;
}

const REC_LIVE = { paolo: '5–0', roberto: '4–1', alessandro: '4–1', francesco: '3–2', gianluigi: '2–3', andrea: '1–4' };
const REC_FINAL = { paolo: '5–1', roberto: '5–1', alessandro: '5–1', francesco: '3–3', gianluigi: '2–4', andrea: '2–4' };

export const BOARD_FRAMES: readonly BoardFrame[] = [
  // The old page's board, verbatim numbers.
  { pct: { paolo: 8.42, roberto: 5.1, alessandro: 4.88, francesco: 2.31, gianluigi: -1.04, andrea: -2.88 }, rec: REC_LIVE },
  {
    pct: { paolo: 8.36, roberto: 4.97, alessandro: 5.21, francesco: 2.44, gianluigi: -1.12, andrea: -2.61 },
    rec: REC_LIVE,
    chyron: 'Alessandro D. moves up to 2nd',
  },
  {
    pct: { paolo: 8.3, roberto: 5.58, alessandro: 5.26, francesco: 2.4, gianluigi: -1.2, andrea: -1.34 },
    rec: REC_LIVE,
    chyron: 'Roberto B. takes 2nd back',
  },
  {
    pct: { paolo: 8.18, roberto: 5.64, alessandro: 5.3, francesco: 2.38, gianluigi: -1.31, andrea: -0.74 },
    rec: REC_LIVE,
    chyron: 'Andrea P. climbs to 5th',
  },
  {
    pct: { paolo: 8.05, roberto: 8.61, alessandro: 5.42, francesco: 2.2, gianluigi: -1.46, andrea: -0.52 },
    rec: REC_FINAL,
    final: true,
    chyron: `Final · Week ${WEEK}: Roberto B. takes 1st`,
  },
];

export const boardRanked = (frame: number) => {
  const { pct, rec } = BOARD_FRAMES[frame];
  return [...PLAYERS]
    .sort((a, b) => pct[b.id] - pct[a.id])
    .map((p, i) => ({ ...p, rank: i + 1, pct: pct[p.id], rec: rec[p.id] }));
};

/** Rank change per player from frame `from` (default: the previous frame)
 * to `frame`; positive = moved up. Frame 0 with no earlier frame is the
 * loop's restart, so it names no moves. */
export const boardMoves = (frame: number, from = frame - 1): Record<string, number> => {
  if (from < 0) return {};
  const before = Object.fromEntries(boardRanked(from).map((r) => [r.id, r.rank]));
  const out: Record<string, number> = {};
  for (const r of boardRanked(frame)) if (before[r.id] !== r.rank) out[r.id] = before[r.id] - r.rank;
  return out;
};

// ── /01 How it works: the phone's three screens ─────────────────────────
/** Draft: the snake order for rounds 1–2 of a 6-team league, and who took
 * what. Roberto (you) picks 2nd, so his picks are #2 and #11. */
export const DRAFT_PICKS: ReadonlyArray<{ pick: number; player: string; t: string; you?: boolean }> = [
  { pick: 1, player: 'Paolo M.', t: 'MSFT' },
  { pick: 2, player: 'Roberto B.', t: 'NVDA', you: true },
  { pick: 3, player: 'Alessandro D.', t: 'META' },
  { pick: 4, player: 'Francesco T.', t: 'AVGO' },
  { pick: 5, player: 'Gianluigi B.', t: 'AMZN' },
  { pick: 6, player: 'Andrea P.', t: 'GOOGL' },
  { pick: 7, player: 'Andrea P.', t: 'COIN' },
  { pick: 8, player: 'Gianluigi B.', t: 'JPM' },
  { pick: 9, player: 'Francesco T.', t: 'AMD' },
  { pick: 10, player: 'Alessandro D.', t: 'PLTR' },
  { pick: 11, player: 'Roberto B.', t: 'AAPL', you: true },
  { pick: 12, player: 'Paolo M.', t: 'TSLA' },
];

/** Compete: Roberto vs Gianluigi, Week 6, daily closes (dollar gain). */
export const WEEK_CLOSES: ReadonlyArray<{ day: string; you: number; opp: number }> = [
  { day: 'Mon', you: 0, opp: 0 },
  { day: 'Mon', you: 61.2, opp: 88.4 },
  { day: 'Tue', you: 142.75, opp: 101.3 },
  { day: 'Wed', you: 118.4, opp: 34.9 },
  { day: 'Thu', you: 238.6, opp: -12.55 },
  { day: 'Fri', you: 351.8, opp: -40.25 },
];

/** Draft: the six roster spots the snake fills (rounds 1–6); the phone
 * shows the first two filling. */
export const ROSTER_SLOTS = ['Rd 1', 'Rd 2', 'Rd 3', 'Rd 4', 'Rd 5', 'Rd 6'] as const;

/** Compete: each side's lineup as shares of that side's dollar gain (the
 * weights sum to 1, so the lineup always adds up to the score), and the
 * lead-change call. Roberto's are his drafted picks. */
export const LINEUPS = {
  you: [
    { t: 'NVDA', w: 0.52 },
    { t: 'AAPL', w: 0.31 },
    { t: 'CRM', w: 0.24 },
    { t: 'TSLA', w: -0.07 },
  ],
  opp: [
    { t: 'AMZN', w: 0.58 },
    { t: 'JPM', w: 0.47 },
    { t: 'DIS', w: 0.13 },
    { t: 'NKE', w: -0.18 },
  ],
  leadChangeCall: 'NVDA +4.1% puts Roberto B. ahead',
} as const;

// ── /03 Why: "Real prices." race chart ───────────────────────────────────
/** The /03 race chart's series: the SAME Roberto vs Gianluigi Week 6 as the
 * /01 Compete chapter (Design Lead, round 4: one story) — Monday's open,
 * then each daily close, as cumulative dollar gain. */
export const raceSeries = () =>
  WEEK_CLOSES.map((d, i) => ({ label: i === 0 ? 'Open' : d.day, you: d.you, opp: d.opp }));
