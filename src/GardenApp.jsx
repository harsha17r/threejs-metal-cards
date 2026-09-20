/* ================= the garden =================
   The library page is a contact sheet: every saved card as a still, laid out
   in a grid, all equally quiet. This page is the opposite reading of the same
   shelf — one card at a time, at size, live, with the rest stacked behind it
   and the whole run scrolling forever.

   The motion is lifted from the portfolio garden archive: a scroll-driven
   infinite stack that morphs into a grid and back on one shared clock. What
   is different here is that a garden card was a PNG and a card here is a
   running WebGL scene, which is the constraint GardenStack.jsx is arranged
   around — see the note on the budget there.

   Nothing is drawn on this page but the cards themselves. No plate behind
   them, no name, no panel, no caption: a card hangs in the dark and that is
   the whole picture. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import GardenStack, { FRAME_HEADROOM } from './GardenStack.jsx';
import PulsatingLoader from './components/ui/pulsating-loader.jsx';
import { loadCards } from './library.js';
import { DEFAULT_RIG } from '@engine/config.js';

/* How much closer the garden stands than the playground does.

   camera.zoom is a distance in card units, so a smaller number is a nearer
   camera and a bigger card. A card is framed to fill about half the width of
   whatever canvas it is given, which is right for the library's tiles — they
   are boxes with edges, and the card needs room inside them. Here there is no
   box to sit inside, so that same framing just reads as a small card adrift
   in a lot of nothing. Pulling in tightens it without touching what is saved:
   the multiplier is applied at render, and the card's own config keeps the
   distance it was tuned at.

   FRAME_HEADROOM then pushes the camera back out by exactly the factor the
   canvas was enlarged by, so the card stays the size this number sets while
   gaining room to turn inside its own canvas. See the note on it in
   GardenStack.jsx; the two halves only work as a pair. */
const GARDEN_ZOOM = 0.66 * FRAME_HEADROOM;
/* Garden is a shared catalogue view, so a card saved with an unusually close
   playground camera must not crop its own body out of the frame. The chip is
   a small inset module; if the camera gets too close it becomes the only
   visible thing and the card reads as a malformed chip tile. Keep the new
   default distance as the floor while preserving farther-out saved views. */
const GARDEN_MIN_ZOOM = 64;
/* The playground rig is tuned for dramatic single-card shots. The garden is
   a catalogue: every card needs a readable front plane so tiny details such
   as the chip etch and engraving survive its smaller size. Keep the same
   room character, but add a broad neutral softbox and lift the key/fill. */
const BASE_GARDEN_LIGHTS = DEFAULT_RIG.map((light) => ({ ...light }));
BASE_GARDEN_LIGHTS[0] = {
  ...BASE_GARDEN_LIGHTS[0], name: 'Garden front softbox', intensity: 0.62,
  x: 0, y: 0.5, z: 6, w: 9, h: 6, rot: 0, color: '#f5f5f2',
};
BASE_GARDEN_LIGHTS[1] = { ...BASE_GARDEN_LIGHTS[1], intensity: 2.8 };
BASE_GARDEN_LIGHTS[2] = { ...BASE_GARDEN_LIGHTS[2], intensity: 3.8 };
BASE_GARDEN_LIGHTS[3] = { ...BASE_GARDEN_LIGHTS[3], intensity: 3.0 };
const GARDEN_LIGHTING_DEFAULTS = Object.freeze({
  exposure: 120,
  frontSoftbox: 1.4,
  leftKey: 1.8,
  rightKey: 4.4,
  detailStrip: 2.9,
  contrastPanel: 1.5,
  floorBounce: 2.2,
});

/* Every card rests at this same tilt in the garden, regardless of whatever
   angle it happened to be posed at when it was saved — one shelf, one pose,
   so the cards read as a set rather than each carrying its own leftover
   orientation from the playground. Straight on (no up/down pitch), turned
   slightly to the right — rotY grows with a rightward drag (interaction.js),
   so a small positive value is a slight rightward turn. */
const GARDEN_VIEW = { rotX: 0, rotY: 0 };
const GARDEN_MOTION = Object.freeze({
  hoverSensitivity: 16,
  entryAngle: 23,
  entryYaw: -87,
  entryTwist: -40,
  exitAngle: 120,
  exitYaw: -84,
  exitTwist: 35,
  flattenDistance: 0,
  rollDistance: 2.31,
  easing: 'smoothstep',
  topCenterSensitivity: 40,
  bottomCenterSensitivity: 40,
  leftCenterSensitivity: 40,
  rightCenterSensitivity: 40,
});

/* The gallery sequence is curated from the artwork itself. Keep this list
   explicit so adding a new export never silently changes the presentation. */
