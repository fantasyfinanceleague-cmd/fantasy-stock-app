import { PortfolioScreen } from '@/components/money/PortfolioScreen';
import { LeagueListGate } from '@/components/shell/NoLeagueState';

// Phase 3e: the Portfolio tab. Holdings, value and the trade-history entry
// come from one league-ledger read (lib/money/usePortfolioData); the stock
// sheet opens from any row through MoneyHost.
export default function PortfolioTab() {
  // Onboarding W4: no leagues is the one shared state on every tab.
  return (
    <LeagueListGate title="Portfolio">
      <PortfolioScreen />
    </LeagueListGate>
  );
}
