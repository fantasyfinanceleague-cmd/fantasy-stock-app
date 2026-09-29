// Phase 3b-1 — which league is active after a relaunch (spec gate 6: "the
// active league persists across relaunch").
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically;
// lib/LeagueContext.tsx owns the AsyncStorage read/write.

import { sheetGroupFor, type SheetLeague } from './leagueSheet';

/** Per user, so two accounts on one phone never share a choice. */
export function activeLeagueStorageKey(userId: string): string {
  return `sp.activeLeague.v1.${userId}`;
}

/**
 * The stored choice while the user is still in that league; otherwise the
 * first live league, then upcoming, then finished (each in the given order,
 * which is newest-first from LeagueContext). null when there are no leagues.
 */
export function resolveActiveLeagueId(storedId: string | null, leagues: Pick<SheetLeague, 'id' | 'seasonPhase'>[]): string | null {
  if (storedId && leagues.some((l) => l.id === storedId)) return storedId;
  for (const group of ['live', 'upcoming', 'finished'] as const) {
    const first = leagues.find((l) => sheetGroupFor(l.seasonPhase) === group);
    if (first) return first.id;
  }
  return null;
}
