/**
 * The League tab's capture fixture (W4 League gate; DEV + the capture seam only), pure so
 * Deno tests it. EXPO_PUBLIC_LEAGUE_FIXTURE picks one League state the Home fixtures don't
 * draw. Unset: League reads the same Home fixture Home does (EXPO_PUBLIC_HOME_FIXTURE), so
 * Home's Standings card and League's full standings always agree.
 *   twelve         12 managers, the stress names (20 characters) and ≥ $1M gains and losses,
 *                  tied records, your row in the MIDDLE (7th);
 *   sixteen        16 managers (the most a league allows), your row at the BOTTOM;
 *   loading        the standings read never answers (the skeleton);
 *   error          the standings read fails ("Couldn't load the standings");
 *   history_error  History's read fails; bracket_error  the bracket's read fails;
 *   playoffs_live  the active league is in its playoffs, the Wild card scored, the
 *                  Semifinals not yet.
 * The extra managers keep the Home fixture's six ids, so Schedule still names them.
 */
import { FIXTURE_USER_ID } from '../shell/fixtureIds';

export type LeagueFixture = 'twelve' | 'sixteen' | 'loading' | 'error' | 'history_error' | 'bracket_error' | 'playoffs_live';

const VARIANTS: readonly LeagueFixture[] = ['twelve', 'sixteen', 'loading', 'error', 'history_error', 'bracket_error', 'playoffs_live'];

export function parseLeagueFixture(v: string | null | undefined): LeagueFixture | null {
  return (VARIANTS as readonly string[]).includes(v ?? '') ? (v as LeagueFixture) : null;
}

export interface FixtureStanding {
  user_id: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  display_name: string;
  is_bot: boolean;
}

const ME = FIXTURE_USER_ID;

/** [id, name, wins, losses, ties, season gain]. Twenty-character names, million-dollar gains
 * and losses, two pairs of equal records (ties resolved by the server's order, as drawn). */
const TWELVE: readonly [string, string, number, number, number, number][] = [
  ['paolo', 'Paolo Mastrantonioli', 6, 0, 0, 1532118.4],
  ['gianluigi', 'Gianluigi Buonarroti', 5, 1, 0, 1204388.1],
  ['m-valentina', 'Valentina Castellani', 4, 1, 1, 998210.55],
  ['marco', 'Marco Tagliavinicchi', 4, 2, 0, -1098552.3],
  ['luca', 'Luca Vercingetorixxi', 4, 2, 0, 412880.15],
  ['m-federico', 'Federico Lombardozzi', 3, 2, 1, 260114.9],
  [ME, 'Robertino Bartolomeo', 3, 3, 0, -1234567.8],
  ['chiara', 'Chiara Rinaldi-Sforz', 3, 3, 0, -815642.95],
  ['m-giulia', 'Giulia Montefeltrini', 2, 4, 0, 1012.4],
  ['m-alessio', 'Alessio Bonaventura', 2, 4, 0, -48.25],
  ['m-francesca', 'Francesca Abbondanzi', 1, 5, 0, -642311.0],
  ['m-tommaso', 'Tommaso Pellegrinoni', 0, 6, 0, -1987654.32],
];

/** Sixteen: four more after the twelve, and you last. */
const SIXTEEN_EXTRA: readonly [string, string, number, number, number, number][] = [
  ['m-beatrice', 'Beatrice Santangelo', 2, 4, 0, -12650.0],
  ['m-lorenzo', 'Lorenzo Guicciardini', 1, 5, 0, -301.75],
  ['m-ilaria', 'Ilaria Vespucciolina', 1, 5, 0, -77012.4],
  ['m-davide', 'Davide Caravaggesco', 0, 6, 0, -1402000.0],
];

function standing([user_id, display_name, wins, losses, ties, points_for]: readonly [string, string, number, number, number, number], i: number): FixtureStanding {
  return { user_id, rank: i + 1, wins, losses, ties, points_for, display_name, is_bot: false };
}

/** The standings for a sized variant, in the server's order (never re-sorted), or null. */
export function leagueFixtureStandings(variant: LeagueFixture | null): FixtureStanding[] | null {
  if (variant === 'twelve') return TWELVE.map(standing);
  if (variant === 'sixteen') {
    // The fixture plays the server: the fifteen others by win % (a stable sort keeps the
    // twelve's own tiebreak order), then you, 0–6, last of all on season gain.
    const pct = ([, , w, l, t]: readonly [string, string, number, number, number, number]) => (w + 0.5 * t) / Math.max(1, w + l + t);
    const others = [...TWELVE.filter(([id]) => id !== ME), ...SIXTEEN_EXTRA].sort((a, b) => pct(b) - pct(a));
    const me = TWELVE.find(([id]) => id === ME)!;
    return [...others, [me[0], me[1], 0, 6, 0, -1999999.99] as const].map(standing);
  }
  return null;
}

/** Last week's order for a sized variant: every pair of neighbours swapped (1↔2, 3↔4, …),
 * so up, down and (for an odd one out) held all show. */
export function leagueFixturePreviousRanks(rows: readonly FixtureStanding[]): { user_id: string; rank: number }[] {
  return rows.map((r) => {
    const i = r.rank - 1;
    const partner = i % 2 === 0 ? i + 1 : i - 1;
    return { user_id: r.user_id, rank: partner < rows.length ? partner + 1 : r.rank };
  });
}
