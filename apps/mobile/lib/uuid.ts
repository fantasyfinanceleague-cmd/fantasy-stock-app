// lib/uuid.ts
//
// Whether a value is shaped like a UUID — the correct check before batching
// an id into a `.in('id', …)` query against a `uuid` column such as
// `user_profiles.id`.
//
// Several screens collected "user ids that might need a profile lookup" by
// excluding only ids starting with `bot-` (`!id.startsWith('bot-')`), on the
// assumption that anything left over is a real Supabase auth UUID. That
// assumption breaks for the seeded/simulation test participants used in
// leagues like `__TEST_SIMULATION__`, whose ids look like `test-user-2` —
// not bot-prefixed, but not a UUID either. Postgres rejects the WHOLE `.in()`
// array when even one element fails to cast to `uuid` (error 22P02), so a
// single non-UUID id in a batch silently failed profile lookups for every
// OTHER (real, UUID) user in that same batch, not just the bad one — the
// screen would already fall back to a truncated id for the bad row either
// way, so the real cost was the collateral failure for legitimate users.
//
// Bot display names/avatars ("Bot 3", 🤖) are a separate, intentional
// convention keyed on the `bot-` prefix and are UNCHANGED by this helper —
// this only decides which ids are safe to send to a `uuid` column.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: string | null | undefined): id is string {
  return !!id && UUID_RE.test(id);
}
