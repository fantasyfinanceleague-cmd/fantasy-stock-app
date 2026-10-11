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
    assert(!src.includes('accessibilityRole="tablist"'), `${path} rolls its own segmented control`);
  }
});
