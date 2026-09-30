/**
 * DEV-ONLY Home fixtures (Phase 3b-2), for states that can't reliably be
 * reached live: playoffs, season-complete, a forced leader flip, and — on
 * a dev machine whose test league isn't mid-scoring right now — the
 * scoring/scored transition. Same safety model as
 * lib/shell/devFixture.ts: read only under `__DEV__`, gated by an env var,
 * never touches Supabase for the faked state.
 *
 * This file holds ONLY the `__DEV__`/env-var gate. The actual sample
 * numbers live in ./homeFixtureData.ts (no `__DEV__` reference), which
 * this file re-exports for app callers — split out because Deno (this
 * repo's hermetic test runtime, tests-deno/) cannot resolve the RN global
 * `__DEV__`, and a module-top-level reference to it makes the WHOLE
 * module unimportable under `deno test`, even for callers that only want
 * the pure data. lib/shell/devFixture.ts has the same shape and is,
 * accordingly, never imported by any deno test either — this module
 * keeps that constraint from spreading to the data itself.
 */

export {
  ROBERTO_WEEKS, ROBERTO_HOLDINGS, GIANLUIGI_HOLDINGS, fixtureQty,
  fixtureSnapshots, fixturePrice, fixtureDraftRows,
  FIXTURE_LEAGUE, FIXTURE_OPPONENT_NAME, FIXTURE_MY_NAME,
  FIXTURE_WEEK6_START, FIXTURE_WEEK6_END,
  type HoldingRow,
} from './homeFixtureData';

export type HomeFixture =
  | 'live_open'
  | 'live_closed'
  | 'scoring'
  | 'scored'
  | 'pre_season'
  | 'pre_draft'
  | 'pre_draft_waiting'
  | 'drafting_on_clock'
  | 'drafting_waiting_turn'
  | 'complete'
  /** B6 (Design Lead, 2026-09-30): the board's non-champion HomeComplete
   * variant -- captured separately from 'complete' (the champion one). */
  | 'complete_runner_up'
  | 'bye'
  | 'playoff_live'
  | 'playoff_bye'
  | 'eliminated'
  | 'missed_playoffs'
  | 'leader_flip';

const FIXTURES: readonly HomeFixture[] = [
  'live_open', 'live_closed', 'scoring', 'scored', 'pre_season', 'pre_draft',
  'pre_draft_waiting', 'drafting_on_clock', 'drafting_waiting_turn', 'complete', 'complete_runner_up', 'bye',
  'playoff_live', 'playoff_bye', 'eliminated', 'missed_playoffs', 'leader_flip',
];

/** True for either drafting-family fixture — the states 6/7 group in
 * useHomeLeague's own fixtureHomeLeague still only needs to know "the
 * draft is in progress", not which of the two capture variants. */
export function isDraftingFixture(fixture: HomeFixture | null): boolean {
  return fixture === 'drafting_on_clock' || fixture === 'drafting_waiting_turn';
}

function parse(raw: string | undefined): HomeFixture | null {
  return raw && (FIXTURES as readonly string[]).includes(raw) ? (raw as HomeFixture) : null;
}

export const HOME_FIXTURE: HomeFixture | null = __DEV__ ? parse(process.env.EXPO_PUBLIC_HOME_FIXTURE) : null;

if (HOME_FIXTURE) {
  console.warn(`[dev] HOME FIXTURE "${HOME_FIXTURE}" — fake league data, no Supabase reads for Home.`);
}
