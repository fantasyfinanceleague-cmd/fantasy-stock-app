import { Ionicons } from '@expo/vector-icons';

import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';

// Phase 3b-1 placeholder (spec row 16). The live matchup screen is rebuilt
// in Phase 3c; copy is NEW-PROPOSED pending the Design Lead.
export default function MatchupScreen() {
  return (
    <PhasePlaceholder
      title="Matchup"
      icon={(p) => <Ionicons name="trending-up-outline" {...p} />}
      heading="Matchups are on the way"
      message="Your weekly head-to-head will live here in the next update."
    />
  );
}
