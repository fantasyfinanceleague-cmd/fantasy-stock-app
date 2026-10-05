/**
 * stockSheetApi: the public shape of the stock sheet route (3e). Every ticker
 * anywhere opens the sheet through useStockSheet().open(symbol, originRef),
 * and that includes 3c's lineups. There is no /stock/[symbol] route on purpose
 * (DESIGN_DIRECTION §3: the sheet is a sheet, not a page).
 */
const SYMBOL_RE = /^[A-Z][A-Z0-9]{0,4}(\.[A-Z])?$/;

/** Uppercased, trimmed ticker, or null for anything that isn't a plausible
 * US symbol (including BRK.B-style share classes). Never a guessed symbol. */
export function normalizeSymbol(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}
