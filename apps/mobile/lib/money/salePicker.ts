/**
 * salePicker: the "Which sale pays for this?" choice (3e, board #money). A
 * per-slot buy is funded from one sale's proceeds. The server's preview names
 * the sources; the picker only appears when there is more than one (the
 * default is the first). Pure: the sheet renders these rows.
 */
import type { PreviewSource } from './buyingPower';

export interface PickerRow {
  tradeId: string;
  /** The slot the sale's cash sits in, e.g. "TSLA slot". */
  label: string;
  amount: number;
  selected: boolean;
}

/** The source a picker opens on: the server's first, or none. */
export function defaultSourceId(sources: PreviewSource[]): string | null {
  return sources[0]?.trade_id ?? null;
}

/** One row per source, in the server's order. Exactly the chosen row is selected. */
export function pickerRows(sources: PreviewSource[], chosenId: string | null): PickerRow[] {
  return sources.map((s) => ({
    tradeId: s.trade_id,
    label: `${s.symbol} slot`,
    amount: s.amount,
    selected: s.trade_id === chosenId,
  }));
}
