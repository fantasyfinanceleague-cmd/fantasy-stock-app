/**
 * marketOpensLabel: "Mon 9:30 AM ET" for a next-open instant, read in
 * America/New_York through lib/time/etParts (validating, h23 parts). Null on
 * any missing or unparseable input: never a guessed time.
 */
import { etDateTimeParts } from '../time/etParts';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function marketOpensLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const p = etDateTimeParts(at);
  if (!p) return null;
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? 'AM' : 'PM';
  return `${weekday} ${h12}:${String(p.minute).padStart(2, '0')} ${ampm} ET`;
}
