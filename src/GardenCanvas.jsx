import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { createEnvironmentBuilder } from '@engine/environment.js';
import { MetalCardObject } from './MetalCard.jsx';

const FOV = 30;
const CAMERA_Z = 9.28;
/* Match the architecture used by fast, card-heavy WebGL showcases: keep a
   small circular pool around the focused card instead of constructing every
   saved card on the GPU. Three cards of runway on either side are enough to
   cover the viewport and warm the next card before it can enter. */
export const GARDEN_POOL_RADIUS = 3;
const wrappedDistance = (index, center, length) => {
  if (length <= 1) return index - center;
  const linear = index - center;
  return ((linear + length / 2) % length + length) % length - length / 2;
};
/* The garden is a live catalogue, not a still render. A full-resolution
   scene plus a second optical pass can miss the frame budget on the devices
   most likely to visit the deployed page. Keep one crisp desktop tier and a
   deliberately bounded phone tier; the card's geometry and textures remain
   unchanged. */
function gardenPixelRatio() {
  if (typeof window === 'undefined') return 1;
  const isPhone = window.innerWidth < 600;
  const maxDpr = isPhone ? 1 : 1.25;
  return Math.min(window.devicePixelRatio || 1, maxDpr);
}
const GARDEN_MOTION_DEFAULTS = Object.freeze({
  hoverSensitivity: 24,
  entryAngle: 90,
  entryYaw: 37,
  entryTwist: -9,
  exitAngle: 120,
  exitYaw: -49,
  exitTwist: 12,
  flattenDistance: 0,
  rollDistance: 1.6,
  easing: 'smoothstep',
  topCenterSensitivity: 30,
  bottomCenterSensitivity: 30,
  leftCenterSensitivity: 30,
  rightCenterSensitivity: 30,
});

