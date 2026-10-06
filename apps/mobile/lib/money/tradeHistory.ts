/**
 * tradeHistory: the Trade history list (3e), as pure data. The caller's own
 * trades and draft picks, newest first, filtered (All / Buys / Sells / Draft),
 * grouped by ET trading week, and paged. The UI pages the list; nothing here
 * truncates it, and a page boundary never drops or repeats a row.
 */
import { etDateParts } from '../time/etParts';
import { marketOpensLabel } from './marketOpensLabel';
import type { LedgerActivityRow } from './portfolioLedger';

export type HistoryFilter = 'all' | 'buys' | 'sells' | 'draft';

export interface HistoryItem {
  id: string;
  kind: 'draft' | 'trade';
  action: string;
  symbol: string;
  quantity: number;
  price: number | null;
  total: number | null;
  occurredAt: string;
  /** "Thu 1:38 PM ET", the time as the market reads it. */
  timeLabel: string | null;
}

export function historyItems(activity: LedgerActivityRow[], userId: string, filter: HistoryFilter): HistoryItem[] {
  return activity
    .filter((a) => a.user_id === userId)
    .filter((a) => {
      if (filter === 'all') return true;
      if (filter === 'draft') return a.kind === 'draft';
      if (filter === 'buys') return a.kind === 'trade' && a.action === 'buy';
      return a.kind === 'trade' && a.action === 'sell';
    })
    .map((a) => ({
      id: `${a.kind}:${a.occurred_at}:${a.symbol}:${a.quantity}:${a.action}`,
      kind: a.kind,
      action: a.action,
      symbol: a.symbol,
      quantity: a.quantity,
      price: a.price,
      total: a.total_value,
      occurredAt: a.occurred_at,
      timeLabel: marketOpensLabel(a.occurred_at),
    }))
    .sort((x, y) => (y.occurredAt < x.occurredAt ? -1 : y.occurredAt > x.occurredAt ? 1 : 0));
}

export interface HistoryPage<T> {
  items: T[];
  page: number;
  pageCount: number;
  hasMore: boolean;
}

/** One page of a list. Pages are contiguous: concatenating them yields the whole list, once. */
export function pageOf<T>(items: T[], page: number, size: number): HistoryPage<T> {
  const pageSize = Math.max(1, Math.floor(size));
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const start = p * pageSize;
  return { items: items.slice(start, start + pageSize), page: p, pageCount, hasMore: p < pageCount - 1 };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 13": the ET calendar day of an instant, from validated parts (never Intl's locale text). Null if unreadable. */
export function monthDayLabel(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const p = etDateParts(at);
  if (!p) return null;
  return `${MONTHS[p.month - 1]} ${p.day}`;
}

/** The Monday (ET, YYYY-MM-DD) of the trading week a timestamp falls in. */
function weekMondayEt(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const p = etDateParts(at);
  if (!p) return null;
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const back = (dow + 6) % 7;
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
  return monday.toISOString().slice(0, 10);
}

export interface HistorySection {
  key: string;
  /** "Draft · Sep 13", "This week", or "Week of Sep 29". */
  title: string;
  items: HistoryItem[];
}

/**
 * Trades grouped by ET trading week (newest first), and the draft picks in one
 * "Draft" section. `todayEt` is the caller's current ET date (YYYY-MM-DD).
 */
export function groupHistory(items: HistoryItem[], todayEt: string): HistorySection[] {
  const thisWeek = weekMondayEt(`${todayEt}T12:00:00Z`);
  const sections = new Map<string, HistorySection>();
  for (const it of items) {
    if (it.kind === 'draft') {
      const key = 'draft';
      if (!sections.has(key)) {
        // An unreadable date names no day rather than inventing one.
        const day = monthDayLabel(it.occurredAt);
        sections.set(key, { key, title: day ? `Draft · ${day}` : 'Draft', items: [] });
      }
      sections.get(key)!.items.push(it);
      continue;
    }
    const monday = weekMondayEt(it.occurredAt);
    if (!monday) continue;
    const key = `week:${monday}`;
    if (!sections.has(key)) {
      const day = monthDayLabel(`${monday}T12:00:00Z`);
      sections.set(key, { key, title: monday === thisWeek ? 'This week' : day ? `Week of ${day}` : 'Earlier', items: [] });
    }
    sections.get(key)!.items.push(it);
  }
  return [...sections.values()];
}
