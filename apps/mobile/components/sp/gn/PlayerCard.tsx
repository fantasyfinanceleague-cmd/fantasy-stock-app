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
  acquisitionLine, actionLabel, howTitle, playerAction, sinceLabel, toneOf, type Acquisition, type Category,
} from '@/components/sp/logic/gameNight';
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

export interface PlayerCardProps {
  visible: boolean;
  onClose: () => void;
  ticker: string;
  company: string;
  /** 'you', or the owning manager (their avatar sits in the "Owned by …" pill). */
  owner: 'you' | { name: string; avatarUri?: string | null };
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
  /** "Since the draft" (drawn) or "Season gain" — Giorgio's call, open. */
  draftLabel?: string;
  season: { points: LinePointIn[]; base: number; axis: Extract<AxisSpec, { kind: 'dated' }> };
  week: { points: LinePointIn[]; base: number };
  marketOpen: boolean;
  /** The next open, for the closed note ("Mon 9:30 ET"). */
  opens: string;
  saved?: boolean;
  onSell?: () => void;
  onToggleSave?: () => void;
}

const SHEET_GUTTER = space[6];

export function PlayerCard(props: PlayerCardProps) {
  const { visible, onClose } = props;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <PlayerCardBody {...props} />
    </Sheet>
  );
}

/** The card's content, without the sheet — the design gallery renders it inline. */
export function PlayerCardBody({
  onClose, ticker, company, owner, slot, category, price, todayPct, weekGain, weekPct, sinceGain, sincePct, acquisition,
  draftLabel, season, week, marketOpen, opens, saved = false, onSell, onToggleSave,
}: PlayerCardProps) {
  const { colors } = useTheme();
  const mine = owner === 'you';
  const action = playerAction(mine ? 'you' : 'other', marketOpen, saved, opens);
  const onAction = action.kind === 'sell' ? (action.enabled ? onSell : undefined) : onToggleSave;
  const actionDisabled = !onAction;
  const weekTone = colors[toneOf(weekGain)];
  const money = (n: number) => formatMoney(n, { sign: 'always' });
  const pct = (n: number) => formatPercent(n, { sign: 'always' });

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
        {mine ? (
          <View style={[styles.pill, { backgroundColor: colors.youTint }]}><Text variant="callout" color={colors.youText} style={styles.pillText}>Yours</Text></View>
        ) : (
          <View style={[styles.pill, styles.ownerPill, { backgroundColor: colors.inset }]}>
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
        <Figure label={sinceLabel(acquisition, draftLabel)} value={money(sinceGain)} valueColor={colors[toneOf(sinceGain)]} sub={pct(sincePct)} subColor={colors[toneOf(sinceGain)]} />
      </View>

      {/* 3. The season line, dated axis, no acquisition marker */}
      <View style={styles.section}>
        <Text variant="headline" style={styles.title}>Season</Text>
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

      {/* 5. The one action */}
      <View style={styles.actionWrap}>
        <PressableScale
          testID="player-card-action"
          disabled={actionDisabled}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityState={{ disabled: actionDisabled, selected: action.kind === 'save' ? action.saved : undefined }}
          style={[styles.action, { borderColor: colors.borderStrong, opacity: actionDisabled ? 0.5 : 1 }]}
        >
          <Text variant="headline" style={styles.actionText}>{actionLabel(action)}</Text>
        </PressableScale>
        {action.kind === 'sell' && !action.enabled ? (
          <Text variant="caption" tone="secondary" style={styles.center}>{action.note}</Text>
        ) : null}
      </View>

      {/* 6. How you got it — at the bottom */}
      <View style={styles.how}>
        <Text variant="headline" style={styles.title}>{howTitle(mine ? 'you' : 'other')}</Text>
        <Text variant="body" style={styles.tabular}>{acquisitionLine(acquisition)}</Text>
      </View>

      {/* 7. The Alpaca credit */}
      <Text variant="caption" tone="secondary" style={styles.center}>{MONEY_COPY.alpacaCredit}</Text>
    </ScrollView>
  );
}

function Figure({ label, value, sub, valueColor, subColor }: { label: string; value: string; sub: string; valueColor?: string; subColor?: string }) {
  return (
    <View style={styles.figure} accessible accessibilityLabel={`${label}, ${value}, ${sub}`}>
      {/* The board's figure label: uppercase at NORMAL width (not the Expanded tag face). */}
      <Text variant="caption" tone="secondary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={styles.figureLabel}>{label}</Text>
      <Text variant="score.md" color={valueColor} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
      <Text variant="caption" color={subColor} style={styles.figureSub} numberOfLines={1}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: SHEET_GUTTER,
    paddingBottom: space[7],
    gap: 14,
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
    minHeight: 26,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  pillText: {
    fontWeight: '700',
  },
  ownerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 3,
  },
  strip: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    paddingVertical: space[4],
    paddingHorizontal: 6,
  },
  figure: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: space[1],
  },
  figureLabel: {
    fontWeight: '800',
    textTransform: 'uppercase',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontWeight: '800',
  },
  how: {
    gap: space[1],
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  center: {
    textAlign: 'center',
  },
});