const LENS_VERTEX_SHADER = /* glsl */`
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const LENS_FRAGMENT_SHADER = /* glsl */`
  uniform sampler2D tScene;
  uniform vec2 uResolution;
  uniform float uEdgeSize;
  uniform float uDistortionX;
  uniform float uDistortionY;
  uniform float uMagnification;
  uniform float uRedShift;
  uniform float uBlueShift;
  uniform float uTangential;
  uniform float uFalloff;
  uniform float uEdgeSoftness;
  uniform float uVignette;
  varying vec2 vUv;

  void main() {
    vec2 centred = vUv - 0.5;
    float edgeDistance = abs(centred.y) * 2.0;
    float edgeStart = 1.0 - uEdgeSize;
    float edgeEnd = edgeStart + uEdgeSize * uEdgeSoftness;
    float edge = smoothstep(edgeStart, edgeEnd, edgeDistance);
    edge = pow(edge, uFalloff);

    float radius2 = dot(centred, centred);
    vec2 magnifiedUv = vec2(0.5) + centred * (1.0 + uMagnification * edge);
    vec2 warpedUv = magnifiedUv + centred * radius2
      * vec2(uDistortionX, uDistortionY) * edge;
    vec2 radial = centred / max(length(centred), 0.0001);
    vec2 tangent = vec2(-radial.y, radial.x);
    vec2 redOffset = (radial * uRedShift + tangent * uTangential)
      / uResolution * edge;
    vec2 blueOffset = (radial * uBlueShift - tangent * uTangential)
      / uResolution * edge;

    float red = texture2D(tScene, warpedUv + redOffset).r;
    float green = texture2D(tScene, warpedUv).g;
    float blue = texture2D(tScene, warpedUv + blueOffset).b;
    float alpha = texture2D(tScene, warpedUv).a;
    vec3 colour = vec3(red, green, blue) * (1.0 - uVignette * edge);

    gl_FragColor = vec4(colour, alpha);
    /* ShaderMaterial exposes these Three.js chunks but does not run them for
       a hand-written fragment output. Calling both is what keeps the optical
       pass in the same ACES and output-color space as the direct scene. */
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* One full-screen optical pass after the garden scene. The distortion is
   masked to the same screen-space height as the glass veils, leaving the
   focused card in the middle pixel-perfect while the incoming and outgoing
   cards pick up the slight bend and colour separation of thick glass. */
function GardenLensPass({ effects, motionRef }) {
  const { gl, scene, camera, size } = useThree();
  const target = useMemo(() => {
    const next = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      /* The optical pass renders the scene into an offscreen target. Keep
         multisample coverage there too; Canvas' own antialias setting cannot
         smooth the card silhouette after it has been redirected into this
         texture. WebGL1 simply ignores the option. */
      /* Two samples preserve the silhouette while avoiding a 4x offscreen
         resolve on browsers with a slower WebGL implementation. */
      samples: 2,
    });
    /* Keep the intermediate scene texture linear. The final ShaderMaterial
       is rendered by the same renderer and performs the single output-color
       conversion; marking this target as display-encoded first would make
       the optical pass visibly darker than the direct scene. */
    next.texture.colorSpace = THREE.NoColorSpace;
    return next;
  }, [gl]);
  const pass = useMemo(() => {
    const passScene = new THREE.Scene();
    const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: LENS_VERTEX_SHADER,
      fragmentShader: LENS_FRAGMENT_SHADER,
      uniforms: {
        tScene: { value: target.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uEdgeSize: { value: 0.25 },
        uDistortionX: { value: 0 },
        uDistortionY: { value: 0 },
        uMagnification: { value: 0 },
        uRedShift: { value: 0 },
        uBlueShift: { value: 0 },
        uTangential: { value: 0 },
        uFalloff: { value: 1 },
        uEdgeSoftness: { value: 0.65 },
        uVignette: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      /* Rendering the scene into a target skips the renderer's tone-mapping
         stage. Re-enable it for this final fullscreen material so the optical
         path matches the direct Canvas path in exposure and highlight range. */
      toneMapped: true,
    });
    passScene.add(new THREE.Mesh(geometry, material));
    return { scene: passScene, camera: passCamera, geometry, material };
  }, [target]);

  useEffect(() => () => {
    pass.geometry.dispose();
    pass.material.dispose();
    target.dispose();
  }, [pass, target]);

  useFrame(() => {
    /* The edge lens doubles the scene render cost. While the stack is moving,
       render the clean scene directly; the CSS glass remains visible and the
       optical treatment returns after the short settle. This keeps scrolling
       inside the frame budget without changing the resting composition. */
    const moving = performance.now() - (motionRef.current.lastMotionAt || 0) < 140;
    if (moving) {
      gl.setRenderTarget(null);
      gl.clear();
      gl.render(scene, camera);
      return;
    }
    const dpr = gl.getPixelRatio();
    const width = Math.max(1, Math.round(size.width * dpr));
    const height = Math.max(1, Math.round(size.height * dpr));
    if (target.width !== width || target.height !== height) target.setSize(width, height);

    const uniforms = pass.material.uniforms;
    uniforms.uResolution.value.set(width, height);
    uniforms.uEdgeSize.value = THREE.MathUtils.clamp(
      (2 * effects.edgeHeight * effects.edgeCoverage) / Math.max(size.height, 1), 0.02, 0.9);
    uniforms.uDistortionX.value = effects.distortionX;
    uniforms.uDistortionY.value = effects.distortionY;
    uniforms.uMagnification.value = effects.magnification;
    uniforms.uRedShift.value = effects.chromatic.redShift * dpr;
    uniforms.uBlueShift.value = effects.chromatic.blueShift * dpr;
    uniforms.uTangential.value = effects.chromatic.tangential * dpr;
    uniforms.uFalloff.value = effects.falloff;
    uniforms.uEdgeSoftness.value = effects.edgeSoftness;
    uniforms.uVignette.value = effects.vignette;

    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    gl.clear();
    gl.render(pass.scene, pass.camera);
  }, 1);

  return null;
}

