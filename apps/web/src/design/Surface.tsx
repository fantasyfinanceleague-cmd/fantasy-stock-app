import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';

// DESIGN_DIRECTION.md §2: "Surface (kind: 'money' | 'game'), providing
// context so children pick on-light / on-game colours automatically. This
// is the mechanism that keeps the two registers from mixing." Text and
// Money read this context via useSurfaceKind() rather than taking a colour
// prop, so a component dropped into the wrong register can't silently pick
// the wrong palette.

export type SurfaceKind = 'money' | 'game';
export type SurfaceLevel = 'base' | 'raised' | 'sunken';

const SurfaceContext = createContext<SurfaceKind>('money');

/** Which register (money or game) the calling component is rendered in. */
export function useSurfaceKind(): SurfaceKind {
  return useContext(SurfaceContext);
}

export interface SurfaceProps {
  kind: SurfaceKind;
  /** 'raised' (game only) / 'sunken' (money only) pick the elevated tier
   * within that register; 'base' is the default for both. */
  level?: SurfaceLevel;
  /** Money-only card elevation (border + soft shadow). Game surfaces are
   * always flat per DESIGN_DIRECTION §9 — this prop is a no-op there. */
  elevated?: boolean;
  as?: 'div' | 'section' | 'article' | 'header' | 'footer';
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function backgroundVar(kind: SurfaceKind, level: SurfaceLevel): string {
  if (kind === 'game') {
    return level === 'raised' ? 'var(--sp-color-surface-game-raised)' : 'var(--sp-color-surface-game-base)';
  }
  return level === 'sunken' ? 'var(--sp-color-surface-money-sunken)' : 'var(--sp-color-surface-money-base)';
}

export function Surface({
  kind,
  level = 'base',
  elevated = false,
  as = 'div',
  className,
  style,
  children,
}: SurfaceProps) {
  const Component = as;
  const isElevatedMoneyCard = kind === 'money' && elevated;

  const surfaceStyle: CSSProperties = {
    backgroundColor: backgroundVar(kind, level),
    boxShadow: isElevatedMoneyCard ? 'var(--sp-elevation-money-card)' : 'none',
    border: isElevatedMoneyCard ? '1px solid var(--sp-color-border-default)' : 'none',
    ...style,
  };

  return (
    <SurfaceContext.Provider value={kind}>
      <Component
        className={['sp-surface', `sp-surface--${kind}`, className].filter(Boolean).join(' ')}
        style={surfaceStyle}
      >
        {children}
      </Component>
    </SurfaceContext.Provider>
  );
}

export default Surface;
