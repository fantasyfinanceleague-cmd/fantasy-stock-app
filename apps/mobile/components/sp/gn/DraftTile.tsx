/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { CATEGORIES, CLOCK_RING, draftTileLook, SECTOR_LINE, type Category, type DraftTileState } from '@/components/sp/logic/gameNight';

// Stockpile — <DraftTile>, Game Night (§9C; Giorgio, 2026-10-12: "the game night one. Look,
// but with the broadcast touch of having like it color coded just with that line at the
// bottom … without it being like a carbon copy of Sleeper"). One cell of the draft board:
//   - picked: `surface`, radius 5, the 3pt category line at the BOTTOM (never a category
//     fill), the label row (pick number left, the category's 3-letter code right — TEC, F&B,
//     … Giorgio, 2026-10-12) in `text2`, the ticker at 13/800;
//   - empty: `sunken`, the pick number in `text2`;
//   - on the clock: `clockCell` with a 2pt ring, the pick number in `clockCellLive`, the
//     clock in `onClockCell` (the cell is dark in BOTH themes).
// The colours come from logic/gameNight.ts's `draftTileLook`, which the tests pin.

export interface DraftTileProps {
  pick: number;
  state: DraftTileState;
  ticker?: string;
  /** The stock's category (a categories.json slug); its colour and code come from CATEGORIES. */
  category?: Category | null;
  /** The on-the-clock cell's clock ("0:42"). */
  clock?: string;
}

const TILE_HEIGHT = 44;
// Six tiles share a phone's width: the text grows with Dynamic Type up to 1.2×, the tile grows with it.
const TILE_MAX_SCALE = 1.2;

export function DraftTile({ pick, state, ticker, category = null, clock }: DraftTileProps) {
  const { colors } = useTheme();
  const look = draftTileLook(state, category, colors);
  const sectorText = state === 'picked' && category ? CATEGORIES[category].code : null;
  const a11y =
    state === 'onClock' ? `Pick ${pick}, on the clock${clock ? `, ${clock}` : ''}`
      : state === 'empty' ? `Pick ${pick}, open`
        : `Pick ${pick}, ${ticker ?? ''}${category ? `, ${CATEGORIES[category].pill}` : ''}`;

  return (
    <View
      accessible
      accessibilityLabel={a11y}
      style={[
        styles.tile,
        { backgroundColor: look.fill },
        look.ring ? { borderWidth: CLOCK_RING, borderColor: look.ring } : null,
      ]}
    >
      <View style={styles.labelRow}>
        <Text variant="caption" color={look.labelInk} maxFontSizeMultiplier={TILE_MAX_SCALE} style={styles.label}>{pick}</Text>
        {sectorText ? <Text variant="caption" color={look.labelInk} maxFontSizeMultiplier={TILE_MAX_SCALE} style={styles.label}>{sectorText}</Text> : null}
      </View>
      {state === 'picked' && ticker ? (
        <Text variant="ticker.tile" color={look.tickerInk} numberOfLines={1}>{ticker}</Text>
      ) : null}
      {state === 'onClock' && clock ? (
        <Text variant="ticker.tile" color={look.tickerInk} maxFontSizeMultiplier={TILE_MAX_SCALE}>{clock}</Text>
      ) : null}
      {look.line ? <View testID="draft-tile-sector-line" style={[styles.line, { backgroundColor: look.line }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    minHeight: TILE_HEIGHT,
    borderRadius: radius.tile,
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 4 + SECTOR_LINE,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 2,
  },
  // The board's label row, bold.
  label: {
    fontWeight: '700',
  },
  line: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SECTOR_LINE,
  },
});
