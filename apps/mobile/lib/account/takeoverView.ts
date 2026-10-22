// Account deletion (W4) — what the takeover landing shows, from join-league's `takeover_preview` and `takeover`
// answers (Orchestrator contract, 2026-10-21). Pure.
//
//   takeover_preview -> {ok:true, league_name, wins, losses, rank} | {ok:false, reason}
//   takeover         -> {ok:true, status:'taken_over'} | {ok:false, reason}
//   reasons: gone | taken | invalid_code | not_deleted | window | already_member | not_eligible
//
// Dead links follow the invite arrival's pattern: NO heading, the refusal alone, then one way out. "taken" has its
// own approved line ("Someone already took this team." + "Go to Home"); every other dead reason reuses the invite's
// existing dead-link sentence (lib/invite/inviteCopy.ts) so this adds no unapproved copy. already_member is not a
// refusal: the person is in the league, so it opens Home. Anything unrecognised (an older app against a newer
// server) and a failed call are an unknown: "Try again" is the person's tap, never a loop.

import type { FunctionRefusal } from '../functionRefusal';
import type { RateWait, TakeoverReply } from './takeoverReply';
import { ordinal } from '../home/ordinal';
import { isUuid } from '../uuid';
import { INVITE_COPY } from '../invite/inviteCopy';
import { TAKEN_LINE } from './deleteCopy';

const DEAD_REASONS = ['gone', 'invalid_code', 'not_deleted', 'window'] as const;

export type TakeoverPreview =
  | { kind: 'found'; leagueName: string; wins: number; losses: number; rank: number }
  | { kind: 'taken' }
  | { kind: 'dead' }
  /** Already in the league (already_member, or not_eligible): the shipped "You're already in {league}." + "Open the league". `leagueName` is null when the reply names none. */
  | { kind: 'member'; leagueName: string | null; leagueId: string | null }
  /** Too many wrong codes: a wait, never the dead-link page (the link may be fine). */
  | { kind: 'rate_limited'; wait: RateWait }
  | { kind: 'unknown' };

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10000 ? v : null);

function memberView(body: Record<string, unknown>): TakeoverPreview {
  const league = body.league as { id?: unknown; name?: unknown } | null | undefined;
  const rawName = typeof body.league_name === 'string' ? body.league_name : league && typeof league === 'object' && typeof league.name === 'string' ? league.name : '';
  const rawId = typeof body.league_id === 'string' ? body.league_id : league && typeof league === 'object' && typeof league.id === 'string' ? league.id : null;
  return { kind: 'member', leagueName: rawName.trim() ? rawName.trim().slice(0, 80) : null, leagueId: isUuid(rawId) ? rawId : null };
}

function reasonView(reason: string, body: Record<string, unknown> = {}, wait?: RateWait): TakeoverPreview {
  if (reason === 'taken') return { kind: 'taken' };
  if (reason === 'already_member' || reason === 'not_eligible') return memberView(body);
  // Unknown wait (a bare reply with no `wait`): the longer line, never understate a lockout.
  if (reason === 'rate_limited') return { kind: 'rate_limited', wait: wait ?? 'later' };
  return (DEAD_REASONS as readonly string[]).includes(reason) ? { kind: 'dead' } : { kind: 'unknown' };
}

export function interpretTakeoverPreview(r: FunctionRefusal | TakeoverReply): TakeoverPreview {
  if (r.transport) return { kind: 'unknown' };
  if (r.reason === null) {
    const b = r.body;
    const name = typeof b.league_name === 'string' ? b.league_name.trim() : '';
    const wins = count(b.wins);
    const losses = count(b.losses);
    const rank = count(b.rank);
    if (b.ok !== true || !name || wins === null || losses === null || rank === null || rank < 1) return { kind: 'unknown' };
    return { kind: 'found', leagueName: name.slice(0, 80), wins, losses, rank };
  }
  return reasonView(r.reason, r.body, 'wait' in r ? r.wait : undefined);
}

/** `leagueId` is the league the seat is in (the taken_over reply carries league.id), or null when absent/malformed. */
export type TakeoverResult = { kind: 'taken_over'; leagueId: string | null } | TakeoverPreview;

/** The write's answer: only an explicit {ok:true, status:'taken_over'} is a takeover. */
export function interpretTakeover(r: FunctionRefusal | TakeoverReply): TakeoverResult {
  if (r.transport) return { kind: 'unknown' };
  if (r.reason === null) {
    if (r.body.ok !== true || r.body.status !== 'taken_over') return { kind: 'unknown' };
    const league = r.body.league as { id?: unknown } | null | undefined;
    const id = league && typeof league === 'object' && typeof league.id === 'string' && isUuid(league.id) ? league.id : null;
    return { kind: 'taken_over', leagueId: id };
  }
  return reasonView(r.reason, r.body, 'wait' in r ? r.wait : undefined);
}

/** The dead-link panel's sentence: no heading, centred (the invite arrival's dead-link pattern). */
export function deadLine(v: Extract<TakeoverPreview, { kind: 'taken' | 'dead' }>): string {
  return v.kind === 'taken' ? TAKEN_LINE : INVITE_COPY.dead;
}

/** The record under the question: "1\u20135, 6th" (the board's; lib/home/ordinal.ts spells the rank). */
export function recordLine(wins: number, losses: number, rank: number): string {
  return `${wins}\u2013${losses}, ${ordinal(rank)}`;
}
