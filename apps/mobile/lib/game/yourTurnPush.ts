/**
 * Your turn, anywhere in the open app (Giorgio 2026-10-11: make it match the
 * your-turn spec). The buzz + chime fire whenever the app is open on screen, not
 * only in the draft room, and still exactly ONCE per turn. Two paths can see a
 * turn start: the foreground "your turn" push (lib/notifications.ts) and the
 * draft room's own clock reading (components/game/DraftRoom.tsx). Both claim
 * one key per league + pick (yourTurnKey); whichever claims it first alerts,
 * the other stays silent. Pure, so Deno tests it; lib/game/yourTurnAlert.ts
 * plays it.
 *
 * In the foreground the your-turn banner still shows (elsewhere than the room),
 * but without the phone's notification sound: the app's one buzz + chime is the
 * sound (the Design Lead: one sound, not two). Every other notification type
 * keeps its sound. App closed or in the background: the OS banner and sound, as
 * before (this handler doesn't run).
 */
import { foregroundPresentation } from '../foregroundQuiet';

/** The once-per-turn key: one league's one pick (its overall pick number). */
export function yourTurnKey(leagueId: string, pick: number): string {
  return `${leagueId.toLowerCase()}:${pick}`;
}

/** A push's once-per-turn key, or null when it isn't a "your turn" push or
 * doesn't name its turn (a push from a server before league_id + pick_number
 * were added: it keeps the old behaviour, banner and OS sound, no app alert). */
export function yourTurnPushKey(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'draft_turn') return null;
  if (typeof d.league_id !== 'string' || d.league_id === '') return null;
  if (typeof d.pick_number !== 'number' || !Number.isInteger(d.pick_number) || d.pick_number < 1) return null;
  return yourTurnKey(d.league_id, d.pick_number);
}

/** Claim a turn's alert: true the first time a key is seen (alert now), false after. */
export function claimYourTurn(claimed: Set<string>, key: string): boolean {
  if (claimed.has(key)) return false;
  claimed.add(key);
  return true;
}

export type ForegroundPresentation = ReturnType<typeof foregroundPresentation>;

/** What the foreground notification handler does with one push: how it presents,
 * and which turn (if any) to alert. A your-turn push while the app is active never
 * plays the OS sound: either the app alerts now, or the turn was already alerted
 * (the claim decides, not this). Not active (e.g. Notification Center pulled down)
 * or any other type: the presentation is foreground quiet's, sound included. */
export function foregroundPushPlan(
  data: unknown,
  quiet: boolean,
  appActive: boolean,
): { presentation: ForegroundPresentation; alertKey: string | null } {
  const presentation = foregroundPresentation(quiet);
  const key = appActive ? yourTurnPushKey(data) : null;
  if (key === null) return { presentation, alertKey: null };
  return { presentation: { ...presentation, shouldPlaySound: false }, alertKey: key };
}
