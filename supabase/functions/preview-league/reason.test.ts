// Hermetic unit tests for previewJoinReason (see ./reason.ts). No DB, no
// secrets, no --allow-* flags. Run from repo root:
//   deno test supabase/functions/preview-league/reason.test.ts

import { assertEquals } from 'jsr:@std/assert';
import { previewJoinReason, type PreviewLeagueInput } from './reason.ts';

function base(overrides: Partial<PreviewLeagueInput> = {}): PreviewLeagueInput {
  return {
    isExistingMember: false,
    seasonStatus: 'active',
    draftStatus: 'not_started',
    invite: null,
    currentMembers: 2,
    numParticipants: 6,
    ...overrides,
  };
}

Deno.test('not_started draft, room, no invite -> joinable', () => {
  assertEquals(previewJoinReason(base()), { joinable: true, reason: null });
});

Deno.test('existing member -> already_member, even mid-draft', () => {
  assertEquals(
    previewJoinReason(base({ isExistingMember: true, draftStatus: 'in_progress' })),
    { joinable: false, reason: 'already_member' },
  );
});

Deno.test('season completed -> season_completed, even if draft not_started', () => {
  assertEquals(
    previewJoinReason(base({ seasonStatus: 'completed' })),
    { joinable: false, reason: 'season_completed' },
  );
});

Deno.test('invite not pending -> invite_expired', () => {
  assertEquals(
    previewJoinReason(base({ invite: { status: 'accepted', expiresAt: null } })),
    { joinable: false, reason: 'invite_expired' },
  );
});

Deno.test('invite past expiry -> invite_expired', () => {
  assertEquals(
    previewJoinReason(
      base({ invite: { status: 'pending', expiresAt: '2020-01-01T00:00:00Z' } }),
    ),
    { joinable: false, reason: 'invite_expired' },
  );
});

Deno.test('invite pending, not yet expired -> falls through to draft/capacity', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  assertEquals(
    previewJoinReason(base({ invite: { status: 'pending', expiresAt: future } })),
    { joinable: true, reason: null },
  );
});

Deno.test('draft in_progress -> draft_started (HARD, not soft)', () => {
  assertEquals(
    previewJoinReason(base({ draftStatus: 'in_progress' })),
    { joinable: false, reason: 'draft_started' },
  );
});

Deno.test('draft completed -> draft_started', () => {
  assertEquals(
    previewJoinReason(base({ draftStatus: 'completed' })),
    { joinable: false, reason: 'draft_started' },
  );
});

Deno.test('league full, draft not_started -> league_full', () => {
  assertEquals(
    previewJoinReason(base({ currentMembers: 6, numParticipants: 6 })),
    { joinable: false, reason: 'league_full' },
  );
});

Deno.test('precedence: draft_started beats league_full', () => {
  // A league can be simultaneously full AND mid-draft (the common case once a
  // draft has begun) -- draft_started must win, matching the RPC's check order.
  assertEquals(
    previewJoinReason(base({ draftStatus: 'in_progress', currentMembers: 6, numParticipants: 6 })),
    { joinable: false, reason: 'draft_started' },
  );
});

Deno.test('precedence: season_completed beats invite_expired and draft_started', () => {
  assertEquals(
    previewJoinReason(
      base({
        seasonStatus: 'completed',
        draftStatus: 'completed',
        invite: { status: 'accepted', expiresAt: null },
      }),
    ),
    { joinable: false, reason: 'season_completed' },
  );
});

Deno.test('precedence: invite_expired beats draft_started and league_full', () => {
  assertEquals(
    previewJoinReason(
      base({
        invite: { status: 'declined', expiresAt: null },
        draftStatus: 'in_progress',
        currentMembers: 6,
        numParticipants: 6,
      }),
    ),
    { joinable: false, reason: 'invite_expired' },
  );
});

Deno.test('precedence: already_member beats everything, including season_completed', () => {
  assertEquals(
    previewJoinReason(
      base({
        isExistingMember: true,
        seasonStatus: 'completed',
        draftStatus: 'completed',
        invite: { status: 'declined', expiresAt: null },
        currentMembers: 6,
        numParticipants: 6,
      }),
    ),
    { joinable: false, reason: 'already_member' },
  );
});
