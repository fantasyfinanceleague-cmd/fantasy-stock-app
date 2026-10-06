/**
 * MoneyHost: owns the single stock sheet for the whole app (3e). Mounted once
 * in app/_layout.tsx, above the Stack, so the sheet can cover the tab bar and
 * any screen can open it with useStockSheet().open(symbol, originRef).
 */
import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { Sheet } from '@/components/sp/Sheet';
import { StockSheetBody } from '@/components/money/StockSheetBody';
import { normalizeSymbol } from '@/lib/money/stockSheetApi';

export interface StockSheetContextValue {
  /** The symbol the sheet is showing, or null when it is closed. */
  symbol: string | null;
  /** Where the sheet was opened from (a row id), so the caller can restore focus. */
  originRef: string | null;
  open: (symbol: string, originRef?: string | null) => void;
  close: () => void;
}

const StockSheetContext = createContext<StockSheetContextValue | undefined>(undefined);

export function MoneyHostProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ symbol: string; originRef: string | null } | null>(null);

  const open = useCallback((raw: string, originRef: string | null = null) => {
    const symbol = normalizeSymbol(raw);
    if (!symbol) return; // a bad ticker never opens an empty sheet
    setCurrent({ symbol, originRef });
  }, []);

  const close = useCallback(() => setCurrent(null), []);

  const value = useMemo<StockSheetContextValue>(
    () => ({ symbol: current?.symbol ?? null, originRef: current?.originRef ?? null, open, close }),
    [current, open, close],
  );

  return (
    <StockSheetContext.Provider value={value}>
      {children}
      <Sheet visible={current !== null} onClose={close}>
        {current ? <StockSheetBody symbol={current.symbol} /> : null}
      </Sheet>
    </StockSheetContext.Provider>
  );
}

export function useStockSheet(): StockSheetContextValue {
  const ctx = useContext(StockSheetContext);
  if (!ctx) throw new Error('useStockSheet must be used within a MoneyHostProvider');
  return ctx;
}
