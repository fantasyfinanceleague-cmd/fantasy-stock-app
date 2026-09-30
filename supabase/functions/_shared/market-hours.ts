/**
 * The record-trade market-hours gate — closes the "trade off-hours, fill at
 * the stale last quote" exploit (docs/audits/2026-09-30-week-window-audit.md
 * S5/U2, PR #87). Pure: no DB, no Alpaca, no Deno runtime APIs beyond
 * Intl.DateTimeFormat and Date. See market-hours.test.ts.
 *
 * CONSOLIDATE AFTER #87 (fix/week-window-single-cut): that branch's
 * _shared/week-window.ts has its own ET-instant helpers (etDateParts,
 * etWallClockToUtc) reading the SAME public.market_calendar /
 * market_calendar_coverage tables. This module is deliberately independent
 * of it — #87 had not merged when this was written — but the two should be
 * folded into one module once #87 lands rather than carrying two ET-instant
 * implementations long-term. Until then, this module validates its own
 * Intl output the same way week-window.ts does (throw on a missing/
 * unrecognized part, never a silent default — CLAUDE.md, the Hermes
 * formatToParts lesson) and additionally validates the SHAPE of the rows
 * read from market_calendar (week-window.ts trusts its caller's shape;
 * record-trade reads straight off PostgREST, so a malformed row here must
 * refuse, not throw past the handler's try/catch as an 'unhandled' 500).
 *
 * FAIL CLOSED: every branch that cannot prove the market is open returns
 * open:false. There is no "assume open" path.
 *
 * CLOSE BOUNDARY IS EXCLUSIVE (now < close), not inclusive like SQL's
 * public.market_session_status (now <= close). The two disagree only in the
 * single instant at exactly the close (e.g. 16:00:00.000 ET on a normal
 * day) — market_session_status calls that "open", this calls it "closed".
 * Deliberate for a trade gate (the exchange itself is closed AT the close,
 * not through it); a follow-up could align the two, but that is a decision
 * beyond this fix's scope.
 */

export interface CalendarRow {
  session_date: unknown;
  open_et: unknown;
  close_et: unknown;
}

export interface Coverage {
  covered_from: unknown;
  covered_through: unknown;
}

export type MarketGate =
  | {
      open: true;
      sessionDate: string;
      openAt: Date;
      closeAt: Date;
    }
  | {
      open: false;
      reason: 'market_closed' | 'calendar_unavailable';
      marketReason?: 'pre_market' | 'after_hours' | 'weekend' | 'holiday';
      nextOpenAt: Date | null;
    };

const ET_ZONE = 'America/New_York';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// PostgREST serializes `time` as HH:MM:SS (seconds always present); accept
// HH:MM too rather than assume a specific driver version.
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * ET calendar date (YYYY-MM-DD) of an instant. Throws rather than silently
 * defaulting if Intl.DateTimeFormat ever returns a part set missing
 * 'year'/'month'/'day' — same discipline as week-window.ts's etDateParts,
 * for the same reason: a silent default would mis-derive "today" and could
 * read a closed market as open.
 */
function etDateStr(instant: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(instant);
  const get = (t: string): string => {
    const v = parts.find((p) => p.type === t)?.value;
    if (v === undefined) throw new Error(`etDateStr: missing '${t}' part from Intl.DateTimeFormat`);
    return v;
  };
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Convert an ET wall-clock date + time into the UTC instant it denotes,
 * correct across the EST/EDT boundary. Same round-trip technique as
 * week-window.ts's etWallClockToUtc (duplicated deliberately — see the
 * CONSOLIDATE AFTER #87 header note). Throws on a missing Intl part.
 */
function etWallClockToUtc(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(guess));
  const get = (t: string): number => {
    const v = parts.find((p) => p.type === t)?.value;
    if (v === undefined) throw new Error(`etWallClockToUtc: missing '${t}' part from Intl.DateTimeFormat`);
    return parseInt(v, 10);
  };
  const shownAsIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  const offset = guess - shownAsIfUtc;
  return new Date(guess + offset);
}

