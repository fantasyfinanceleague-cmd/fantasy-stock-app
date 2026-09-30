import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Object3D, type InstancedMesh } from 'three';

// A one-shot particle burst out of the device's screen (round 4): the lead
// change (team blue) and the FINAL (live gold + gain green). Each firing is
// a single flash — the Design Lead's cap is ≤ 3 flashes/s, and a burst can
// only re-fire on a new beat, which is ≥ 35vh of scroll away. Particles are
// flat discs that shrink out (no additive glow: the chapter is on snow).
// Nothing is computed while no burst is alive.

const LIFE_S = 1.0;
const GRAVITY = -1.8;
/** Emission ring: the device's outline (it is 1 × ~2.07 world units), so
 * the burst frames the screen instead of covering it. */
const RING = { w: 0.56, h: 1.08 };

export function particleCap() {
  const narrow = window.innerWidth < 768 || window.matchMedia('(pointer: coarse)').matches;
  return narrow ? 48 : 96; // Design Lead: mobile ≈ half
}

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  s: number;
}

export function Burst({ fire, colors, ring = RING }: { fire: number; colors: readonly string[]; ring?: { w: number; h: number } }) {
  const cap = useMemo(particleCap, []);
  const mesh = useRef<InstancedMesh>(null);
  const born = useRef<number | null>(null);
  const parts = useRef<P[]>([]);
  const dummy = useMemo(() => new Object3D(), []);
  // Colours are read at fire time; the effect is keyed on `fire` alone, so
  // a re-render can never re-fire a burst.
  const palette = useRef<Color[]>([]);
  palette.current = colors.map((c) => new Color(c));
  const first = useRef(true);

  useEffect(() => {
    // `fire` is a counter; the initial value never fires.
    if (first.current) {
      first.current = false;
      return;
    }
    const m = mesh.current;
    if (!m) return;
    parts.current = Array.from({ length: cap }, (_, i) => {
      // A point on the device's outline, flying outward from it.
      const a = Math.random() * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      const r = 1 / Math.max(Math.abs(cx) / ring.w, Math.abs(cy) / ring.h);
      const sp = 0.35 + Math.random() * 0.6;
      m.setColorAt(i, palette.current[i % palette.current.length]);
      return {
        x: cx * r,
        y: cy * r,
        z: 0.05,
        vx: cx * sp,
        vy: cy * sp + 0.3,
        vz: Math.random() * 0.5,
        s: 0.012 + Math.random() * 0.016,
      };
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    born.current = performance.now();
    m.visible = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire is the only trigger
  }, [fire]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m || born.current === null) return;
    const age = (performance.now() - born.current) / 1000;
    if (age > LIFE_S) {
      born.current = null;
      m.visible = false;
      return;
    }
    const step = Math.min(dt, 0.05);
    const k = 1 - age / LIFE_S;
    parts.current.forEach((p, i) => {
      p.vy += GRAVITY * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.z += p.vz * step;
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.s * k);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cap]} visible={false} frustumCulled={false}>
      <circleGeometry args={[1, 10]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