const ARTWORK_HUE_ORDER = Object.freeze([
  'strawberry',
  'watermelon',
  'goldfish',
  'tiger',
  'butterfly',
  'pumpkin',
  'giraffe',
  'mushroom',
  'deer',
  'cheetah',
  'sand',
  'jackfruit',
  'kiwi',
  'chameleon',
  'beetle',
  'lotus-leaf',
  'crocodile',
  'tortoise',
  'eye',
  /* The remaining variants and pink artwork close the loop after Zebra. */
  'dragon-fruit-variant',
  'zebra',
  'onion',
  'dragon-fruit',
]);
const ARTWORK_HUE_RANK = new Map(ARTWORK_HUE_ORDER.map((id, index) => [id, index]));

function orderCardsByArtworkHue(entries) {
  return [...entries].sort((a, b) => {
    const aRank = ARTWORK_HUE_RANK.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bRank = ARTWORK_HUE_RANK.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}

/* The edge glass is deliberately a screen-space layer rather than part of
   the Three scene. Two static backdrop filters can stay composited while the
   cards move underneath them, and none of the infinite-scroll maths needs to
   know the treatment exists. Keep every visual choice here so the glass
   treatment stays together rather than becoming magic numbers spread through
   the JSX and CSS. */
const GARDEN_GLASS_DEFAULTS = {
  enabled: true,
  geometry: {
    height: 220,
    featherStart: 4,
    featherEnd: 60,
    featherMid: 36,
    featherEase: 28,
    inset: 0,
    cornerRadius: 53,
    shape: 'arch',
  },
  glass: {
    blur: 40,
    tintColor: '#000000',
    tintOpacity: 0.36,
    saturation: 220,
    brightness: 180,
  },
  finish: {
    gloss: 0,
    topStrength: 1,
    bottomStrength: 1,
  },
  optics: {
    enabled: true,
    edgeCoverage: 1,
    distortionX: 0.16,
    distortionY: -0.16,
    magnification: 0.07,
    chromatic: {
      redShift: -12,
      blueShift: -10,
      tangential: -6,
    },
    falloff: 4,
    edgeSoftness: 1,
    vignette: 0.7,
  },
};

function GardenEdgeGlass({ controls }) {
  if (!controls.enabled) return null;

  const featherStart = controls.geometry.featherStart;
  const featherMid = Math.max(featherStart + 0.1, controls.geometry.featherMid);
  const featherEnd = Math.max(featherMid + 0.1, controls.geometry.featherEnd);

  const shared = {
    '--garden-glass-height': `${controls.geometry.height}px`,
    '--garden-glass-feather-start': `${featherStart}%`,
    '--garden-glass-feather-mid': `${featherMid}%`,
    '--garden-glass-feather-end': `${featherEnd}%`,
    '--garden-glass-feather-mid-opacity': controls.geometry.featherEase / 100,
    '--garden-glass-inset': `${controls.geometry.inset}px`,
    '--garden-glass-corner-radius': `${controls.geometry.cornerRadius}px`,
    '--garden-glass-blur': `${controls.glass.blur}px`,
    '--garden-glass-tint-color': controls.glass.tintColor,
    '--garden-glass-tint-opacity': controls.glass.tintOpacity,
    '--garden-glass-saturation': `${controls.glass.saturation}%`,
    '--garden-glass-brightness': `${controls.glass.brightness}%`,
    '--garden-glass-gloss': controls.finish.gloss,
  };

  return (
    <div className={`garden-edge-glass garden-edge-glass--${controls.geometry.shape}`} style={shared} aria-hidden="true">
      <div
        className="garden-edge-glass__veil garden-edge-glass__veil--top"
        style={{ '--garden-glass-strength': controls.finish.topStrength }}
      />
      <div
        className="garden-edge-glass__veil garden-edge-glass__veil--bottom"
        style={{ '--garden-glass-strength': controls.finish.bottomStrength }}
      />
    </div>
  );
}

function Empty() {
  return (
    <div className="garden-empty">
      <h1>Nothing in the garden yet</h1>
      <p className="hint">
        Add an exported card JSON file to the <code>cards</code> folder.
      </p>
    </div>
  );
}

function LoadingScreen({ progress }) {
  return (
    <motion.div
      className="garden-loading"
      role="status"
      aria-label="Loading card collection"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.19, 1, 0.22, 1] }}
    >
      <PulsatingLoader progress={progress} />
    </motion.div>
  );
}

