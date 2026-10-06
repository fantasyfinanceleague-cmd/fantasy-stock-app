/**
 * The game screens' calls, through the capture seam (3c). With the seam off these
 * are exactly the real calls (supabase.rpc, functions.invoke, a leagues update).
 * With the seam on (dev build and EXPO_PUBLIC_GAME_SEAM=1), a call with a fixture
 * returns the fixture and makes NO real call. A call with no fixture is real.
 */
import { supabase } from '../supabase';
import { SEAM_ON } from './devSeam';
import { fixtureFor, invokeFixtureFor } from './seamFixtures';
import { seamTableRows, type SeamTableName } from './seamTables';
import { saveLeagueSlots, type SlotDraft } from '../categoryData';

export async function seamRpc(name: string, args: Record<string, unknown>) {
  if (SEAM_ON) {
    const f = fixtureFor(name, args);
    if (f) return f;
  }
  return supabase.rpc(name, args);
}

export async function seamInvoke(fn: string, opts: { body: Record<string, unknown> }) {
  if (SEAM_ON) {
    const f = invokeFixtureFor(fn, opts.body);
    if (f) return f;
  }
  return supabase.functions.invoke(fn, opts);
}

/** A league update (League settings, the playoff-teams stepper). It selects the
 * updated row's id, so the caller can tell a real write from a 0-row no-op (an
 * update that matches nothing resolves with no error: check it with
 * updatedOneRow). With the seam on it "updates" the one fixture row and writes nothing. */
export async function seamUpdateLeague(id: string, patch: Record<string, unknown>) {
  if (SEAM_ON) return { data: [{ id }], error: null };
  return supabase.from('leagues').update(patch).eq('id', id).select('id');
}

/** A table read through the seam: the fixture rows when the seam is on, else the real query. */
export async function seamTable<T>(
  name: SeamTableName,
  real: () => PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>,
): Promise<{ data: T[] | null; error: unknown; count?: number | null }> {
  const rows = seamTableRows(SEAM_ON, name);
  if (rows) return { data: rows as T[], error: null, count: rows.length };
  return real();
}

/** Stand-in id for the league a fixture create returns. The seam never writes it anywhere. */
const SEAM_NEW_LEAGUE_ID = 'fixture-new-league';

/** The create-league insert. With the seam on it returns a fixture league and writes nothing. */
export async function seamInsertLeague(row: Record<string, unknown>) {
  if (SEAM_ON) {
    return { data: { ...row, id: SEAM_NEW_LEAGUE_ID }, error: null } as { data: Record<string, unknown> & { id: string }; error: null };
  }
  return supabase.from('leagues').insert(row).select().single();
}

/** The commissioner's membership row. With the seam on it succeeds and writes nothing. */
export async function seamInsertMember(row: Record<string, unknown>) {
  if (SEAM_ON) return { error: null };
  return supabase.from('league_members').insert(row);
}

/** Replace a league's slots. With the seam on it succeeds and writes nothing. */
export async function seamSaveLeagueSlots(leagueId: string, slots: SlotDraft[]): Promise<void> {
  if (SEAM_ON) return;
  return saveLeagueSlots(leagueId, slots);
}
