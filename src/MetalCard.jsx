/* ================= <MetalCard /> =================
   The reusable card. Two forms, because two different things are wanted at
   different times:

     <MetalCard config={cfg} />        self-contained, brings its own <Canvas>
     <MetalCardObject config={cfg} />  just the 3D object, for a Canvas you
                                       already have

   Everything about a card is the `config` prop — the metal, the lighting, the
   engraving, the foil, and the artwork with its image bytes inside it. Two
   cards differ only by that object, which is the whole point: the shell is
   one component, the picture is data.

   The card's lighting is applied as scene.environment rather than per
   material (see the note in engine/card.js — in three.js r180 the two are not
   equivalent and this is the one the material values were tuned against).
   That means one card's rig lights its whole scene, so <MetalCard> gives each
   card its own <Canvas>. If you put several MetalCardObjects in one Canvas
   they will share whichever rig mounted last. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { createCard } from '@engine/card.js';
import { createEnvironmentBuilder } from '@engine/environment.js';
import { normalizeConfig } from '@engine/config.js';

/* Rebuilding on every render would throw away the card's GPU resources each
   time a parent re-renders, so identity is keyed on the serialised config. */
function useStableConfig(config) {
  const json = JSON.stringify(config ?? {});
  return useMemo(() => normalizeConfig(config), [json]);   // eslint-disable-line react-hooks/exhaustive-deps
}

