/**
 * Pure decisions for draft-order-notify — no DB, no network, hermetically
 * tested in plan.test.ts.
 *
 * The notices (league_notifications rows) are created in SQL, in the same
 * transaction as their event (20261111000000: the room opening, the start, a
 * postponement, a league becoming at risk). This function only DELIVERS them:
 * pending -> sending -> sent | no_device | skipped | failed. The words are
 * built HERE, at send time, from verified rows (draft_notice_context), so a
 * position or a name is never stale and nothing caller-supplied reaches a push.
 *
 * #67's 'draft_order_set' is no longer pushed (its rows are in-app records,
 * marked skipped at insert); its message lives on as the room-open push.
 */

/** Bounds per invocation; the cron re-fires each minute for the rest. */
export const MAX_PUSHES_PER_RUN = 50;
/** A transient failure (lookup error, Expo non-ok) is retried this many times
 * in total, one attempt per tick, before the row settles as 'failed'. */
export const MAX_PUSH_ATTEMPTS = 3;
/** A row stuck in 'sending' this long (the function died mid-send) is
 * reclaimable. Must match draft_order_notify_due()'s interval in SQL. */
export const STALE_SENDING_MS = 10 * 60 * 1000;

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** The app's time convention: no per-user time zone is stored, so draft
 * times in pushes are Eastern (as lib/marketHours.ts), labeled "ET". */
export const PUSH_TIME_ZONE = 'America/New_York';

/**
 * Eastern parts, assembled by hand from formatToParts with hourCycle 'h12'
 * PINNED: an hour formatted without hour12/hourCycle can come back tagged as
 * "literal" on Hermes (memory: hermes-intl-formattoparts), and ICU may put a
 * narrow no-break space before AM/PM. Building the string from named parts
 * makes both irrelevant, here and in any client that copies this.
 */
function etParts(iso: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PUSH_TIME_ZONE,
    hourCycle: 'h12',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    weekday: get('weekday'),
    month: get('month'),
    day: get('day'),
    time: `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`,
  };
}

/** "7:00 PM" — time only, Eastern. */
export function formatDraftTime(iso: string): string {
  return etParts(iso).time;
}

/** "Sat 6:00 PM" — weekday and time, Eastern (the at-risk deadline). */
export function formatWeekdayTime(iso: string): string {
  const p = etParts(iso);
  return `${p.weekday} ${p.time}`;
}

/** "Sun, Oct 4 · 7:00 PM" — the full draft time, Eastern (the time-set push). */
export function formatDraftDateTime(iso: string): string {
  const p = etParts(iso);
  return `${p.weekday}, ${p.month} ${p.day} · ${p.time}`;
}

export type DeliveryOutcome =
  | 'sent'
  | 'no_token' // no device registered, or notifications turned off
  | 'not_in_order' // left the league (or never in the order) since the notice was created
  | 'superseded' // the event no longer holds (fixed, rescheduled, started): saying it would be wrong
  | 'lookup_failed'
  | 'expo_error'
  | 'expo_ticket_error';

export type PushStatus = 'pending' | 'sent' | 'no_device' | 'skipped' | 'failed';

/** Where a claimed row settles. `attempts` INCLUDES the one just made. A
 * transient failure goes back to 'pending' (the next tick retries) until the
 * attempt budget is spent; a definitive outcome settles immediately. */
export function nextPushStatus(outcome: DeliveryOutcome, attempts: number): PushStatus {
  switch (outcome) {
    case 'sent': return 'sent';
    case 'no_token': return 'no_device';
    case 'not_in_order': return 'skipped';
    case 'superseded': return 'skipped';
    default: return attempts >= MAX_PUSH_ATTEMPTS ? 'failed' : 'pending';
  }
}

// ===========================================================================
// Draft auto-start pushes (20261111000000). COPY: the Design Lead's strings,
// VERBATIM (board #call-auto-start: 6cd10b8 / PR #128; blocker clauses from the
// strings box, PR #135). Lines the board does not cover are marked NEW COPY.
// ===========================================================================

/** The kinds this function delivers (and the only ones it selects). */
export const DELIVERED_KINDS = [
  'draft_room_open',
  'draft_started',
  'draft_at_risk',
  'draft_at_risk_reminder',
  'draft_postponed',
  'draft_time_set',
] as const;
export type DeliveredKind = typeof DELIVERED_KINDS[number];

