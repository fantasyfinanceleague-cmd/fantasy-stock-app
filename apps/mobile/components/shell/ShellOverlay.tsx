/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { createContext, ReactNode, RefObject, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { SharedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { router } from 'expo-router';

import { useLeagueContext } from '@/lib/LeagueContext';
import { useMotion } from '@/components/sp/motion';
import { LeagueSheet } from '@/components/shell/LeagueSheet';
import { FlyingLabel, type Frame } from '@/components/shell/FlyingLabel';

// Phase 3b-1 — the root overlay layer (spec row 9 + signature moment S3).
//
// Why not an RN <Modal> (which sp/Sheet uses): a Modal is a separate native
// window, so anything the app animates at the root renders UNDER it. S3
// flies the picked league's name from its sheet row into the header pill as
// the sheet closes; the row and the flying label have to share a layer. So
// the league sheet is drawn here, in an absolute layer above the root Stack
// (app/_layout.tsx), with the FlyingLabel beside it.
//
// The flight: measure the row label and the visible pill label in window
// coordinates; hide the pill label; switch the active league underneath
// (the pill re-renders with the new name while hidden); close the sheet and
// spring the flying label from row to pill (spring.snappy); on landing, the
// pill label fades back in and the flyer fades out. Reduce Motion: no flight;
// the sheet fades and the pill label crossfades (quick).

interface ShellOverlayValue {
  openLeagueSheet: () => void;
  /** The pill on the focused screen registers its label here (null on blur). */
  registerPillLabel: (ref: RefObject<View | null> | null) => void;
  /** 0 while a flight is in the air, 1 otherwise; the pill label reads it. */
  pillLabelOpacity: SharedValue<number>;
  /** Bumps once per landing, so the pill's "+N" hint can acknowledge it. */
  landings: number;
  sheetOpen: boolean;
}

const ShellOverlayContext = createContext<ShellOverlayValue | undefined>(undefined);

function measure(ref: RefObject<View | null> | null): Promise<Frame | null> {
  return new Promise((resolve) => {
    const node = ref?.current;
    if (!node) return resolve(null);
    node.measureInWindow((x, y, width, height) => resolve(width > 0 ? { x, y, width, height } : null));
  });
}

interface Flight {
  key: number;
  label: string;
  from: Frame;
  to: Frame;
}

export function ShellOverlayProvider({ children }: { children: ReactNode }) {
  const { setActiveLeagueId, activeLeagueId } = useLeagueContext();
  const { reduced, duration } = useMotion();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [landings, setLandings] = useState(0);
  const pillLabel = useRef<RefObject<View | null> | null>(null);
  const pillLabelOpacity = useSharedValue(1);

  const registerPillLabel = useCallback((ref: RefObject<View | null> | null) => {
    pillLabel.current = ref;
  }, []);

  const openLeagueSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const onPickLeague = useCallback(
    async (id: string, name: string, rowLabel: RefObject<View | null>) => {
      if (id === activeLeagueId) {
        setSheetOpen(false);
        return;
      }
      const [from, to] = reduced ? [null, null] : await Promise.all([measure(rowLabel), measure(pillLabel.current)]);

      if (!from || !to) {
        // Reduce Motion, or nothing to fly to (no pill on this screen):
        // swap the label in place with a quick crossfade.
        pillLabelOpacity.value = 0;
        setActiveLeagueId(id);
        setSheetOpen(false);
        pillLabelOpacity.value = withTiming(1, { duration: duration.quick });
        return;
      }

      pillLabelOpacity.value = 0;
      setActiveLeagueId(id);
      setFlight({ key: Date.now(), label: name, from, to });
      setSheetOpen(false);
    },
    [activeLeagueId, reduced, duration.quick, pillLabelOpacity, setActiveLeagueId]
  );

  const onLanded = useCallback(() => {
    pillLabelOpacity.value = withTiming(1, { duration: duration.quick });
    setLandings((n) => n + 1);
  }, [duration.quick, pillLabelOpacity]);

  const onFlightDone = useCallback(() => setFlight(null), []);

  const goTo = useCallback((path: '/create-league' | '/join-league') => {
    setSheetOpen(false);
    router.push(path);
  }, []);

  const value = useMemo<ShellOverlayValue>(
    () => ({ openLeagueSheet, registerPillLabel, pillLabelOpacity, landings, sheetOpen }),
    [openLeagueSheet, registerPillLabel, pillLabelOpacity, landings, sheetOpen]
  );

  return (
    <ShellOverlayContext.Provider value={value}>
      {/* While the sheet is open, hide the app from assistive tech (Android;
          iOS uses the sheet's accessibilityViewIsModal). */}
      <View style={styles.fill} importantForAccessibility={sheetOpen ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      <LeagueSheet
        open={sheetOpen}
        onClose={closeSheet}
        onPick={onPickLeague}
        onCreate={() => goTo('/create-league')}
        onJoin={() => goTo('/join-league')}
      />
      {flight ? (
        <Animated.View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <FlyingLabel
            key={flight.key}
            label={flight.label}
            from={flight.from}
            to={flight.to}
            onLanded={onLanded}
            onDone={onFlightDone}
          />
        </Animated.View>
      ) : null}
    </ShellOverlayContext.Provider>
  );
}

export function useShellOverlay(): ShellOverlayValue {
  const ctx = useContext(ShellOverlayContext);
  if (!ctx) throw new Error('useShellOverlay must be used within a ShellOverlayProvider');
  return ctx;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