export default function GardenApp() {
  const lighting = GARDEN_LIGHTING_DEFAULTS;
  const [cards, setCards] = useState(null);
  const [cardLoadProgress, setCardLoadProgress] = useState(0);
  const [readyIds, setReadyIds] = useState(() => new Set());
  const [displayedProgress, setDisplayedProgress] = useState(0);
  /* The loader has two real phases (module loading, then WebGL readiness),
     but the user should experience one continuous timeline. Keep the highest
     target reached so a phase hand-off can never send the number backwards. */
  const progressFloorRef = useRef(0);
  const chipControls = {
    plateColor: '#86878c',
    plateContrast: 82,
    plateRoughness: 71,
    platingLines: 8,
    surfaceRelief: 0,
    surfaceGrain: 14,
    microScratches: 0,
  };

  useEffect(() => {
    let active = true;
    loadCards((progress) => {
      if (active) setCardLoadProgress(progress);
    }).then((loadedCards) => {
      if (!active) return;
      setCards(orderCardsByArtworkHue(loadedCards));
      setCardLoadProgress(1);
    }).catch((error) => {
      console.error('Could not load the card collection.', error);
      if (active) setCards([]);
    });
    return () => { active = false; };
  }, []);

  const gardenLights = useMemo(() => {
    const lights = BASE_GARDEN_LIGHTS.map((light) => ({ ...light }));
    lights[0] = { ...lights[0], intensity: lighting.frontSoftbox };
    lights[1] = { ...lights[1], intensity: lighting.leftKey };
    lights[2] = { ...lights[2], intensity: lighting.rightKey };
    lights[3] = { ...lights[3], intensity: lighting.detailStrip };
    lights[4] = { ...lights[4], intensity: lighting.contrastPanel };
    lights[7] = { ...lights[7], intensity: lighting.floorBounce };
    return lights;
  }, [lighting]);

  const styleKey = useMemo(() => cards?.map((entry) => entry.id).join('|') ?? '', [cards]);
  const styled = useMemo(() => (cards ?? []).map((entry) => {
    const config = entry.config;
    return {
      ...entry,
      config: {
        ...config,
        camera: {
          ...config.camera,
          exposure: Math.max(config.camera.exposure, lighting.exposure),
          zoom: Math.max(config.camera.zoom, GARDEN_MIN_ZOOM) * GARDEN_ZOOM,
        },
        lights: gardenLights,
        view: { ...config.view, ...GARDEN_VIEW },
        chip: {
          ...config.chip,
          color: chipControls.plateColor,
          contrast: chipControls.plateContrast,
          rough: chipControls.plateRoughness,
          plating: chipControls.platingLines,
          micro: chipControls.surfaceRelief,
          grain: chipControls.surfaceGrain,
          scratch: chipControls.microScratches,
        },
      },
    };
  }), [cards, gardenLights, chipControls]);

  useEffect(() => {
    setReadyIds(new Set());
  }, [cards]);
  /* Only the circular live pool is constructed at first paint. Waiting for
     all catalogue entries would defeat the pool and hold the loader open for
     cards that are intentionally dormant. */
  const initialReadyCount = Math.min(styled.length, 3);
  const readyProgress = styled.length === 0
    ? cards === null ? 0 : 1
    : Math.min(readyIds.size, initialReadyCount) / Math.max(initialReadyCount, 1);
  const rawLoadingProgress = cards === null
    ? Math.min(70, 8 + cardLoadProgress * 62)
    : 70 + Math.round(readyProgress * 30);
  /* Card data and WebGL can report at slightly different times. Treat their
     weighted value as a target, but make the target itself monotonic so a
     React phase transition cannot cause a visible reset. */
  progressFloorRef.current = Math.max(progressFloorRef.current, rawLoadingProgress);
  const actualLoadingProgress = progressFloorRef.current;
  useEffect(() => {
    const ceiling = actualLoadingProgress >= 100 ? 100 : 92;
    if (displayedProgress >= ceiling) return undefined;

    const delay = actualLoadingProgress >= 100
      ? 24
      : displayedProgress < 60 ? 90 : displayedProgress < 85 ? 120 : 160;
    const timer = window.setTimeout(() => {
      setDisplayedProgress((value) => Math.min(value + 1, ceiling));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [actualLoadingProgress, displayedProgress]);
  const loadingComplete = cards !== null && readyProgress >= 1 && displayedProgress >= 100;

  return (
    <div className="garden-root">
      {cards === null
        ? null
        : styled.length === 0
        ? <Empty />
        : (
          <GardenStack
            key={styleKey}
            cards={styled}
            revealed={loadingComplete}
            lensEffects={{
              ...GARDEN_GLASS_DEFAULTS.optics,
              edgeHeight: GARDEN_GLASS_DEFAULTS.geometry.height,
            }}
            motionTuning={GARDEN_MOTION}
            onCardReady={(id) => setReadyIds((current) => {
              if (current.has(id)) return current;
              const next = new Set(current);
              next.add(id);
              return next;
            })}
          />
        )}
      <GardenEdgeGlass controls={GARDEN_GLASS_DEFAULTS} />
      <AnimatePresence>
        {!loadingComplete ? <LoadingScreen key="loading-screen" progress={displayedProgress} /> : null}
      </AnimatePresence>
    </div>
  );
}