/** A 'draft_time_set' notice waits until the time has been unchanged this long
 * (each change re-stamps the pending row's created_at), so rapid edits coalesce
 * into ONE push carrying the final time. */
export const TIME_SET_QUIET_MS = 2 * 60 * 1000;

/** Fairness (security review M1): at most this many pushes per league per run,
 * so one noisy league can't use the whole MAX_PUSHES_PER_RUN budget. */
export const MAX_PUSHES_PER_LEAGUE_PER_RUN = 20;

/** Round-robin the oldest-first candidates across leagues, capped per league,
 * then cut to `max`. Each league's own order is kept. */
export function fairOrder<T extends { league_id: string }>(rows: T[], max: number, perLeague = MAX_PUSHES_PER_LEAGUE_PER_RUN): T[] {
  const byLeague = new Map<string, T[]>();
  for (const r of rows) {
    const q = byLeague.get(r.league_id) ?? [];
    if (q.length < perLeague) q.push(r);
    byLeague.set(r.league_id, q);
  }
  const out: T[] = [];
  const queues = [...byLeague.values()];
  for (let i = 0; out.length < max && queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length && out.length < max) out.push(q[i]);
  }
  return out;
}

/** The push title: the league's name (commissioner free text), with control
 * characters removed and capped (security review L2). */
