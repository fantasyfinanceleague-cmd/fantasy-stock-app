/**
 * The single-cut week window — the fix for the Monday-gap scoring defect
 * (docs/audits/2026-09-30-week-window-audit.md, "week window audit",
 * 386b0f0). Pure: no DB, no Alpaca, no Deno runtime APIs. See
 * week-window.test.ts.
 *
 * THE DEFECT THIS REPLACES: snapshot-week-start, process-week-results and
 * snapshot-week-end each drew their own line for "when does this week
 * start/end" — a fixed Tuesday 14:30Z / Friday 21:00Z nominal window
 * (_shared/schedule.ts's weekWindow), vs. "whenever the cron happened to
 * run" for the two snapshot jobs' own ledger cuts. A trade placed between
 * Monday's snapshot run and Tuesday 14:30Z fell into NEITHER cut — a sell
 * was scored as held all the way to Friday, a buy was dropped from both
 * gain and cost basis. Fixed UTC times also meant: a 9:30-10:35 EDT trade
 * was credited from the stale OPEN price instead of its own fill; a holiday
 * Monday double-counted trades in the gap; week_end (a fixed 21:00Z) was
 * wrong by an hour in EDT and wrong outright on an early-close Friday.
 *
 * THE FIX: every week has exactly ONE instant it starts at and ONE instant
 * it ends at — this week's first qualifying market open, and this week's
 * last market close — both read from market_calendar (20261005000002),
 * never from a fixed UTC clock. weekCut() computes that pair. Every
 * consumer (the week-start baseline, the in-week trade window, the
 * week-end close) is measured against the SAME two instants, so a trade
 * can no longer fall between two different codepaths' ideas of "the week."
 *
 * WHICH CALENDAR WEEK: weekCut() takes an `anchor` instant — normally
 * matchups.week_start, whether that's still the OLD nominal Tuesday 14:30Z
 * value or an ALREADY-RECONCILED cut.open from a prior run — and derives
 * the calendar week (Monday..Friday, ET) that CONTAINS the anchor's ET
 * calendar date. Because the reconciled cut.open always falls inside the
 * same Monday..Friday span the nominal anchor did, re-deriving from either
 * one yields the identical week and therefore the identical cut: weekCut is
 * a FIXPOINT on its own output. This is what lets the caller safely rewrite
 * matchups.week_start/week_end in place without ever drifting on a re-run.
 *
 * THE FLOOR: a week's cut_open is never earlier than `floor` (normally the
 * matchup row's `created_at` — the draft-completion instant). Without it, a
 * league drafted Monday at 11 AM ET would compute cut_open = that same
 * Monday's 9:30 AM open, an instant BEFORE the league existed, and "trades
 * before cut_open" would include none (correct) but "trades from cut_open to
 * cut_close" would absorb the 9:30-11:00 AM gap as if it were in-week, which
 * is meaningless (nobody could trade before the draft finished). The floor
 * bumps cut_open to the next qualifying session open instead — normally
 * Tuesday's, since _shared/schedule.ts's weekWindow already anchors week 1
 * to the Tuesday STRICTLY after the draft's UTC calendar day, so Monday is
 * the ONLY day of that week whose open can precede the floor. Weeks after
 * week 1 are always far enough in the future that the floor never binds.
 */

export interface CalendarSession {
  /** YYYY-MM-DD, the ET calendar date this session covers (market_calendar.session_date). */
  sessionDate: string;
  /** ET wall-clock 'HH:MM' (market_calendar.open_et). */
  openEt: string;
  /** ET wall-clock 'HH:MM' (market_calendar.close_et). */
  closeEt: string;
}

export interface Coverage {
  /** YYYY-MM-DD — market_calendar_coverage.covered_from. */
  from: string;
  /** YYYY-MM-DD — market_calendar_coverage.covered_through. */
  through: string;
}

