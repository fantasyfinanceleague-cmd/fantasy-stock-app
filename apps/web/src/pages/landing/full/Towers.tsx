import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, type Group, type Mesh } from 'three';
import { color } from '../../../design/tokens';
import { BOARD_FRAMES, PLAYERS, boardRanked } from '../sampleData';

// The standings as six towers (round 4): height = season %, Roberto in team
// blue, ordered by rank left → right. When the rank order changes, towers
// swap along arcs (a lift over the neighbour, never a teleport). Used by
// the /01 climb (extruding behind the device) and /02 (the arena).

export const TOWER_GAP = 0.72;
const W = 0.28;
const MOVE_S = 0.9;
const GROW_RATE = 1.8; // units / s

export const towerHeight = (pct: number) => 0.6 + (pct + 3) * 0.17;

export function Towers({
  frame,
  rise,
  dark = false,
}: {
  frame: number;
  /** 0 = sunk into the floor, 1 = standing. */
  rise: number;
  dark?: boolean;
}) {
  const refs = useRef<Record<string, Mesh | null>>({});
  const group = useRef<Group>(null);
  const ranked = useMemo(() => boardRanked(Math.min(frame, BOARD_FRAMES.length - 1)), [frame]);
  const slot = (rank: number) => (rank - 1 - (PLAYERS.length - 1) / 2) * TOWER_GAP;
  // Per tower: where it is, where it is going, when the move started.
  const moves = useRef<Record<string, { from: number; to: number; t0: number; h: number }>>({});
  const colors = useMemo(() => {
    const quiet = new Color(dark ? color.text.onGame.secondary : color.text.secondary).lerp(
      new Color(dark ? color.surface.game.base : color.bg.app),
      dark ? 0.72 : 0.68
    );
    // Dark: kept near the navy so on-game text over them holds AA.
    const you = new Color(dark ? color.team.you.base : color.team.you.base);
    if (dark) you.lerp(new Color(color.surface.game.base), 0.35);
    return { you, quiet };
  }, [dark]);

  useFrame((_, dt) => {
    const now = performance.now() / 1000;
    ranked.forEach((p) => {
      const mesh = refs.current[p.id];
      if (!mesh) return;
      const target = slot(p.rank);
      let m = moves.current[p.id];
      if (!m) m = moves.current[p.id] = { from: target, to: target, t0: now, h: 0 };
      if (m.to !== target) {
        const k = Math.min(1, (now - m.t0) / MOVE_S);
        m.from = m.from + (m.to - m.from) * k;
        m.to = target;
        m.t0 = now;
      }
      const k = Math.min(1, (now - m.t0) / MOVE_S);
      const e = k * k * (3 - 2 * k);
      const x = m.from + (m.to - m.from) * e;
      const lift = m.from !== m.to ? Math.sin(Math.PI * e) * 0.35 : 0;
      const hTarget = towerHeight(p.pct) * rise;
      m.h += Math.sign(hTarget - m.h) * Math.min(Math.abs(hTarget - m.h), GROW_RATE * Math.min(dt, 0.1));
      const h = Math.max(0.001, m.h);
      mesh.visible = m.h > 0.002;
      mesh.scale.set(W, h, W);
      mesh.position.set(x, h / 2 + lift, (p.you ? 0.25 : 0) - (m.from !== m.to ? Math.sin(Math.PI * e) * 0.3 : 0));
    });
  });

  return (
    <group ref={group}>
      {PLAYERS.map((p) => (
        <mesh key={p.id} ref={(m) => void (refs.current[p.id] = m)} visible={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={p.you ? colors.you : colors.quiet} roughness={0.4} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}
