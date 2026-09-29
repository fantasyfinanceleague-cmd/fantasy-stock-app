import { useEffect, useState } from 'react';
import { useLandingMotion } from './hooks';

// The landing's three tiers (round 4; Design Lead conditions):
//   FULL     — WebGL2 3D scenes (lazy chunk, after first paint)
//   ENHANCED — the DOM/CSS-3D motion (round 3 + round-4 grammar)
//   STATIC   — reduced motion or no JS: plain, complete, still
// Every tier is complete on its own; scroll lengths and beats are shared
// (pacing.ts), so a tier switch never moves the page.

export type Tier = 'full' | 'enhanced' | 'static';

export interface TierDecision {
  tier: Tier;
  /** Why the gate chose it — logged with every evidence capture. */
  reasons: string[];
  /** Set by `?tier=`: runtime guards log but never demote a forced tier. */
  forced?: boolean;
  /** Advisory hints (never decisive; iOS under-reports or omits them). */
  hints: { deviceMemory?: number; hardwareConcurrency?: number; saveData?: boolean };
}

interface NavigatorHints {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/** Can this browser give us a WebGL2 context that isn't software-rendered?
 * `failIfMajorPerformanceCaveat` refuses SwiftShader-style fallbacks. */
function probeWebGL2(): { ok: boolean; renderer?: string } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true, antialias: false });
    if (!gl) return { ok: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : undefined;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, renderer };
  } catch {
    return { ok: false };
  }
}

/** The capability gate. Decisive: reduced motion (→ STATIC), a real WebGL2
 * context, Save-Data. Advisory only (logged, never decisive — Design Lead:
 * don't lock modern iPhones out): deviceMemory, hardwareConcurrency. The
 * runtime frame guard in the FULL chunk is the second line of defence.
 * `?tier=full|enhanced|static` overrides it, for tests and evidence. */
export function decideTier(reducedMotion: boolean): TierDecision {
  const nav = navigator as Navigator & NavigatorHints;
  const hints = {
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    saveData: nav.connection?.saveData,
  };
  const forced = new URLSearchParams(window.location.search).get('tier');
  if (forced === 'full' || forced === 'enhanced' || forced === 'static') {
    return { tier: forced, forced: true, reasons: [`forced by ?tier=${forced}`], hints };
  }
  if (reducedMotion) return { tier: 'static', reasons: ['prefers-reduced-motion'], hints };
  if (hints.saveData) return { tier: 'enhanced', reasons: ['Save-Data'], hints };
  const gl = probeWebGL2();
  if (!gl.ok) return { tier: 'enhanced', reasons: ['no hardware WebGL2'], hints };
  return { tier: 'full', reasons: [`WebGL2 (${gl.renderer ?? 'renderer hidden'})`], hints };
}

/** The tier, decided once after hydration. Server render and the first
 * client render are always STATIC-shaped markup (so hydration matches);
 * null until decided. A FULL scene that fails (context loss, slow load,
 * slow frames) calls `demote()` and the page settles on ENHANCED. */
let current: TierDecision | null = null;
const listeners = new Set<(d: TierDecision) => void>();

/** The decision, mirrored onto <html> (data-lp-tier, data-lp-tier-why)
 * so every evidence capture can log which tier ran and why. */
function publish(d: TierDecision) {
  const root = document.documentElement;
  root.dataset.lpTier = d.tier;
  root.dataset.lpTierWhy = d.reasons.join(' | ');
  (window as unknown as { __lpTier?: TierDecision }).__lpTier = d;
}

/** True when `?tier=` forced the tier (captures): guards log, never act. */
export const tierForced = () => current?.forced === true;

export function demoteToEnhanced(reason: string) {
  if (!current || current.tier !== 'full') return;
  if (current.forced) {
    // Forced for a capture: keep FULL, but record what would have happened.
    current = { ...current, reasons: [...current.reasons, `guard (ignored, forced): ${reason}`] };
    publish(current);
    return;
  }
  current = { ...current, tier: 'enhanced', reasons: [...current.reasons, `demoted: ${reason}`] };
  publish(current);
  listeners.forEach((l) => l(current!));
}

export function useTier(): TierDecision | null {
  const { hydrated, reduced } = useLandingMotion();
  const [decision, setDecision] = useState<TierDecision | null>(current);
  useEffect(() => {
    if (!hydrated) return;
    if (!current) {
      current = decideTier(reduced);
      publish(current);
    }
    setDecision(current);
    const l = (d: TierDecision) => setDecision(d);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [hydrated, reduced]);
  return decision;
}

/** Test-only: forget the decision between test renders. */
export function __resetTierForTests() {
  current = null;
}
