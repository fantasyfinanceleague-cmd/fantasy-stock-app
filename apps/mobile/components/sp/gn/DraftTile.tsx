/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { CATEGORIES, CLOCK_RING, draftTileLabel, draftTileLook, SECTOR_LINE, type Category, type DraftTileState } from '@/components/sp/logic/gameNight';

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
  /** In your column (the board's slab marks it; VoiceOver hears "Yours"). */
  yours?: boolean;
  /** Made by auto-pick (VoiceOver only: the pick log says it in words). */
  auto?: boolean;
  /** What VoiceOver says for the ticker, when it isn't the ticker (a legacy SKIP's "—" is "No pick"). */
  spokenTicker?: string;
  /** The board's column width minus its pads (draftBoardLayout); the tile fills its column without it. */
  width?: number;
  /** One height for every tile on the board (draftBoardLayout's tileHeight), so rounds line up. */
  height?: number;
}

const TILE_HEIGHT = 44;
// Six tiles share a phone's width: the text grows with Dynamic Type up to 1.2×, the tile grows with it.
const TILE_MAX_SCALE = 1.2;
// A five-letter ticker (GOOGL) shrinks to fit a six-across tile, never under the 11pt floor (§9B): 13 × 0.85 = 11.05.
export const TICKER_MIN_SCALE = 0.85;

export function DraftTile({ pick, state, ticker, category = null, clock, yours = false, auto = false, spokenTicker, width, height }: DraftTileProps) {
  const { colors } = useTheme();
  const look = draftTileLook(state, category, colors);
  const sectorText = state === 'picked' && category ? CATEGORIES[category].code : null;
  const a11y = draftTileLabel({ pick, state, spoken: spokenTicker ?? ticker, category, clock, yours, auto });

  return (
    <View
      accessible
      accessibilityLabel={a11y}
      style={[
        styles.tile,
        width !== undefined ? { width } : null,
        height !== undefined ? { height } : null,
        { backgroundColor: look.fill },
        look.ring ? { borderWidth: CLOCK_RING, borderColor: look.ring } : null,
      ]}
    >
      <View style={styles.labelRow}>
        <Text variant="caption" color={look.labelInk} maxFontSizeMultiplier={TILE_MAX_SCALE} style={styles.label}>{pick}</Text>
        {sectorText ? <Text variant="caption" color={look.labelInk} maxFontSizeMultiplier={TILE_MAX_SCALE} style={styles.label}>{sectorText}</Text> : null}
      </View>
      {state === 'picked' && ticker ? (
        <Text variant="ticker.tile" color={look.tickerInk} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={TICKER_MIN_SCALE} maxFontSizeMultiplier={TILE_MAX_SCALE}>{ticker}</Text>
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
