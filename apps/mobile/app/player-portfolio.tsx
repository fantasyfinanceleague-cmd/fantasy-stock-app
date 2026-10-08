import { useLocalSearchParams } from 'expo-router';

import { PlayerPortfolioScreen } from '@/components/money/PlayerPortfolioScreen';

// Phase 3e: another manager's portfolio in the active league. Read-only: it
// shows their holdings and value, and offers no trade action.
export default function PlayerPortfolioRoute() {
  const { userId } = useLocalSearchParams<{ userId: string; username: string }>();
  return <PlayerPortfolioScreen userId={String(userId ?? '')} />;
}
