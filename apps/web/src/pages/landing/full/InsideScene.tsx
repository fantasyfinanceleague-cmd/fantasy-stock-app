import { useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MotionValue } from 'motion/react';
import type { Group } from 'three';
import { color } from '../../../design/tokens';
import { HomeScreen } from '../PhoneScreens';
import { useSlotAnchor } from './anchor';
import { PARALLAX_MAX, clamp01, smooth, turnToward, usePointer } from './motion3d';
import { Device, DEVICE_H, DeviceLights } from './Device';
import { Skyline } from './Skyline';
import { Stage } from './Stage';

// "A look inside" (round 4, storyboard scene 2). The device waits face-on
// at the centre of the pinned stage — the hero device turns face-on over
// the same scroll, so the swallow reads as one continuous shot — then, as
// the cards launch out of its screen (FlyOut, DOM), it dollies back into a
// night skyline. A dolly at constant FOV; no roll; no turn beyond parallax.

const DOLLY = 7; // world units back, over the fly-out
/** The device rises into place only once the layer's top has passed the
 * hero device (≈ the upper quarter of the viewport), so the two are never
 * on screen together: one device, handed off under the swallow. */
const ENTER_FROM = 0.8;
const ENTER_RISE = 2.4;
const DOLLY_FROM = 0.02;
const DOLLY_TO = 0.55;

function InsideDevice({
  slot,
  frame,
  approach,
  dwell,
}: {
  slot: RefObject<HTMLElement | null>;
  frame: number;
  approach: MotionValue<number>;
  dwell: MotionValue<number>;
}) {
  const anchor = useSlotAnchor(slot, DEVICE_H);
  const rig = useRef<Group>(null);
  const pointer = usePointer();
  const yaw = useRef(0);
  useFrame((_, dt) => {
    const g = rig.current;
    if (!g) return;
    const enter = smooth(clamp01((approach.get() - ENTER_FROM) / (1 - ENTER_FROM)));
    const k = smooth(clamp01((dwell.get() - DOLLY_FROM) / (DOLLY_TO - DOLLY_FROM)));
    g.visible = enter > 0;
    g.position.z = -DOLLY * k;
    g.position.y = -0.35 * k - ENTER_RISE * (1 - enter);
    yaw.current = turnToward(yaw.current, pointer.current.x * PARALLAX_MAX, dt);
    g.rotation.set(0, yaw.current, 0);
  });
  return (
    <group ref={anchor}>
      <group ref={rig}>
        <Device screen={<HomeScreen frame={frame} />} />
      </group>
    </group>
  );
}

export default function InsideScene({
  onPainted,
  slot,
  frame,
  approach,
  dwell,
}: {
  onPainted: () => void;
  slot: RefObject<HTMLElement | null>;
  frame: number;
  approach: MotionValue<number>;
  dwell: MotionValue<number>;
}) {
  return (
    <Stage onPainted={onPainted} fov={30} position={[0, 0, 9]}>
      <fog attach="fog" args={[color.surface.game.base, 9, 24]} />
      <DeviceLights />
      <Skyline frame={frame} bg={color.surface.game.base} night />
      <InsideDevice slot={slot} frame={frame} approach={approach} dwell={dwell} />
    </Stage>
  );
}
