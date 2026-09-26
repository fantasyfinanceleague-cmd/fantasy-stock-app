/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { createContext, useContext, useMemo } from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';

import { color } from '@/constants/tokens';

// Stockpile — <Surface> (Phase 2 foundation).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9.
//
// The mechanism that keeps money and game registers from mixing (§1, "the
// token system encodes it as two surface sets... so a worker can't mix them
// by accident"): every <Text> / <Money> reads its surface kind from this
// context to pick color.text.* vs color.text.onGame.*, and
// color.data.gain/loss.base vs .onGame, WITHOUT the caller passing a color
// prop. There is no way to render on-light text on a stadium background
// without explicitly overriding the context.

export type SurfaceKind = 'money' | 'game';
export type MoneySurfaceLevel = 'base' | 'sunken';
export type GameSurfaceLevel = 'base' | 'raised';
export type SurfaceLevel = MoneySurfaceLevel | GameSurfaceLevel;

export interface SurfaceContextValue {
  kind: SurfaceKind;
}

const SurfaceContext = createContext<SurfaceContextValue>({ kind: 'money' });

/** Reads the nearest ancestor <Surface>'s kind. Defaults to 'money' outside any <Surface>. */
export function useSurface(): SurfaceContextValue {
  return useContext(SurfaceContext);
}

export interface SurfaceProps extends ViewProps {
  kind: SurfaceKind;
  /** Defaults to 'base'. Money: base | sunken. Game: base | raised. */
  level?: SurfaceLevel;
  /** Render as a flat container with no background (context only, e.g. wrapping a ScrollView). */
  transparent?: boolean;
}

function backgroundFor(kind: SurfaceKind, level: SurfaceLevel): string {
  if (kind === 'money') {
    return level === 'sunken' ? color.surface.money.sunken : color.surface.money.base;
  }
  return level === 'raised' ? color.surface.game.raised : color.surface.game.base;
}

export function Surface({ kind, level = 'base', transparent = false, style, children, ...rest }: SurfaceProps) {
  const contextValue = useMemo<SurfaceContextValue>(() => ({ kind }), [kind]);
  const backgroundColor = transparent ? undefined : backgroundFor(kind, level);

  return (
    <SurfaceContext.Provider value={contextValue}>
      <View style={[styles.base, backgroundColor ? { backgroundColor } : null, style]} {...rest}>
        {children}
      </View>
    </SurfaceContext.Provider>
  );
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
  },
});
