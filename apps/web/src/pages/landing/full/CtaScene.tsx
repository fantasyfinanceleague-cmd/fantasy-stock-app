import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, CanvasTexture, Color, Vector3, type Points } from 'three';
import { color } from '../../../design/tokens';
import { useSlotAnchor } from './anchor';
import { particleCap } from './Burst';
import { Stage } from './Stage';

// The CTA (round 4, storyboard scene 7): the market's particles stream in
// and ASSEMBLE into the three-bar mark as the layer arrives; the pointer
// scatters them and they settle back. Additive on navy (no flashes — the
// mark only ever brightens as it forms). Once formed and undisturbed, the
// buffers stop updating (the scene idles).

// The mark's geometry, in its 24-unit viewBox (design/BrandMark.tsx).
const BARS = [
  { x: 3, h: 8 },
  { x: 9.75, h: 12 },
  { x: 16.5, h: 16 },
] as const;
const BAR_W = 4.5;
const BASELINE = 21;
/** Local units: viewBox / 16, centred — the slot (24 units) is 1.5 high. */
const U = 1 / 16;
const SLOT_H = 24 * U;

const SCATTER_R = 0.45;
const SETTLE = 6; // spring back rate, 1/s

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

function MarkParticles({ slot, arrive }: { slot: RefObject<HTMLElement | null>; arrive: () => number }) {
  const anchor = useSlotAnchor(slot, SLOT_H);
  const points = useRef<Points>(null);
  const { camera, gl } = useThree();
  const count = useMemo(() => particleCap() * 18, []); // 1728 desktop / 864 phones
  const tex = useMemo(dotTexture, []);

  const data = useMemo(() => {
    const target = new Float32Array(count * 3);
    const start = new Float32Array(count * 3);
    const pos = new Float32Array(count * 3);
    const off = new Float32Array(count * 3); // pointer displacement
    const delay = new Float32Array(count);
    const col = new Float32Array(count * 3);
    const minor = new Color(color.text.onGame.secondary);
    const accent = new Color(color.team.you.onGame);
    // Particles per bar in proportion to its area.
    const areas = BARS.map((b) => b.h * BAR_W);
    const total = areas.reduce((a, b) => a + b, 0);
    let i = 0;
    BARS.forEach((b, k) => {
      const n = k === BARS.length - 1 ? count - i : Math.round((areas[k] / total) * count);
      for (let j = 0; j < n; j++, i++) {
        const vx = b.x + Math.random() * BAR_W;
        const vy = BASELINE - Math.random() * b.h;
        target.set([(vx - 12) * U, (12 - vy) * U, (Math.random() - 0.5) * 0.04], i * 3);
        // Start: a wide, deep drift field around the slot.
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.random() * 4;
        start.set([Math.cos(a) * r, Math.sin(a) * r * 0.6, -Math.random() * 6], i * 3);
        delay[i] = Math.random() * 0.35;
        (k === BARS.length - 1 ? accent : minor).toArray(col, i * 3);
      }
    });
    pos.set(start);
    return { target, start, pos, off, delay, col };
  }, [count]);

  // Window-level pointer (the canvas takes no events); fine pointers only.
  const pointer = useRef({ x: 0, y: 0, moved: 0, inside: false });
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY, moved: performance.now(), inside: true };
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);
  const ray = useMemo(() => ({ p: new Vector3(), d: new Vector3() }), []);
  const idle = useRef(false);

  useFrame((_, dt) => {
    const pts = points.current;
    const g = anchor.current;
    if (!pts || !g) return;
    const k = arrive();
    const now = performance.now();
    const disturbed = now - pointer.current.moved < 1500;
    if (k >= 1 && !disturbed && idle.current) return;

    // Pointer → the mark's local plane (z = 0 of the anchored group).
    let px = Infinity;
    let py = Infinity;
    if (disturbed && pointer.current.inside) {
      const c = gl.domElement.getBoundingClientRect();
      ray.p.set(((pointer.current.x - c.left) / c.width) * 2 - 1, -(((pointer.current.y - c.top) / c.height) * 2 - 1), 0.5).unproject(camera);
      ray.d.copy(ray.p).sub(camera.position).normalize();
      const t = (g.position.z - camera.position.z) / ray.d.z;
      ray.p.copy(camera.position).addScaledVector(ray.d, t);
      px = (ray.p.x - g.position.x) / g.scale.x;
      py = (ray.p.y - g.position.y) / g.scale.y;
    }

    const { target, start, pos, off, delay } = data;
    const step = Math.min(dt, 0.05);
    let moving = false;
    for (let i = 0; i < count; i++) {
      const e = Math.min(1, Math.max(0, (k - delay[i]) / (1 - 0.35)));
      const s = e * e * (3 - 2 * e);
      for (let a = 0; a < 3; a++) {
        const j = i * 3 + a;
        let o = off[j] * Math.max(0, 1 - SETTLE * step);
        if (a < 2 && px !== Infinity) {
          const dx = target[i * 3] - px;
          const dy = target[i * 3 + 1] - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < SCATTER_R * SCATTER_R) {
            const push = (1 - Math.sqrt(d2) / SCATTER_R) * 0.9 * step * 8;
            const dd = Math.sqrt(d2) || 1;
            o += (a === 0 ? dx : dy) / dd * push * 0.1;
          }
        }
        off[j] = o;
        if (Math.abs(o) > 1e-4) moving = true;
        pos[j] = start[j] + (target[j] - start[j]) * s + o;
      }
    }
    idle.current = k >= 1 && !moving;
    (pts.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  });

  return (
    <group ref={anchor}>
      <points ref={points} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
          <bufferAttribute attach="attributes-color" args={[data.col, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={tex}
          size={0.08}
          sizeAttenuation
          vertexColors
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
    </group>
  );
}

export default function CtaScene({ onPainted, slot }: { onPainted: () => void; slot: RefObject<HTMLElement | null> }) {
  // Arrival: the layer's top from the viewport bottom to the top, read from
  // the slot's own box (the CTA is the last layer and never recedes).
  const arrive = () => {
    const el = slot.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const k = 1 - (r.top + r.height / 2 - window.innerHeight * 0.5) / (window.innerHeight * 0.6);
    return Math.min(1, Math.max(0, k));
  };
  return (
    <Stage onPainted={onPainted} fov={30} position={[0, 0, 9]}>
      <MarkParticles slot={slot} arrive={arrive} />
    </Stage>
  );
}
