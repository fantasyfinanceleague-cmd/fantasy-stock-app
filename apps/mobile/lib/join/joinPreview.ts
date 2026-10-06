/**
 * joinPreview: the pure half of the 1.2.0 Join a league screen (board
 * "Join a league", docs/design/screens/key-screens.html #join-league).
 *
 * It turns what `preview-league` / `join-league` return into what the screen
 * shows, and nothing here touches React, supabase or `__DEV__` (so Deno can
 * import it).
 *
 * Two rules the file exists to hold:
 *  - The preview shows ONLY what preview-league returns: a name, the
 *    commissioner, a member COUNT (never faces), the draft time, stakes and
 *    season length. There is no league id in that response by design.
 *  - NO server text ever reaches the UI (house rule). `message` fields in
 *    error bodies are ignored; every error maps to a line written here.
 */
import { draftDateTimeLabel } from '../home/draftCountdown';
import { stakesLine } from '../stakesLine';

/** Why a league that exists still can't be joined. Mirrors previewJoinReason's
 * vocabulary (supabase/functions/preview-league/reason.ts) plus `left_league`,
 * which the server does not send yet (see `coerceBlock`). */
export type JoinBlock =
  | 'league_full'
  | 'draft_started'
  /** draft_started for a draft still UNDER WAY (see refineBlock); draft_started alone means a completed draft. */
  | 'draft_in_progress'
  | 'already_member'
  | 'invite_expired'
  | 'season_completed'
  | 'left_league'
  | 'unknown';

/** A transport failure, never the server's own words. */
export type JoinErrorKind = 'unreachable' | 'rate_limited';

// ── Copy ────────────────────────────────────────────────────────────────
// Verbatim from the board unless marked NEW (flagged to the Design Lead).
export const JOIN_COPY = {
  codeIntro: 'Enter the invite code your commissioner sent you.',
  badCode: 'No league has that code. Check it and try again.',
  /** Board: "no connection" (under the field). Also used for any 5xx / unknown failure. */
  unreachable: "Couldn't reach the league. Check your connection, then try again.",
  /** NEW (Orchestrator-suggested): the server's 429, never its body text. */
  rateLimited: 'Too many tries. Wait a moment, then try again.',
  leaveAnyTime: 'You can leave any time before the draft.',
  /** A refusal reason this app doesn't know yet (an older client against a newer server). Design Lead, #125. */
  unknownBlock: "You can't join this league right now. Ask your commissioner to check the invite.",
  /** The draft has no date yet (the board's sample always has one). Approved, #125. */
  draftNotScheduled: 'Not scheduled',
  /** A draft that is under way but not "Done". Approved, #125. */
  draftInProgress: 'In progress',
  /** Joined, when the league has no draft date yet (Design Lead, #125: no push exists to promise). */
  joinedNoDate: "The commissioner hasn't set a draft date yet. You'll see it on your Home once they do.",
} as const;

export function errorMessage(kind: JoinErrorKind): string {
  return kind === 'rate_limited' ? JOIN_COPY.rateLimited : JOIN_COPY.unreachable;
}

// ── The league, as preview-league returns it ────────────────────────────

export interface PreviewLeague {
  name: string;
  commissionerName: string;
  members: number;
  max: number;
  stakeMode: string | null;
  /** Absent from an older preview-league deploy: the stakes line then drops the amount. */
  notionalPerSlot: number | null;
  budgetAmount: number | null;
  leagueType: string | null;
  numWeeks: number | null;
  durationDays: number | null;
  draftDate: string | null;
  draftStatus: string;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}
function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Null when the body doesn't carry a usable league (treated as a failure, never shown half-built). */
export function parsePreviewLeague(raw: unknown): PreviewLeague | null {
  const l = rec(raw);
  if (!l) return null;
  const name = str(l.name);
  const max = num(l.num_participants);
  if (!name || max === null) return null;
  return {
    name,
    commissionerName: str(l.commissioner_name) ?? 'Unknown',
    members: num(l.current_members) ?? 0,
    max,
    stakeMode: str(l.stake_mode),
    notionalPerSlot: num(l.notional_per_slot),
    budgetAmount: num(l.budget_amount),
    leagueType: str(l.league_type),
    numWeeks: num(l.num_weeks),
    durationDays: num(l.duration_days),
    draftDate: str(l.draft_date),
    draftStatus: str(l.draft_status) ?? 'not_started',
  };
}

