import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/components/sp/ThemeProvider';
import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { useLeagueContext } from '@/lib/LeagueContext';

// Phase 3b-1: Home's header (pill + avatar) and its no-leagues state are
// this phase; the dashboard itself is Phase 3b-2, so a league member sees an
// honest placeholder until then (copy NEW-PROPOSED pending the Design Lead).
// "No leagues yet" copy is the board's, verbatim, with both of its actions
// (spec row 14) — neither leads to another empty screen. Pull to refresh
// (S5) re-reads the leagues.
export default function HomeScreen() {
  const { leagues, loading, refresh } = useLeagueContext();
  const { colors } = useTheme();

  // First load (e.g. just signed in): just the header, so neither state
  // flashes and then swaps for the other.
  if (loading && leagues.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ShellHeader title="Home" showAvatar />
      </View>
    );
  }

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
        secondaryActionLabel="Join with a code"
        onSecondaryAction={() => router.push('/join-league')}
        onRefresh={refresh}
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
      onRefresh={refresh}
    />
  );
}
