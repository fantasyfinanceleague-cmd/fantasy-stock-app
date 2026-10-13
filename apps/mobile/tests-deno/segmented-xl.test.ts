/**
 * Game-screens gate GS-3: at XL text every SegmentedControl truncated ("Stan… / Sche…",
 * "My matc…"), so the League tabs couldn't be told apart. Its labels now take the tab
 * bar's Dynamic Type ceiling (1.3), with fit-to-width only as a narrow-phone safety net.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the segment label is capped like the tab bar label (source guard)', () => {
  const seg = SOURCES['components/sp/SegmentedControl.tsx'];
  const tab = SOURCES['components/shell/ShellTabBar.tsx'];
  assert(tab.includes('const LABEL_MAX_SCALE = 1.3;'));
  assert(seg.includes('const LABEL_MAX_SCALE = 1.3;'), 'the segment cap matches the tab bar cap');
  assert(seg.includes('maxFontSizeMultiplier={LABEL_MAX_SCALE}'));
  assert(seg.includes('adjustsFontSizeToFit'));
});

Deno.test('every segmented control in the app is the one sp SegmentedControl (so one cap covers them)', () => {
  for (const [path, src] of Object.entries(SOURCES)) {
    if (path === 'components/sp/SegmentedControl.tsx' || path === 'components/shell/ShellTabBar.tsx') continue;
    // A calm Home (2026-10-12): Home's range is text tabs by the spec, not a segmented
    // control; they carry the same 1.3x cap themselves (pinned below).
    if (path === 'components/home/HomeSeason.tsx') continue;
    // Game Night (§9C): RangePills is the range primitive (tabs or pills); same cap, pinned below.
    if (path === 'components/sp/gn/RangePills.tsx') continue;
    assert(!src.includes('accessibilityRole="tablist"'), `${path} rolls its own segmented control`);
  }
});

Deno.test("Home's text range tabs carry the segmented labels' cap (1.3x)", () => {
  // W4: Home's tabs are the Game Night RangePills (capped there, the test below); Home's
  // own layout math uses the same cap.
  const tabs = SOURCES['components/home/HomeSeason.tsx'];
  assert(tabs.includes('<RangePills options={RANGE_OPTIONS}'));
  assert(SOURCES['lib/home/weekMarks.ts'].includes('export const RANGE_TAB_MAX_FONT_SCALE = 1.3;'));
});

Deno.test("Game Night RangePills carry the segmented labels' cap (1.3x)", () => {
  const pills = SOURCES['components/sp/gn/RangePills.tsx'];
  assert(pills.includes('const LABEL_MAX_SCALE = 1.3;'));
  assert(pills.includes('maxFontSizeMultiplier={LABEL_MAX_SCALE}'));
});