// ── Reasons ─────────────────────────────────────────────────────────────

/**
 * Maps a server refusal reason to a block.
 *
 * `left_league` is flag (a) from the board: a manager who left this season
 * reads as `already_member` today (the kept row). If leave-league ships with
 * Q5-A the server will return its own reason; until it does nothing sends
 * this, and a leaver is shown `already_member` like any member. The server
 * contract is the optional string `left_league`.
 */
export function coerceBlock(reason: unknown): JoinBlock {
  switch (reason) {
    case 'league_full':
    case 'draft_started':
    case 'already_member':
    case 'invite_expired':
    case 'season_completed':
    case 'left_league':
      return reason;
    default:
      return 'unknown';
  }
}

/**
 * preview-league / join-league answer `draft_started` for any draft that is not
 * `not_started`, so the REASON cannot tell a draft under way from a finished
 * one. The preview's `draft_status` can: anything other than `completed` is a
 * draft in progress. At join time the refusal carries no status, so the caller
 * passes the status of the preview it is holding (a league that was joinable a
 * moment ago and now refuses has only just started drafting, so this reads as
 * in progress). Every other block passes through unchanged.
 */
export function refineBlock(block: JoinBlock, draftStatus: string | null | undefined): JoinBlock {
  return block === 'draft_started' && draftStatus !== 'completed' ? 'draft_in_progress' : block;
}

// ── Rows ────────────────────────────────────────────────────────────────

/** Board: "10 weeks". Null when the league has neither length. */
export function seasonLine(l: Pick<PreviewLeague, 'leagueType' | 'numWeeks' | 'durationDays'>): string | null {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (l.numWeeks !== null && l.numWeeks > 0) return plural(l.numWeeks, 'week');
  if (l.durationDays !== null && l.durationDays > 0) return plural(l.durationDays, 'day');
  return null;
}

/** Board: the Draft row ("Sat, Oct 3 · 7:00 PM ET"; "Done" once drafted). */
export function draftRow(l: Pick<PreviewLeague, 'draftDate' | 'draftStatus'>): string {
  if (l.draftStatus === 'completed') return 'Done';
  if (l.draftStatus !== 'not_started') return JOIN_COPY.draftInProgress;
  return draftDateTimeLabel(l.draftDate) ?? JOIN_COPY.draftNotScheduled;
}

/** The refusal under the preview: board copy, naming the league. */
export function blockMessage(block: JoinBlock, l: Pick<PreviewLeague, 'name' | 'max' | 'commissionerName'>): string {
  switch (block) {
    case 'league_full':
      return `${l.name} is full: ${l.max} of ${l.max} managers. Ask ${l.commissionerName} if they can make room.`;
    case 'draft_started':
      return `${l.name} has already drafted, so it can't take new managers this season.`;
    case 'draft_in_progress':
      return `${l.name} is drafting right now, so it can't take new managers this season.`;
    case 'already_member':
      return `You're already in ${l.name}.`;
    case 'invite_expired':
      return 'This invite has expired. Ask your commissioner for a new code.';
    case 'season_completed':
      return `${l.name}'s season is over. Ask your commissioner whether they're running it back.`;
    case 'left_league':
      return `You left ${l.name} this season, so you can't rejoin it. You can still view it from Your leagues.`;
    default:
      return JOIN_COPY.unknownBlock;
  }
}

/** What the single button under the preview does. */
export type PreviewAction = 'join' | 'open' | 'another' | 'join_disabled';

export function previewAction(block: JoinBlock | null): PreviewAction {
  if (block === null) return 'join';
  if (block === 'already_member') return 'open';
  if (block === 'left_league') return 'join_disabled';
  return 'another';
}

export interface PreviewRow {
  label: string;
  value: string;
}

export interface PreviewView {
  name: string;
  /** "Run by Roberto B." */
  runBy: string;
  rows: PreviewRow[];
  block: JoinBlock | null;
  /** The Alert card under the rows; null when joinable. */
  message: string | null;
  action: PreviewAction;
  /** The caption under a joinable preview's button; null otherwise. */
  caption: string | null;
}

