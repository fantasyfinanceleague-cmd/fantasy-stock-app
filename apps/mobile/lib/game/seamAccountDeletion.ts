// Account deletion (W4) — DEV capture fixtures for the Design Lead's gate. Pure (no React Native / supabase imports), so
// tests-deno can exercise it; never consulted by a release path (every caller is behind SEAM_ON / __DEV__).
//
//   EXPO_PUBLIC_DELETED_SEAT=1     Gianluigi's display name comes back as the label the SERVER sends for a deleted seat
//                                  (every fixture answer, so the real components draw the seat: Avatar's isDeletedSeatName,
//                                  useSeatInk). It replaces a value in the data; it never fakes the render.
//   EXPO_PUBLIC_TAKEOVER_FIXTURE   found | taken | dead | unknown: join-league's takeover_preview / takeover answers.
//   create_takeover_invite         answers {code} so "Find a new manager" opens the real share sheet.

import { FORMER_MANAGER_FALLBACK } from '../account/deletedSeat';

/** A takeover code as the server mints it: exactly 10 characters, A-Z / 0-9. */
export const FIXTURE_TAKEOVER_CODE = 'QX7P4KM3AB';

const SEAT_NAMES: readonly string[] = ['Gianluigi B.', 'Gianluigi Buonarroti', 'Gianluigi Buffonetti'];

/** Deep-replaces the fixture seat's names by the deleted-seat label. Off: the SAME value, untouched. */
export function seatify<T>(value: T, on: boolean, label: string = FORMER_MANAGER_FALLBACK): T {
  if (!on) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return SEAT_NAMES.includes(v) ? label : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

export const TAKEOVER_FIXTURES = ['found', 'taken', 'dead', 'unknown', 'member', 'rate_limited_moment', 'rate_limited_later'] as const;
export type TakeoverFixture = (typeof TAKEOVER_FIXTURES)[number];

export function parseTakeoverFixture(raw: string | null | undefined): TakeoverFixture | null {
  return (TAKEOVER_FIXTURES as readonly string[]).includes(raw ?? '') ? (raw as TakeoverFixture) : null;
}

/** join-league's answer for a takeover action, or null (not a takeover action / no knob: the caller's other fixtures apply). 'unknown' is a transport failure. */
export function takeoverFixtureFor(body: Record<string, unknown>, fixture: TakeoverFixture | null): { data: unknown; error: unknown } | null {
  if (!fixture || (body.action !== 'takeover_preview' && body.action !== 'takeover')) return null;
  switch (fixture) {
    case 'found':
      return body.action === 'takeover_preview'
        ? { data: { ok: true, league_name: 'Stock Scudetto', wins: 1, losses: 5, rank: 6 }, error: null }
        : { data: { ok: true, status: 'taken_over' }, error: null };
    case 'taken': return { data: { ok: false, reason: 'taken' }, error: null };
    case 'dead': return { data: { ok: false, reason: 'gone' }, error: null };
    case 'unknown': return { data: null, error: { message: 'fixture: the league could not be reached' } };
    case 'member': return { data: { ok: false, reason: 'already_member', league_name: 'Stock Scudetto', league_id: '3f2b8a1e-5c4d-4e6f-8a9b-0c1d2e3f4a5b' }, error: null };
    // The SQL lockout (an hour): a 2xx {ok:false, reason:'rate_limited'} -> "Too many tries. Try again later."
    case 'rate_limited_later': return { data: { ok: false, reason: 'rate_limited' }, error: null };
    // The EDGE limiter (a short window): a 429 whose body is {error:'rate_limited'} -> "Too many tries. Wait a moment, then try again."
    case 'rate_limited_moment':
      return { data: null, error: { name: 'FunctionsHttpError', message: 'fixture: 429', context: { status: 429, json: async () => ({ error: 'rate_limited', message: 'Too many requests' }) } } };
  }
}

/** create_takeover_invite's answer (a bare object; the app accepts an array too). */
export function takeoverInviteFixture(): { data: unknown; error: null } {
  return { data: { code: FIXTURE_TAKEOVER_CODE }, error: null };
}
