/**
 * MoneyHost: owns the single stock sheet for the whole app (3e). Mounted once
 * in app/_layout.tsx, above the Stack, so the sheet can cover the tab bar and
 * any screen can open it with useStockSheet().open(symbol, originRef).
 */
import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { Sheet } from '@/components/sp/Sheet';
import { StockSheetBody } from '@/components/money/StockSheetBody';
import { normalizeOpenOptions, normalizeSymbol, type OpenOptions } from '@/lib/money/stockSheetApi';

export interface StockSheetContextValue {
  /** The symbol the sheet is showing, or null when it is closed. */
  symbol: string | null;
  /** Where the sheet was opened from (a row id), so the caller can restore focus. */
  originRef: string | null;
  /** open(symbol, options?) — the legacy origin-ref string is still accepted (3c compatibility). */
  open: (symbol: string, options?: string | null | OpenOptions) => void;
  close: () => void;
}

const StockSheetContext = createContext<StockSheetContextValue | undefined>(undefined);

export function MoneyHostProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ symbol: string; originRef: string | null; name: string | null } | null>(null);
  // True while a trade submit is in flight: the sheet can't be dismissed then (the outcome must land).
  const [busy, setBusy] = useState(false);

  const open = useCallback((raw: string, options?: string | null | OpenOptions) => {
    const symbol = normalizeSymbol(raw);
    if (!symbol) return; // a bad ticker never opens an empty sheet
    const o = normalizeOpenOptions(options);
    setCurrent({ symbol, originRef: o.originRef, name: o.name });
  }, []);

  const close = useCallback(() => {
    setCurrent(null);
    setBusy(false);
  }, []);

  const value = useMemo<StockSheetContextValue>(
    () => ({ symbol: current?.symbol ?? null, originRef: current?.originRef ?? null, open, close }),
    [current, open, close],
  );

  return (
    <StockSheetContext.Provider value={value}>
      {children}
      <Sheet visible={current !== null} onClose={close} dismissible={!busy}>
        {current ? <StockSheetBody symbol={current.symbol} knownName={current.name} onDone={close} onBusyChange={setBusy} /> : null}
      </Sheet>
    </StockSheetContext.Provider>
  );
}

export function useStockSheet(): StockSheetContextValue {
  const ctx = useContext(StockSheetContext);
  if (!ctx) throw new Error('useStockSheet must be used within a MoneyHostProvider');
  return ctx;
}
