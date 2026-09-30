/**
 * etParts: a validating wrapper around Intl.DateTimeFormat.formatToParts
 * for America/New_York conversions.
 *
 * Orchestrator ask (2026-09-30): marketHours.ts:58's `getPart` falls back
 * to '0' when formatToParts doesn't return a part -- on a runtime where
 * Hermes drops hour/minute, the market would silently read as 00:00 ET
 * and always "closed" (this codebase's own "success signals are
 * unreliable by default" lesson, CLAUDE.md, in a new place: a wrong
 * default reads as a normal, confident answer, not a failure). This
 * module's two exports replace every `?? '0'`/`?? ''` formatToParts
 * fallback in lib/home/marketWeek.ts and buildHomeViewModel.ts with an
 * explicit null on any missing required part -- never a silently wrong
 * number fed into a phase decision.
 *
 * Probed on-device (3b2 17 Pro, Hermes for RN 0.81.5, Expo Go SDK 54,
 * 2026-09-30): every part (weekday/year/month/day/hour/minute/second)
 * came back present and correct for all three of marketWeek.ts's/
 * marketHours.ts's exact option shapes, across an EDT weekday, an EST
 * weekday, and a Saturday. Nothing is silently broken on THAT build. But
 * a clean probe on one Hermes build is not a proof for every build this
 * app will ever run on (a different RN/Expo SDK, a real native build's
 * bundled Hermes vs. Expo Go's own, a JSC fallback) -- so this module
 * exists regardless of the probe result, per CLAUDE.md's own standing
 * rule: verify the effect, never assume a mechanism keeps working.
 *
 * marketHours.ts itself is untouched (shipped in 1.1.0, outside this
 * branch's scope, and the probe found nothing wrong there to justify an
 * out-of-scope change).
 */

export interface EtDateParts {
  year: number;
  month: number;
  day: number;
}

export interface EtDateTimeParts extends EtDateParts {
  hour: number;
  minute: number;
  second: number;
}

function partsOrNull(date: Date, options: Intl.DateTimeFormatOptions, keys: readonly string[]): Record<string, string> | null {
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = parts.find((p) => p.type === key)?.value;
    if (value === undefined) return null;
    out[key] = value;
  }
  return out;
}

const DATE_KEYS = ['year', 'month', 'day'] as const;
const DATE_TIME_KEYS = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;

/** Year/month/day in America/New_York, or null if the runtime's Intl
 * didn't return one of them -- never a fabricated 0/empty default. */
export function etDateParts(date: Date): EtDateParts | null {
  const p = partsOrNull(date, { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }, DATE_KEYS);
  if (!p) return null;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
}

/** Full date + time (24h) in America/New_York, or null if any part is
 * missing. `hourCycle: 'h23'` avoids the AM/PM->24h conversion a missing
 * `dayPeriod` part could otherwise silently get wrong. */
export function etDateTimeParts(date: Date): EtDateTimeParts | null {
  const p = partsOrNull(
    date,
    { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    DATE_TIME_KEYS,
  );
  if (!p) return null;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) };
}
