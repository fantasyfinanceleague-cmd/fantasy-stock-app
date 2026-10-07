/**
 * The Draft time sheet, ruling B (board #call-ux-pass1, PR #140): the sheet holds
 * the time it shows and writes ONLY on "Set draft time". The wheel spinning, ×,
 * and a swipe write nothing (the 1.1.0 half-save on swipe-away); "Set later"
 * writes "no time", only where a time is optional.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  PICK_A_TIME_HOME, SET_DRAFT_TIME, SET_LATER, draftTimeSheet, homeSetsDraftTime, shownDraftTime, type SheetAction, type SheetWrite,
} from '../lib/game/draftTimeSheet.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const NOW = new Date('2026-10-06T18:07:12Z'); // earliest: 19:15Z
const at = (iso: string) => new Date(iso);

const SHEET_CALLERS = ['app/create-league.tsx', 'app/league-settings.tsx', 'components/game/AutoStartBlockers.tsx', 'components/home/PreDraftCard.tsx'];
/** The <DraftDateSheet …/> element in a caller's source. */
function sheetElement(src: string): string {
  const start = src.indexOf('<DraftDateSheet');
  return start < 0 ? '' : src.slice(start, src.indexOf('/>', start));
}

/** Run a sequence of sheet steps; collect every write. */
function play(actions: SheetAction[]): { writes: SheetWrite[]; open: boolean; local: Date | null } {
  let local: Date | null = null;
  let open = false;
  const writes: SheetWrite[] = [];
  for (const a of actions) {
    const s = draftTimeSheet(local, a);
    local = s.local;
    open = s.open;
    if (s.write.kind !== 'none') writes.push(s.write);
  }
  return { writes, open, local };
}

Deno.test('the ruled copy, verbatim', () => {
  assertEquals(SET_DRAFT_TIME, 'Set draft time');
  assertEquals(SET_LATER, 'Set later');
  assertEquals(PICK_A_TIME_HOME, 'Pick a time, and the countdown starts here.');
});

Deno.test('a dismiss writes nothing: open, spin, swipe away', () => {
  const r = play([
    { type: 'open', current: null, now: NOW },
    { type: 'spin', date: at('2026-10-07T23:00:00Z') },
    { type: 'spin', date: at('2026-10-08T23:00:00Z') },
    { type: 'dismiss' },
  ]);
  assertEquals(r.writes, []);
  assertEquals(r.open, false);
  assertEquals(r.local, null); // the held time is thrown away
});

Deno.test('a dismiss writes nothing even over an existing time (it keeps the caller\'s)', () => {
  const r = play([
    { type: 'open', current: at('2026-10-09T23:00:00Z'), now: NOW },
    { type: 'spin', date: at('2026-10-10T23:00:00Z') },
    { type: 'dismiss' },
  ]);
  assertEquals(r.writes, []);
});

Deno.test('the wheel never writes; only "Set draft time" does, with the time last shown', () => {
  const spun = play([
    { type: 'open', current: null, now: NOW },
    { type: 'spin', date: at('2026-10-07T23:00:00Z') },
  ]);
  assertEquals(spun.writes, []);
  assertEquals(spun.open, true);
  const r = play([
    { type: 'open', current: null, now: NOW },
    { type: 'spin', date: at('2026-10-07T23:00:00Z') },
    { type: 'confirm', nowMs: NOW.getTime() },
  ]);
  assertEquals(r.writes, [{ kind: 'time', date: at('2026-10-07T23:00:00Z') }]);
  assertEquals(r.open, false);
});

Deno.test('accepting the shown time without spinning commits it (the seed)', () => {
  // No time yet: the earliest, an hour out on the quarter hour.
  assertEquals(play([{ type: 'open', current: null, now: NOW }, { type: 'confirm', nowMs: NOW.getTime() }]).writes, [
    { kind: 'time', date: at('2026-10-06T19:15:00Z') },
  ]);
  // An existing valid time: that time.
  assertEquals(play([{ type: 'open', current: at('2026-10-09T23:00:00Z'), now: NOW }, { type: 'confirm', nowMs: NOW.getTime() }]).writes, [
    { kind: 'time', date: at('2026-10-09T23:00:00Z') },
  ]);
});

Deno.test('a sheet left open past the earliest time commits what it shows (the earliest), never an earlier time', () => {
  const later = new Date('2026-10-06T18:40:00Z').getTime(); // earliest now 19:45Z
  const r = play([
    { type: 'open', current: null, now: NOW }, // held 19:15Z
    { type: 'confirm', nowMs: later },
  ]);
  assertEquals(r.writes, [{ kind: 'time', date: at('2026-10-06T19:45:00Z') }]);
  assertEquals(shownDraftTime(at('2026-10-06T19:15:00Z'), later).toISOString(), '2026-10-06T19:45:00.000Z');
});