function GardenScene({ cards, activeIndex, poolRadius, motionRef, lights, onCardReady }) {
  const { gl, scene, camera, invalidate } = useThree();
  const groups = useRef([]);
  const hoverEnabled = useRef([]);
  const rotations = useRef([]);
  const bounds = useMemo(() => new THREE.Box3(), []);
  const corner = useMemo(() => new THREE.Vector3(), []);
  const environmentKey = useMemo(() => JSON.stringify(lights ?? []), [lights]);
  const exposure = cards[0]?.config?.camera?.exposure ?? 100;
  const liveCards = useMemo(() => cards
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => Math.abs(wrappedDistance(index, activeIndex, cards.length)) <= poolRadius),
  [cards, activeIndex, poolRadius]);

  useEffect(() => {
    motionRef.current.invalidate = invalidate;
    invalidate();
    return () => {
      if (motionRef.current.invalidate === invalidate) motionRef.current.invalidate = null;
    };
  }, [invalidate, motionRef]);

  useEffect(() => {
    camera.position.set(0, 0, CAMERA_Z);
    camera.fov = FOV;
    camera.near = 0.1;
    camera.far = 80;
    camera.updateProjectionMatrix();
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure / 100;
  }, [camera, gl, exposure]);

  useEffect(() => {
    const builder = createEnvironmentBuilder(gl);
    const previous = scene.environment;
    scene.environment = builder.build(lights);
    invalidate();
    return () => {
      scene.environment = previous;
      builder.dispose();
    };
  }, [environmentKey, gl, scene, lights, invalidate]);

  useFrame((_, delta) => {
    const motion = motionRef.current;
    const tuning = motion.tuning ?? GARDEN_MOTION_DEFAULTS;
    // Track the cursor promptly, but use a softer release when it leaves the
    // card so the rotation settles back to neutral instead of snapping.
    const hoverSpeed = motion.pointerOverCard ? 14 : 5.5;
    const hoverEase = 1 - Math.exp(-Math.min(delta, 0.05) * hoverSpeed);
    motion.hoverCurrentX = THREE.MathUtils.lerp(
      motion.hoverCurrentX || 0, motion.hoverCardX || 0, hoverEase);
    motion.hoverCurrentY = THREE.MathUtils.lerp(
      motion.hoverCurrentY || 0, motion.hoverCardY || 0, hoverEase);
    const hoverStillSettling = Math.abs((motion.hoverCurrentX || 0) - (motion.hoverCardX || 0)) > 0.001
      || Math.abs((motion.hoverCurrentY || 0) - (motion.hoverCardY || 0)) > 0.001;
    const pxToWorld = (motion.viewportH > 0)
      ? (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAMERA_Z) / motion.viewportH
      : 0.01;
    const gap = motion.sectionH * pxToWorld;
    const center = motion.floatIndex;
    const grid = motion.gridProgress > 0 && !motion.isMobile;
    const columns = Math.max(1, motion.gridColumns || 1);
    const cardGap = motion.gridCardSizePx * pxToWorld;
    const rowGap = motion.gridItemHeightPx * pxToWorld;
    const rows = Math.ceil(cards.length / columns);

    groups.current.forEach((group, index) => {
      if (!group) return;
      const linearDistance = index - center;
      const distance = motion.loop
        ? ((linearDistance + cards.length / 2) % cards.length + cards.length) % cards.length - cards.length / 2
        : linearDistance;
      if (!hoverEnabled.current[index]) hoverEnabled.current[index] = { current: false };
      hoverEnabled.current[index].current = !grid && Math.abs(distance) < 0.5;
      if (!rotations.current[index]) {
        rotations.current[index] = { current: {
          x: cards[index].config.view?.rotX ?? 0,
          y: cards[index].config.view?.rotY ?? 0,
        } };
      }
      const baseX = cards[index].config.view?.rotX ?? 0;
      const baseY = cards[index].config.view?.rotY ?? 0;
      const saved = motion.cardRotations?.[index] ?? { x: 0, y: 0 };
      const active = !grid && Math.abs(distance) < 0.5;
      const cardX = motion.hoverCurrentX || 0;
      const cardY = motion.hoverCurrentY || 0;
      const verticalSensitivity = cardY < 0
        ? tuning.topCenterSensitivity
        : tuning.bottomCenterSensitivity;
      const horizontalSensitivity = cardX < 0
        ? tuning.leftCenterSensitivity
        : tuning.rightCenterSensitivity;
      const sensitivityScale = tuning.hoverSensitivity / 30;
      const hoverX = active && !motion.dragging
        ? -cardY * verticalSensitivity * sensitivityScale : 0;
      const hoverY = active && !motion.dragging
        ? cardX * horizontalSensitivity * sensitivityScale : 0;
      /* Ratchet-like entrance: a card approaching from either side is held
         on a diagonal, then eases flat as it reaches the focal plane. This
         is driven directly by scroll position, so it stays interruptible and
         never restarts or lags behind the user's hand. */
      const flattenDistance = tuning.flattenDistance;
      const rollSpan = Math.max(tuning.rollDistance, flattenDistance + 0.01);
      const rollDistance = Math.min(Math.max(Math.abs(distance) - flattenDistance, 0), rollSpan);
      const rollT = rollDistance / rollSpan;
      const easedRoll = tuning.easing === 'linear'
        ? rollT
        : tuning.easing === 'cubic'
          ? easeOutCubic(rollT)
          : rollT * rollT * (3 - 2 * rollT);
      const enteringFromTop = distance < 0;
      const rollSign = enteringFromTop ? -1 : 1;
      const rollAmount = enteringFromTop ? tuning.entryAngle : tuning.exitAngle;
      const yawAmount = enteringFromTop ? tuning.entryYaw : tuning.exitYaw;
      const twistAmount = enteringFromTop ? tuning.entryTwist : tuning.exitTwist;
      const rollX = motion.reducedMotion || grid ? 0 : rollSign * easedRoll * rollAmount;
      const rollY = motion.reducedMotion || grid ? 0 : easedRoll * yawAmount;
      const rollZ = motion.reducedMotion || grid ? 0 : easedRoll * twistAmount;
      rotations.current[index].current.x = baseX + saved.x + hoverX + rollX;
      rotations.current[index].current.y = baseY + saved.y + hoverY + rollY;
      rotations.current[index].current.z = rollZ;
      const listY = -distance * gap;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const gridX = (column - (columns - 1) / 2) * cardGap;
      const gridY = (row - (rows - 1) / 2) * rowGap;
      const t = grid ? motion.gridProgress : 0;
      group.position.x = THREE.MathUtils.lerp(0, gridX, t);
      group.position.y = THREE.MathUtils.lerp(listY, gridY, t);
      group.visible = grid || Math.abs(distance) < 4.5;
      /* The layout frame is intentionally larger than the visible card to
         leave room for tilt. On phones the same world-space card otherwise
         fills the viewport before perspective and the edge optics are applied.
         Scale the whole group so the card and every inset detail stay together. */
      /* CSS has clamp(); for the Three.js group use the same bounded rule so
         a narrow phone does not inherit a near-desktop card footprint. The
         viewport width is in CSS pixels, while the scale is world-space. */
      const mobileListScale = THREE.MathUtils.clamp(
        (motion.viewportW || 390) / 860, 0.42, 0.56);
      const listScale = motion.isMobile ? mobileListScale : 1;
      const gridScale = 0.72;
      group.scale.setScalar(THREE.MathUtils.lerp(listScale, gridScale, t));
    });

    const focusedIndex = cards.length
      ? ((Math.round(center) % cards.length) + cards.length) % cards.length
      : 0;
    const focused = groups.current[focusedIndex];
    if (focused && !grid) {
      bounds.setFromObject(focused);
      const min = { x: Infinity, y: Infinity };
      const max = { x: -Infinity, y: -Infinity };
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            corner.set(x, y, z).project(camera);
            const px = (corner.x * 0.5 + 0.5) * motion.viewportW;
            const py = (-corner.y * 0.5 + 0.5) * motion.viewportH;
            min.x = Math.min(min.x, px); min.y = Math.min(min.y, py);
            max.x = Math.max(max.x, px); max.y = Math.max(max.y, py);
          }
        }
      }
      motion.cardRect = { left: min.x, right: max.x, top: min.y, bottom: max.y };
    } else {
      motion.cardRect = null;
    }
    if (hoverStillSettling || motion.dragging) invalidate();
  });

  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[-4, 5, 7]} intensity={0.24} />
      {liveCards.map(({ entry, index }) => (
        <MetalCardObject
          key={entry.id || index}
          config={entry.config}
          autoSway={false}
          interactive={false}
          hoverTilt={false}
          lights={null}
          groupRef={(node) => { groups.current[index] = node; }}
          hoverEnabledRef={(hoverEnabled.current[index] ??= { current: false })}
          transformRef={(rotations.current[index] ??= { current: {
            x: entry.config.view?.rotX ?? 0,
            y: entry.config.view?.rotY ?? 0,
          } })}
          onReady={() => onCardReady?.(entry.id || index)}
        />
      ))}
    </>
  );
}