export function pushTitle(name: string | null): string {
  // deno-lint-ignore no-control-regex
  const clean = (name ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Your league';
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean;
}

/** Is this pending notice still inside its debounce window (not yet sendable)? */
export function isDebouncing(kind: string, createdAt: string, now: Date): boolean {
  return kind === 'draft_time_set' && now.getTime() - new Date(createdAt).getTime() < TIME_SET_QUIET_MS;
}

/** draft_notice_context's shape (20261111000000), read at send time. */
export interface NoticeContext {
  kind: string;
  league_id: string;
  user_id: string;
  created_at: string;
  league_name: string | null;
  draft_status: string | null;
  draft_date: string | null;
  draft_order_mode: string | null;
  is_member: boolean;
  is_commissioner: boolean;
  commissioner_name: string | null;
  position: number | null;
  told_time_before?: boolean;
  watch: { draft_date: string; blocked: boolean; blockers: unknown; room_opened_at: string | null } | null;
  postponement: { postponed_from: string; stage: string; reason: string; blockers: unknown } | null;
}

/** The first blocker, as a whole clause ("{first blocker}" in the board copy;
 * every line is the board's, PR #135, unless marked NEW COPY). */
export function blockerReason(blockers: unknown): string {
  const first = Array.isArray(blockers) && blockers.length > 0 ? blockers[0] as Record<string, unknown> : null;
  const code = first ? String(first.code ?? '') : '';
  switch (code) {
    case 'roster_reconfirm_required': {
      const names = Array.isArray(first!.departed)
        ? (first!.departed as Array<Record<string, unknown>>).map((d) => String(d.name ?? '')).filter(Boolean)
        : [];
      if (names.length === 1) return `${names[0]} left the league`;
      if (names.length === 2) return `${names[0]} and ${names[1]} left the league`;
      if (names.length > 2) return `${names.length} managers left the league`;
      return 'a manager left the league'; // NEW COPY (a confirmation row with no readable names)
    }
    case 'playoff_teams_exceeds_members': {
      const p = Number(first!.playoffTeams);
      const m = Number(first!.members);
      if (Number.isFinite(p) && Number.isFinite(m) && p > 0) return `${p} playoff teams, but ${m} teams are in`;
      return 'there are more playoff teams than teams'; // the counts aren't known (a refusal under the lock)
    }
    case 'not_enough_members': return 'fewer than 4 teams have joined';
    case 'slots_infeasible': return "some slots can't be filled";
    case 'budget_infeasible': return "the budget can't fill every roster";
    case 'no_stake_mode': return "the league's stakes aren't set";
    case 'invalid_playoff_teams': return "the number of playoff teams isn't set";
    case 'renewal_replies_pending': return 'not every Season 1 player has answered';
    default: return 'something in League settings needs fixing';
  }
}

const ROOM_LEAD_MS = 60 * 60 * 1000;
const roomTime = (draftDate: string) => new Date(new Date(draftDate).getTime() - ROOM_LEAD_MS).toISOString();

export type NoticeDecision =
  | { send: true; message: { title: string; body: string; data: Record<string, string> } }
  | { send: false; outcome: 'not_in_order' | 'superseded' };

/**
 * What to send for one notice — or why not. Every "why not" re-checks that the
 * event still holds, so nobody is told something that stopped being true
 * between the event and the send (a fixed league, a new time, a started draft).
 */
export function decideNotice(ctx: NoticeContext): NoticeDecision {
  const title = pushTitle(ctx.league_name);
  const data = { type: ctx.kind, screen: 'draft', league_id: ctx.league_id };
  const send = (body: string): NoticeDecision => ({ send: true, message: { title, body, data } });
  if (!ctx.is_member) return { send: false, outcome: 'not_in_order' };
  const notStarted = (ctx.draft_status ?? 'not_started') === 'not_started';
  const currentWatch = !!ctx.watch && !!ctx.draft_date && ctx.watch.draft_date === ctx.draft_date;

  switch (ctx.kind) {
    case 'draft_room_open': {
      // The room opened for THIS draft time and the draft is still ahead.
      if (!notStarted || ctx.postponement || !currentWatch || !ctx.watch!.room_opened_at) {
        return { send: false, outcome: 'superseded' };
      }
      if (ctx.position == null) return { send: false, outcome: 'not_in_order' };
      return send(
        `The draft room is open. You pick ${ordinal(Number(ctx.position))}. The draft starts at ${formatDraftTime(ctx.draft_date!)} ET.`,
      );
    }
    case 'draft_started': {
      if (notStarted) return { send: false, outcome: 'superseded' };
      if (ctx.position == null) return { send: false, outcome: 'not_in_order' };
      return send(`The draft has started. You pick ${ordinal(Number(ctx.position))}.`);
    }
    case 'draft_at_risk':
    case 'draft_at_risk_reminder': {
      // Still the commissioner, still blocked for the CURRENT time, still ahead.
      if (!ctx.is_commissioner || !notStarted || ctx.postponement || !currentWatch || !ctx.watch!.blocked) {
        return { send: false, outcome: 'superseded' };
      }
      const room = roomTime(ctx.draft_date!);
      if (ctx.kind === 'draft_at_risk_reminder') {
        return send(`One hour left to fix your league. If it isn't ready by ${formatDraftTime(room)} ET, the draft is postponed.`);
      }
      return send(
        `The draft room can't open yet: ${blockerReason(ctx.watch!.blockers)}. Fix it before ${formatWeekdayTime(room)} ET, or the draft is postponed.`,
      );
    }
    case 'draft_postponed': {
      if (!ctx.postponement || !notStarted) return { send: false, outcome: 'superseded' }; // a new time is set already
      if (ctx.is_commissioner) {
        // "wasn't ready at": the moment it was judged (the room time, or the start time).
        const judged = ctx.postponement.stage === 'start'
          ? ctx.postponement.postponed_from
          : roomTime(ctx.postponement.postponed_from);
        return send(`The draft is postponed: the league wasn't ready at ${formatDraftTime(judged)} ET. Fix it, then pick a new time.`);
      }
      const who = ctx.commissioner_name ?? 'The commissioner'; // board: the members' fallback name
      return send(`The draft is postponed. ${who} will pick a new time.`);
    }
    case 'draft_time_set': {
      // Worded from the CURRENT time (the debounce coalesces edits); nothing if
      // it was cleared, postponed or started since.
      if (!notStarted || ctx.postponement || !ctx.draft_date) return { send: false, outcome: 'superseded' };
      const when = formatDraftDateTime(ctx.draft_date);
      // Design Lead (proposed form): "The draft is now {Sun, Oct 4 · 7:00 PM ET}."
      // NEW COPY (first-set variant, flagged): "The draft is set for {…}."
      return send(ctx.told_time_before ? `The draft is now ${when} ET.` : `The draft is set for ${when} ET.`);
    }
    default:
      return { send: false, outcome: 'superseded' };
  }
}
