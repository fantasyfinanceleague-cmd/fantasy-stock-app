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

/** A league update (the playoff-teams stepper). With the seam on it succeeds on the fixture and writes nothing. */
export async function seamUpdateLeague(id: string, patch: Record<string, unknown>) {
  if (SEAM_ON) return { data: null, error: null };
  return supabase.from('leagues').update(patch).eq('id', id);
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
