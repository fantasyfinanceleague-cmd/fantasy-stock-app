import { useEffect, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MotionValue } from 'motion/react';
import type { Group } from 'three';
import { color } from '../../../design/tokens';
import type { ChapterState } from '../pacing';
import { ChapterScreens, LEAD_CHANGE_DAY } from '../PhoneScreens';
import { useSlotAnchor } from './anchor';
import { Burst } from './Burst';
import { DEG, PARALLAX_MAX, clamp01, smooth, turnToward, usePointer } from './motion3d';
import { Device, DEVICE_H, DeviceLights } from './Device';
import { Stage } from './Stage';

// /01 How it works (round 4, storyboard scene 3). The device DIVES in from
// depth as the chapter arrives (a dolly at constant FOV), then holds in the
// phone slot while its live screen scrubs Draft → Compete → Climb with the
// steps. It yaws a little toward the steps per step (rate-limited, ≤30°/s).
// Beats get a burst out of the screen: the lead change (team blue) and the
// FINAL (live gold + gain). The standings get their 3D towers in /02.

const DIVE_DEPTH = 9;
const LEAD_COLORS = [color.team.you.base, color.team.you.onGame] as const;
const FINAL_COLORS = [color.live, color.data.gain.base, color.team.you.base] as const;
const STEP_YAW = [-12 * DEG, -4 * DEG, -9 * DEG] as const;

function ChapterDevice({ slot, state, arrive }: { slot: RefObject<HTMLElement | null>; state: ChapterState; arrive: MotionValue<number> }) {
  const anchor = useSlotAnchor(slot, DEVICE_H);
  const rig = useRef<Group>(null);
  const pointer = usePointer();
  const yaw = useRef<number>(STEP_YAW[0]);

  const leadChange = state.step === 1 && !state.final && state.day >= LEAD_CHANGE_DAY;
  const final = state.step === 1 && state.final;
  const [fires, setFires] = useState({ lead: 0, final: 0 });
  const was = useRef({ leadChange, final });
  useEffect(() => {
    // Fire on entering the beat, scrolling forward or back.
    if (leadChange && !was.current.leadChange) setFires((f) => ({ ...f, lead: f.lead + 1 }));
    if (final && !was.current.final) setFires((f) => ({ ...f, final: f.final + 1 }));
    was.current = { leadChange, final };
  }, [leadChange, final]);

  useFrame((_, dt) => {
    const g = rig.current;
    if (!g) return;
    const k = smooth(clamp01(arrive.get()));
    g.position.z = -DIVE_DEPTH * (1 - k);
    yaw.current = turnToward(yaw.current, STEP_YAW[state.step] + pointer.current.x * PARALLAX_MAX, dt);
    g.rotation.set(0, yaw.current, 0);
  });

  return (
    <group ref={anchor}>
      <group ref={rig}>
        <Device screen={<ChapterScreens state={state} />} />
        <Burst fire={fires.lead} colors={LEAD_COLORS} />
        <Burst fire={fires.final} colors={FINAL_COLORS} />
      </group>
    </group>
  );
}

export default function ChapterScene({
  onPainted,
  slot,
  state,
  arrive,
}: {
  onPainted: () => void;
  slot: RefObject<HTMLElement | null>;
  state: ChapterState;
  arrive: MotionValue<number>;
}) {
  return (
    <Stage onPainted={onPainted} fov={30} position={[0, 0, 9]}>
      <fog attach="fog" args={[color.bg.app, 12, 26]} />
      <DeviceLights />
      <ChapterDevice slot={slot} state={state} arrive={arrive} />
    </Stage>
  );
}
