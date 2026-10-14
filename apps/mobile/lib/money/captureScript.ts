/**
 * captureScript (W4 Portfolio, DEV capture only): timed "taps" for headless simulator
 * captures, when the harness can't tap the simulator (no device grant). Under the capture seam
 * (SEAM_ON: a dev build AND EXPO_PUBLIC_GAME_SEAM=1) and EXPO_PUBLIC_CAPTURE_SCRIPT, the steps
 * run at their times after the first screen registers; each step calls the SAME handler a
 * real tap would (open the card, press Sell, Review, the range pill…), so a recording shows
 * the real flow. Production never runs it: the gate is SEAM_ON, and the env var is unset.
 *
 * Format: "card:NVDA@1500,sell@3500,review@6000" — action[:arg]@ms, comma-separated.
 */
import { useEffect, useRef } from 'react';

import { SEAM_ON } from '../game/devSeam';

export interface CaptureStep {
  action: string;
  arg: string | null;
  at: number;
}

/** Pure: the steps of a script string, in time order; malformed steps are dropped. */
export function parseCaptureScript(raw: string | null | undefined): CaptureStep[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .map((part): CaptureStep | null => {
      const m = /^([a-z]+)(?::([^@]+))?@(\d+)$/.exec(part);
      return m ? { action: m[1], arg: m[2] ?? null, at: Number(m[3]) } : null;
    })
    .filter((s): s is CaptureStep => s !== null)
    .sort((a, b) => a.at - b.at);
}

const STEPS = SEAM_ON ? parseCaptureScript(process.env.EXPO_PUBLIC_CAPTURE_SCRIPT) : [];
const handlers = new Map<string, (arg: string | null) => void>();
let started = false;

function start() {
  if (started || STEPS.length === 0) return;
  started = true;
  for (const step of STEPS) {
    setTimeout(() => {
      const h = handlers.get(step.action);
      console.log(`[capture] ${step.action}${step.arg ? `:${step.arg}` : ''} @${step.at} ${h ? 'ran' : 'NO HANDLER'}`);
      h?.(step.arg);
    }, step.at);
  }
}

/** Registers `handler` for a script action while the component is mounted (a no-op unless
 * the capture seam and a script are both on). */
export function useCaptureAction(action: string, handler: (arg: string | null) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (STEPS.length === 0) return;
    const fn = (arg: string | null) => ref.current(arg);
    handlers.set(action, fn);
    start();
    return () => {
      if (handlers.get(action) === fn) handlers.delete(action);
    };
  }, [action]);
}
