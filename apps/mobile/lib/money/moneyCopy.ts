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
  eachSaleStaysInItsSlot: "Each sale's cash stays in its own slot. Pick one; the buy uses all of it.",
  sellAllPrefix: 'Sell all',
  aSlotHoldsOneStock: 'A slot holds one stock, so you sell the whole position. The cash stays in this slot to reinvest.',
  slotCashReady: 'stays in this slot, ready to invest in any stock. It doesn\'t earn until you buy.',
  // Budget / tier leagues (D4 ruled A, Giorgio): the sale's cash stays in the
  // budget, shown as its own line and counted in the header.
  portfolioValueIncludesCash: 'Portfolio value · includes cash',
  cashFromSales: 'Cash from sales',
  // D3 (PENDING Giorgio's A/B): an unfilled draft slot is never "Skipped". The
  // clock auto-drafts, so a slot is unfilled only when auto-pick found no legal
  // stock. Flagged until the A/B ruling.
  unfilledDraftSlot: 'Unfilled draft slot',
  // NEW (flagged): trading-hours copy.
  tradingHoursUnavailable: 'Trading hours unavailable. Try again shortly.',
  marketHoliday: "It's a market holiday.",
  marketClosedNow: 'Trading is closed right now.',
  // NEW (flagged): ownership and eligibility.
  ownedBy: (name: string) => `Owned by ${name}`,
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
  nothingTraded: 'Something went wrong. Nothing was traded.',
  cantReach: "Couldn't reach trading. Check your connection and try again.",
  // NEW (flagged): market-data credit, one constant (wording to confirm with the provider's terms).
  alpacaCredit: 'Market data provided by Alpaca',
  // Board pattern, verbatim: "Trading opens Mon 9:30 AM ET."
  tradingOpens: (when: string) => `Trading opens ${when}.`,
};
