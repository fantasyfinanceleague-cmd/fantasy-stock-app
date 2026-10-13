/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { AVATAR_RING, AVATAR_RING_GAP, Avatar } from '@/components/sp/Avatar';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { DraftTile } from '@/components/sp/gn';
import type { Category } from '@/components/sp/logic/gameNight';
import { pickRowView } from '@/lib/game/draftRoom';
import { BOARD_GAP, COLUMN_PAD, boardColumns, boardFirstName, boardLayout, scrollXForColumn, tileHeight } from '@/lib/game/draftBoardLayout';

// W4 Draft, Game Night (§9C; board #call-game-night, "Draft room, on the clock"). The snake
// board: one column per manager (the seats), each headed by the manager's avatar and first
// name, one DraftTile per round. A picked tile is `surface` with its category as the 3pt line
// at the bottom and its code (Giorgio, 2026-10-12: "without it being like a carbon copy of
// Sleeper"); an open one `sunken`; the pick on the clock the navy cell with its ring and clock.
//
// Your column sits on one `youTint` slab from your avatar to your last round (shading B, your
// side, never the leader's: the Matchup roster column's treatment), your avatar ringed and
// your name in 800. Nothing on the board is tappable, so nothing looks it.
//
// Six columns fill a phone's width; a bigger league keeps the tiles at their floor and
// scrolls sideways, opening on the pick that's on the clock (draftBoardLayout).

export interface DraftBoardProps {
  order: string[];
  rounds: number;
  picks: Map<number, { symbol: string; source: string }>;
  onClockPick: number;
  /** The clock in the on-the-clock cell ("0:42"); empty while auto-picking. */
  clock: string;
  names: Record<string, { name: string } | undefined>;
  myUserId: string;
  categories: Record<string, Category | null>;
}

const AVATAR = 26;

export function DraftBoard({ order, rounds, picks, onClockPick, clock, names, myUserId, categories }: DraftBoardProps) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  // The gutters are the host's (20 on each side); onLayout replaces the estimate.
  const [width, setWidth] = useState(windowWidth - 2 * space[6]);
  // The outer columns' pads reach into the gutter, so the tiles' edges line up with the cards'.
  const layout = boardLayout({ columns: order.length, available: width + 2 * COLUMN_PAD, fontScale });
  const height = tileHeight(fontScale);
  const columns = useMemo(() => boardColumns(order, rounds, picks, onClockPick), [order, rounds, picks, onClockPick]);
  const onClockColumn = columns.findIndex((col) => col.some((c) => c.onClock));

  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    if (!layout.scrolls) return;
    scroller.current?.scrollTo({ x: scrollXForColumn(onClockColumn, layout, width + 2 * COLUMN_PAD), animated: !reduced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-centres when the pick moves or the width changes
  }, [onClockColumn, layout.scrolls, layout.columnWidth, width]);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scroller}
        horizontal
        scrollEnabled={layout.scrolls}
        showsHorizontalScrollIndicator={layout.scrolls}
        style={styles.scroller}
      >
        {columns.map((col, i) => {
          const manager = order[i];
          const you = manager === myUserId;
          const name = names[manager]?.name ?? '';
          return (
            <View
              key={manager}
              testID={you ? 'draft-board-your-column' : undefined}
              style={[styles.column, { width: layout.columnWidth }, you ? { backgroundColor: colors.youTint } : null]}
            >
              <View style={styles.head} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {/* Every avatar sits in the ringed one's box, so the headers (and the rounds under them) line up. */}
                <View style={styles.avatarBox}>
                  <Avatar name={name} size={AVATAR} tone={you ? 'you' : 'opp'} ring={you} />
                </View>
                <Text
                  variant="caption"
                  color={you ? colors.text : colors.text2}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.2}
                  style={[styles.name, you ? styles.yourName : null]}
                >
                  {boardFirstName(name)}
                </Text>
              </View>
              {col.map((cell) => {
                const made = cell.symbol !== null ? pickRowView({ symbol: cell.symbol, source: cell.source ?? 'manual' }) : null;
                const state = cell.onClock ? 'onClock' : made ? 'picked' : 'empty';
                return (
                  <DraftTile
                    key={cell.pick}
                    pick={cell.pick}
                    state={state}
                    ticker={made?.symbolCell}
                    spokenTicker={made?.symbolLabel}
                    category={made?.countsAsPick ? categories[made.symbolCell.toUpperCase()] ?? null : null}
                    clock={cell.onClock && clock ? clock : undefined}
                    yours={you}
                    auto={made?.auto === true}
                    width={layout.tileWidth}
                    height={height}
                  />
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroller: { marginHorizontal: -COLUMN_PAD },
  column: {
    padding: COLUMN_PAD,
    gap: BOARD_GAP,
    // The slab follows the tiles' corners, out by its pad.
    borderRadius: radius.tile + COLUMN_PAD,
  },
  avatarBox: { height: AVATAR + 2 * (AVATAR_RING + AVATAR_RING_GAP), alignItems: 'center', justifyContent: 'center' },
  head: { alignItems: 'center', gap: 3, paddingTop: 2, paddingBottom: 2 },
  name: { textAlign: 'center', alignSelf: 'stretch' },
  yourName: { fontWeight: '800' },
});
