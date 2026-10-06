/**
 * The test_0925 sale, shared by every 3e test that needs it. Nothing here is a
 * typed dollar figure: the proceeds are DERIVED from the sold quantity and the
 * price, the way the server stores them (price x quantity, rounded to cents).
 * The spec's "$971.92" came from rounding the shares to 2.9165 first; the real
 * trade test checks against the stored trades row, never against a figure
 * typed here.
 */
import { fixedNotionalShares } from '../../lib/money/buyQuantity.ts';

/** JPM sold whole in test_0925. */
export const JPM_QTY = 2.916472;
export const JPM_PRICE = 333.25;
/** 2.916472 x 333.25, to cents: 971.91. */
export const JPM_PROCEEDS = Math.round(JPM_QTY * JPM_PRICE * 100) / 100;

/** The buy that reinvests JPM's proceeds into VIST. */
export const VIST_PRICE = 66.42;
export const VIST_BUY = fixedNotionalShares(JPM_PROCEEDS, VIST_PRICE);
