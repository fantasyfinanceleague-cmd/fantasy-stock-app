import type { CSSProperties, ElementType } from 'react';
import { Text, type TextVariant } from './Text';
import { useSurfaceKind } from './Surface';
import { formatMoney, roundToCents, type MoneyOptions } from './lib/money';

// DESIGN_DIRECTION.md §2/§9: money always uses tabular-nums and never
// wraps; zero is neutral, not green; the minus sign precedes the currency
// (U+2212). The formatting rule itself lives in lib/money.ts (byte-for-byte
// matched with mobile) — this component is the styled, surface-aware,
// sign-coloured wrapper screens actually render.

export interface MoneyProps extends MoneyOptions {
  value: number;
  /** Text variant to render at. Default 'body'. */
  size?: TextVariant;
  /** Colour by gain/loss/zero (default true). False renders in the
   * surface's normal text colour instead — e.g. a neutral "cost basis"
   * figure that shouldn't read as a gain or a loss. */
  colorBySign?: boolean;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}

export function Money({
  value,
  size = 'body',
  sign,
  alignSign,
  compact,
  colorBySign = true,
  as,
  className,
  style,
}: MoneyProps) {
  const surfaceKind = useSurfaceKind();
  const onGame = surfaceKind === 'game';
  const formatted = formatMoney(value, { sign, alignSign, compact });
  const isZero = roundToCents(value) === 0;

  let colorOverride: string | undefined;
  if (colorBySign) {
    if (isZero) {
      colorOverride = onGame ? 'var(--sp-color-data-zero-on-game)' : 'var(--sp-color-data-zero-base)';
    } else if (value < 0) {
      colorOverride = onGame ? 'var(--sp-color-data-loss-on-game)' : 'var(--sp-color-data-loss-base)';
    } else {
      colorOverride = onGame ? 'var(--sp-color-data-gain-on-game)' : 'var(--sp-color-data-gain-base)';
    }
  }

  return (
    <Text
      variant={size}
      as={as}
      nowrap
      className={['sp-money', className].filter(Boolean).join(' ')}
      style={{
        fontVariantNumeric: 'tabular-nums',
        ...(colorOverride ? { color: colorOverride } : {}),
        ...style,
      }}
    >
      {formatted}
    </Text>
  );
}

export default Money;
