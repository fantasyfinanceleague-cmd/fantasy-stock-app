import { PortfolioScreen } from '@/components/money/PortfolioScreen';

// Phase 3e: the Portfolio tab. Holdings, value and the trade-history entry
// come from one league-ledger read (lib/money/usePortfolioData); the stock
// sheet opens from any row through MoneyHost.
export default function PortfolioTab() {
  return <PortfolioScreen />;
}
