/**
 * The session preview and join, interpreted. A port of the pure half of
 * apps/mobile/lib/join/joinPreview.ts (parsePreviewLeague, interpretPreview,
 * interpretJoin, the rows) with its formatters (draftDateTimeLabel, stakesLine);
 * previewData.parity.test.ts loads the app's module and compares outputs.
 *
 * Used AFTER sign-in: `preview-league` (with a session) answers the full facts
 * and the exact refusal reason, and `join-league` is the only truth for
 * joining. No server text ever reaches the page.
 */
import { cleanDisplay } from './displayText';
import { coerceBlock, refineBlock, type JoinBlock, type JoinErrorKind } from './joinCopy';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}
function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export interface PreviewLeague {
  name: string;
  members: number;
  max: number;
  stakeMode: string | null;
  notionalPerSlot: number | null;
  budgetAmount: number | null;
  leagueType: string | null;
  numWeeks: number | null;
  durationDays: number | null;
  draftDate: string | null;
  draftStatus: string;
}

export function parsePreviewLeague(raw: unknown): PreviewLeague | null {
  const l = rec(raw);
  if (!l) return null;
  const name = cleanDisplay(l.name);
  const max = num(l.num_participants);
  if (!name || max === null) return null;
  return {
    name,
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

/** A transport failure's kind: only a 429 is told apart; everything else is "unreachable". */
export function classifyInvokeError(err: unknown): JoinErrorKind {
  const e = rec(err);
  const ctx = e ? rec(e.context) : null;
  if (ctx && ctx.status === 429) return 'rate_limited';
  return 'unreachable';
}

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

// ── Formatters (the app's, always Eastern time) ─────────────────────────

const ET_WEEKDAY_DATE: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' };
const ET_TIME: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' };

/** "Sat, Oct 3 · 7:00 PM ET" from a real ISO timestamp. */
export function draftDateTimeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const datePart = new Intl.DateTimeFormat('en-US', ET_WEEKDAY_DATE).format(d);
  const timePart = new Intl.DateTimeFormat('en-US', ET_TIME).format(d);
  return `${datePart} · ${timePart} ET`;
}

/** "$2,000" (whole dollars unless there are cents), built without Intl. */
export function dollars(n: number): string {
  const fixed = Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2);
  const [whole, cents] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}${cents ? `.${cents}` : ''}`;
}

export function stakesLine(
  mode: string | null | undefined,
  amounts: { notionalPerSlot?: number | null; budgetAmount?: number | null } = {},
): string {
  const amount = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
  switch (mode) {
    case 'fixed_notional': {
      const per = amount(amounts.notionalPerSlot);
      return per !== null ? `Equal stakes · ${dollars(per)} per slot` : 'Equal stakes';
    }
    case 'price_tiers':
      return 'Price tiers · one share per slot';
    case 'budget_cap': {
      const cap = amount(amounts.budgetAmount);
      return cap !== null ? `Budget cap · ${dollars(cap)}` : 'Budget cap';
    }
    default:
      return 'Not set yet';
  }
}

export function seasonLine(l: Pick<PreviewLeague, 'numWeeks' | 'durationDays'>): string | null {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (l.numWeeks !== null && l.numWeeks > 0) return plural(l.numWeeks, 'week');
  if (l.durationDays !== null && l.durationDays > 0) return plural(l.durationDays, 'day');
  return null;
}

export function draftRow(l: Pick<PreviewLeague, 'draftDate' | 'draftStatus'>): string {
  if (l.draftStatus === 'completed') return 'Done';
  if (l.draftStatus !== 'not_started') return 'In progress';
  return draftDateTimeLabel(l.draftDate) ?? 'Not scheduled';
}

export interface PreviewRow {
  label: string;
  value: string;
}

/** The board's Managers / Draft / Stakes / Season rows, shown with a refusal. */
export function previewRows(l: PreviewLeague, block: JoinBlock | null): PreviewRow[] {
  const members = block === 'league_full' ? l.max : l.members;
  const rows: PreviewRow[] = [
    { label: 'Managers', value: `${members} of ${l.max}` },
    { label: 'Draft', value: draftRow(l) },
    { label: 'Stakes', value: stakesLine(l.stakeMode, { notionalPerSlot: l.notionalPerSlot, budgetAmount: l.budgetAmount }) },
  ];
  const season = seasonLine(l);
  if (season) rows.push({ label: 'Season', value: season });
  return rows;
}
