import { useLocalSearchParams } from 'expo-router';

import { PlayerPortfolioScreen } from '@/components/money/PlayerPortfolioScreen';

// A leaguemate's team in the active league (3e; the leaguemate team view). Read-only: it
// shows their holdings and value, and offers no trade action. Opened from a manager's row in
// League › Standings / Home's excerpt and the opponent's half of the Matchup header
// (lib/game/teamLink); your own row opens the Portfolio tab instead. `username` is the name
// shown while the team loads and in its "didn't load" title.
export default function PlayerPortfolioRoute() {
  const { userId, username } = useLocalSearchParams<{ userId: string; username: string }>();
  return <PlayerPortfolioScreen userId={String(userId ?? '')} username={username ? String(username) : null} />;
}
