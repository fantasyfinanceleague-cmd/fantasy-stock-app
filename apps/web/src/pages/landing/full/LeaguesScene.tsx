import { useEffect, useRef, useState, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { color } from '../../../design/tokens';
import { BOARD_FRAMES, PLAYERS, boardRanked } from '../sampleData';
import { Burst } from './Burst';
import { DeviceLights } from './Device';
import { Stage } from './Stage';
import { TOWER_GAP, Towers, towerHeight } from './Towers';

// /02 Leagues (round 4, storyboard scene 4): the league as an arena. Six
// standings towers stand far back in the navy, height = season %, Roberto
// in team blue, and they re-sort in step with the live DOM board beside
// them (same frame) — swapping along arcs. At FINAL · Week 6 Roberto's
// tower takes 1st and bursts. The DOM board carries every number; this is
// the atmosphere behind it (aria-hidden, masked clear of the copy).

const FINAL_COLORS = [color.live, color.data.gain.onGame, color.team.you.onGame] as const;
const DEPTH = -1.5;
/** Towers span this share of the board's width… */
const SPAN = 0.8;
/** …and the tallest fills this share of the space under the board. */
const FILL = 0.75;
const SPAN_UNITS = 5 * TOWER_GAP + 0.28;
const TALLEST = towerHeight(8.61) + 0.2;

/** Stands the arena centred under the board card, sized to it, on the
 * layer's floor (the bottom of the view at the towers' depth). */
function useUnderBoard(board: RefObject<HTMLElement | null>) {
  const group = useRef<Group>(null);
  const { camera, gl } = useThree();
  useFrame(() => {
    const el = board.current;
    const g = group.current;
    if (!el || !g) return;
    const r = el.getBoundingClientRect();
    const c = gl.domElement.getBoundingClientRect();
    if (!c.width || !c.height) return;
    const fov = ((camera as unknown as { fov: number }).fov * Math.PI) / 180;
    const halfH = Math.tan(fov / 2) * (camera.position.z - DEPTH);
    const perPx = (2 * halfH) / c.height;
    const cx = r.left + r.width / 2 - (c.left + c.width / 2);
    const space = Math.max(0, c.bottom - r.bottom) * perPx;
    const scale = Math.min((SPAN * r.width * perPx) / SPAN_UNITS, (FILL * space) / TALLEST);
    g.position.set(cx * perPx, -halfH, DEPTH);
    g.scale.setScalar(Math.max(0.001, scale));
    g.visible = scale > 0.05;
  });
  return group;
}

function Arena({ frame, board }: { frame: number; board: RefObject<HTMLElement | null> }) {
  const arena = useUnderBoard(board);
  const final = BOARD_FRAMES[frame]?.final === true;
  const [fire, setFire] = useState(0);
  const was = useRef(final);
  useEffect(() => {
    if (final && !was.current) setFire((f) => f + 1);
    was.current = final;
  }, [final]);

  const you = boardRanked(BOARD_FRAMES.length - 1).find((p) => p.you)!;
  const youX = (you.rank - 1 - (PLAYERS.length - 1) / 2) * TOWER_GAP;

  return (
    <group ref={arena}>
      <Towers frame={frame} rise={1} dark />
      <group position={[youX, towerHeight(you.pct) + 0.15, 0.3]}>
        <Burst fire={fire} colors={FINAL_COLORS} ring={{ w: 0.2, h: 0.12 }} />
      </group>
    </group>
  );
}

export default function LeaguesScene({ onPainted, frame, board }: { onPainted: () => void; frame: number; board: RefObject<HTMLElement | null> }) {
  return (
    <Stage onPainted={onPainted} fov={30} position={[0, 0, 9]}>
      <fog attach="fog" args={[color.surface.game.base, 9, 20]} />
      <DeviceLights />
      <Arena frame={frame} board={board} />
    </Stage>
  );
}
