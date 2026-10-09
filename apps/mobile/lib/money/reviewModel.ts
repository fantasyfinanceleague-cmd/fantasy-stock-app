/**
 * reviewModel: the lines, headline and button of a trade review (3e), as pure
 * data. The Review screen is the confirmation (Design Lead ruling (b)): it
 * states the whole outcome before the one primary button, which names the
 * action ("Sell TSLA" / "Buy SHOP", never "Confirm" or "OK").
 *
 * Dollars come from the same arithmetic the server stores (price times
 * quantity, rounded to cents), and shares carry "≈" on a buy, because the
 * fill price can move before the order fills.
 */
import { formatMoney } from '../../components/sp/logic/money';
import { formatShares } from './formatShares';
import { COPY } from './moneyCopy';

export interface ReviewLine {
  label: string;
  value: string;
  tone?: 'zero' | 'gain' | 'loss';
}

export interface TradeReview {
  title: string;
  headline: string | null;
  lines: ReviewLine[];
  /** The card under the lines (the cash that stays in the slot), or null. */
  card: string | null;
  /** The caption above the button: every review says prices can move (board). */
  caption: string;
  buttonLabel: string;
  buttonRole: 'sell' | 'buy';
}

const cents = (v: number) => Math.round(v * 100) / 100;
const toneOf = (v: number): ReviewLine['tone'] => (Math.abs(v) < 0.005 ? 'zero' : v > 0 ? 'gain' : 'loss');

/** A sell is always the whole position: there is no quantity to choose. */
export function sellReview(i: {
  symbol: string;
  quantity: number;
  price: number;
  /** Per-slot leagues: the slot's full stake, to compare the sale against. */
  slotNotional?: number;
  /** Budget/tier leagues: the budget before and after the sale. */
  budget?: { before: number; after: number };
}): TradeReview {
  const proceeds = cents(i.quantity * i.price);
  const common: ReviewLine[] = [];
  if (i.budget) {
    common.push({ label: 'Sell', value: `${formatShares(i.quantity)} ${i.symbol} · ${COPY.allYouHold}` });
    common.push({ label: 'Price', value: `${formatMoney(i.price)} · ${COPY.marketPrice}` });
    common.push({ label: COPY.backToBudget, value: formatMoney(proceeds) });
    common.push({ label: COPY.budgetLeftAfter, value: formatMoney(i.budget.after) });
    return {
      title: COPY.reviewSell,
      headline: null,
      lines: common,
      card: null,
      caption: COPY.pricesCanMove,
      buttonLabel: COPY.sellButton(i.symbol),
      buttonRole: 'sell',
    };
  }

  const realized = cents(proceeds - (i.slotNotional ?? 0));
  const lines: ReviewLine[] = [
    { label: 'Sell', value: `${formatShares(i.quantity)} ${i.symbol}` },
    { label: 'Price', value: `${formatMoney(i.price)} · ${COPY.marketPrice}` },
    { label: COPY.youGet, value: formatMoney(proceeds) },
  ];
  if (i.slotNotional != null) {
    lines.push({
      label: COPY.vsSlotStart(formatMoney(i.slotNotional)),
      value: formatMoney(realized, { sign: 'always' }),
      tone: toneOf(realized),
    });
  }
  return {
    title: COPY.reviewSell,
    headline: null,
    lines,
    card: `${formatMoney(proceeds)} ${COPY.slotCashStays}`,
    caption: COPY.pricesCanMove,
    buttonLabel: COPY.sellButton(i.symbol),
    buttonRole: 'sell',
  };
}

/** A per-slot buy: the quantity is the server's, sized from the source. */
export function buyReviewPerSlot(i: {
  symbol: string;
  amount: number;
  price: number;
  quantity: number;
  sourceLabel: string;
  leftInSlot: number;
}): TradeReview {
  return {
    title: COPY.reviewBuy,
    headline: COPY.buyOutcome(formatMoney(i.amount), i.symbol),
    lines: [
      { label: 'Buy', value: `≈ ${formatShares(i.quantity)} ${i.symbol}` },
      { label: 'Price', value: `${formatMoney(i.price)} · ${COPY.marketPrice}` },
      { label: COPY.paidFrom, value: `${i.sourceLabel} · ${formatMoney(i.amount)}` },
      { label: COPY.leftInSlot, value: formatMoney(i.leftInSlot), tone: toneOf(i.leftInSlot) },
    ],
    card: null,
    caption: COPY.pricesCanMove,
    buttonLabel: COPY.buyButton(i.symbol),
    buttonRole: 'buy',
  };
}

/** A one-share buy in a budget or tier league. */
export function buyReviewOneShare(i: {
  symbol: string;
  price: number;
  /** Rows iff the league is budget_cap: the server keeps a budget only there. */
  budget?: { before: number; after: number };
  /** The line iff the server named the slot the buy fills ("Fills your $100–$200 slot"). */
  fills?: string;
}): TradeReview {
  const lines: ReviewLine[] = [
    { label: 'Buy', value: `1 ${i.symbol}` },
    { label: 'Price', value: `${formatMoney(i.price)} · ${COPY.marketPrice}` },
  ];
  if (i.budget) {
    lines.push({ label: COPY.budgetNow, value: formatMoney(i.budget.before) });
    lines.push({ label: COPY.budgetLeftAfter, value: formatMoney(i.budget.after) });
  }
  return {
    title: COPY.reviewBuy,
    headline: null,
    lines,
    card: i.fills ?? null,
    caption: COPY.pricesCanMove,
    buttonLabel: COPY.buyButton(i.symbol),
    buttonRole: 'buy',
  };
}

/**
 * A one-share buy in a tier league. The server decided the slot (the preview's
 * would_fill); the review only states it. No budget rows: a tier league has no
 * budget, only the slot the stock fills.
 */
export function buyReviewTier(i: { symbol: string; price: number; fills: string }): TradeReview {
  return buyReviewOneShare({ symbol: i.symbol, price: Math.round(i.price * 100) / 100, fills: i.fills });
}
