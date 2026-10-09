/**
 * formatShares: a position's share count for display — at most 4 decimals,
 * trailing zeros trimmed, thousands grouped ("2.9165", "1", "1,234.5").
 * The 4 dp cap is the board's (fractional fixed_notional quantities are 6 dp
 * in the ledger; people read 4). Rounds, never truncates. Non-finite input
 * renders an em dash rather than an invented number. The minus sign is
 * U+2212, per the money rules.
 */
export function formatShares(quantity: number): string {
  if (!Number.isFinite(quantity)) return '—';
  const scaled = Math.round(Math.abs(quantity) * 1e4);
  const whole = Math.floor(scaled / 1e4);
  const frac = String(scaled % 1e4).padStart(4, '0').replace(/0+$/, '');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac ? `${grouped}.${frac}` : grouped;
  return quantity < 0 && scaled > 0 ? `−${body}` : body;
}
