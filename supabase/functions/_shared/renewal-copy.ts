/**
 * Run it back: every push and notice string, in ONE module, so a copy change is
 * one edit (Orchestrator, 2026-10-04). Source of truth: the 3c prompt,
 * docs/design/prompts/phase3c-mobile-game.md "Run it back" section (design
 * branch @ 3244d02). The strings are used VERBATIM.
 *
 * Pure: no DB, no network. Tested hermetically in renewal-copy.test.ts.
 *
 * Two lines are NEW COPY pending Giorgio's OK and are marked as such:
 * renewalRemovedBody and seasonSetBody.
 */

/** America/New_York, pinned: the app's Eastern convention (lib/marketHours.ts).
 * hourCycle is pinned to h12 with an explicit dayPeriod, because an hour without
 * it is tagged as a literal by Hermes (memory: hermes-intl-formattoparts). */
export const COPY_TIME_ZONE = 'America/New_York';

/** "{commissioner} is running it back. Are you in for Season 2?" */
export function renewalInviteBody(i: { commissioner: string; season: number }): string {
  return `${i.commissioner} is running it back. Are you in for Season ${i.season}?`;
}

/** "{name} is running back for Season 2. {n} running back · {n} out · {n} no reply yet."
 * For an out answer: "{name} is out for Season 2. …" with the same counts tail. */
export function renewalReplyBody(i: {
  name: string;
  response: 'in' | 'out';
  season: number;
  running: number;
  out: number;
  noReply: number;
}): string {
  const lead = i.response === 'in'
    ? `${i.name} is running back for Season ${i.season}.`
    : `${i.name} is out for Season ${i.season}.`;
  return `${lead} ${i.running} running back · ${i.out} out · ${i.noReply} no reply yet.`;
}

/** NEW COPY, pending Giorgio's OK: "{commissioner} set up Season 2 of {league} without you." */
export function renewalRemovedBody(i: { commissioner: string; season: number; league: string }): string {
  return `${i.commissioner} set up Season ${i.season} of ${i.league} without you.`;
}

/** NEW COPY, pending Giorgio's OK: "Season 2 of {league} is set. The draft is {Sat, Jan 23 · 7:00 PM ET}."
 * The date is shown only when stored; a TBD date drops the second sentence. */
export function seasonSetBody(i: { league: string; season: number; draftDate: string | null }): string {
  const head = `Season ${i.season} of ${i.league} is set.`;
  if (!i.draftDate) return head;
  return `${head} The draft is ${formatDraftWhen(i.draftDate)}.`;
}

/** "Sat, Jan 23 · 7:00 PM ET", in America/New_York, assembled from parts so the
 * separators are ours and not the locale's. */
export function formatDraftWhen(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: COPY_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    hourCycle: 'h12',
  }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  const clean = (v: string) => v.replace(/[  ]/g, ' ');
  return `${get('weekday')}, ${get('month')} ${get('day')} · ${clean(get('hour'))}:${get('minute')} ${get('dayPeriod')} ET`
    .replace(/\s+/g, ' ');
}
