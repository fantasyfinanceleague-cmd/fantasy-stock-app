/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { Icon } from '@/components/sp/Icon';
import { PressableScale } from '@/components/sp/PressableScale';
import { Sheet } from '@/components/sp/Sheet';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney, formatPercent } from '@/components/sp/logic/money';
import {
  acquisitionLine, cardAction, howTitle, sinceLabel, toneOf, type Acquisition, type Category, type PlayerCardOwnership,
} from '@/components/sp/logic/gameNight';

export type { PlayerCardOwnership, PlayerCardOwnerInfo } from '@/components/sp/logic/gameNight';
import { Avatar } from '@/components/sp/Avatar';
import { CategoryPill } from '@/components/sp/gn/CategoryPill';
import type { AxisSpec } from '@/components/sp/logic/chartAxis';
import type { LinePointIn } from '@/components/sp/logic/lineChart';
import { COPY as MONEY_COPY } from '@/lib/money/moneyCopy';
import { Chart } from '@/components/sp/gn/Chart';

// Stockpile — <PlayerCard>, Game Night (§9C "PlayerCard", in the order of Giorgio's review on
// ESPN's player card, 2026-10-12): tapping ANY stock, yours or theirs, on Matchup or
// Portfolio opens it as a sheet (`surface`, radius 20, over `scrim`; the sheet rises on
// spring.snappy and fades under Reduce Motion — components/sp/Sheet).
//   1. Header: ticker, company, "Yours" / "Owned by …", the slot pill in slotted leagues.
//   2. THREE key figures on `inset`: Price · Week gain · Since the draft ("Since {date}" for
//      a stock bought or claimed later). No position figure ("a little cluttered").
//   3. The season line, with its date axis. NO acquisition marker: block 6 says how.
//   4. This week's line, with its Mon…Fri axis.
//   5. The one action: your stock → Sell while the market is open, disabled with the
//      reason while closed, NEVER Save; a stock you don't own → Save / Saved.
//   6. "How you got it" at the BOTTOM ("How they got it" on theirs).
//   7. The Alpaca credit.
// Giorgio, 2026-10-12: the owner's avatar (a 20pt `opp` disc, `onOpp` initials) sits in "Owned by …"; no game log.
// No new copy: every string is the spec's or the app's own (moneyCopy).

interface PlayerCardBase {
  visible: boolean;
  onClose: () => void;
  /** After the sheet has fully left (Sheet's onClosed): where Sell opens the stock sheet. */
  onClosed?: () => void;
  ticker: string;
  company: string;
  /** The slot pill in slotted leagues: a category league passes `category` (a coloured
   * CategoryPill), a price-tier league its tier as `slot` ("$100–$200"); omit both in
   * unslotted leagues. */
  slot?: string;
  category?: Category;
  price: number;
  /** Today's change, percent. */
  todayPct: number;
  weekGain: number;
  weekPct: number;
  sinceGain: number;
  sincePct: number;
  acquisition: Acquisition;
  season: { points: LinePointIn[]; base: number; axis: Extract<AxisSpec, { kind: 'dated' }> };
  week: { points: LinePointIn[]; base: number };
  marketOpen: boolean;
  /** The next open, for the closed note ("Mon 9:30 AM ET"); null when it isn't known. */
  opens: string | null;
}

export type PlayerCardProps = PlayerCardBase & PlayerCardOwnership;

const SHEET_GUTTER = space[6];

export function PlayerCard(props: PlayerCardProps) {
  const { visible, onClose, onClosed } = props;
  return (
    <Sheet visible={visible} onClose={onClose} onClosed={onClosed}>
      <PlayerCardBody {...props} />
    </Sheet>
  );
}

