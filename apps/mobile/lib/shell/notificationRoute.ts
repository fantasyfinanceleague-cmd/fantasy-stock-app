/**
 * Where a tapped push opens (3c-2). Pure, so the rules tests see it.
 *
 * screen:'draft' (draft_turn from send-notification, draft_order_set from
 * draft-order-notify) opens the League tab, which shows the pre-draft lobby
 * or the live draft room by phase. It no longer opens the legacy
 * (tabs)/draft route: that route is kept ONLY for the finalize heal, which
 * the draft room hands off to itself (components/game/DraftRoom.tsx).
 */
export type NotificationTarget = '/(tabs)/league' | '/(tabs)/matchup';

export function notificationRoute(data: { screen?: unknown } | null | undefined): NotificationTarget | null {
  switch (data?.screen) {
    case 'draft':
    case 'leaderboard':
    case 'league':
      return '/(tabs)/league';
    case 'matchup':
      return '/(tabs)/matchup';
    default:
      return null;
  }
}
