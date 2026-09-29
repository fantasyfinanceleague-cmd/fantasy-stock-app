import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';
import { useLeagueContext } from '@/lib/LeagueContext';

// Phase 3b-1: Home's header (pill + avatar) and its no-leagues state are
// this phase; the dashboard itself is Phase 3b-2, so a league member sees an
// honest placeholder until then (copy NEW-PROPOSED pending the Design Lead).
// "No leagues yet" copy is the board's, verbatim.
export default function HomeScreen() {
  const { leagues, loading } = useLeagueContext();

  if (!loading && leagues.length === 0) {
    return (
      <PhasePlaceholder
        title="Home"
        showAvatar
        icon={(p) => <Ionicons name="trophy-outline" {...p} />}
        heading="No leagues yet"
        message="Create or join a league to get started."
        actionLabel="Create a league"
        onAction={() => router.push('/create-league')}
      />
    );
  }

  return (
    <PhasePlaceholder
      title="Home"
      showAvatar
      icon={(p) => <Ionicons name="home-outline" {...p} />}
      heading="Your dashboard is on the way"
      message="Your leagues at a glance will live here in the next update."
    />
  );
}
