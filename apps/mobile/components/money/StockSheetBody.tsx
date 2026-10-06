/**
 * StockSheetBody: renders the stock sheet from stockSheetModel (3e). Every
 * decision lives in the model; this file only lays it out. The market gate is
 * re-checked each second while the sheet is open, so trading closes at the
 * close without a refetch.
 *
 * Not yet reachable: nothing calls useStockSheet().open() in the app. The
 * Portfolio and League entry points land with their screens.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/sp/Text';
import { formatMoney, formatPercent } from '@/components/sp/logic/money';
import { useLeagueContext } from '@/lib/LeagueContext';
import { cleanCompanyName } from '@/lib/money/cleanCompanyName';
import { formatShares } from '@/lib/money/formatShares';
import { COPY } from '@/lib/money/moneyCopy';
import { marketOpensLabel } from '@/lib/money/marketOpensLabel';
import { decideTradeGate } from '@/lib/money/tradeGate';
import { stockSheetModel } from '@/lib/money/stockSheetModel';
import { useStockSheetData } from '@/lib/money/useStockSheetData';

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function StockSheetBody({ symbol, knownName = null, onDone }: { symbol: string; knownName?: string | null; onDone: () => void }) {
  const data = useStockSheetData(symbol, knownName);
  const { market } = useLeagueContext();
  const now = useNow(1000);
  const [choice, setChoice] = useState<'buy' | 'sell' | null>(null);

  if (data.status === 'loading') {
    return <Text variant="callout" tone="secondary">{symbol}</Text>;
  }
  if (data.status === 'error' || !data.facts) {
    return <Text variant="callout" tone="secondary">{COPY.cantReach}</Text>;
  }

  const gate = decideTradeGate(now, market);
  const opensLabel = market?.next_open_at ? marketOpensLabel(market.next_open_at) : null;
  const model = stockSheetModel({
    symbol,
    companyName: data.companyName,
    price: data.price,
    prevClose: data.prevClose,
    held: data.facts.held,
    owner: data.facts.owner,
    draft: data.facts.draft,
    gate: { open: gate.open, opensLabel },
    leagueName: data.leagueName ?? '',
    lastCloseLabel: null,
  });
  const selected = choice ?? model.selected;
  const action = selected === 'buy' ? model.buy : model.sell;

  return (
    <View accessibilityRole="summary" style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="headline" style={{ flex: 1 }}>{symbol}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={onDone}
          hitSlop={8}
          style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' }}
        >
          <Text variant="callout" tone="primary">Done</Text>
        </Pressable>
      </View>
      <Text variant="caption" tone="secondary">{model.name || cleanCompanyName(data.companyName) || symbol}</Text>

      {data.price != null ? (
        <Text variant="title">{formatMoney(data.price)}</Text>
      ) : (
        <Text variant="callout" tone="secondary">{COPY.noPrice}</Text>
      )}
      {model.todayChange ? (
        <Text variant="callout">
          {`${formatMoney(model.todayChange.perShare, { sign: 'always' })} · ${formatPercent(model.todayChange.pct, { sign: 'always' })} `}
          <Text variant="callout" tone="secondary">today</Text>
        </Text>
      ) : null}

      <Text variant="callout" tone="secondary">
        {model.ownershipLine}
        {model.ownerBadge ? ` · ${model.ownerBadge}` : ''}
      </Text>

      {data.facts.held ? (
        <Text variant="callout">{formatShares(data.facts.held.quantity)} sh</Text>
      ) : null}

      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 8 }}>
        {(['buy', 'sell'] as const).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: selected === k }}
            accessibilityLabel={k === 'buy' ? 'Buy' : 'Sell'}
            onPress={() => setChoice(k)}
            hitSlop={6}
            style={{ minHeight: 44, minWidth: 64, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text variant="callout" tone={selected === k ? 'primary' : 'secondary'}>
              {k === 'buy' ? 'Buy' : 'Sell'}
            </Text>
          </Pressable>
        ))}
      </View>

      {selected === 'sell' && model.sell.summary ? (
        <Text variant="callout">{model.sell.summary}</Text>
      ) : null}
      {action.reason ? (
        <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
          {action.reason}
        </Text>
      ) : null}
      {model.marketNote ? <Text variant="caption" tone="secondary">{model.marketNote}</Text> : null}

      <Text variant="caption" tone="secondary">{COPY.alpacaCredit}</Text>
    </View>
  );
}
