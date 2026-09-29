import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { color } from '../../../design/tokens';
import { world } from '../copy';
import { HomeScreen } from '../PhoneScreens';
import { TAPE } from '../sampleData';
import { useSlotAnchor } from './anchor';
import { City, type CityHover } from './City';
import { DEG, PARALLAX_MAX, clamp01, smooth, turnToward, usePointer } from './motion3d';
import { Device, DEVICE_H, DeviceLights, DeviceScreen } from './Device';
import { Stage } from './Stage';

// Hero (round 4; Design Lead redirect B). ONE composition: the device
// stands on the snow ground IN the market city, which rises behind it and
// recedes into fog. The camera sits a little above the ground looking
// slightly down (no roll, constant FOV). The whole world is anchored so the
// device lands exactly on its DOM slot. As the next layer rises over the
// hero, the device turns face-on for the "look inside" handoff.

export const HERO_YAW = -16 * DEG;
const IDLE_YAW = 4 * DEG;
const IDLE_PERIOD_S = 9;
const CAMERA: [number, number, number] = [0, 2.0, 9.5];

/** The camera looks slightly down at the device plane. */
function Aim() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.lookAt(0, 0.6, 0);
    camera.updateMatrixWorld();
  }, [camera]);
  return null;
}

/** Soft copy mask (≥120px feather), measured from the real copy box: the
 * city fades out before the headline and lede (desktop) or above the trust
 * row (phones); the device is always in the opaque part. */
function CopyMask() {
  const gl = useThree((s) => s.gl);
  const last = useRef('');
  useFrame(() => {
    const cv = gl.domElement;
    const hero = cv.closest('.lp-hero');
    const copy = hero?.querySelector('.lp-hero__copy');
    const meta = hero?.querySelector('.lp-hero__meta');
    if (!copy || !meta) return;
    const c = cv.getBoundingClientRect();
    let mask: string;
    if (window.innerWidth >= 1024) {
      const edge = copy.getBoundingClientRect().right - c.left;
      mask = `linear-gradient(90deg, transparent ${Math.round(edge - 40)}px, black ${Math.round(edge + 110)}px)`;
    } else {
      // The city rises from the trust row: at the text it is a whisper
      // (≤ ~10%, AA holds — pixel-sampled), full strength by the device.
      const m = meta.getBoundingClientRect();
      mask = `linear-gradient(180deg, transparent ${Math.round(m.top - c.top + 14)}px, black ${Math.round(m.bottom - c.top + 120)}px)`;
    }
    if (mask !== last.current) {
      last.current = mask;
      cv.style.maskImage = mask;
      cv.style.setProperty('-webkit-mask-image', mask);
    }
  });
  return null;
}

/** Hover only registers where the city is actually visible (unmasked). */
const hoverable = (x: number, y: number, c: DOMRect) =>
  window.innerWidth >= 1024 ? x > c.left + c.width * 0.62 : y > c.top + c.height * 0.62;

function HeroWorld({
  slot,
  screenEl,
  frame,
  onHover,
}: {
  slot: RefObject<HTMLElement | null>;
  screenEl: RefObject<HTMLDivElement | null>;
  frame: number;
  onHover: (h: CityHover) => void;
}) {
  // The world's origin is the ground under the device; the device's centre
  // (DEVICE_H/2 up) lands on the slot's centre.
  const anchor = useSlotAnchor(slot, DEVICE_H, DEVICE_H / 2);
  const turn = useRef<Group>(null);
  const pointer = usePointer();
  const yaw = useRef(HERO_YAW);
  useFrame((state, dt) => {
    const g = turn.current;
    if (!g) return;
    const covered = smooth(clamp01(window.scrollY / window.innerHeight));
    const idle = Math.sin((state.clock.elapsedTime / IDLE_PERIOD_S) * Math.PI * 2) * IDLE_YAW * (1 - covered);
    yaw.current = turnToward(yaw.current, HERO_YAW * (1 - covered) + idle + pointer.current.x * PARALLAX_MAX, dt);
    g.rotation.set(0, yaw.current, 0); // never pitch or roll: it stands on the ground
  });
  return (
    <group ref={anchor}>
      <City frame={frame} onHover={onHover} hoverable={hoverable} />
      <group ref={turn} position={[0, DEVICE_H / 2, 0]}>
        <Device screenEl={screenEl} />
      </group>
    </group>
  );
}

export default function HeroScene({ onPainted, slot, frame }: { onPainted: () => void; slot: RefObject<HTMLElement | null>; frame: number }) {
  // The hover tooltip is plain DOM, moved by ref (no re-render per move).
  const tip = useRef<HTMLSpanElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const onHover = useCallback((h: CityHover) => {
    const el = tip.current;
    if (!el) return;
    if (!h.cell) {
      el.dataset.on = 'false';
      return;
    }
    const q = TAPE.find((t) => t.t === h.cell!.t);
    el.textContent = q ? `${q.t} ${q.d}` : h.cell.t;
    el.dataset.on = 'true';
    el.style.transform = `translate(${Math.round(h.x + 14)}px, ${Math.round(h.y - 34)}px)`;
  }, []);
  return (
    <>
      <Stage
        onPainted={onPainted}
        fov={30}
        position={CAMERA}
        overlay={
          <DeviceScreen ref={screen}>
            <HomeScreen frame={frame} />
          </DeviceScreen>
        }
      >
        <Aim />
        <CopyMask />
        {/* Depth fog toward snow from ~40% of the city's depth to the
            horizon: the only thing that desaturates distance. */}
        <fog attach="fog" args={[color.bg.app, 18, 40]} />
        <DeviceLights rim />
        <HeroWorld slot={slot} screenEl={screen} frame={frame} onHover={onHover} />
      </Stage>
      <span ref={tip} className="lp-sky-tip" data-on="false" />
      <p className="lp-sky-caption">{world.skylineCaption}</p>
    </>
  );
}
