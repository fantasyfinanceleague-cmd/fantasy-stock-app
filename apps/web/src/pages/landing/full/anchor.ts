import { useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3, type Group, type PerspectiveCamera } from 'three';

// Place a 3D object where a DOM "slot" is. Each frame: the slot's rect →
// normalised device coords → the point on the world z = 0 plane under it,
// and a scale so the object's `unitHeight` world units span the slot's
// height at that point. Works for any perspective camera (level or tilted):
// the visible height at a point is 2·tan(fov/2)·d, with d its depth along
// the camera's forward axis. Measured every frame (cheap: two rects), so a
// resize, a font swap or iOS's dynamic toolbar can never leave it stale.
//
// `offsetY` shifts the anchored point in the object's local units (e.g.
// anchor a world whose origin is the floor, with the device's centre
// DEVICE_H/2 above it).

const ndc = new Vector3();
const dir = new Vector3();
const fwd = new Vector3();
const hit = new Vector3();

export function useSlotAnchor(slot: RefObject<HTMLElement | null>, unitHeight: number, offsetY = 0) {
  const group = useRef<Group>(null);
  const { camera, gl, size } = useThree();
  useFrame(() => {
    const el = slot.current;
    const g = group.current;
    if (!el || !g) return;
    const r = el.getBoundingClientRect();
    const c = gl.domElement.getBoundingClientRect();
    if (!c.width || !c.height) return;
    // Evidence aid (?lpdebug): what the anchor measured, for the badge.
    const dbg = window as unknown as { __lpAnchor?: string; __lpDebug?: boolean };
    if (dbg.__lpDebug) {
      dbg.__lpAnchor = `slot ${Math.round(r.top)},${Math.round(r.height)} canvas ${Math.round(c.top)},${Math.round(c.height)} vv ${Math.round(window.visualViewport?.height ?? 0)}/${window.innerHeight}`;
    }
    const cam = camera as PerspectiveCamera;
    ndc.set(((r.left + r.width / 2 - c.left) / c.width) * 2 - 1, -(((r.top + r.height / 2 - c.top) / c.height) * 2 - 1), 0.5).unproject(cam);
    dir.copy(ndc).sub(cam.position).normalize();
    const t = -cam.position.z / dir.z;
    hit.copy(cam.position).addScaledVector(dir, t);
    cam.getWorldDirection(fwd);
    const depth = hit.clone().sub(cam.position).dot(fwd);
    const worldH = 2 * Math.tan(((cam.fov / 2) * Math.PI) / 180) * depth;
    const s = ((r.height / c.height) * worldH) / unitHeight;
    g.scale.setScalar(s);
    g.position.set(hit.x, hit.y - offsetY * s, 0);
    if (dbg.__lpDebug) {
      // Round trip: where the anchored centre projects back to, vs the slot.
      const back = new Vector3(hit.x, hit.y, 0).project(cam);
      const py = Math.round(c.top + ((1 - back.y) / 2) * c.height);
      dbg.__lpAnchor += ` · proj ${py} vs ${Math.round(r.top + r.height / 2)} · size ${Math.round(size.height)} asp ${cam.aspect.toFixed(3)}/${(c.width / c.height).toFixed(3)}`;
    }
  });
  return group;
}
