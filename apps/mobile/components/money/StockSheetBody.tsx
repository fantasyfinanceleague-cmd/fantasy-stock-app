/**
 * StockSheetBody: the stock sheet (3e). Every decision lives in stockSheetModel;
 * the trade review lives in reviewModel, reviewPresentation and useTradeSubmit.
 * This file wires them: the Review call to action opens the review in place,
 * the review submits through record-trade, and a retry re-fetches the fresh
 * numbers before the review can submit again. The market gate is re-checked
 * every second, so a review open at the close swaps to closed at once.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { LoadFailure } from '@/components/money/LoadFailure';
import { TradeReviewPanel, type NextStep } from '@/components/money/TradeReviewPanel';
import { Button } from '@/components/sp/Button';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { Text } from '@/components/sp/Text';
import { formatMoney, formatPercent } from '@/components/sp/logic/money';
import { useLeagueContext } from '@/lib/LeagueContext';
import { MONEY_FIXTURE, MONEY_FIXTURE_CONFIG } from '@/lib/money/devFixture';
import { FIXTURE_LEAGUE_ID, fixtureLeague, fixtureMarket } from '@/lib/money/fixtureMode';
import { STRESS_CALLER } from '@/lib/money/stressFixture';
import { useSession } from '@/lib/SessionProvider';
import { buyingPower, type PreviewSource } from '@/lib/money/buyingPower';
import { SalePicker } from '@/components/money/SalePicker';
import { StockChart } from '@/components/money/StockChart';
import { defaultSourceId } from '@/lib/money/salePicker';
import { budgetAfterBuy, budgetAfterSell, userCashSpentFromLedger } from '@/lib/money/budgetFigures';
import { cleanCompanyName } from '@/lib/money/cleanCompanyName';
import { fixedNotionalShares } from '@/lib/money/buyQuantity';
import { formatShares } from '@/lib/money/formatShares';
import { COPY } from '@/lib/money/moneyCopy';
import { marketOpensLabel } from '@/lib/money/marketOpensLabel';
import { fetchPreview, type TradeBody } from '@/lib/money/recordTrade';
import { buyReviewOneShare, buyReviewPerSlot, buyReviewTier, sellReview, type TradeReview } from '@/lib/money/reviewModel';
import { fillsSlotLine, tierRefusalSentence } from '@/lib/money/tierContract';
import { categoryNameOf, loadCategoryNames } from '@/lib/money/categoryNames';
import { useTheme } from '@/components/sp/ThemeProvider';
import { reviewPresentation } from '@/lib/money/reviewPresentation';
import { canDismiss } from '@/lib/money/reviewMachine';
import { decideTradeGate } from '@/lib/money/tradeGate';
import { stockSheetModel } from '@/lib/money/stockSheetModel';
import { buyBody, previewBody, sellBody } from '@/lib/money/tradeBodies';
import { useStockSheetData } from '@/lib/money/useStockSheetData';
import { usePortfolioLedger } from '@/lib/money/usePortfolioLedger';
import { useTradeSubmit } from '@/lib/money/useTradeSubmit';
import { useRouter } from 'expo-router';

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

type ReviewKind = 'sell' | 'buy';
interface OpenReview {
  kind: ReviewKind;
  /** null while the numbers are being fetched, or when they could not be built (see `error`). */
  review: TradeReview | null;
  body: TradeBody | null;
  error: string | null;
  loading: boolean;
  /** The error is a blocker (a tier refusal): warn-tint, no icon. */
  warn?: boolean;
  /** Per-slot buy with more than one sale to pay from: the picker comes first. */
  needsPicker?: boolean;
  sources?: PreviewSource[];
}

