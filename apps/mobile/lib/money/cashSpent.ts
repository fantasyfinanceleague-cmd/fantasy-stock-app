/**
 * cashSpent: the client port of userCashSpent (supabase/functions/_shared/
 * draft-validation.ts), the budget_cap "cash spent" figure. Draft costs plus
 * buy costs minus sell proceeds, for one user. Parity is asserted against the
 * server's own function in tests-deno/server-parity.test.ts, so the budget a
 * review shows is the budget record-trade enforces.
 */
export interface CashPick {
  user_id: string;
  entry_price: number;
  quantity: number;
}

export interface CashTrade {
  user_id: string;
  action: string;
  price: number;
  quantity: number;
}

export function cashSpent(userId: string, picks: CashPick[], trades: CashTrade[]): number {
  let spent = 0;
  for (const p of picks) {
    if (String(p.user_id) !== userId) continue;
    spent += (Number(p.entry_price) || 0) * (Number(p.quantity) || 0);
  }
  for (const t of trades) {
    if (String(t.user_id) !== userId) continue;
    const cost = (Number(t.price) || 0) * (Number(t.quantity) || 0);
    spent += t.action === 'sell' ? -cost : cost;
  }
  return spent;
}
