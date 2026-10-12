import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Color, ExtrudeGeometry, Shape, ShapeGeometry, Vector3, type Mesh } from 'three';
import { Surface } from '../../../design/Surface';
import { homographyMatrix3d, type Quad } from './homography';
import { color } from '../../../design/tokens';

// The throughline device (round 4). A GENERIC phone — a rounded slab with a
// uniform bezel and a single camera dot; no notch or island silhouette, no
// replica proportions (Design Lead: trade dress). All geometry is
// procedural and the lighting is procedural Lightformers: no model files,
// no HDR downloads, no third-party assets to license.
//
// Its screen is LIVE: the same Game Day screen components as the ENHANCED
// tier, as a DOM overlay (DeviceScreen) BEHIND the canvas. Each frame the
// screen's four corners are projected with the GL camera and the DOM is
// mapped onto that quad by one 2D projective matrix3d (homography.ts) —
// no CSS 3D context, so every engine agrees with the GL body. An occluder
// cuts the canvas open over it (the glass sheen then draws on top). The
// overlay is aria-hidden and pointer-events: none; the page's DOM carries
// the accessible text.

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

export function DeviceLights({ rim = false }: { rim?: boolean }) {
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 4, 5]} intensity={1.1} />
      {/* Rim: a back light on the far long edge, so the device reads lit
          on both sides (Design Lead: at 375 one edge went unlit black). */}
      {rim && <directionalLight position={[-4, 3, -5]} intensity={1.4} />}
      <Environment resolution={128} frames={1}>
        {rim && <Lightformer form="rect" intensity={5} position={[-3.2, 0.5, -2.5]} rotation-y={Math.PI * 0.8} scale={[0.35, 7, 1]} />}
        {rim && <Lightformer form="rect" intensity={2.5} position={[3.2, 0.5, -2.5]} rotation-y={-Math.PI * 0.8} scale={[0.25, 7, 1]} />}
        {/* Soft studio: a long key strip, two rims, a floor bounce. */}
        <Lightformer form="rect" intensity={3} position={[0, 3, 4]} scale={[6, 1.2, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[-4, 1, 1]} rotation-y={Math.PI / 2} scale={[4, 0.6, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[4, -0.5, 1]} rotation-y={-Math.PI / 2} scale={[4, 0.5, 1]} color={color.team.you.onGame} />
        <Lightformer form="rect" intensity={0.5} position={[0, -3, 2]} rotation-x={-Math.PI / 2} scale={[6, 4, 1]} />
      </Environment>
    </>
  );
}

/** The DOM screen, rendered by a scene OUTSIDE its canvas (in the stage's
 * DOM, behind the canvas) and positioned by the Device each frame. Hidden
 * until the first projection lands. */
export function DeviceScreen({ ref, children }: { ref: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <div ref={ref} className="lp-3d-screen" aria-hidden="true" style={{ width: SCREEN_PX.w, height: SCREEN_PX.h }}>
      <div className="lp-3d-screen__inner">
        <Surface kind="game" className="lp-phone__screen">
          {children}
        </Surface>
      </div>
    </div>
  );
}

const SCREEN_Z = D / 2 + 0.002;
const CORNERS = [
  [-SCREEN_W / 2, SCREEN_H / 2],
  [SCREEN_W / 2, SCREEN_H / 2],
  [SCREEN_W / 2, -SCREEN_H / 2],
  [-SCREEN_W / 2, -SCREEN_H / 2],
] as const;
const OCCLUDE_FRAG = 'void main() { gl_FragColor = vec4(0.0); }';
const OCCLUDE_VERT = 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

/** Cuts the canvas open over the screen and maps the DOM screen onto it. */
function LiveScreen({ geometry, screenEl }: { geometry: ShapeGeometry; screenEl: RefObject<HTMLDivElement | null> }) {
  const occluder = useRef<Mesh>(null);
  const { camera, size } = useThree();
  const v = useMemo(() => new Vector3(), []);
  const last = useRef('');
  useFrame(() => {
    const m = occluder.current;
    const el = screenEl.current;
    if (!m || !el) return;
    m.updateWorldMatrix(true, false);
    let behind = false;
    const q = CORNERS.map(([x, y]) => {
      v.set(x, y, 0).applyMatrix4(m.matrixWorld).project(camera);
      if (v.z > 1) behind = true;
      return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height] as const;
    }) as unknown as Quad;
    const t = behind ? '' : homographyMatrix3d(SCREEN_PX.w, SCREEN_PX.h, q);
    if (t !== last.current) {
      last.current = t;
      el.style.transform = t;
      el.style.visibility = t ? 'visible' : 'hidden';
    }
  });
  return (
    <mesh ref={occluder} geometry={geometry} position={[0, 0, SCREEN_Z]}>
      <shaderMaterial vertexShader={OCCLUDE_VERT} fragmentShader={OCCLUDE_FRAG} />
    </mesh>
  );
}

export function Device({ screenEl, shadow = false }: { screenEl: RefObject<HTMLDivElement | null>; shadow?: boolean }) {
  const bodyColor = useMemo(() => new Color(color.surface.game.base), []);
  const frameColor = useMemo(() => new Color(color.surface.game.raised), []);
  const glass = useMemo(screenShape, []);
  const body = useMemo(bodyGeometry, []);
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
      {/* The live screen: the DOM overlay behind the canvas, cut open here. */}
      <LiveScreen geometry={glass} screenEl={screenEl} />
      {/* Glass: a thin reflective sheet over the screen — the studio strips
          slide across it as the device turns. */}
      <mesh geometry={glass} position={[0, 0, D / 2 + 0.004]}>
        <meshPhysicalMaterial
          transparent
          opacity={0.12}
          color={bodyColor}
          metalness={0}
          roughness={0.05}
          clearcoat={1}
          clearcoatRoughness={0.02}
          envMapIntensity={3}
          depthWrite={false}
        />
      </mesh>
      {/* The single camera dot, recessed: a lens inside a slightly lighter ring. */}
      <mesh position={[0, H / 2 - BEZEL - 0.035, D / 2 + 0.005]}>
        <circleGeometry args={[0.022, 28]} />
        <meshStandardMaterial color={frameColor} roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, H / 2 - BEZEL - 0.035, D / 2 + 0.006]}>
        <circleGeometry args={[0.014, 28]} />
        <meshPhysicalMaterial color="black" roughness={0.1} clearcoat={1} />
      </mesh>
      {shadow && <ContactShadows position={[0, -H / 2 - 0.08, 0]} opacity={0.35} scale={3} blur={2.6} far={1.6} resolution={256} frames={1} />}
    </group>
  );
}