export function StockSheetBody({
  symbol,
  knownName = null,
  onDone,
  onBusyChange,
}: {
  symbol: string;
  knownName?: string | null;
  onDone: () => void;
  /** Reports a submit in flight, so the host can lock the sheet's dismiss paths. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const data = useStockSheetData(symbol, knownName);
  const { market: contextMarket, activeLeague } = useLeagueContext();
  const { user } = useSession();
  const { colors } = useTheme();
  const router = useRouter();
  const userId = MONEY_FIXTURE ? STRESS_CALLER : (user?.id ?? null);
  const ledgerState = usePortfolioLedger(activeLeague?.id ?? (MONEY_FIXTURE ? FIXTURE_LEAGUE_ID : null));
  const now = useNow(1000);
  // DEV fixture: the market the scenario plays (open, or closed for market_closed); live otherwise.
  const market = MONEY_FIXTURE_CONFIG ? fixtureMarket(MONEY_FIXTURE_CONFIG.scenario, now) : contextMarket;
  const [choice, setChoice] = useState<'buy' | 'sell' | null>(null);
  const [open, setOpen] = useState<OpenReview | null>(null);
  // "Which sale pays for this?": the sales a per-slot buy can be paid from, and the one chosen.
  const [picking, setPicking] = useState<{ sources: PreviewSource[]; chosen: string | null } | null>(null);
  const trade = useTradeSubmit();
  const lastData = useRef<unknown>(null);

  const gate = decideTradeGate(now, market);
  const opensLabel = market?.next_open_at ? marketOpensLabel(market.next_open_at) : null;

  async function buildReview(kind: ReviewKind, pickedId: string | null = null): Promise<OpenReview> {
    const league = MONEY_FIXTURE_CONFIG ? { id: FIXTURE_LEAGUE_ID, ...fixtureLeague(MONEY_FIXTURE_CONFIG.stake) } : activeLeague;
    if (!league || !userId) return { kind, review: null, body: null, error: COPY.cantReach, loading: false };
    const price = data.price;
    const spent = ledgerState.ledger ? userCashSpentFromLedger(ledgerState.ledger, userId) : 0;
    const budget = league.budget_amount == null ? null : Number(league.budget_amount);

    if (kind === 'sell') {
      const held = data.facts?.held;
      if (!held || price == null) return { kind, review: null, body: null, error: COPY.noPrice, loading: false };
      const body = sellBody(league.id, symbol);
      if (league.stake_mode === 'fixed_notional') {
        const review = sellReview({ symbol, quantity: held.quantity, price, slotNotional: league.notional_per_slot ?? undefined });
        return { kind, review, body, error: null, loading: false };
      }
      if (league.stake_mode === 'budget_cap' && budget != null) {
        const before = budget - spent;
        const after = budgetAfterSell(before, held.quantity, price);
        return { kind, review: sellReview({ symbol, quantity: held.quantity, price, budget: { before, after } }), body, error: null, loading: false };
      }
      return { kind, review: sellReview({ symbol, quantity: held.quantity, price }), body, error: null, loading: false };
    }

    // Buy. A per-slot league funds the buy from a sale's proceeds, which the server's preview names.
    if (price == null) return { kind, review: null, body: null, error: COPY.noPrice, loading: false };
    if (league.stake_mode === 'fixed_notional') {
      const preview = await fetchPreview(previewBody(league.id));
      const power = buyingPower({
        league,
        preview: preview ? { stake_mode: preview.stakeMode, stake: preview.stake, unfilled_slots: preview.unfilledSlots, sources: preview.sources } : null,
        cashSpent: null,
        openTierLabel: null,
      });
      if (power.kind === 'none') return { kind, review: null, body: null, error: COPY.noProceeds, loading: false };
      if (power.kind !== 'proceeds') return { kind, review: null, body: null, error: COPY.cantReach, loading: false };
      if (power.pickerRequired && !pickedId) {
        return { kind, review: null, body: null, error: null, loading: false, needsPicker: true, sources: power.sources };
      }
      const source = power.sources.find((s) => s.trade_id === (pickedId ?? power.defaultTradeId));
      const shares = source ? fixedNotionalShares(source.amount, price) : null;
      if (!source || !shares) return { kind, review: null, body: null, error: COPY.invalidPrice, loading: false };
      const review = buyReviewPerSlot({
        symbol,
        amount: source.amount,
        price: shares.price,
        quantity: shares.quantity,
        sourceLabel: `${source.symbol} slot`,
        leftInSlot: 0,
      });
      return { kind, review, body: buyBody(league.id, symbol, source.trade_id), error: null, loading: false };
    }
    if (league.stake_mode === 'price_tiers' || league.stake_mode === 'budget_cap') {
      // The server decides the slot and the refusal. The client asks (advisory) and words the answer; it never computes fit.
      const check = await fetchPreview(previewBody(league.id, { price, symbol }));
      if (!check) return { kind, review: null, body: null, error: COPY.cantReach, loading: false };
      await loadCategoryNames();
      if (check.wouldFill === null) {
        // The refusal comes BEFORE the review, per the board.
        return { kind, review: null, body: null, error: tierRefusalSentence(symbol, price, check.openSlots ?? [], categoryNameOf), loading: false, warn: true };
      }
      // Rows follow their own rule: the budget rows iff budget_cap; the fill line iff the server named a slot.
      const before = budget != null && league.stake_mode === 'budget_cap' ? budget - spent : null;
      const review = buyReviewOneShare({
        symbol,
        price,
        budget: before != null ? { before, after: budgetAfterBuy(before, price) } : undefined,
        fills: check.wouldFill ? fillsSlotLine(check.wouldFill, categoryNameOf) : undefined,
      });
      return { kind, review, body: buyBody(league.id, symbol), error: null, loading: false };
    }
    return { kind, review: null, body: null, error: COPY.cantReach, loading: false };
  }

  // The sheet locks its dismiss paths only while a submit is in flight (reviewMachine.canDismiss).
  const busy = !canDismiss(trade.state);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // A review open when the market closes swaps to closed at once (the server's refusal wins a race).
  useEffect(() => {
    if (open && !gate.open && trade.state.kind !== 'done') trade.gateClosed(opensLabel);
    // `trade` is a fresh object each render; its methods are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gate.open, opensLabel]);

  // Try again: once the sheet's facts have re-loaded, rebuild the review from them.
  useEffect(() => {
    const fresh = data !== lastData.current;
    lastData.current = data;
    if (!open || trade.state.kind !== 'refreshing' || !fresh || data.status !== 'ready') return;
    let cancelled = false;
    (async () => {
      const next = await buildReview(open.kind);
      if (cancelled) return;
      setOpen(next);
      trade.refreshed();
    })();
    return () => {
      cancelled = true;
    };
    // buildReview reads the current data; the identity check above tracks it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, trade.state.kind]);

  if (data.status === 'loading') {
    return <Text variant="callout" tone="secondary">{symbol}</Text>;
  }
  if (data.status === 'error' || !data.facts) {
    return <LoadFailure title={COPY.stockLoadTitle} message={COPY.loadRetryMessage} onRetry={data.refresh} />;
  }

  async function openReview(kind: ReviewKind, pickedId: string | null = null) {
    trade.reset();
    setOpen({ kind, review: null, body: null, error: null, loading: true });
    const next = await buildReview(kind, pickedId);
    if (next.needsPicker && next.sources) {
      setOpen(null);
      setPicking({ sources: next.sources, chosen: defaultSourceId(next.sources) });
      return;
    }
    setOpen(next);
  }

  // "Pick another sale" (a proceeds refusal): re-read the sales, so the picker never offers a stale one.
  async function pickAnotherSale() {
    const leagueId = MONEY_FIXTURE_CONFIG ? FIXTURE_LEAGUE_ID : (activeLeague?.id ?? null);
    if (!leagueId) return;
    const preview = await fetchPreview(previewBody(leagueId));
    const sources = preview?.sources ?? [];
    if (sources.length === 0) {
      setOpen({ kind: 'buy', review: null, body: null, error: COPY.noProceeds, loading: false });
      return;
    }
    trade.reset();
    setOpen(null);
    setPicking({ sources, chosen: defaultSourceId(sources) });
  }

  async function submitNow() {
    if (!open?.body) return;
    const outcome = await trade.submit(open.body);
    if (outcome?.kind === 'ok') data.refresh();
  }

  // A refusal's next step. Pick another stock closes the sheet: the stock search is where it leads.
  function handleNextStep(step: NextStep) {
    if (step === 'back_to_picker') {
      void pickAnotherSale();
    } else if (step === 'pick_stock') {
      onDone();
    } else if (step === 'sell_first') {
      onDone();
      router.navigate('/portfolio');
    } else {
      onDone();
      router.replace('/login');
    }
  }

  function retryReview() {
    trade.retry();
    data.refresh();
  }

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

  if (picking) {
    return (
      <SalePicker
        sources={picking.sources}
        chosenId={picking.chosen}
        symbol={symbol}
        onChoose={(id) => setPicking({ ...picking, chosen: id })}
        onUse={() => {
          const id = picking.chosen;
          setPicking(null);
          void openReview('buy', id);
        }}
        onClose={() => setPicking(null)}
      />
    );
  }

  if (open) {
    if (open.loading) {
      return <Text variant="callout" tone="secondary">{COPY.preparingReview}</Text>;
    }
    if (open.review) {
      const doneTitle = open.kind === 'sell' ? `Sold ${symbol}` : `Bought ${symbol}`;
      const ownerName = data.facts?.owner?.kind === 'other' ? (data.facts.owner.name ?? undefined) : undefined;
      const presentation = reviewPresentation(trade.state, open.review, { title: doneTitle, symbol, resolve: categoryNameOf, ownerName });
      return (
        <TradeReviewPanel
          review={open.review}
          presentation={presentation}
          onSubmit={submitNow}
          onRetry={retryReview}
          onNextStep={handleNextStep}
          canEdit={!busy}
          onBack={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            onDone();
          }}
        />
      );
    }
    return (
      <View style={{ gap: 10 }}>
        {open.warn ? (
          <View style={{ borderRadius: 12, padding: 14, backgroundColor: colors.sunken }}>
            <Text variant="callout" accessibilityRole="alert">{open.error}</Text>
          </View>
        ) : (
          <Text variant="callout" tone="secondary" accessibilityRole="alert">{open.error ?? COPY.cantReach}</Text>
        )}
        <Pressable accessibilityRole="button" onPress={() => setOpen(null)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
          <Text variant="callout" tone="primary">Edit</Text>
        </Pressable>
      </View>
    );
  }

  const selected = choice ?? model.selected;
  const action = selected === 'buy' ? model.buy : model.sell;
  const canReview = selected === 'sell' ? model.sell.enabled : model.buy.enabled;

  return (
    <View accessibilityRole="summary" style={{ gap: 12, paddingHorizontal: 20, paddingBottom: 24 }}>
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

      {/* M2: the live chart, against the previous close. */}
      <StockChart symbol={symbol} price={data.price} prevClose={data.prevClose} live={gate.open} />

      <Text variant="callout" tone="secondary">
        {model.ownershipLine}
        {model.ownerBadge ? ` · ${model.ownerBadge}` : ''}
      </Text>

      {data.facts.held ? (
        <Text variant="callout">{formatShares(data.facts.held.quantity)} sh</Text>
      ) : null}

      <SegmentedControl
        options={[{ label: 'Buy', value: 'buy' }, { label: 'Sell', value: 'sell' }]}
        value={selected}
        onChange={(v) => setChoice(v as 'buy' | 'sell')}
      />

      {selected === 'sell' && model.sell.summary ? (
        <Text variant="callout">{model.sell.summary}</Text>
      ) : null}
      {action.reason ? (
        <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
          {action.reason}
        </Text>
      ) : null}
      {model.marketNote ? <Text variant="caption" tone="secondary">{model.marketNote}</Text> : null}

      {canReview && gate.open ? (
        <Button
          label={selected === 'sell' ? 'Review sell' : 'Review buy'}
          variant={selected === 'sell' ? 'destructive' : 'primary'}
          fullWidth
          onPress={() => openReview(selected)}
        />
      ) : null}

      <Text variant="caption" tone="secondary">{COPY.alpacaCredit}</Text>
    </View>
  );
}
