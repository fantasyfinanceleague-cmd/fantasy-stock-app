import { useEffect, useState, type ComponentProps } from 'react';
import { demoteToEnhanced, tierForced, useTier } from './tier';

// The bridge from the entry bundle to the lazily loaded FULL (WebGL) chunk.
// Nothing 3D is in the entry: `import('./full')` is fetched only when the
// capability gate says FULL, and only once the browser is idle after the
// first paint. Until a scene has painted its first frame, the ENHANCED DOM
// version underneath stays fully visible (no blank moment); then the
// scene's wrapper fades in and `html[data-lp3d-<name>]` lets the DOM
// counterpart fade out. A load slower than LOAD_BUDGET_MS demotes the page
// to ENHANCED (Design Lead: ">2.5s → stays on the poster/ENHANCED path").

type FullModule = typeof import('./full');
export type SceneName = keyof FullModule['scenes'];

const LOAD_BUDGET_MS = 2500;
let loaded: FullModule | null = null;
let loading: Promise<FullModule> | null = null;

function loadFull(): Promise<FullModule> {
  if (!loading) {
    loading = import('./full').then((m) => {
      loaded = m;
      return m;
    });
  }
  return loading;
}

function whenIdle(cb: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(cb, { timeout: 600 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(cb, 1);
  return () => window.clearTimeout(t);
}

export function useFullModule(enabled: boolean): FullModule | null {
  const [mod, setMod] = useState<FullModule | null>(loaded);
  useEffect(() => {
    if (!enabled || mod) return;
    let alive = true;
    const started = performance.now();
    const guard = window.setTimeout(() => {
      if (alive && !loaded) demoteToEnhanced(`3D chunk not loaded within ${LOAD_BUDGET_MS}ms`);
    }, LOAD_BUDGET_MS);
    const cancelIdle = whenIdle(() => {
      loadFull()
        .then((m) => {
          if (!alive) return;
          // Too late: the guard has already settled the page on ENHANCED.
          if (performance.now() - started > LOAD_BUDGET_MS && !tierForced()) return;
          setMod(m);
        })
        .catch(() => demoteToEnhanced('3D chunk failed to load'));
    });
    return () => {
      alive = false;
      window.clearTimeout(guard);
      cancelIdle();
    };
  }, [enabled, mod]);
  return mod;
}

/** Renders the named FULL scene (absolutely filling its positioned parent)
 * when — and only when — the tier is FULL and the chunk has arrived. */
export function FullSlot<N extends SceneName>({
  name,
  ...props
}: { name: N } & Omit<ComponentProps<FullModule['scenes'][N]>, 'onPainted'>) {
  const tier = useTier();
  const full = tier?.tier === 'full';
  const mod = useFullModule(full);
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (full && painted) root.setAttribute(`data-lp3d-${name}`, 'painted');
    else root.removeAttribute(`data-lp3d-${name}`);
    return () => root.removeAttribute(`data-lp3d-${name}`);
  }, [full, painted, name]);

  if (!full || !mod) return null;
  const Scene = mod.scenes[name] as React.ComponentType<Record<string, unknown>>;
  return (
    <div className={painted ? `lp-3d lp-3d--${name} lp-3d--painted` : `lp-3d lp-3d--${name}`} aria-hidden="true">
      <Scene {...(props as Record<string, unknown>)} onPainted={() => setPainted(true)} />
    </div>
  );
}
