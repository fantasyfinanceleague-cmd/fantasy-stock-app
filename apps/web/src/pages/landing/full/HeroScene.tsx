import { useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { color } from '../../../design/tokens';
import { HomeScreen } from '../PhoneScreens';
import { useSlotAnchor } from './anchor';
import { DEG, PARALLAX_MAX, clamp01, smooth, turnToward, usePointer } from './motion3d';
import { Device, DEVICE_H, DeviceLights } from './Device';
import { Skyline } from './Skyline';
import { Stage } from './Stage';

// Hero (round 4, storyboard scene 1): the device floats in its slot beside
// the headline with a slow idle yaw, over the market skyline. As the next
// layer rises over the hero, the device turns face-on — so the "look
// inside" layer can pick it up face-on (a matched-action cut).

/** The resting three-quarter turn, screen toward the headline. */
export const HERO_YAW = -16 * DEG;
// No resting pitch: the device sits off the optical axis, where any pitch
// makes its vertical edges lean and reads as a roll (vestibular rule: no roll).
export const HERO_PITCH = 0;
const IDLE_YAW = 4 * DEG;
const IDLE_PERIOD_S = 9;

function HeroDevice({ slot, frame }: { slot: RefObject<HTMLElement | null>; frame: number }) {
  const anchor = useSlotAnchor(slot, DEVICE_H);
  const turn = useRef<Group>(null);
  const pointer = usePointer();
  const yaw = useRef(HERO_YAW);
  const pitch = useRef(HERO_PITCH);
  useFrame((state, dt) => {
    const g = turn.current;
    if (!g) return;
    // How far the next layer has risen over the hero (hero is first).
    const covered = smooth(clamp01(window.scrollY / window.innerHeight));
    const idle = Math.sin((state.clock.elapsedTime / IDLE_PERIOD_S) * Math.PI * 2) * IDLE_YAW * (1 - covered);
    const targetYaw = HERO_YAW * (1 - covered) + idle + pointer.current.x * PARALLAX_MAX;
    const targetPitch = HERO_PITCH * (1 - covered) + pointer.current.y * PARALLAX_MAX * 0.5;
    yaw.current = turnToward(yaw.current, targetYaw, dt);
    pitch.current = turnToward(pitch.current, targetPitch, dt);
    g.rotation.set(pitch.current, yaw.current, 0); // never roll
    g.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.025;
  });
  return (
    <group ref={anchor}>
      <group ref={turn}>
        <Device screen={<HomeScreen frame={frame} />} />
      </group>
    </group>
  );
}

export default function HeroScene({ onPainted, slot, frame }: { onPainted: () => void; slot: RefObject<HTMLElement | null>; frame: number }) {
  return (
    <Stage onPainted={onPainted} fov={30} position={[0, 0, 9]}>
      <fog attach="fog" args={[color.bg.app, 10, 26]} />
      <DeviceLights />
      <Skyline frame={frame} bg={color.bg.app} />
      <HeroDevice slot={slot} frame={frame} />
    </Stage>
  );
}
