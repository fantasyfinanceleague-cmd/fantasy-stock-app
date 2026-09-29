import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';
import { useLeagueContext } from '@/lib/LeagueContext';

// Phase 3b-1 placeholder (spec row 16). Standings, schedule and the draft
// room are rebuilt in Phase 3c; copy is NEW-PROPOSED pending the Design Lead.
// While the active league is drafting, the existing draft room stays one tap
// away — the League tab is its entry (§3 IA), and nothing else reaches it.
export default function LeagueScreen() {
  const { sheetLeagues, activeLeagueId } = useLeagueContext();
  const drafting = sheetLeagues.find((l) => l.id === activeLeagueId)?.seasonPhase === 'drafting';

  return (
    <PhasePlaceholder
      title="League"
      icon={(p) => <Ionicons name="trophy-outline" {...p} />}
      heading="Standings are on the way"
      message="Standings, the schedule and the draft room will live here in the next update."
      actionLabel={drafting ? 'Go to the draft room' : undefined}
      onAction={drafting ? () => router.push('/(tabs)/draft') : undefined}
    />
  );
}
