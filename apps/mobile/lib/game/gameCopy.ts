/**
 * gameCopy: every string on the 3c game screens (Matchup, League, the draft
 * room, Run it back). Each entry carries its SOURCE so the copy audit can
 * check it (spec: "Keep existing strings and Giorgio's copy verbatim"):
 *   board     = the key-screens board's wording (docs/design/screens)
 *   existing  = a string the app already ships
 *   giorgio   = approved by Giorgio, verbatim
 *   new       = a proposal, flagged for Giorgio's copy audit
 */

/** One tag per COPY key (the test enforces it). Template helpers below are
 * tagged where they are defined. */
export const COPY_SOURCES = {
  scoringLabel: 'existing',
  preSeasonChyron: 'board',
  endsFriday: 'board',
  byeNoResult: 'new',
} as const;

const MINUS = '−';

/** "+1.76%" / "−0.32%": sign first, U+2212 minus. Two decimals by default
 * (the tiebreak); the chyron passes 1, as the board's "+2.9%" does. */
export function signedPct(pct: number, decimals = 2): string {
  const factor = 10 ** decimals;
  const r = Math.round(pct * factor) / factor;
  const zero = (0).toFixed(decimals);
  if (r > 0) return `+${r.toFixed(decimals)}%`;
  if (r < 0) return `${MINUS}${Math.abs(r).toFixed(decimals)}%`;
  return `${zero}%`;
}

/** "Tiebreak +1.76% vs +0.74%" (board, Matchup live). */
export function tiebreakLine(myPct: number, oppPct: number): string {
  return `Tiebreak ${signedPct(myPct)} vs ${signedPct(oppPct)}`;
}

/** "Roberto B. leads by $123.16" (board). The dollars are the lead's absolute gap. */
export function leadLine(leaderName: string, dollars: number): string {
  const magnitude = Math.abs(dollars).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${leaderName} leads by $${magnitude}`;
}

/**
 * The lead-change chyron (G2): names the stock that just moved the game.
 * The "{T} {±x%} puts {name} ahead" grammar is derived from the board's
 * chyron example ("NVDA +2.9% puts Roberto B. ahead"), so it is NEW copy.
 * Without a day move we say no percentage rather than invent one.
 */
export function leadChangeChyron(args: { symbol: string; dayPct: number | null; leaderName: string }): string {
  const move = args.dayPct === null ? '' : ` ${signedPct(args.dayPct, 1)}`;
  return `${args.symbol}${move} puts ${args.leaderName} ahead`;
}

export const COPY = {
  scoringLabel: 'Scoring…',
  preSeasonChyron: (startLabel: string) => `Week 1 starts ${startLabel}. No leader until the market opens.`,
  endsFriday: 'Ends Fri 4:00 PM ET',
  byeNoResult: 'Bye week · no result',
} as const;
