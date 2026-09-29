import { useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3, type Group } from 'three';

// Place a 3D object where a DOM "slot" is. Each frame: the slot's rect →
// normalised device coords → a point on the z = 0 plane, and a scale so the
// object's `unitHeight` world units span the slot's height. This keeps the
// device exactly where the layout reserved space for it, at every viewport
// size, without hand-tuned per-breakpoint world coordinates.

const v = new Vector3();
const dir = new Vector3();

export function useSlotAnchor(slot: RefObject<HTMLElement | null>, unitHeight: number) {
  const group = useRef<Group>(null);
  const { camera, gl } = useThree();
  useFrame(() => {
    const el = slot.current;
    const g = group.current;
    if (!el || !g) return;
    const r = el.getBoundingClientRect();
    const c = gl.domElement.getBoundingClientRect();
    if (!c.width || !c.height) return;
    const nx = ((r.left + r.width / 2 - c.left) / c.width) * 2 - 1;
    const ny = -(((r.top + r.height / 2 - c.top) / c.height) * 2 - 1);
    // Ray from the camera through the slot centre, to the z = 0 plane.
    v.set(nx, ny, 0.5).unproject(camera);
    dir.copy(v).sub(camera.position).normalize();
    const t = -camera.position.z / dir.z;
    g.position.copy(camera.position).addScaledVector(dir, t);
    // World height visible at z = 0 → the slot's share of it.
    const dist = camera.position.z;
    const fov = ((camera as unknown as { fov: number }).fov * Math.PI) / 180;
    const worldH = 2 * Math.tan(fov / 2) * dist;
    const s = ((r.height / c.height) * worldH) / unitHeight;
    g.scale.setScalar(s);
  });
  return group;
}
