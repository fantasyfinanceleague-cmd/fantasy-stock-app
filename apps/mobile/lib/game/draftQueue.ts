/**
 * The draft queue editor's rules (3c). The queue is what auto-pick takes first
 * (Giorgio's rule: "the manager's queue first"). These mirror set_draft_queue, so
 * an edit is checked the way the server checks it: upper-case, trimmed,
 * de-duplicated (the first kept), at most 50.
 */

export const QUEUE_MAX = 50;

/** The queue as the server stores it. */
export function normalizeQueue(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const s = raw.trim().toUpperCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length === QUEUE_MAX) break;
  }
  return out;
}

/** Move the item at `index` by `dir` (-1 up, +1 down). A move past either end is a no-op. */
export function moveItem(list: string[], index: number, dir: 1 | -1): string[] {
  const to = index + dir;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list.slice();
  const out = list.slice();
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

export function removeItem(list: string[], index: number): string[] {
  return list.filter((_, i) => i !== index);
}

/** Append a stock: a duplicate or a full queue leaves the list as it is. */
export function addSymbol(list: string[], symbol: string): string[] {
  const s = symbol.trim().toUpperCase();
  if (!s || list.includes(s) || list.length >= QUEUE_MAX) return list.slice();
  return [...list, s];
}

/** "A", "A and B", "A, B and C". */
function listSymbols(symbols: string[]): string {
  return symbols.length < 2 ? symbols.join('') : `${symbols.slice(0, -1).join(', ')} and ${symbols[symbols.length - 1]}`;
}

/** The line for a refused save. Ruled (Design Lead, audit pass 1): too_many,
 * unknown_symbols, and when the server names the symbols "{A} and {B} can't
 * be queued. Remove them and try again." The one-symbol ("Remove it") and
 * three-plus ("A, B and C") forms are NEW, flagged. */
export function queueRefusalLine(reason: string, symbols?: unknown): string {
  switch (reason) {
    case 'draft_completed': return 'The draft is already complete';
    case 'too_many': return `Your queue can hold up to ${QUEUE_MAX} stocks.`;
    case 'unknown_symbols': {
      const named = Array.isArray(symbols) ? symbols.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
      if (named.length === 1) return `${named[0]} can't be queued. Remove it and try again.`;
      if (named.length > 1) return `${listSymbols(named)} can't be queued. Remove them and try again.`;
      return "Some of these stocks can't be queued. Remove them and try again.";
    }
    default: return "Your queue couldn't be saved.";
  }
}
