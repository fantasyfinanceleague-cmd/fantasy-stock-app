/**
 * joinFixtureGate: the PURE half of the Join screen's dev-only fixture seam
 * (same split as lib/home/homeFixtureData.ts vs lib/home/devFixture.ts: this
 * file never mentions `__DEV__`, so Deno can import and test it; the one
 * file that reads `__DEV__` and the env var is ./devFixture.ts).
 *
 * A fixture stands in for the SERVER, not for the screen: it returns the
 * exact bodies preview-league and join-league return, so the real
 * interpretPreview / interpretJoin / previewView code and the real screen run
 * on top of it. Every join state is reachable (prefill + tap Find league)
 * without a real code and without a real join. Nothing is ever written.
 *
 *   EXPO_PUBLIC_JOIN_FIXTURE=<state>  (apps/mobile/.env.local, gitignored)
 */

export type JoinFixture =
  | 'typing'      // code entry, "SERIEA" typed, no network
  | 'checking'    // Find league never answers: the spinner holds
  | 'bad'         // no league has the code
  | 'preview'     // joinable; Join succeeds
  | 'full'
  | 'drafted'      // a completed draft (draft_started)
  | 'drafting'     // a draft under way (draft_started, status in_progress)
  | 'member'      // already_member; Open the league works
  | 'expired'
  | 'season_over'
  | 'left'        // the optional left_league reason (flag a)
  | 'offline'     // no connection
  | 'rate_limited'
  | 'join_race';  // joinable at the preview, then the league fills before Join

export const JOIN_FIXTURES: readonly JoinFixture[] = [
  'typing', 'checking', 'bad', 'preview', 'full', 'drafted', 'drafting', 'member', 'expired',
  'season_over', 'left', 'offline', 'rate_limited', 'join_race',
];

/**
 * The only way a fixture turns on: a development build (`isDev`) AND a
 * recognised value. Release bundles pass `isDev` false, so every input,
 * recognised or not, resolves to null.
 */
export function resolveJoinFixture(isDev: boolean, raw: string | undefined): JoinFixture | null {
  if (!isDev) return null;
  return raw && (JOIN_FIXTURES as readonly string[]).includes(raw) ? (raw as JoinFixture) : null;
}

/** The code a fixture prefills (the board's Serie A Traders code). */
export function fixturePrefill(f: JoinFixture): string {
  return f === 'typing' ? 'SERIEA' : f === 'bad' ? 'SERIAE7' : 'SERIEA7';
}

/** Long enough to see the loading state in a capture. */
export const FIXTURE_NETWORK_MS = 900;

/** A supabase-js-shaped failure (FunctionsHttpError / FunctionsFetchError) for the error fixtures. */
export type FixtureInvokeError = { name: string; context?: { status: number } };

const SERIE_A = {
  name: 'Serie A Traders',
  commissioner_name: 'Roberto B.',
  league_type: 'matchup',
  num_participants: 8,
  current_members: 6,
  budget_mode: 'no-budget',
  budget_amount: null,
  stake_mode: 'fixed_notional',
  notional_per_slot: 2000,
  duration_days: null,
  num_weeks: 10,
  // Sat Oct 10 2026, 7:00 PM ET.
  draft_date: '2026-10-10T23:00:00Z',
  draft_status: 'not_started',
};

function preview(reason: string | null, league: Partial<typeof SERIE_A> = {}) {
  return { found: true, joinable: reason === null, reason, league: { ...SERIE_A, ...league } };
}

/** What preview-league answers for a fixture. `checking` never resolves (caller's job). */
export function fixturePreviewResponse(f: JoinFixture): { data: unknown; error: FixtureInvokeError | null } {
  switch (f) {
    case 'bad': return { data: { found: false, reason: 'invalid_code' }, error: null };
    case 'full': return { data: preview('league_full', { current_members: 8 }), error: null };
    case 'drafted': return { data: preview('draft_started', { draft_status: 'completed' }), error: null };
    case 'drafting': return { data: preview('draft_started', { draft_status: 'in_progress' }), error: null };
    case 'member': return { data: preview('already_member'), error: null };
    case 'expired': return { data: preview('invite_expired'), error: null };
    case 'season_over': return { data: preview('season_completed', { draft_status: 'completed' }), error: null };
    case 'left': return { data: preview('left_league'), error: null };
    case 'offline': return { data: null, error: { name: 'FunctionsFetchError' } };
    case 'rate_limited': return { data: null, error: { name: 'FunctionsHttpError', context: { status: 429 } } };
    default: return { data: preview(null), error: null };
  }
}

/** What join-league answers. Only `preview` joins; `member` opens; `join_race` refuses. */
export function fixtureJoinResponse(f: JoinFixture): { data: unknown; error: FixtureInvokeError | null } {
  const league = { id: '00000000-0000-4000-8000-000000000001', name: SERIE_A.name };
  switch (f) {
    case 'member': return { data: { ok: false, reason: 'already_member', league }, error: null };
    case 'join_race': return { data: { ok: false, reason: 'league_full' }, error: null };
    default: return { data: { ok: true, league }, error: null };
  }
}
