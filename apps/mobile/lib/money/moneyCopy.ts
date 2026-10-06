/**
 * moneyCopy: every string the 3e money screens show, in one module (3e
 * brief). Strings marked NEW are off-board copy: the Design Lead flags them
 * for Giorgio, and nothing here is polished past the brief until he rules.
 * Board strings are verbatim.
 */
export const COPY = {
  // Board, Trading (3e), verbatim.
  marketClosedTitle: 'Market closed',
  pricesShowLastClose: "Prices show Friday's close.",
  pricesCanMove: 'Prices can move before the order fills.',
  proceedsUnavailable: "That sale's cash isn't available anymore. Pick another.",
  noProceeds: "There's no cash in your slots to invest.",
  whichSalePays: 'Which sale pays for this?',
  pickerCaption: "Each sale's cash stays in its own slot. Pick one; the buy uses all of it.",
  // NEW copy (Design Lead): the way out of a proceeds refusal, and the picker's commit.
  pickAnotherSale: 'Pick another sale',
  useSaleButton: (symbol: string) => `Use the ${symbol} sale`,
  eachSaleStaysInItsSlot: "Each sale's cash stays in its own slot. Pick one; the buy uses all of it.",
  sellAllPrefix: 'Sell all',
  aSlotHoldsOneStock: 'A slot holds one stock, so you sell the whole position. The cash stays in this slot to reinvest.',
  slotCashReady: 'stays in this slot, ready to invest in any stock. It doesn\'t earn until you buy.',
  // Budget / tier leagues (D4 ruled A, Giorgio): the sale's cash stays in the
  // budget, shown as its own line and counted in the header.
  portfolioValueIncludesCash: 'Portfolio value · includes cash',
  cashFromSales: 'Cash from sales',
  // D3 closed (Giorgio): a draft pick can never be unused. There is no
  // unfilled-slot copy; legacy SKIP rows render nothing.
  // NEW (flagged, PLACEHOLDER for the Design Lead): the submit may or may not have
  // been recorded. No retry: a blind retry could double-buy.
  unconfirmed: "We couldn't confirm the trade. Check your history before trying again.",
  // NEW (flagged): trading-hours copy.
  tradingHoursUnavailable: 'Trading hours unavailable. Try again shortly.',
  marketHoliday: "It's a market holiday.",
  marketClosedNow: 'Trading is closed right now.',
  // NEW (flagged): ownership and eligibility.
  ownedBy: (name: string) => `Owned by ${name}`,
  // NEW copy (Design Lead): the next step on a refusal, and the session ending.
  pickAnotherStock: 'Pick another stock',
  sellHoldingFirst: 'Sell a holding first',
  sessionEnded: 'Your session ended. Sign in again.',
  signIn: 'Sign in',
  notHeld: "You don't hold this stock.",
  overBudget: "That's more than your budget left.",
  noEligibleSlot: "This price doesn't fit an open slot.",
  rosterFull: 'Your roster is full. Sell a holding first.',
  notDraftable: "This stock isn't in this league's list.",
  noPrice: "We can't price this stock right now. Try again shortly.",
  rateLimited: 'Too many trades in a row. Wait a moment and try again.',
  draftNotCompleted: 'Trading opens after the draft.',
  notAMember: "You're not in this league.",
  invalidPrice: "That price isn't valid right now. Try again.",
  // An unknown game refusal (HTTP 200) never wrote, but it says only what it knows.
  tradeDidNotGoThrough: "That trade didn't go through.",
  // Approved by the Design Lead (via the Orchestrator). Shown only for trade_conflict,
  // which the backend returns only when nothing was written. Never for a 500 or network error.
  tradeConflict: 'Nothing was traded: your league changed while this trade was going through. Try again.',
  tryAgain: 'Try again',
  // The submit-in-flight label (Design Lead, NEW copy): names the work, never the resting label.
  sellingProgress: 'Selling…',
  buyingProgress: 'Buying…',
  // NEW (flagged): a LOAD failure. The alert icon arrives with the Design Lead's ruling.
  // NEW (flagged): shown while a review's numbers are being fetched.
  preparingReview: 'Preparing your review',
  // Trade history (board copy: "Bought SHOP", "Sold TSLA", "Drafted TSLA").
  tradeBought: (symbol: string) => `Bought ${symbol}`,
  tradeSold: (symbol: string) => `Sold ${symbol}`,
  tradeDrafted: (symbol: string) => `Drafted ${symbol}`,
  historyFilters: ['All', 'Buys', 'Sells', 'Draft'] as const,
  // NEW (flagged): an honest empty state.
  historyEmpty: 'No trades yet. Your buys, sells and draft picks will show here.',
  historyPending: 'Your trade history is loading.',
  // Tier trades (the Design Lead's final rulings).
  everySlotFull: 'Every slot is full. Sell a stock first to open its slot.',
  fillsOpenSlotFallback: 'Fills your open slot',
  portfolioLoadTitle: "Your portfolio didn't load",
  stockLoadTitle: "This stock didn't load",
  loadRetryMessage: 'Check your connection, then try again.',
  cantReach: "Couldn't reach trading. Check your connection and try again.",
  // NEW (flagged): market-data credit, one constant (wording to confirm with the provider's terms).
  alpacaCredit: 'Market data provided by Alpaca',
  // Board stock sheet, verbatim: ownership and the sell summary.
  draftedByYou: (round: number, pick: number) => `Drafted by you · Round ${round}, pick ${pick}`,
  noOneOwns: (league: string, symbol: string) => `No one in ${league} owns ${symbol}`,
  sellAll: (qty: string, value: string) => `Sell all ${qty} sh ≈ ${value}`,
  pricesShowClose: (label: string) => `Prices show ${label}.`,
  // NEW (flagged): ownership states the board doesn't draw.
  heldByYou: 'Held by you',
  alreadyHeld: 'You already hold this stock.',
  // Review screens (board, verbatim where the board has the words).
  reviewSell: 'Review sell',
  reviewBuy: 'Review buy',
  marketPrice: 'market',
  youGet: 'You get',
  vsSlotStart: (start: string) => `Vs. the slot's ${start}`,
  slotCashStays: "stays in this slot, ready to invest in any stock. It doesn't earn until you buy.",
  paidFrom: 'Paid from',
  leftInSlot: 'Left in the slot',
  buyOutcome: (amount: string, symbol: string) => `Buy ${amount} of ${symbol}`,
  sellButton: (symbol: string) => `Sell ${symbol}`,
  buyButton: (symbol: string) => `Buy ${symbol}`,
  allYouHold: 'all you hold',
  backToBudget: 'Back to your budget',
  budgetNow: 'Budget now',
  budgetLeftAfter: 'Budget left after',
  // Portfolio (board, verbatim).
  sinceTheDraft: 'since the draft',
  slotsInvested: (n: number, total: number) => `${n} of ${total} slots invested`,
  perSlotAtDraft: (amount: string) => `${amount} per slot at the draft`,
  holdingsHeading: 'Holdings',
  tradeHistory: 'Trade history',
  includesDraftPicks: 'Includes your draft picks',
  // Board pattern, verbatim: "Trading opens Mon 9:30 AM ET."
  tradingOpens: (when: string) => `Trading opens ${when}.`,
};