/** The card's content, without the sheet — the design gallery renders it inline. */
export function PlayerCardBody(props: PlayerCardProps) {
  const {
    onClose, ticker, company, owner, slot, category, price, todayPct, weekGain, weekPct, sinceGain, sincePct, acquisition,
    season, week, marketOpen, opens,
  } = props;
  const { colors } = useTheme();
  const action = cardAction(props);
  const weekTone = colors[toneOf(weekGain)];
  const money = (n: number) => formatMoney(n, { sign: 'always' });
  const pct = (n: number) => formatPercent(n, { sign: 'always' });
  const ownerLabel = owner === 'you' ? 'Yours' : MONEY_COPY.ownedBy(owner.name);

  return (
    <ScrollView contentContainerStyle={styles.body} accessibilityLabel={`${ticker}, player card`}>
      {/* 1. Header */}
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: colors.inset }]}>
          <Text variant="ticker.tile" allowFontScaling={false}>{ticker}</Text>
        </View>
        <View style={styles.headText}>
          <Text variant="ticker.card" accessibilityRole="header" testID="player-card-ticker">{ticker}</Text>
          <Text variant="callout" tone="secondary" numberOfLines={1}>{company}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close} hitSlop={4}>
          <Icon name="close" size="title" tone="text2" />
        </Pressable>
      </View>
      <View style={styles.pills}>
        {owner === 'you' ? (
          <View style={[styles.pill, { backgroundColor: colors.youTint }]} accessible accessibilityLabel={ownerLabel}><Text variant="callout" color={colors.youText} style={styles.pillText}>Yours</Text></View>
        ) : (
          // One stop for VoiceOver: "Owned by Gianluigi B." (not the avatar's name, then the line).
          <View style={[styles.pill, styles.ownerPill, { backgroundColor: colors.inset }]} accessible accessibilityLabel={ownerLabel}>
            <Avatar name={owner.name} uri={owner.avatarUri} size={20} tone="opp" />
            <Text variant="callout" style={styles.pillText}>{MONEY_COPY.ownedBy(owner.name)}</Text>
          </View>
        )}
        {category ? <CategoryPill category={category} /> : slot ? <View style={[styles.pill, { backgroundColor: colors.inset }]}><Text variant="callout" style={styles.pillText}>{slot}</Text></View> : null}
      </View>

      {/* 2. Three key figures */}
      <View style={[styles.strip, { backgroundColor: colors.inset }]}>
        <Figure label="Price" value={formatMoney(price)} sub={`${pct(todayPct)} today`} subColor={colors[toneOf(todayPct)]} />
        <Figure label="Week gain" value={money(weekGain)} valueColor={weekTone} sub={pct(weekPct)} subColor={weekTone} />
        <Figure label={sinceLabel(acquisition)} value={money(sinceGain)} valueColor={colors[toneOf(sinceGain)]} sub={pct(sincePct)} subColor={colors[toneOf(sinceGain)]} />
      </View>

      {/* 3. The season line, dated axis, no acquisition marker */}
      <View style={styles.section}>
        <View style={styles.titleRow}>
          <Text variant="headline" style={styles.title}>Season</Text>
          {/* The board's caption: the entry price per share → the price now. */}
          <Text variant="caption" tone="secondary" style={styles.tabular} testID="player-card-season-caption">{`${formatMoney(acquisition.price)} → ${formatMoney(price)}`}</Text>
        </View>
        <Chart points={season.points} base={season.base} axis={season.axis} height={128} bleed={SHEET_GUTTER} drawKey={`${ticker}-season`} formatValue={(v) => formatMoney(v)} accessibilityLabel={`${ticker} this season`} />
      </View>

      {/* 4. This week, Mon…Fri */}
      <View style={styles.section}>
        <View style={styles.titleRow}>
          <Text variant="headline" style={styles.title}>This week</Text>
          <Text variant="callout" color={weekTone} style={styles.titleFigure}>{`${money(weekGain)} · ${pct(weekPct)}`}</Text>
        </View>
        <Chart points={week.points} base={week.base} axis={{ kind: 'week' }} height={70} bleed={SHEET_GUTTER} live={marketOpen} drawKey={`${ticker}-week`} formatValue={(v) => formatMoney(v)} accessibilityLabel={`${ticker} this week`} />
      </View>

      {/* 5. The one action (none for a stock you sold this week, or with no watchlist to save to) */}
      {action ? (
        <View style={styles.actionWrap}>
          <PressableScale
            testID="player-card-action"
            disabled={action.disabled}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${action.label}, ${ticker}`}
            accessibilityHint={action.note ?? undefined}
            accessibilityState={{ disabled: action.disabled, selected: action.saved ?? undefined }}
            style={[styles.action, { borderColor: colors.borderStrong, opacity: action.disabled ? 0.5 : 1 }]}
          >
            {action.star ? <Icon name={action.star} size="body" tone="text" /> : null}
            <Text variant="headline" style={styles.actionText}>{action.label}</Text>
          </PressableScale>
          {action.note ? (
            <Text variant="caption" tone="secondary" style={styles.center}>{action.note}</Text>
          ) : null}
        </View>
      ) : null}

      {/* 6. How you got it — at the bottom, in its inset panel (the board: radius 14, 12 / 14) */}
      <View style={[styles.how, { backgroundColor: colors.inset }]} accessible accessibilityLabel={`${howTitle(owner === 'you' ? 'you' : 'other')}: ${acquisitionLine(acquisition)}`}>
        <CardLabel text={howTitle(owner === 'you' ? 'you' : 'other')} />
        <Text variant="body" style={styles.howLine}>{acquisitionLine(acquisition)}</Text>
      </View>

      {/* 7. The Alpaca credit */}
      <Text variant="caption" tone="secondary" style={styles.center}>{MONEY_COPY.alpacaCredit}</Text>
    </ScrollView>
  );
}

function Figure({ label, value, sub, valueColor, subColor }: { label: string; value: string; sub: string; valueColor?: string; subColor?: string }) {
  return (
    <View style={styles.figure} accessible accessibilityLabel={`${label}, ${value}, ${sub}`}>
      <CardLabel text={label} />
      <Text variant="score.md" color={valueColor} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
      <Text variant="caption" color={subColor} style={styles.figureSub} numberOfLines={1}>{sub}</Text>
    </View>
  );
}

/** The board's card label (the figure labels, "How you got it"): the tag's size and
 * capitals at NORMAL width (not the Expanded tag face), `text2`. Uppercased in JS. */
function CardLabel({ text }: { text: string }) {
  return (
    <Text variant="caption" tone="secondary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.92} style={styles.cardLabel}>
      {text.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: SHEET_GUTTER,
    paddingBottom: space[7],
    gap: space[5],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: {
    flex: 1,
    minWidth: 0,
    gap: space[1],
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
  },
  pill: {
    minHeight: 28,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  pillText: {
    fontWeight: '700',
  },
  ownerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingLeft: space[2],
  },
  strip: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    paddingVertical: space[4],
    paddingHorizontal: space[3],
  },
  figure: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: space[1],
  },
  // Uppercased in JS, not textTransform (iOS measures the source case and clips the capitals).
  cardLabel: {
    fontWeight: '800',
    letterSpacing: 0.48,
  },
  figureSub: {
    fontWeight: '700',
  },
  section: {
    gap: space[2],
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space[3],
  },
  title: {
    fontWeight: '800',
  },
  titleFigure: {
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  actionWrap: {
    gap: space[3],
  },
  action: {
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: space[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontWeight: '800',
  },
  how: {
    gap: space[2],
    borderRadius: radius.lg,
    paddingVertical: space[4],
    paddingHorizontal: 14,
  },
  // The board: 15/700, tabular.
  howLine: {
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  center: {
    textAlign: 'center',
  },
});