Deno.test('Set later writes "no time" and closes', () => {
  const r = play([{ type: 'open', current: at('2026-10-09T23:00:00Z'), now: NOW }, { type: 'set_later' }]);
  assertEquals(r.writes, [{ kind: 'later' }]);
  assertEquals(r.open, false);
});

Deno.test('the sheet: × and a swipe dismiss; one full-width Set draft time; Set later a 44 pt text button (source guard)', () => {
  const sheet = SOURCES['components/game/DraftDateSheet.tsx'];
  assertEquals(sheet.includes("<Sheet visible={visible} onClose={() => run({ type: 'dismiss' })}>"), true);
  assertEquals(sheet.includes("<Pressable onPress={() => run({ type: 'dismiss' })} accessibilityRole=\"button\" accessibilityLabel=\"Close\""), true);
  assertEquals(sheet.includes("<Button label={SET_DRAFT_TIME} onPress={() => run({ type: 'confirm', nowMs: Date.now() })} fullWidth />"), true);
  assertEquals(sheet.includes("{onSetLater ? (\n          <Pressable onPress={() => run({ type: 'set_later' })}"), true);
  assertEquals(sheet.includes('Done'), false); // the header link is gone
  // The wheel only updates the held time.
  assertEquals(sheet.includes("if (event.type === 'set' && selectedDate) run({ type: 'spin', date: selectedDate });"), true);
});

Deno.test('every caller commits through onConfirm; a required time has no Set later (source guard)', () => {
  const blockers = SOURCES['components/game/AutoStartBlockers.tsx'];
  assertEquals(blockers.includes('onConfirm={(d) => void f.saveDraftTime(d)}'), true);
  assertEquals(blockers.includes('onSetLater'), false); // a postponed draft needs a time
  for (const p of SHEET_CALLERS) {
    const el = sheetElement(SOURCES[p]);
    assertEquals(el.includes('onChange='), false, p);
    assertEquals(el.includes('onConfirm={'), true, p);
    assertEquals(el.includes('initial={'), true, p);
  }
});

// ── Ruling B, Home: no draft time yet (commissioner) ──

Deno.test('Home leads with setting the time for the commissioner only; members are unchanged', () => {
  assertEquals(homeSetsDraftTime(true, true), true);
  assertEquals(homeSetsDraftTime(true, false), false); // a member: "{Commissioner} will set the draft time."
  assertEquals(homeSetsDraftTime(false, true), false); // a time is set: the countdown
});

Deno.test('Home: the ruled line, primary "Set draft time" opening the sheet in place, Build your queue secondary (source guard)', () => {
  const home = SOURCES['components/home/PreDraftCard.tsx'];
  assertEquals(home.includes('{setsTime ? PICK_A_TIME_HOME : noDateCopy(ds.isCommissioner, commissionerName)}'), true);
  assertEquals(home.includes('<Button label={SET_DRAFT_TIME} onPress={() => setPicking(true)} variant="primary"'), true);
  assertEquals(home.includes("<Button label={BUILD_YOUR_QUEUE} onPress={() => router.push('/(tabs)/league')} variant=\"secondary\" />"), true);
  // The same sheet and the same save as a postponed draft's new time; no Set later (no time yet).
  const el = sheetElement(home);
  assertEquals(el.includes('onConfirm={(d) => void auto.fixes.saveDraftTime(d, { firstTime: true })}'), true);
  assertEquals(el.includes('onSetLater'), false);
  assertEquals(el.includes('visible={picking && setsTime}'), true);
});

Deno.test('Home\'s first-time save failure has no "new" (ruled); the postponed flow keeps it', async () => {
  const { DRAFT_TIME_NOT_SAVED, NEW_TIME_NOT_SAVED } = await import('../lib/game/autoStart.ts');
  assertEquals(DRAFT_TIME_NOT_SAVED, "The draft time wasn't saved. Try again.");
  assertEquals(NEW_TIME_NOT_SAVED, "The new draft time wasn't saved. Try again.");
  const hook = SOURCES['lib/game/useDraftAutoStart.ts'];
  assertEquals(hook.includes('draftTimeRefusal(res.error) ?? (opts.firstTime ? DRAFT_TIME_NOT_SAVED : NEW_TIME_NOT_SAVED)'), true);
  // The blockers card (a postponed draft) doesn't pass firstTime.
  assertEquals(SOURCES['components/game/AutoStartBlockers.tsx'].includes('onConfirm={(d) => void f.saveDraftTime(d)}'), true);
});
