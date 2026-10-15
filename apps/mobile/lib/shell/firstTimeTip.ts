// Onboarding W4 — the stored flags behind first-time tips (policy: lib/shell/firstTimeTipPolicy.ts).
// A tiny external store per tip key, read once from AsyncStorage (like lib/shell/firstRun.ts), so a
// dismissal hides the tip everywhere it is mounted at once.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { TIPS, tipVisible, type TipId, type TipStored } from './firstTimeTipPolicy';

const values = new Map<string, TipStored>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function load(key: string): void {
  if (values.has(key)) return;
  values.set(key, undefined);
  AsyncStorage.getItem(key)
    .then((v) => values.set(key, v))
    .catch(() => values.set(key, 'error'))
    .finally(emit);
}

export function dismissTip(id: TipId): void {
  const { key } = TIPS[id];
  values.set(key, '1');
  emit();
  AsyncStorage.setItem(key, '1').catch(() => {});
}

/** Whether the tip shows now. */
export function useTipVisible(id: TipId): boolean {
  const { key } = TIPS[id];
  load(key);
  const stored = useSyncExternalStore(subscribe, () => values.get(key));
  return tipVisible(stored);
}