export type WeekCutResult =
  | {
    ok: true;
    /** This week's first qualifying market open — the ONE instant every consumer cuts the ledger and prices at. */
    open: Date;
    /** This week's last market close — the ONE instant every consumer's in-week window ends and closes at. */
    close: Date;
    /** ET calendar date of `open`'s session — the date to request the OPEN bar for (never "today"). */
    openSessionDate: string;
    /** ET calendar date of `close`'s session — the date to request the CLOSE bar for (never "today"). */
    closeSessionDate: string;
  }
  | {
    ok: false;
    /**
     * 'no_coverage'         — the week (Monday..Friday, ET) isn't fully inside
     *                         [coverage.from, coverage.through]. A missing
     *                         refresh-market-calendar run must never read as
     *                         "no trading days" (CLAUDE.md "success signals" #1);
     *                         refuse and retry, exactly like a missing Alpaca price.
     * 'no_sessions_in_week' — the week IS covered, but zero sessions fall in it
     *                         (a whole-week holiday — not reachable for any real
     *                         US trading week, handled defensively rather than
     *                         assumed impossible).
     * 'floor_beyond_week'   — every session's open in the week is before `floor`
     *                         (not reachable given _shared/schedule.ts's own
     *                         anchor rule, which puts the draft strictly before
     *                         the week's Tuesday — handled so this module never
     *                         assumes a caller invariant it cannot itself verify).
     */
    reason: 'no_coverage' | 'no_sessions_in_week' | 'floor_beyond_week';
  };

const ET_ZONE = 'America/New_York';
const WEEKDAY_NUM: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** ET calendar date (YYYY-MM-DD) and ISO weekday (Mon=1..Sun=7) of an instant. */
function etDateParts(instant: Date): { dateStr: string; isoWeekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts = fmt.formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  const isoWeekday = WEEKDAY_NUM[get('weekday')] ?? 1;
  return { dateStr, isoWeekday };
}

/** Pure calendar-day arithmetic on a YYYY-MM-DD string — never represents a
 * real instant, just Gregorian date math (safe: no timezone crossed). */
function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Convert an ET wall-clock date + time into the UTC instant it denotes,
 * correct across the EST/EDT boundary. Standard "round-trip" technique: guess
 * the instant by treating the wall-clock components as if they were UTC, see
 * what wall-clock that guess actually shows in America/New_York, and correct
 * by the difference. Safe for this module's inputs (market open/close times,
 * always well outside the 1-3 AM DST-transition window), so there is no
 * spring-forward "this wall-clock time doesn't exist" case to handle.
 */
export function etWallClockToUtc(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(guess));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  // hour12:false can format midnight as "24"; normalize like marketHours.ts does.
  const shownAsIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  const offset = guess - shownAsIfUtc;
  return new Date(guess + offset);
}

/**
 * The single cut for the week containing `anchor` (ET calendar week,
 * Monday..Friday). See the module header for the fixpoint property, the
 * floor, and each failure reason.
 *
 * `sessions` need not be pre-filtered to the week — every session outside
 * [monday, friday] is ignored. It SHOULD span at least [coverage.from,
 * coverage.through] for 'no_coverage' to be distinguishable from a
 * caller bug, but this function only reads what it needs.
 */
export function weekCut(
  anchor: Date,
  floor: Date | null,
  sessions: ReadonlyArray<CalendarSession>,
  coverage: Coverage | null,
): WeekCutResult {
  const { dateStr: anchorDate, isoWeekday } = etDateParts(anchor);
  const monday = shiftDateStr(anchorDate, 1 - isoWeekday);
  const friday = shiftDateStr(monday, 4);

  if (!coverage || monday < coverage.from || friday > coverage.through) {
    return { ok: false, reason: 'no_coverage' };
  }

  const weekSessions = sessions
    .filter((s) => s.sessionDate >= monday && s.sessionDate <= friday)
    .slice()
    .sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0));

  if (weekSessions.length === 0) {
    return { ok: false, reason: 'no_sessions_in_week' };
  }

  let openSession: CalendarSession | undefined;
  let openInstant: Date | undefined;
  for (const s of weekSessions) {
    const candidate = etWallClockToUtc(s.sessionDate, s.openEt);
    if (!floor || candidate.getTime() >= floor.getTime()) {
      openSession = s;
      openInstant = candidate;
      break;
    }
  }
  if (!openSession || !openInstant) {
    return { ok: false, reason: 'floor_beyond_week' };
  }

  const closeSession = weekSessions[weekSessions.length - 1];
  const closeInstant = etWallClockToUtc(closeSession.sessionDate, closeSession.closeEt);

  return {
    ok: true,
    open: openInstant,
    close: closeInstant,
    openSessionDate: openSession.sessionDate,
    closeSessionDate: closeSession.sessionDate,
  };
}