export default function GardenCanvas({
  cards, activeIndex, revealed, motionRef, lights, lensEffects, motionTuning, onCardReady,
}) {
  motionRef.current.tuning = motionTuning ?? GARDEN_MOTION_DEFAULTS;
  const hostRef = useRef(null);
  const [poolRadius, setPoolRadius] = useState(revealed ? GARDEN_POOL_RADIUS : 1);
  useEffect(() => {
    if (!revealed) {
      setPoolRadius(1);
      return undefined;
    }
    const expand = () => setPoolRadius(GARDEN_POOL_RADIUS);
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(expand, { timeout: 1200 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(expand, 700);
    return () => window.clearTimeout(timer);
  }, [revealed]);
  const updatePointer = (event) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const cardRect = motionRef.current.cardRect;
    const overCard = !!cardRect
      && x >= cardRect.left && x <= cardRect.right
      && y >= cardRect.top && y <= cardRect.bottom;
    motionRef.current.pointerOverCard = overCard;
    motionRef.current.pointerX = overCard ? (x / rect.width) * 2 - 1 : 0;
    motionRef.current.pointerY = overCard ? (y / rect.height) * 2 - 1 : 0;
    motionRef.current.hoverCardX = overCard
      ? ((x - cardRect.left) / Math.max(cardRect.right - cardRect.left, 1)) * 2 - 1 : 0;
    motionRef.current.hoverCardY = overCard
      ? ((y - cardRect.top) / Math.max(cardRect.bottom - cardRect.top, 1)) * 2 - 1 : 0;
    motionRef.current.invalidate?.();
  };
  const onPointerDown = (event) => {
    updatePointer(event);
    if (!motionRef.current.pointerOverCard) return;
    motionRef.current.dragging = true;
    motionRef.current.dragIndex = Math.max(0, Math.min(cards.length - 1, Math.round(motionRef.current.floatIndex)));
    motionRef.current.cardRotations ??= cards.map(() => ({ x: 0, y: 0 }));
    motionRef.current.dragStartX = event.clientX;
    motionRef.current.dragStartY = event.clientY;
    motionRef.current.dragDX = 0;
    motionRef.current.dragDY = 0;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    updatePointer(event);
    if (!motionRef.current.dragging) return;
    motionRef.current.dragDX = event.clientX - motionRef.current.dragStartX;
    motionRef.current.dragDY = event.clientY - motionRef.current.dragStartY;
    const index = motionRef.current.dragIndex;
    motionRef.current.cardRotations[index] = {
      x: THREE.MathUtils.clamp(-(motionRef.current.dragDY || 0) * 0.18, -68, 68),
      y: THREE.MathUtils.clamp((motionRef.current.dragDX || 0) * 0.22, -68, 68),
    };
    motionRef.current.invalidate?.();
  };
  const onPointerUp = (event) => {
    motionRef.current.dragging = false;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* pointer already gone */ }
  };
  return (
    <div
      ref={hostRef}
      className="garden-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        motionRef.current.pointerOverCard = false;
        if (!motionRef.current.dragging) {
          motionRef.current.pointerX = 0;
          motionRef.current.pointerY = 0;
          motionRef.current.hoverCardX = 0;
          motionRef.current.hoverCardY = 0;
        }
      }}
    >
      <Canvas
        dpr={gardenPixelRatio()}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: FOV, position: [0, 0, CAMERA_Z], near: 0.1, far: 80 }}
        frameloop="demand"
      >
        <GardenScene
          cards={cards}
          activeIndex={activeIndex}
          poolRadius={poolRadius}
          motionRef={motionRef}
          lights={lights}
          onCardReady={onCardReady}
        />
        {lensEffects?.enabled ? <GardenLensPass effects={lensEffects} motionRef={motionRef} /> : null}
      </Canvas>
    </div>
  );
}
