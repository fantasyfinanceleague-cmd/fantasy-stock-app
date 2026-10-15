/**
 * The /join/:code path segment, checked before anything uses it (no network
 * call for junk). Same normalisation as preview-league / join-league: trim,
 * then upper-case.
 *
 * Deliberately WIDER than today's generator (10 chars from
 * ABCDEFGHJKLMNPQRSTUVWXYZ23456789; utils/inviteCode.js, mobile
 * lib/inviteCode.ts, _renewal_invite_code): leagues created before the
 * 2026-08 hardening carry `Math.random().toString(36).slice(2, 8)` codes, six
 * characters that may include 0, O, 1 and I. The server is the only judge of
 * whether a code exists; this only refuses what can't be a code at all.
 * The shape is W3's contract (the app's link handler uses the same one).
 */
const CODE_SHAPE = /^[A-Z0-9]{4,12}$/;

export function normalizeInviteCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return CODE_SHAPE.test(code) ? code : null;
}
