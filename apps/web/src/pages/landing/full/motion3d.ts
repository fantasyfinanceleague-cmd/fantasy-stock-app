import { useEffect, useRef } from 'react';

// Shared motion rules for every FULL scene (Design Lead, round 4,
// vestibular conditions): no camera roll; any "dive" is a dolly at a
// constant FOV; object turns stay under 30°/s; pointer parallax ≤ 2°.

export const DEG = Math.PI / 180;
export const MAX_TURN_RAD_S = 30 * DEG;
export const PARALLAX_MAX = 2 * DEG;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smooth = (v: number) => {
  const k = clamp01(v);
  return k * k * (3 - 2 * k);
};

/** Moves `current` toward `target` at no more than MAX_TURN_RAD_S. */
export function turnToward(current: number, target: number, dt: number, rate = MAX_TURN_RAD_S) {
  const step = rate * Math.min(dt, 0.1);
  const d = target - current;
  return Math.abs(d) <= step ? target : current + Math.sign(d) * step;
}

/** The pointer, normalised to −1…1 across the viewport (0,0 on touch). */
export function usePointer() {
  const p = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const move = (e: PointerEvent) => {
      p.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      p.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);
  return p;
}
