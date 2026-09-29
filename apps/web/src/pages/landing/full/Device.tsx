import { useMemo, type ReactNode } from 'react';
import { ContactShadows, Environment, Html, Lightformer } from '@react-three/drei';
import { Color, ExtrudeGeometry, Shape, ShapeGeometry } from 'three';
import { Surface } from '../../../design/Surface';
import { useStagePortal } from './Stage';
import { color } from '../../../design/tokens';

// The throughline device (round 4). A GENERIC phone — a rounded slab with a
// uniform bezel and a single camera dot; no notch or island silhouette, no
// replica proportions (Design Lead: trade dress). All geometry is
// procedural and the lighting is procedural Lightformers: no model files,
// no HDR downloads, no third-party assets to license.
//
// Its screen is LIVE: the same Game Day screen components as the ENHANCED
// tier, mounted with drei <Html transform occlude="blending"> so the DOM
// sits BEHIND the canvas (the glass sheen and any particles render over
// it), aria-hidden and pointer-events: none — the page's DOM carries the
// accessible text. One Html root per device.

/** The DOM screens are laid out at 280 × 580 css px (the ENHANCED phone's
 * screen inside its 300 × 600 frame), so the 3D screen has that aspect and
 * the body adds a uniform bezel: 300 × 600 css px ⇔ W × DEVICE_H world. */
const SCREEN_PX = { w: 280, h: 580 };
const W = 1;
const BEZEL = W * (10 / 300);
const SCREEN_W = W - BEZEL * 2;
const SCREEN_H = (SCREEN_W * SCREEN_PX.h) / SCREEN_PX.w;
export const DEVICE_H = SCREEN_H + BEZEL * 2;
const H = DEVICE_H;
const D = 0.085;
const SCREEN_R = SCREEN_W * (34 / 280);
/** drei Html transform maps 400 css px to `distanceFactor` world units. */
const DF = (400 * SCREEN_W) / SCREEN_PX.w;

function roundedRect(width: number, height: number, r: number) {
  const w = width / 2;
  const h = height / 2;
  const s = new Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
}

/** The screen's rounded rectangle: it is both the occluder that cuts the
 * canvas open over the DOM screen and the glass on top of it. */
const screenShape = () => new ShapeGeometry(roundedRect(SCREEN_W, SCREEN_H, SCREEN_R), 12);

/** The body: a rounded slab (corner radius = screen radius + bezel, so the
 * bezel is even all the way round) with a soft bevelled edge. */
const BEVEL = 0.018;
function bodyGeometry() {
  const g = new ExtrudeGeometry(roundedRect(W - BEVEL * 2, H - BEVEL * 2, SCREEN_R + BEZEL - BEVEL), {
    depth: D - BEVEL * 2,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 5,
    curveSegments: 16,
  });
  g.translate(0, 0, -(D - BEVEL * 2) / 2);
  return g;
}

export function DeviceLights() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 5]} intensity={1.1} />
      <Environment resolution={128} frames={1}>
        {/* Soft studio: a long key strip, two rims, a floor bounce. */}
        <Lightformer form="rect" intensity={3} position={[0, 3, 4]} scale={[6, 1.2, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[-4, 1, 1]} rotation-y={Math.PI / 2} scale={[4, 0.6, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[4, -0.5, 1]} rotation-y={-Math.PI / 2} scale={[4, 0.5, 1]} color={color.team.you.onGame} />
        <Lightformer form="rect" intensity={0.5} position={[0, -3, 2]} rotation-x={-Math.PI / 2} scale={[6, 4, 1]} />
      </Environment>
    </>
  );
}

export function Device({ screen, shadow = false }: { screen: ReactNode; shadow?: boolean }) {
  const bodyColor = useMemo(() => new Color(color.surface.game.base), []);
  const frameColor = useMemo(() => new Color(color.surface.game.raised), []);
  const glass = useMemo(screenShape, []);
  const body = useMemo(bodyGeometry, []);
  const portal = useStagePortal();
  return (
    <group>
      {/* Body: a bevelled slab, satin metal edges. */}
      <mesh geometry={body}>
        <meshPhysicalMaterial color={frameColor} metalness={0.75} roughness={0.28} clearcoat={1} clearcoatRoughness={0.15} envMapIntensity={1.2} />
      </mesh>
      {/* Screen well (the bezel colour). */}
      <mesh position={[0, 0, D / 2 + 0.001]}>
        <shapeGeometry args={[roundedRect(W - BEVEL * 2, H - BEVEL * 2, SCREEN_R + BEZEL - BEVEL), 16]} />
        <meshStandardMaterial color={bodyColor} roughness={0.9} />
      </mesh>
      {/* The live screen: DOM behind the canvas, cut through by an
          occluding plane (occlude="blending"). */}
      <Html
        transform
        occlude="blending"
        portal={portal as React.RefObject<HTMLElement>}
        geometry={<primitive object={glass} attach="geometry" />}
        distanceFactor={DF}
        position={[0, 0, D / 2 + 0.002]}
        zIndexRange={[100, 0]}
        pointerEvents="none"
        className="lp-3d-screen"
      >
        <div aria-hidden="true" className="lp-3d-screen__inner" style={{ width: SCREEN_PX.w, height: SCREEN_PX.h }}>
          <Surface kind="game" className="lp-phone__screen">
            {screen}
          </Surface>
        </div>
      </Html>
      {/* Glass: a thin reflective sheet over the screen — the studio strips
          slide across it as the device turns. */}
      <mesh geometry={glass} position={[0, 0, D / 2 + 0.004]}>
        <meshPhysicalMaterial
          transparent
          opacity={0.1}
          color={bodyColor}
          metalness={0}
          roughness={0.05}
          clearcoat={1}
          clearcoatRoughness={0.02}
          envMapIntensity={3}
          depthWrite={false}
        />
      </mesh>
      {/* The single camera dot. */}
      <mesh position={[0, H / 2 - BEZEL - 0.035, D / 2 + 0.005]}>
        <circleGeometry args={[0.018, 24]} />
        <meshStandardMaterial color={bodyColor} roughness={0.3} metalness={0.4} />
      </mesh>
      {shadow && <ContactShadows position={[0, -H / 2 - 0.08, 0]} opacity={0.35} scale={3} blur={2.6} far={1.6} resolution={256} frames={1} />}
    </group>
  );
}
