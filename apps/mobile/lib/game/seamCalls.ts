/**
 * The game screens' calls, through the capture seam (3c). With the seam off these
 * are exactly the real calls (supabase.rpc, functions.invoke, a leagues update).
 * With the seam on (dev build and EXPO_PUBLIC_GAME_SEAM=1), a call with a fixture
 * returns the fixture and makes NO real call. A call with no fixture is real.
 */
import { supabase } from '../supabase';
import { SEAM_ON } from './devSeam';
import { fixtureFor, invokeFixtureFor } from './seamFixtures';
import { seamTableRows, seamWeekClosed, type SeamTableName } from './seamTables';
import { markFixtureRenewed } from '../shell/devFixture';
import { markFixtureAnswer } from './renewalFixture';
import { draftRoomClockRead, parseDraftRoomVariant, roomVariantAfterAutoPick } from './seamRoom';

/** EXPO_PUBLIC_DRAFT_ROOM_FIXTURE: how far the board's draft has gone (seamRoom.ts).
 * 'turn_arrives' moves on once, when the room's auto-pick backstop reaches the seam. */
let roomVariant = parseDraftRoomVariant(process.env.EXPO_PUBLIC_DRAFT_ROOM_FIXTURE);
import { saveLeagueSlots, type SlotDraft } from '../categoryData';

export async function seamRpc(name: string, args: Record<string, unknown>) {
  if (SEAM_ON) {
    // DRAFT_ROOM_FIXTURE=loading: the room's clock read never answers, so its skeleton stays up for the capture.
    if (name === 'get_draft_clock' && draftRoomClockRead(roomVariant) === 'pending') return new Promise<never>(() => {});
    const f = fixtureFor(name, args, roomVariant, process.env.EXPO_PUBLIC_DRAFT_START_FIXTURE);
    // A renewal adds Season 2 to the fixture league list, as the real list would.
    if (f && name === 'renew_league') markFixtureRenewed();
    // An answer moves the fixture roster's caller, as the real roster would.
    if (f && name === 'respond_to_renewal') markFixtureAnswer(args.p_response);
    if (f) return f;
  }
  return supabase.rpc(name, args);
}

export async function seamInvoke(fn: string, opts: { body: Record<string, unknown> }) {
  if (SEAM_ON) {
    if (fn === 'validate-and-record-pick' && opts.body.action === 'auto_pick') roomVariant = roomVariantAfterAutoPick(roomVariant);
    const f = invokeFixtureFor(fn, opts.body, process.env.EXPO_PUBLIC_DRAFT_START_FIXTURE, process.env.EXPO_PUBLIC_LEAVE_FIXTURE);
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
  // Week 6 closes in the Home fixtures that score it (EXPO_PUBLIC_HOME_FIXTURE=scored, …).
  const rows = seamTableRows(SEAM_ON, name, roomVariant, {
    weekClosed: seamWeekClosed(process.env.EXPO_PUBLIC_HOME_FIXTURE),
    bye: process.env.EXPO_PUBLIC_HOME_FIXTURE === 'bye',
    lost: process.env.EXPO_PUBLIC_HOME_FIXTURE === 'scored' && process.env.EXPO_PUBLIC_SCORED_OUTCOME === 'lost',
    // The League fixture's playoffs in progress: the Wild card scored, the Semifinals not yet.
    playoffsLive: process.env.EXPO_PUBLIC_LEAGUE_FIXTURE === 'playoffs_live',
  });
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