export function MetalCardObject({
  config,
  autoSway = true,
  interactive = true,
  hoverTilt = false,
  lights,
  onReady,
  onSnapshot,
  groupRef: externalGroupRef,
  hoverEnabledRef,
  transformRef,
}) {
  const cfg = useStableConfig(config);
  const { gl, scene, invalidate, size } = useThree();

  const [controller, setController] = useState(null);
  const groupRef = useRef(null);
  const callbackGroupRef = typeof externalGroupRef === 'function' ? externalGroupRef : null;
  const nodeRef = callbackGroupRef ? groupRef : (externalGroupRef ?? groupRef);

  useEffect(() => {
    callbackGroupRef?.(nodeRef.current);
    return () => callbackGroupRef?.(null);
  }, [callbackGroupRef, nodeRef]);

  /* Build the card once, tear it down properly on unmount. Without the
     dispose the GPU keeps every texture and geometry of every card that has
     ever been mounted, which a gallery notices fast. */
  useLayoutEffect(() => {
    const ctl = createCard(cfg);
    setController(ctl);
    ctl.ready().then(() => { invalidate(); onReady?.(ctl); });
    return () => { ctl.dispose(); setController(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Config changes after mount go through update(), which diffs and rebuilds
     only what moved — so animating a single value stays cheap. */
  useEffect(() => {
    if (!controller) return;
    controller.update(cfg);
    controller.ready().then(invalidate);
    invalidate();
  }, [controller, cfg, invalidate]);

  /* Lighting is a default, not a fixture:
       lights undefined  -> the card's own baked rig
       lights = null     -> touch nothing, reflect whatever the host scene has
       lights = [...]    -> a rig of your own
     The card is metal and shows only what is in front of it, so with null and
     an unlit scene it renders as a dark slab. That is correct for an object
     dropped into someone else's scene; it is their job to light it. */
  const ownRig = lights !== null;
  const rig = lights === undefined ? cfg.lights : lights;
  const rigKey = ownRig ? JSON.stringify(rig) : 'inherit';

  useEffect(() => {
    if (!ownRig) return undefined;
    const builder = createEnvironmentBuilder(gl);
    /* Restore whatever was there rather than nulling on the way out — this
       card may be a guest in a scene that had its own environment, and
       clearing it on unmount would put out the host's lights. */
    const previous = scene.environment;
    scene.environment = builder.build(rig);
    invalidate();
    return () => {
      scene.environment = previous;
      builder.dispose();
      invalidate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, rigKey, ownRig, invalidate]);

  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = cfg.camera.exposure / 100;
    invalidate();
  }, [gl, cfg.camera.exposure, invalidate]);

  /* ---- orientation ---- */
  const rot = useRef({ x: cfg.view.rotX, y: cfg.view.rotY });
  const drag = useRef(null);
  const hoverTarget = useRef({ x: 0, y: 0 });
  const hoverSpring = useRef({ x: 0, y: 0, vx: 0, vy: 0 });

  /* The focused garden card follows the pointer with a small spring. */
  useEffect(() => {
    hoverTarget.current = { x: 0, y: 0 };
    if ((!hoverTilt && !hoverEnabledRef) || typeof window === 'undefined') return undefined;
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const move = (event) => {
      if (query?.matches || drag.current || (hoverEnabledRef && !hoverEnabledRef.current)) return;
      const nx = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      const ny = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
      hoverTarget.current = {
        x: THREE.MathUtils.clamp(-ny * 7, -7, 7),
        y: THREE.MathUtils.clamp(nx * 10, -10, 10),
      };
      invalidate();
    };
    const leave = () => { hoverTarget.current = { x: 0, y: 0 }; invalidate(); };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('blur', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('blur', leave);
    };
  }, [hoverTilt, hoverEnabledRef, invalidate]);

  useEffect(() => { rot.current = { x: cfg.view.rotX, y: cfg.view.rotY }; }, [cfg.view.rotX, cfg.view.rotY]);

  /* Capture the first properly-drawn frame as a PNG, so a gallery can show a
     still instead of holding a live WebGL context open per card. useFrame runs
     BEFORE the render, so with preserveDrawingBuffer the buffer we read at the
     top of frame N holds frame N-1 — hence waiting a couple of frames after
     the artwork reports ready rather than grabbing the first one and getting
     an empty buffer. */
  const snapState = useRef({ done: false, settle: 0, ready: false });
  useEffect(() => {
    if (!controller || !onSnapshot) return;
    controller.ready().then(() => { snapState.current.ready = true; invalidate(); });
  }, [controller, onSnapshot, invalidate]);

  const euler = useMemo(() => new THREE.Euler(), []);
  useFrame((state, delta) => {
    const g = nodeRef.current;
    const snap = snapState.current;
    if (onSnapshot && !snap.done && snap.ready) {
      if (snap.settle++ >= 2) {
        snap.done = true;
        try { onSnapshot(gl.domElement.toDataURL('image/png')); }
        catch (err) { console.warn('Could not capture the card.', err); }
      } else {
        invalidate();
      }
    }
    if (!g) return;
    if (autoSway && !drag.current) {
      const t = state.clock.elapsedTime * 1000;
      rot.current.y = 26 * Math.sin(t / 4200);
      rot.current.x = -8 + 5 * Math.sin(t / 6100);
    }
    const spring = hoverSpring.current;
    const target = hoverTarget.current;
    const step = Math.min(delta, 0.05);
    spring.vx += ((target.x - spring.x) * 150 - spring.vx * 22) * step;
    spring.vy += ((target.y - spring.y) * 150 - spring.vy * 22) * step;
    spring.x += spring.vx * step;
    spring.y += spring.vy * step;
    const hoverOn = hoverEnabledRef ? hoverEnabledRef.current : hoverTilt;
    const external = transformRef?.current;
    if (hoverOn && (Math.abs(spring.x - target.x) > 0.01
      || Math.abs(spring.y - target.y) > 0.01
      || Math.abs(spring.vx) > 0.01 || Math.abs(spring.vy) > 0.01)) invalidate();
    euler.set(
      THREE.MathUtils.degToRad(external?.x ?? (rot.current.x + (hoverOn ? spring.x : 0))),
      THREE.MathUtils.degToRad(external?.y ?? (rot.current.y + (hoverOn ? spring.y : 0))),
      THREE.MathUtils.degToRad(external?.z ?? 0), 'XYZ');
    g.quaternion.setFromEuler(euler);
  });

  const pointerHandlers = interactive ? {
    onPointerDown: (e) => {
      e.stopPropagation();
      e.target.setPointerCapture?.(e.pointerId);
      hoverTarget.current = { x: 0, y: 0 };
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, rot: { ...rot.current } };
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      rot.current.x = THREE.MathUtils.clamp(d.rot.x - (e.clientY - d.y) / size.height * 120, -68, 68);
      rot.current.y = THREE.MathUtils.clamp(d.rot.y + (e.clientX - d.x) / size.width * 220, -68, 68);
      invalidate();
    },
    onPointerUp: (e) => {
      if (drag.current?.id === e.pointerId) drag.current = null;
    },
  } : {};

  return (
    <group ref={nodeRef} {...pointerHandlers}>
      {controller && <primitive object={controller.group} />}
    </group>
  );
}

export default function MetalCard({
  config,
  autoSway = true,
  interactive = true,
  hoverTilt = false,
  lights,
  fill = true,
  onReady,
  onSnapshot,
  className,
  style,
  background = 'transparent',
  dpr = [1, 2],
}) {
  const cfg = useStableConfig(config);
  /* The playground's "Distance" dial is a camera z in card units; keeping the
     same number here means a copied card frames identically. */
  const z = cfg.camera.zoom / 10;

  /* R3F sizes its canvas from a ResizeObserver on the container, and that
     first measurement can simply not arrive — the canvas keeps the HTML
     default 300x150, never renders, and anything waiting on it (a thumbnail
     capture, say) waits forever. Nothing resizes afterwards to correct it.

     A single nudge on the next frame was not enough: it fires before R3F is
     listening. So this watches until the canvas actually matches its box,
     nudging while it does not, and gives up after half a second rather than
     spinning forever. */
  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let frame = 0, tries = 0;
    const settle = () => {
      const canvas = host.querySelector('canvas');
      const box = host.getBoundingClientRect();
      if (canvas && box.width > 1) {
        if (Math.abs(canvas.clientWidth - box.width) <= 1) return;   // measured
        window.dispatchEvent(new Event('resize'));
      }
      if (++tries < 30) frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={hostRef} className={className} style={{ width: '100%', height: '100%', background, ...style }}>
      <Canvas
        dpr={dpr}
        resize={{ debounce: 0 }}
        /* toDataURL only sees pixels if the buffer survives compositing, and
           that costs memory — so it is only asked for when capturing. */
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance',
              preserveDrawingBuffer: !!onSnapshot }}
        camera={{ fov: 30, position: [0, 0, z], near: 0.1, far: 60 }}
        /* "demand" so a still card costs zero frames; autoSway switches it
           back to always, because a sway has to animate. */
        frameloop={autoSway ? 'always' : 'demand'}
      >
        {/* A little direct light on top of the reflected room. Off with
            fill={false} when you want the card lit purely by an environment
            of your own. */}
        {fill && <ambientLight intensity={0.36} />}
        {fill && <directionalLight position={[-4, 5, 7]} intensity={0.34} />}
        <MetalCardObject
          config={cfg}
          autoSway={autoSway}
          interactive={interactive}
          hoverTilt={hoverTilt}
          lights={lights}
          onReady={onReady}
          onSnapshot={onSnapshot}
        />
      </Canvas>
    </div>
  );
}
