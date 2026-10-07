/**
 * MoneyHost: owns the single stock sheet for the whole app (3e). Mounted once
 * in app/_layout.tsx, above the Stack, so the sheet can cover the tab bar and
 * any screen can open it with useStockSheet().open(symbol, originRef).
 */
import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Dimensions } from 'react-native';

import { Sheet, SHEET_HANDLE_AREA_HEIGHT } from '@/components/sp/Sheet';
import { StockSheetBody } from '@/components/money/StockSheetBody';
import { MagicMoveTile } from '@/components/money/MagicMoveTile';
import { normalizeOpenOptions, normalizeSymbol, type OpenOptions } from '@/lib/money/stockSheetApi';
import type { Rect } from '@/lib/motion/magicMove';

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
  // M1: the flying row->header tile, while one is in flight. fromRect is set at open() time
  // (measureInWindow, the opener's job); sheetHeight arrives once the risen sheet lays out.
  const [transition, setTransition] = useState<{ symbol: string; name: string | null; fromRect: Rect } | null>(null);
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);

  const open = useCallback((raw: string, options?: string | null | OpenOptions) => {
    const symbol = normalizeSymbol(raw);
    if (!symbol) return; // a bad ticker never opens an empty sheet
    const o = normalizeOpenOptions(options);
    setCurrent({ symbol, originRef: o.originRef, name: o.name });
    setSheetHeight(null);
    setTransition(o.originRect ? { symbol, name: o.name, fromRect: o.originRect } : null);
  }, []);

  const close = useCallback(() => {
    setCurrent(null);
    setBusy(false);
    setTransition(null);
    setSheetHeight(null);
  }, []);

  // The header's resting rect: the sheet's own top edge (screenHeight - its rendered
  // height) plus the constant handle-area offset every sheet's content starts below.
  // x/width reuse the row's own (the header's ticker label is roughly the same width);
  // only y genuinely needs to travel, which is the move's dominant, visible part.
  const headerRect: Rect | null = transition && sheetHeight != null
    ? {
      x: transition.fromRect.x,
      width: transition.fromRect.width,
      y: Dimensions.get('window').height - sheetHeight + SHEET_HANDLE_AREA_HEIGHT,
      height: transition.fromRect.height,
    }
    : null;

  const value = useMemo<StockSheetContextValue>(
    () => ({ symbol: current?.symbol ?? null, originRef: current?.originRef ?? null, open, close }),
    [current, open, close],
  );

  return (
    <StockSheetContext.Provider value={value}>
      {children}
      <Sheet
        visible={current !== null}
        onClose={close}
        dismissible={!busy}
        onSheetLayout={transition ? setSheetHeight : undefined}
        overlay={transition ? (
          <MagicMoveTile
            symbol={transition.symbol}
            name={transition.name}
            fromRect={transition.fromRect}
            toRect={headerRect}
            onArrived={() => setTransition(null)}
          />
        ) : null}
      >
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
