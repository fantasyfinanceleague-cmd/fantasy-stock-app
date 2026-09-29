import { Ionicons } from '@expo/vector-icons';

import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';

// Phase 3b-1 placeholder (spec row 16). Portfolio, the stock sheet and
// trading are rebuilt in Phase 3e; copy is NEW-PROPOSED pending the Design Lead.
export default function PortfolioScreen() {
  return (
    <PhasePlaceholder
      title="Portfolio"
      icon={(p) => <Ionicons name="pie-chart-outline" {...p} />}
      heading="Your portfolio is on the way"
      message="Your holdings and trades will live here in the next update."
    />
  );
}
