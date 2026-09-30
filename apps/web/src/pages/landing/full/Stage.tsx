import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { demoteToEnhanced } from '../tier';

// One WebGL stage per 3D layer (round 4). It lives INSIDE its layer,
// behind the layer's text, so the page's swallow transitions carry it like
// any other content. Rendering runs only while the stage is on screen and
// the tab is visible (Design Lead: pause off-screen / hidden); DPR is
// capped at 2 (1.5 on phones).

const FRAME_GUARD_MS = 2000;
const FRAME_GUARD_P90_MS = 24;
/** Frames skipped before sampling: the first ones carry shader compiles
 * and the environment bake, which are one-off costs, not the frame rate. */
const FRAME_GUARD_WARMUP = 12;

/** Reports the first rendered frame, and demotes the page to ENHANCED if
 * the first ~2 s of visible frames run slow (p90 > 24 ms). */
function FrameWatch({ onPainted }: { onPainted: () => void }) {
  const painted = useRef(false);
  const samples = useRef<number[]>([]);
  const start = useRef<number | null>(null);
  const done = useRef(false);
  const seen = useRef(0);
  useFrame((_, delta) => {
    if (!painted.current) {
      painted.current = true;
      // Next macrotask: the frame has been presented.
      window.setTimeout(onPainted, 0);
      return;
    }
    if (done.current || ++seen.current < FRAME_GUARD_WARMUP) return;
    const now = performance.now();
    if (start.current === null) start.current = now;
    samples.current.push(delta * 1000);
    if (now - start.current > FRAME_GUARD_MS) {
      done.current = true;
      const s = [...samples.current].sort((a, b) => a - b);
      const p90 = s[Math.floor(s.length * 0.9)] ?? 0;
      (window as unknown as { __lpFrameGuard?: object }).__lpFrameGuard = { p90, frames: s.length };
      if (p90 > FRAME_GUARD_P90_MS) demoteToEnhanced(`frame guard: p90 ${p90.toFixed(1)}ms`);
    }
  });
  return null;
}

/** Renders ONE frame while the browser is idle after mount, even while
 * the stage is off screen: shader compiles and the environment bake then
 * happen at load time instead of as a hitch the moment the stage scrolls
 * into view. The loop itself stays off until it is visible. */
function Warmup() {
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const run = () => advance(performance.now()); // rAF-style ms, like the loop
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 1500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(run, 200);
    return () => window.clearTimeout(t);
  }, [advance]);
  return null;
}

/** Hooks the context-loss event (→ ENHANCED). */
function ContextWatch() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      demoteToEnhanced('WebGL context lost');
    };
    el.addEventListener('webglcontextlost', lost);
    return () => el.removeEventListener('webglcontextlost', lost);
  }, [gl]);
  return null;
}

export function Stage({
  children,
  onPainted,
  fov = 30,
  position = [0, 0, 6] as [number, number, number],
  className,
  overlay,
}: {
  children: ReactNode;
  /** DOM drawn BEHIND the canvas, in the stage's box (device screens). */
  overlay?: ReactNode;
  onPainted: () => void;
  fov?: number;
  position?: [number, number, number];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: '120px 0px' });
    io.observe(el);
    const vis = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', vis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const dprCap = coarse || (typeof window !== 'undefined' && window.innerWidth < 768) ? 1.5 : 2;

  return (
    <div ref={ref} className={['lp-stage3d', className].filter(Boolean).join(' ')}>
      {overlay}
      <Canvas
        frameloop={onScreen && pageVisible ? 'always' : 'never'}
        dpr={[1, dprCap]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov, position, near: 0.1, far: 80 }}
        // Layers scale while they recede (a transform, not layout): measuring
        // on scroll would read the scaled rect and resize the drawing buffer
        // every frame, so size tracks layout (ResizeObserver) only.
        resize={{ scroll: false }}
        // Above the overlay: the canvas is transparent wherever the scene
        // cuts it open (the device screens).
        style={{ pointerEvents: 'none', position: 'relative', zIndex: 1 }}
      >
        <FrameWatch onPainted={onPainted} />
        <ContextWatch />
        <Warmup />
        {children}
      </Canvas>
    </div>
  );
}
