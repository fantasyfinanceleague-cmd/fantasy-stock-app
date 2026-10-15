// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type * as AppJoin from '../../../mobile/lib/join/joinPreview';
import type * as AppStakes from '../../../mobile/lib/stakesLine';
import type * as AppCountdown from '../../../mobile/lib/home/draftCountdown';
import { dollars, draftDateTimeLabel, interpretJoin, interpretPreview, parsePreviewLeague, previewRows, stakesLine, type PreviewLeague } from './previewData';
import { loadMobile } from './testing/loadMobile';

const app = loadMobile<typeof AppJoin>('lib/join/joinPreview.ts');
const stakes = loadMobile<typeof AppStakes>('lib/stakesLine.ts');
const countdown = loadMobile<typeof AppCountdown>('lib/home/draftCountdown.ts');

const league = (over: Record<string, unknown> = {}) => ({
  name: 'Stock Scudetto', league_type: 'duration', num_participants: 6, current_members: 5, budget_mode: null, budget_amount: null,
  stake_mode: 'fixed_notional', notional_per_slot: 2000, duration_days: null, num_weeks: 14, draft_date: '2026-10-03T23:00:00Z', draft_status: 'not_started', ...over,
});

const PREVIEWS: unknown[] = [
  { found: true, joinable: true, reason: null, league: league() },
  { found: true, joinable: false, reason: 'league_full', league: league({ current_members: 6 }) },
  { found: true, joinable: false, reason: 'draft_started', league: league({ draft_status: 'in_progress' }) },
  { found: true, joinable: false, reason: 'draft_started', league: league({ draft_status: 'completed' }) },
  { found: true, joinable: false, reason: 'already_member', league: league() },
  { found: true, joinable: false, reason: 'season_completed', league: league() },
  { found: true, joinable: false, reason: 'invite_expired', league: league() },
  { found: true, joinable: false, reason: 'something_new', league: league() },
  { found: true, joinable: true, league: league({ name: '' }) },
  { found: true, joinable: true, league: league({ num_participants: 'six' }) },
  { found: true, joinable: true },
  { found: false },
  {},
  null,
  'oops',
];
const JOINS: unknown[] = [
  { ok: true, league: { id: 'L1', name: 'Stock Scudetto' } },
  { ok: true, league: { id: 'L1' } },
  { ok: true },
  { ok: false, reason: 'already_member', league: { id: 'L1' } },
  { ok: false, reason: 'league_full' },
  { ok: false, reason: 'draft_started' },
  { ok: false, reason: 'who_knows' },
  { ok: false },
  null,
];
const ERRORS: unknown[] = [null, new Error('x'), { context: { status: 429 } }, { context: { status: 500 } }, { context: null }];

describe('previewData: the app\'s interpretation, ported', () => {
  it.each(PREVIEWS.map((p, i) => [i, p] as const))('interpretPreview %#', (_i, data) => {
    expect(interpretPreview(data, null)).toEqual(app.interpretPreview(data, null));
  });

  it.each(ERRORS.map((e, i) => [i, e] as const))('interpretPreview with transport error %#', (_i, err) => {
    expect(interpretPreview({ found: false }, err)).toEqual(app.interpretPreview({ found: false }, err));
  });

  it.each(JOINS.map((p, i) => [i, p] as const))('interpretJoin %#', (_i, data) => {
    expect(interpretJoin(data, null)).toEqual(app.interpretJoin(data, null));
  });

  it.each(ERRORS.map((e, i) => [i, e] as const))('interpretJoin with transport error %#', (_i, err) => {
    expect(interpretJoin({ ok: true }, err)).toEqual(app.interpretJoin({ ok: true }, err));
  });

  it('parsePreviewLeague', () => {
    for (const l of [league(), league({ notional_per_slot: undefined }), league({ draft_status: undefined }), null, 5, []]) {
      expect(parsePreviewLeague(l)).toEqual(app.parsePreviewLeague(l));
    }
  });
});

describe('the rows and formatters match the app\'s (Eastern time, no Intl dependence in dollars)', () => {
  const rowsFor = (raw: Record<string, unknown>, block: AppJoin.JoinBlock | null) => {
    const mine = parsePreviewLeague(raw) as PreviewLeague;
    return previewRows(mine, block);
  };

  it.each([
    ['joinable', league(), null],
    ['full', league({ current_members: 4 }), 'league_full'],
    ['drafting', league({ draft_status: 'in_progress' }), 'draft_in_progress'],
    ['done', league({ draft_status: 'completed' }), 'draft_started'],
    ['no date', league({ draft_date: null }), null],
    ['price tiers, days', league({ stake_mode: 'price_tiers', num_weeks: null, duration_days: 1 }), null],
    ['budget cap', league({ stake_mode: 'budget_cap', budget_amount: 2500.5, num_weeks: 0, duration_days: 0 }), null],
    ['unset stakes', league({ stake_mode: null }), null],
  ] as const)('%s', (_label, raw, block) => {
    const theirs = app.previewView(app.parsePreviewLeague(raw)!, block as AppJoin.JoinBlock | null);
    expect(rowsFor(raw, block as AppJoin.JoinBlock | null)).toEqual(theirs.rows);
  });

  it('draftDateTimeLabel, stakesLine, dollars', () => {
    for (const iso of [null, '', 'nonsense', '2026-10-03T23:00:00Z', '2026-12-25T05:30:00Z', '2026-03-08T07:30:00Z']) {
      expect(draftDateTimeLabel(iso)).toBe(countdown.draftDateTimeLabel(iso));
    }
    for (const n of [0, 5, 999, 1000, 2500.5, 1234567, 0.1]) expect(dollars(n)).toBe(stakes.dollars(n));
    for (const mode of ['fixed_notional', 'price_tiers', 'budget_cap', null, 'weird']) {
      const amounts = { notionalPerSlot: 1500, budgetAmount: 2500 };
      expect(stakesLine(mode, amounts)).toBe(stakes.stakesLine(mode, amounts));
      expect(stakesLine(mode)).toBe(stakes.stakesLine(mode));
    }
  });
});
