import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Object3D, Vector2, type InstancedMesh } from 'three';
import { color } from '../../../design/tokens';
import { TAPE } from '../sampleData';

// The market skyline (round 4): a field of the brand's three-bar forms
// receding to the horizon. It carries meaning — every form is a ticker from
// the tape at the top of the page; its height is that ticker's move and its
// tint is the move's sign — and it answers the page's live ticks: each
// sample-data tick sends a wave rolling out from the device through the
// field. Pale, fogged into the page background, and kept below the reading
// line, so no text ever sits on a saturated column.

const COLS = 16;
const ROWS = 6;
const SPACING = 1.7;
const BAR_W = 0.13;
const BAR_GAP = 0.05;
/** The three bars of each form rise like the mark: 55%, 80%, 100%. */
const STEPS = [0.55, 0.8, 1] as const;
const WAVE_SPEED = 7; // world units / s
const WAVE_WIDTH = 2.2;
const WAVE_LIFT = 0.35;

const moves = TAPE.map((x) => ({ t: x.t, up: x.up, mag: Math.abs(parseFloat(x.d.replace('−', '-'))) }));

export interface SkylineHover {
  /** The ticker under the pointer, or null. */
  cell: SkylineCell | null;
  x: number;
  y: number;
}

export interface SkylineCell {
  x: number;
  z: number;
  h: number;
  up: boolean;
  t: string;
}

export function skylineCells(): SkylineCell[] {
  const cells: SkylineCell[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const m = moves[(c * 5 + r * 7) % moves.length];
      cells.push({
        x: (c - (COLS - 1) / 2) * SPACING,
        z: -r * SPACING * 1.5 - 0.6,
        h: 0.3 + m.mag * 0.2,
        up: m.up,
        t: m.t,
      });
    }
  }
  return cells;
}

/** The field stands on the bottom edge of the view at z = 0, so it grows
 * out of the layer's floor at any viewport size. */
export function Skyline({
  frame,
  origin = [3, -4] as [number, number],
  bg,
  night = false,
  onHover,
  hoverable,
}: {
  frame: number;
  origin?: [number, number];
  bg: string;
  /** On stadium navy: on-game tints. */
  night?: boolean;
  /** Pointer hover (fine pointers): which form is under it, if any. */
  onHover?: (h: SkylineHover) => void;
  /** Where hover may register (client x, y): the unmasked part. */
  hoverable?: (x: number, y: number, canvas: DOMRect) => boolean;
}) {
  const three = useThree();
  const camera = three.camera as unknown as { fov: number; position: { z: number } };
  const mesh = useRef<InstancedMesh>(null);
  const cells = useMemo(skylineCells, []);
  const count = cells.length * STEPS.length;
  const dummy = useMemo(() => new Object3D(), []);
  const waveAt = useRef<number | null>(null);
  const last = useRef(frame);

  // Tints: the move's colour washed most of the way into the page.
  const tints = useMemo(() => {
    const base = new Color(bg);
    // Like the mark: two quiet bars, then the one that carries the signal.
    return night
      ? {
          quiet: new Color(color.text.onGame.secondary).lerp(base, 0.78),
          up: new Color(color.data.gain.onGame).lerp(base, 0.55),
          down: new Color(color.data.loss.onGame).lerp(base, 0.55),
        }
      : {
          quiet: new Color(color.text.secondary).lerp(base, 0.62),
          up: new Color(color.data.gain.base).lerp(base, 0.2),
          down: new Color(color.data.loss.base).lerp(base, 0.2),
        };
  }, [bg, night]);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    cells.forEach((cell, i) => {
      STEPS.forEach((_, k) => m.setColorAt(i * 3 + k, k < 2 ? tints.quiet : cell.up ? tints.up : tints.down));
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [cells, tints]);

  useEffect(() => {
    if (frame !== last.current) {
      last.current = frame;
      waveAt.current = performance.now();
    }
  }, [frame]);

  // Hover: raycast only when the pointer has moved (window-level — the
  // canvas takes no events), against the instanced forms.
  const pointer = useRef<{ x: number; y: number; dirty: boolean } | null>(null);
  useEffect(() => {
    if (!onHover || !window.matchMedia('(pointer: fine)').matches) return;
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY, dirty: true };
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, [onHover]);
  const ndc = useMemo(() => new Vector2(), []);
  const hovered = useRef<number | null>(null);
  useFrame(() => {
    const p = pointer.current;
    const m = mesh.current;
    if (!p || !p.dirty || !m || !onHover) return;
    p.dirty = false;
    const c = three.gl.domElement.getBoundingClientRect();
    const inside = p.x >= c.left && p.x <= c.right && p.y >= c.top && p.y <= c.bottom;
    let hit: number | null = null;
    if (inside && (!hoverable || hoverable(p.x, p.y, c))) {
      ndc.set(((p.x - c.left) / c.width) * 2 - 1, -(((p.y - c.top) / c.height) * 2 - 1));
      three.raycaster.setFromCamera(ndc, three.camera);
      const hits = three.raycaster.intersectObject(m, false);
      if (hits.length && hits[0].instanceId !== undefined) hit = Math.floor(hits[0].instanceId / STEPS.length);
    }
    if (hit !== hovered.current || hit !== null) {
      hovered.current = hit;
      onHover({ cell: hit === null ? null : cells[hit], x: p.x - c.left, y: p.y - c.top });
    }
  });

  const settled = useRef(false);
  const lastFloor = useRef(0);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const floor = -Math.tan(((camera.fov / 2) * Math.PI) / 180) * camera.position.z;
    if (floor !== lastFloor.current) {
      lastFloor.current = floor;
      settled.current = false;
    }
    const t0 = waveAt.current;
    const age = t0 === null ? Infinity : (performance.now() - t0) / 1000;
    const front = age * WAVE_SPEED;
    const active = front < 40;
    if (!active && settled.current) return; // nothing moving: skip the upload
    settled.current = !active;
    cells.forEach((cell, i) => {
      const d = Math.hypot(cell.x - origin[0], cell.z - origin[1]);
      const k = active ? Math.exp(-(((front - d) / WAVE_WIDTH) ** 2)) : 0;
      const h = cell.h * (1 + WAVE_LIFT * k);
      STEPS.forEach((s, j) => {
        const bh = h * s;
        dummy.position.set(cell.x + (j - 1) * (BAR_W + BAR_GAP), floor + bh / 2, cell.z);
        dummy.scale.set(BAR_W, bh, BAR_W);
        dummy.updateMatrix();
        m.setMatrixAt(i * 3 + j, dummy.matrix);
      });
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.45} metalness={0} envMapIntensity={night ? 0.5 : 0.6} />
    </instancedMesh>
  );
}