/** Pure calendar-day arithmetic on a YYYY-MM-DD string (UTC date math only —
 * never represents a real instant, so no timezone is crossed). */
function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** ISO weekday (Mon=1..Sun=7) of a YYYY-MM-DD string via pure UTC date math
 * — the string represents an ET calendar date already, so no timezone
 * conversion is needed or wanted here (unlike etDateStr, which converts a
 * real instant). `new Date('YYYY-MM-DD')` parses as UTC midnight, so
 * getUTCDay is the correct, DST-independent way to read it. */
function isoWeekdayOfDateStr(dateStr: string): number {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

function isValidRow(row: CalendarRow): row is { session_date: string; open_et: string; close_et: string } {
  return (
    typeof row.session_date === 'string' &&
    DATE_RE.test(row.session_date) &&
    typeof row.open_et === 'string' &&
    TIME_RE.test(row.open_et) &&
    typeof row.close_et === 'string' &&
    TIME_RE.test(row.close_et)
  );
}

function isValidCoverage(cov: Coverage): cov is { covered_from: string; covered_through: string } {
  return (
    typeof cov.covered_from === 'string' &&
    DATE_RE.test(cov.covered_from) &&
    typeof cov.covered_through === 'string' &&
    DATE_RE.test(cov.covered_through)
  );
}

/**
 * The decision. `sessions` should be every market_calendar row with
 * session_date >= today's ET date (ascending) — the caller does not need to
 * pre-filter beyond that lower bound; this function only ever looks at
 * today's row (if present) and the earliest later row. `coverage` is the
 * single market_calendar_coverage row, or null if there isn't one (never
 * refreshed).
 *
 * Every failure mode — missing coverage, today outside the covered window,
 * a malformed row, an Intl part set the runtime should never actually
 * produce — collapses to the same fail-closed result: open:false,
 * reason:'calendar_unavailable'. There is no ambiguity for the caller to
 * resolve; CLAUDE.md's "a stale key must never read as closed" lesson cuts
 * the other way here too — an UNAVAILABLE calendar must never read as a
 * plain 'market_closed' refusal either, since that would look like a
 * routine game-flow response instead of the operational problem it is.
 */
export function decideMarketGate(now: Date, sessions: ReadonlyArray<CalendarRow>, coverage: Coverage | null): MarketGate {
  try {
    if (!coverage) {
      return { open: false, reason: 'calendar_unavailable', nextOpenAt: null };
    }
    if (!isValidCoverage(coverage)) {
      console.error('decideMarketGate: malformed coverage row', JSON.stringify(coverage));
      return { open: false, reason: 'calendar_unavailable', nextOpenAt: null };
    }

    const todayEt = etDateStr(now);
    if (todayEt < coverage.covered_from || todayEt > coverage.covered_through) {
      return { open: false, reason: 'calendar_unavailable', nextOpenAt: null };
    }

    // Every row is shape-validated regardless of date (a malformed row
    // anywhere in the caller's result must refuse, not just one that
    // happens to matter for today's decision). Downstream lookups
    // (`today`, `next`) each filter by date themselves, so no separate
    // "is this row in range" filter is needed here.
    const validRows: { session_date: string; open_et: string; close_et: string }[] = [];
    for (const row of sessions) {
      if (!isValidRow(row)) {
        console.error('decideMarketGate: malformed market_calendar row', JSON.stringify(row));
        return { open: false, reason: 'calendar_unavailable', nextOpenAt: null };
      }
      validRows.push(row);
    }
    validRows.sort((a, b) => (a.session_date < b.session_date ? -1 : a.session_date > b.session_date ? 1 : 0));

    const today = validRows.find((r) => r.session_date === todayEt);

    if (today) {
      const openAt = etWallClockToUtc(today.session_date, today.open_et);
      const closeAt = etWallClockToUtc(today.session_date, today.close_et);
      if (now >= openAt && now < closeAt) {
        return { open: true, sessionDate: today.session_date, openAt, closeAt };
      }
      if (now < openAt) {
        return { open: false, reason: 'market_closed', marketReason: 'pre_market', nextOpenAt: openAt };
      }
      // now >= closeAt: after hours today. Fall through to find the next
      // session (tomorrow or later) for nextOpenAt.
    }

    // No session today (or today's already closed): find the earliest
    // later session within the covered window, bounded so we never report a
    // "next open" the last refresh doesn't actually vouch for.
    const next = validRows.find(
      (r) => r.session_date > todayEt && r.session_date <= coverage.covered_through,
    );
    const nextOpenAt = next ? etWallClockToUtc(next.session_date, next.open_et) : null;

    const marketReason: 'pre_market' | 'after_hours' | 'weekend' | 'holiday' =
      isoWeekdayOfDateStr(todayEt) >= 6 ? 'weekend' : (today ? 'after_hours' : 'holiday');

    return { open: false, reason: 'market_closed', marketReason, nextOpenAt };
  } catch (e) {
    console.error('decideMarketGate: refusing — Intl.DateTimeFormat returned an incomplete/unrecognized part set:', e);
    return { open: false, reason: 'calendar_unavailable', nextOpenAt: null };
  }
}

// ===========================================================================
// HTTP-response mapping — pure, so record-trade's read -> decide -> respond
// pipeline is hermetically testable without a live handler harness. The
// handler itself only: (1) fetches rows, (2) calls decideMarketGate, (3)
// calls tradeGateResponse and either returns it or continues.
// ===========================================================================

export interface MarketGateHttpResult {
  status: number;
  body: {
    ok: false;
    reason: 'market_closed' | 'calendar_unavailable';
    market_reason?: 'pre_market' | 'after_hours' | 'weekend' | 'holiday';
    next_open_at?: string | null;
  };
}

/**
 * Maps a refusal (never called for open:true — callers check .open first)
 * to the wire shape. `market_closed` is a 200 game-flow refusal (the
 * project's convention throughout record-trade — see the file header;
 * supabase-js's functions.invoke() discards the body on any non-2xx, so a
 * "proper" 4xx here would reach the 1.1.0 client as an opaque transport
 * error instead of a mapped reason). `calendar_unavailable` is a 503: it is
 * not a game-flow outcome, it is the calendar-freshness guarantee
 * (market_calendar_coverage) failing to hold, which must read as an
 * operational problem, never as a routine refusal (CLAUDE.md "success
 * signals" #1 — a stale/missing refresh must never look like "market
 * closed").
 */
export function tradeGateResponse(gate: Extract<MarketGate, { open: false }>): MarketGateHttpResult {
  if (gate.reason === 'calendar_unavailable') {
    return { status: 503, body: { ok: false, reason: 'calendar_unavailable' } };
  }
  return {
    status: 200,
    body: {
      ok: false,
      reason: 'market_closed',
      market_reason: gate.marketReason,
      next_open_at: gate.nextOpenAt ? gate.nextOpenAt.toISOString() : null,
    },
  };
}

export interface MarketLabel {
  open: boolean;
  reason: 'pre_market' | 'after_hours' | 'weekend' | 'holiday' | null;
  next_open_at: string | null;
}

/**
 * The additive `market` field on the preview response. NEVER blocks preview
 * — preview has no fill price and no write, so there is nothing to refuse.
 * Returns null (fail-soft) when the calendar itself is unavailable: a label
 * asserting open:true or open:false would be a guess at that point, and
 * preview is not the endpoint that should surface an operational problem —
 * record-trade's buy/sell path already does, via tradeGateResponse's 503.
 */
export function marketLabel(gate: MarketGate): MarketLabel | null {
  if (gate.open) return { open: true, reason: null, next_open_at: null };
  if (gate.reason === 'calendar_unavailable') return null;
  return {
    open: false,
    reason: gate.marketReason ?? null,
    next_open_at: gate.nextOpenAt ? gate.nextOpenAt.toISOString() : null,
  };
}
