# DR-001: Move simulated trading fully in-house

**Status:** Accepted
**Date:** 2026-08-08
**Owner:** Giorgio (commissioner of prod)
**Supersedes:** Alpaca account-linking as the portfolio source for gameplay

---

## Decision

Stockpile's simulated trading becomes fully in-house. Users never create, link, or authenticate against any brokerage account. Alpaca remains in the stack **solely as a server-side market data vendor** behind the existing symbols/quotes pipeline, using Stockpile's own single API key.

Broker integration for real-money leagues (Alpaca OAuth Connect or SnapTrade) is **deferred post-launch**, gated on demonstrated user demand.

## Context

The current flow requires users to open an Alpaca brokerage account (full KYC) and paste API keys into Stockpile. This has three problems:

1. **Onboarding cliff.** Requiring a brokerage account + SSN to join a friend's fantasy league with fake money is a conversion killer. Fantasy football does not require an NFL contract.
2. **Credential custody.** Storing users' broker keys makes Stockpile a high-value target and is the root cause of most of the recent security-hardening workload (vault storage, `get-broker-keys` retirement, RLS work around linked-account state).
3. **Wrong integration pattern anyway.** If/when real accounts are supported, the correct patterns are OAuth (Alpaca Connect) or an aggregator (SnapTrade) — never key copy-paste.

## What we evaluated

| Option | Verdict |
|---|---|
| Manual API keys (current) | Remove. Prototype-only pattern; custody liability + friction. |
| Alpaca OAuth Connect | Deferred. Correct direct-broker pattern; requires app registration + Alpaca compliance approval for live trading; limits users to Alpaca accounts. Paper env supported via `env=paper`. |
| SnapTrade | Deferred. Broker-agnostic adapter (~20+ brokerages incl. Robinhood/Fidelity/Schwab); users connect accounts they already have; read + trade-if-available; near-real-time data. Paid, usage-based; connections expire (~weeks) and need reauth flows. Likely the better fit for mixed-broker friend leagues if real-money leagues ship. |
| In-house simulator | **Accepted.** Zero external accounts, zero credential custody, zero approval processes. Roster-based design means minimal order-simulation logic. |

## Consequences

- The Alpaca account-linking flow is removed from mobile and web (see migration spec).
- The vault holds only Stockpile's own data-vendor key. The user-broker-credential attack surface is retired entirely.
- Market data continues to flow through the existing server-side pipeline (free/IEX tier is adequate for display; official closes are SIP-accurate for scoring; a paid SIP upgrade is a config change, not a code change).
- Positions originate from Stockpile's own ledger; the scoring/snapshot pipeline is unchanged in structure — only its position source changes.
- Real-money leagues become a post-launch phase. Revisit criteria: sustained user requests for real-money play, and evidence of which brokerages users actually hold (determines Alpaca-direct vs SnapTrade).

## Game design decisions (final)

Commissioner-configurable per league (extends existing settings: roster size, draft rounds, season format):

- **Season formats (existing, unchanged):** *Weekly matchups* (Mon-open → Fri-close snapshots, dollar-delta head-to-head, W/L records, playoffs) and *Duration* (single long window, best total dollar return).
- **Stake modes (new):**
  1. **Fixed notional** — every drafted slot represents the same simulated stake (default $1,000/slot, commissioner-set). Fractional shares. Price-neutral.
  2. **Price tiers** — one share per pick; roster slots bracketed by share-price ranges (commissioner-defined). Price skew handled by bracketing.
  3. **Budget cap** — one share per pick; sum of roster share prices must fit under the league budget. Price skew handled by the cap.
  - Plain unconstrained one-share mode is **cut**: with dollar-delta scoring it makes share price ≈ exposure, and the dominant strategy degenerates to "draft the most expensive shares." Every shipped mode carries an anti-skew mechanism.
- **Scoring:** dollar delta between snapshots in **every** mode. Matchups, standings, playoffs, and both season formats remain mode-blind.
- **Draft constraint system:** league draft rules = a list of slots; each slot = count + optional price bracket + optional category filter; a flex/misc slot has no filter. Price tiers and sector requirements are both instances of this one mechanism. League-exclusive picks via the existing snake draft are unchanged.
- **Categories:** ~10 Stockpile-curated, player-intuitive categories layered over vendor GICS data. Three-layer assignment: rule table (GICS industry → category, automatic, total coverage), override table (curated exceptions with justifications), Misc fallback. Multi-category eligibility capped at 3 per symbol, granted only under the written criterion (distinct segment ≥ ~1/3 of revenue, or the famous-for-it test). Unclassified new listings (IPOs) are flex-slot-only until classified by the daily refresh.
- **Draftable universe:** default-on eligibility filter (market-cap / price / exchange floor) excluding penny stocks and junk listings; commissioner-overridable.
- **Corporate actions:** splits occurring mid-scoring-period are handled by quantity adjustment so exposure is continuous. Weekly re-baseline makes between-week splits a non-event; duration mode relies on the adjustment more.

## Non-goals (this phase)

- Real-money trading, broker OAuth, SnapTrade integration
- Custom per-league categories beyond the built-in set
- Order-book realism (limit orders, slippage, after-hours fills)
