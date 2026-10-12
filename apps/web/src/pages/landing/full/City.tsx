import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CanvasTexture, Color, Object3D, Vector2, type InstancedMesh } from 'three';
import { color } from '../../../design/tokens';
import { TAPE } from '../sampleData';

// The market city (round 4, Design Lead redirect B). ONE composition the
// device stands in: the snow ground (soft contact shadows under every form
// and the device), and a field of the brand's
// three-bar forms receding to a fogged horizon. Every form is a ticker from
// the tape: its height is the move, its signal bar the move's sign in the
// token gain/loss colours on a physical material; the two base bars are
// slate. Only the fog desaturates distance. Local units: the device is
// 1 × ~2.07 and stands at the origin; y = 0 is the ground.

const COLS = 22;
const ROWS = 12;
const PITCH_X = 1.02;
const PITCH_Z = 1.75;
const BAR_W = 0.14;
const BAR_GAP = 0.05;
const STEPS = [0.55, 0.8, 1] as const;
const WAVE_SPEED = 6; // units / s
const WAVE_WIDTH = 1.8;
const WAVE_LIFT = 0.3;

const moves = TAPE.map((x) => ({ t: x.t, up: x.up, mag: Math.abs(parseFloat(x.d.replace('−', '-'))) }));

export interface CityCell {
  x: number;
  z: number;
  h: number;
  up: boolean;
  t: string;
}

export interface CityHover {
  cell: CityCell | null;
  x: number;
  y: number;
}

/** The field, minus a clearing around the device (it stands in the city,
 * not inside a column). Rows run from beside the device back to the
 * horizon; the far rows rise a little, like a skyline. */
export function cityCells(): CityCell[] {
  const cells: CityCell[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = (c - (COLS - 1) / 2) * PITCH_X + (r % 2 ? PITCH_X / 2 : 0);
      const z = 0.2 - r * PITCH_Z - (((c * 37 + r * 61) % 10) / 10) * 0.5;
      if (Math.abs(x) < 1.35 && z > -2.2) continue; // the device's clearing
      // No lone giants in the foreground: the front rows only flank the
      // device on its open side (the copy side is masked and must stay calm).
      if (z > -2.6 && (x < -1.35 || x > 3.6)) continue;
      const m = moves[(c * 5 + r * 7) % moves.length];
      cells.push({ x, z, h: (0.18 + m.mag * 0.12) * (1 + r * 0.13), up: m.up, t: m.t });
    }
  }
  return cells;
}

/** A soft radial blob: the contact shadow / AO under a form. */
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** Shadows under every form (and the device): soft, ~30%, blurring wider
 * with the form's height — the AO that stands the city on its ground. */
function GroundShadows({ cells }: { cells: CityCell[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const tex = useMemo(blobTexture, []);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const d = new Object3D();
    cells.forEach((cell, i) => {
      const spread = 1 + cell.h * 0.55;
      d.position.set(cell.x + 0.06, 0.003, cell.z + 0.05);
      d.rotation.set(-Math.PI / 2, 0, 0);
      d.scale.set(0.95 * spread, 0.55 * spread, 1);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    // The device's own shadow (last instance): an ellipse under its foot.
    d.position.set(0.05, 0.004, 0.02);
    d.rotation.set(-Math.PI / 2, 0, 0);
    d.scale.set(1.9, 0.62, 1);
    d.updateMatrix();
    m.setMatrixAt(cells.length, d.matrix);
    m.instanceMatrix.needsUpdate = true;
  }, [cells]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cells.length + 1]} frustumCulled={false} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} color={color.text.primary} transparent opacity={0.3} depthWrite={false} />
    </instancedMesh>
  );
}

export function City({
  frame,
  onHover,
  hoverable,
}: {
  frame: number;
  onHover?: (h: CityHover) => void;
  hoverable?: (x: number, y: number, canvas: DOMRect) => boolean;
}) {
  const three = useThree();
  const mesh = useRef<InstancedMesh>(null);
  const cells = useMemo(cityCells, []);
  const count = cells.length * STEPS.length;
  const dummy = useMemo(() => new Object3D(), []);
  const waveAt = useRef<number | null>(null);
  const last = useRef(frame);

  const tints = useMemo(
    () => ({
      base: new Color(color.text.disabled),
      baseDeep: new Color(color.border.control),
      up: new Color(color.data.gain.base),
      down: new Color(color.data.loss.base),
    }),
    []
  );

  const place = (lift: (cell: CityCell) => number) => {
    const m = mesh.current;
    if (!m) return;
    cells.forEach((cell, i) => {
      const h = cell.h * (1 + WAVE_LIFT * lift(cell));
      STEPS.forEach((s, j) => {
        const bh = h * s;
        dummy.position.set(cell.x + (j - 1) * (BAR_W + BAR_GAP), bh / 2, cell.z);
        dummy.scale.set(BAR_W, bh, BAR_W);
        dummy.updateMatrix();
        m.setMatrixAt(i * 3 + j, dummy.matrix);
      });
    });
    m.instanceMatrix.needsUpdate = true;
  };

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    cells.forEach((cell, i) => {
      m.setColorAt(i * 3, tints.base);
      m.setColorAt(i * 3 + 1, tints.baseDeep);
      m.setColorAt(i * 3 + 2, cell.up ? tints.up : tints.down);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // Placed before the first frame, so the contact shadows (rendered
    // once) see the city, not a pile of unit boxes at the origin.
    place(() => 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at mount
  }, [cells, tints]);

  useEffect(() => {
    if (frame !== last.current) {
      last.current = frame;
      waveAt.current = performance.now();
    }
  }, [frame]);

  // Hover: raycast on pointer moves only (window-level; the canvas takes
  // no events), against the instanced forms.
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

  const settled = useRef(true);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    // The tick wave rolls out from the device through the city.
    const t0 = waveAt.current;
    const front = t0 === null ? Infinity : ((performance.now() - t0) / 1000) * WAVE_SPEED;
    const active = front < 40;
    if (active || !settled.current) {
      settled.current = !active;
      place((cell) => (active ? Math.exp(-(((front - Math.hypot(cell.x, cell.z)) / WAVE_WIDTH) ** 2)) : 0));
    }
    const p = pointer.current;
    if (!p || !p.dirty || !onHover) return;
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

  return (
    <group>
      {/* The ground is the page's own snow (the canvas is transparent);
          what stands the city on it is the shadow under every form. */}
      <GroundShadows cells={cells} />
      <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshPhysicalMaterial roughness={0.45} metalness={0} clearcoat={0.3} clearcoatRoughness={0.4} envMapIntensity={0.9} />
      </instancedMesh>
    </group>
  );
}