/** Board: Managers / Draft / Stakes / Season (Season dropped when the league has no length). */
export function previewView(l: PreviewLeague, block: JoinBlock | null): PreviewView {
  // A full league always reads "N of N", even if the count is a beat stale.
  const members = block === 'league_full' ? l.max : l.members;
  const rows: PreviewRow[] = [
    { label: 'Managers', value: `${members} of ${l.max}` },
    { label: 'Draft', value: draftRow(l) },
    { label: 'Stakes', value: stakesLine(l.stakeMode, { notionalPerSlot: l.notionalPerSlot, budgetAmount: l.budgetAmount }) },
  ];
  const season = seasonLine(l);
  if (season) rows.push({ label: 'Season', value: season });
  return {
    name: l.name,
    runBy: `Run by ${l.commissionerName}`,
    rows,
    block,
    message: block ? blockMessage(block, l) : null,
    action: previewAction(block),
    caption: block ? null : JOIN_COPY.leaveAnyTime,
  };
}

// ── Transport errors ────────────────────────────────────────────────────

/**
 * supabase-js errors, by shape: a FunctionsHttpError carries the Response in
 * `context` (its status is the only thing read), a FunctionsFetchError is a
 * network failure. Anything else, including 5xx and 401, is "unreachable":
 * the server's body is never shown.
 */
export function classifyInvokeError(err: unknown): JoinErrorKind {
  const e = rec(err);
  const ctx = e ? rec(e.context) : null;
  if (ctx && ctx.status === 429) return 'rate_limited';
  return 'unreachable';
}

// ── Outcomes ────────────────────────────────────────────────────────────

export type FindOutcome =
  | { kind: 'found'; league: PreviewLeague; block: JoinBlock | null }
  | { kind: 'bad_code' }
  | { kind: 'error'; error: JoinErrorKind };

/** preview-league's `{ found, joinable, reason, league }` (or an invoke error). */
export function interpretPreview(data: unknown, invokeError: unknown): FindOutcome {
  if (invokeError) return { kind: 'error', error: classifyInvokeError(invokeError) };
  const d = rec(data);
  if (!d) return { kind: 'error', error: 'unreachable' };
  if (d.found === false) return { kind: 'bad_code' };
  const league = d.found === true ? parsePreviewLeague(d.league) : null;
  if (!league) return { kind: 'error', error: 'unreachable' };
  if (d.joinable === true) return { kind: 'found', league, block: null };
  return { kind: 'found', league, block: refineBlock(coerceBlock(d.reason), league.draftStatus) };
}

export type JoinOutcome =
  | { kind: 'joined'; leagueId: string; leagueName: string }
  /** A refusal at join time (the league changed since the preview). `leagueId` rides along only for already_member / draft_started. */
  | { kind: 'refused'; block: JoinBlock; leagueId: string | null }
  | { kind: 'error'; error: JoinErrorKind };

/** join-league's `{ ok, league?, reason? }` (or an invoke error). */
export function interpretJoin(data: unknown, invokeError: unknown): JoinOutcome {
  if (invokeError) return { kind: 'error', error: classifyInvokeError(invokeError) };
  const d = rec(data);
  if (!d) return { kind: 'error', error: 'unreachable' };
  const league = rec(d.league);
  const id = league ? str(league.id) : null;
  if (d.ok === true) {
    const name = league ? str(league.name) : null;
    if (!id || !name) return { kind: 'error', error: 'unreachable' };
    return { kind: 'joined', leagueId: id, leagueName: name };
  }
  return { kind: 'refused', block: coerceBlock(d.reason), leagueId: id };
}

// ── Joined ──────────────────────────────────────────────────────────────

export interface JoinedView {
  title: string;
  body: string;
}

/** "You're in {League}" / "The draft is {when}. The draft order is set an hour before." (Design Lead, #125: the board's "and we'll let you know" is dropped, the order-notify push doesn't exist yet.) */
export function joinedView(leagueName: string, draftDate: string | null): JoinedView {
  const when = draftDateTimeLabel(draftDate);
  return {
    title: `You're in ${leagueName}`,
    body: when
      ? `The draft is ${when}. The draft order is set an hour before.`
      : JOIN_COPY.joinedNoDate,
  };
}
