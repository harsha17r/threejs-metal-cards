/* ================= the scroll-driven card stack =================
   A port of the portfolio garden's PlantShowcase onto saved metal cards.

   What carries over: an infinitely looping, scroll-driven stack of cards with
   the focused one at the centre; a list ⇄ grid morph that runs the card
   transforms and the layout reflow on ONE clock and one curve, so the whole
   thing reads as a single motion; arrow-key snapping; a FLIP pass so the
   vertical recenter between the two modes never jumps.

   What the garden had and this does not is any writing at all. There is no
   plate behind a card, no name under it, no panel beside it and no caption
   anywhere: a card hangs in the dark, and the only thing the page draws is
   the card. Every measurement below that used to leave room for a panel or a
   title has had that room taken back out, which is why the stack sits centred
   rather than offset to the left.

   What is different: a garden card was a PNG and a card here is a live WebGL
   scene. That changes three things.

     1. THE BUDGET. Browsers hand out a fixed number of WebGL contexts —
        around 16 in Chrome — and drop the oldest under pressure, which is how
        you get a stack of blank rectangles. Every card here is live, as asked
        for, but past LIVE_DISTANCE stack-steps from the focus a card is
        already at zero opacity, so it stops being mounted rather than
        holding a context to draw nothing. In the grid its place is simply
        empty until you scroll toward it.

     2. THE DRAG. The garden was scroll-only. Here a drag means two different
        things depending on what is under it: on the focused card it rotates
        the card in 3D, the way the playground does; anywhere else it flicks
        the stack, with momentum and a snap to the nearest card. Touch is left
        alone — a native scroll IS the drag gesture there, and Lenis is
        already reading it.

     3. FRAMES. Every card sits on frameloop "demand" and costs nothing per
        frame until something moves it. That is what makes a dozen live
        contexts survivable at all. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Lenis from 'lenis';
import GardenCanvas from './GardenCanvas.jsx';

/* The garden keeps one real entry per saved card. The document scroll runway
   is recycled by whole card-cycles, so the list feels infinite without
   cloned head/tail nodes or React remounts at the seam. */

/* The garden's cards were square images. These are credit cards — roughly
   1.6:1 — and MetalCard frames one inside whatever box it is given, so a
   square box spends most of its area on empty margin above and below. The
   box is shaped to the card instead, and every other measurement on the page
   (the grid cell, the stack's pitch, the stage height) is derived from this
   one number so nothing has to be re-tuned twice.

   The box itself draws nothing — it is the card's canvas and its hit target,
   and that is all. */
const CARD_ASPECT = 1.5;

/* Slack between the card and the edge of the canvas it is drawn on.

   A WebGL canvas clips at its own bounds — CSS overflow can't rescue a
   render past the edge of a <canvas>, so however free a card looks on the
   page, this is the one boundary that is real. A card can be dragged 68
   degrees in either axis, and at that angle the near corner swings toward
   the camera and grows under perspective: the corner that reads as
   "outside the flat card's footprint" is exactly the one that clips first.

   1.3 was the first number tried here and still let the near corner touch
   the edge at a hard drag. This is generous specifically so there is no
   near miss to find with a harder drag, a wider swing, or a texture (the
   embossed name, the chip) that sits a hair outside the flat silhouette —
   the box costs nothing to look at, so there is no reason to cut this
   margin close.

   It is enlarged and the camera pulled back by the SAME factor, which
   leaves the card exactly the size it was on screen and gives it room to
   move inside its canvas. Nothing else uses the box measurement: the
   stack's pitch and the grid's cells are spaced off the card's visible
   size, so the extra slack overlaps invisibly between neighbours instead of
   pushing them apart. GardenApp applies the camera half — keep them equal.

   The cost is drag feel, not looks: MetalCard's rotate-on-drag reads pointer
   delta as a fraction of the canvas it is dragging across, so a bigger
   canvas means the same finger movement turns the card less. Turning a
   card here takes noticeably more drag than it does in the playground. */
export const FRAME_HEADROOM = 2.2;

const clampNumber = (v, min, max) => Math.min(max, Math.max(min, v));
const wrapIndex = (value, length) => {
  if (!length) return 0;
  return ((value % length) + length) % length;
};
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
/* Perlin's smootherstep — gentle start, soft decelerating settle. */
const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);
/* cubic-bezier(0.23, 1, 0.32, 1), solved by bisection. */
const easeOutStrong = (t) => {
  const p1x = 0.23, p1y = 1, p2x = 0.32, p2y = 1;
  let lo = 0, hi = 1, x = t;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const cx = 3 * p1x * mid * (1 - mid) ** 2 + 3 * p2x * mid ** 2 * (1 - mid) + mid ** 3;
    cx < t ? (lo = mid) : (hi = mid);
    x = mid;
  }
  return 3 * p1y * x * (1 - x) ** 2 + 3 * p2y * x ** 2 * (1 - x) + x ** 3;
};
const easeInOutCubic = (t) => (
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
);

const PARAMS = {
  stack: { size: 620, spacing: 500, opacity: 0.25, blur: 0 },
  grid: {
    cardSize: 380,
    columnGap: { viewportFactor: 0.06, min: 26, max: 58 },
    rowGap: { viewportFactor: 0.04, min: 28, max: 56 },
  },
};

/* The reel that plays once the loader releases the scene. It begins just over
   one card-step below the resting index, so one card rolls upward through the
   focal plane before the first card settles exactly flat at centre. The short
   delay lets the loader begin fading first without hiding the useful motion. */
const INTRO = { durationMs: 1240, delayMs: 300, startIndexOffset: 1.08 };

const GRID_PROGRESS_SNAP = 0.012;
const MORPH_DURATION_MS = 480;
/* A CSS approximation of easeOutCubic, so the layout transitions the browser
   owns (card resize, shell reflow) ride the same curve as the JS morph. One
   clock, or the layout snaps on its own timeline while the cards slide. */
const MORPH_EASE_CSS = 'cubic-bezier(0.33, 1, 0.68, 1)';
const MORPH_TRANSITION = (...props) =>
  props.map((p) => `${p} ${MORPH_DURATION_MS}ms ${MORPH_EASE_CSS}`).join(', ');
const GRID_SETTLE_SCROLL_MS = 560;
/* Cards that are off-screen in the list start their slide from a capped
   distance off the nearest edge rather than flying their full list offset
   across the centre, which at ten cards looks like a stampede. */
const MORPH_TRAVEL_CAP_VH = 0.6;
const MORPH_OFFSCREEN_VH = 0.7;

/* Drag-to-flick. */
const CLICK_SLOP_PX = 6;
const FLICK_PROJECT_MS = 260;
const FLICK_SETTLE_S = 0.62;

export default function GardenStack({ cards, lensEffects, motionTuning, onCardReady, revealed = true }) {
  const [viewportW, setViewportW] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  const [viewportH, setViewportH] = useState(() => (typeof window === 'undefined' ? 760 : window.innerHeight));
  const [viewMode, setViewMode] = useState('list');
  const [gridSettled, setGridSettled] = useState(false);
  const [viewportSettled, setViewportSettled] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  /* The padded-array slot actually nearest the centre this frame — read
     straight off floatIndex in the render loop below. `activeIndex` above is
     a wrapped card identity (0..cards.length-1) and cannot tell which COPY
     of a card — the real one or one of its loop clones — is the one
     currently on screen; at the exact seam where the infinite loop wraps,
     reconstructing a position from it can land on the wrong copy: the
     invisible one gets marked focused/live, the one actually on screen does
     not. Tracking the position directly sidesteps that. Starts at 0; every
     card is opacity-0 until the render loop's first frame places it, so an
     unset initial value is never visible. */
  const [centeredPos, setCenteredPosState] = useState(0);

  const rootRef = useRef(null);
  const trackRef = useRef(null);
  const stageRef = useRef(null);
  const gridScrollerRef = useRef(null);
  const cardRefs = useRef([]);

  const activeRef = useRef(0);
  const centeredPosRef = useRef(0);
  const viewModeRef = useRef('list');
  const previousViewModeRef = useRef('list');
  const gridProgressRef = useRef(0);
  const morphTargetRef = useRef(0);
  const morphFromRef = useRef(0);
  const morphStartTimeRef = useRef(0);
  const gridSettledRef = useRef(false);
  const morphRawFloatRef = useRef(null);
  const scrollResetRafRef = useRef(0);
  const gridEntryIndexRef = useRef(0);
  const introStartRef = useRef(null);
  const introCompleteRef = useRef(false);
  /* The render loop is rebuilt whenever the card list or the viewport changes,
     and the intro reel is set up inside it. Without a flag that outlives the
     rebuild, resizing the window replays the whole entrance. It should play
     once per visit. */
  const introPlayedRef = useRef(false);
  /* Loading and card construction happen while this scene is mounted. Keep
     the latest reveal state outside the render-loop closure so the intro can
     begin on the first frame after the loading page releases it. */
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  const keySnapTargetRef = useRef(null);
  /* Where a released flick is still coasting to, so a second gesture can
     interrupt the settle without leaving a stale snap target behind. */
  const flickTargetRef = useRef(null);
  const flipFromTopRef = useRef(null);
  const flipAnimRef = useRef(null);
  /* Shared with the pointer handlers, which live outside the render loop. */
  const lenisRef = useRef(null);
  const sectionHRef = useRef(PARAMS.stack.spacing);
  const dragRef = useRef(null);
  const canvasMotionRef = useRef({
    floatIndex: 0, sectionH: PARAMS.stack.spacing, viewportH: 1, viewportW: 1,
    gridProgress: 0, isMobile: false, gridColumns: 1,
    gridCardSizePx: 1, gridItemHeightPx: 1,
    loop: false,
  });

  /* Keep one stable set of WebGL cards mounted. The document scroll position
     is recycled by whole card-cycles below, so the reel can run forever
     without cloning or remounting React nodes at the seam. */
  const loop = cards.length > 1;
  const padding = 0;
  const paddedCards = cards;

  const layout = useMemo(() => {
    const isMobile = viewportW < 600;
    const isCompactTablet = viewportW >= 600 && viewportW < 860;
    const isWideTablet = viewportW >= 860 && viewportW < 1280;
    /* The card's own box. Nothing else shares the row now that the panel is
       gone, so these are the widths of the picture itself rather than of a
       plate with a card inside it. */
    /* Keep phones deliberately smaller than the desktop composition. The
       canvas adds its own perspective/tilt headroom, so a 72% CSS width gives
       the visible card comfortable side margins even while it is rotating. */
    const mobileCardPx = clampNumber(viewportW * 0.72, 220, 300);
    const compactTabletCardPx = clampNumber(viewportW * 0.62, 340, 500);
    const wideTabletCardPx = clampNumber(viewportW * 0.54, 440, 620);
    const desktopCardPx = clampNumber(viewportW * 0.42, 500, PARAMS.stack.size);

    const gridColumns = isMobile ? 1 : viewportW >= 980 ? 3 : 2;
    const gridRows = Math.ceil(cards.length / gridColumns);
    const gridColumnGapPx = isMobile ? 0 : clampNumber(
      viewportW * PARAMS.grid.columnGap.viewportFactor,
      PARAMS.grid.columnGap.min, PARAMS.grid.columnGap.max);
    const gridRowGapPx = isMobile ? 0 : clampNumber(
      viewportW * PARAMS.grid.rowGap.viewportFactor,
      PARAMS.grid.rowGap.min, PARAMS.grid.rowGap.max);

    /* The stack is centred now, so the grid gets the full width rather than
       the width left over beside a panel. */
    const gridAvailableW = Math.max(320, viewportW - 112);
    const gridAvailableH = Math.max(320, viewportH - 130);
    const widthLimited = (gridAvailableW - gridColumnGapPx * Math.max(gridColumns - 1, 0)) / gridColumns;
    const heightLimited = (
      gridAvailableH - gridRowGapPx * Math.max(gridRows - 1, 0)
    ) / gridRows * CARD_ASPECT;
    const gridMaxCardPx = gridRows <= 2
      ? Math.min(PARAMS.grid.cardSize, widthLimited, heightLimited)
      : Math.min(PARAMS.grid.cardSize, widthLimited);
    const gridCardSizePx = isMobile
      ? mobileCardPx
      : clampNumber(gridMaxCardPx, viewportW < 860 ? 150 : 190, PARAMS.grid.cardSize);
    const gridItemHeightPx = gridCardSizePx / CARD_ASPECT;

    /* The card's box is landscape, so the pitch follows its HEIGHT. Driving it
       off the width instead left the stack looking like three stamps on an
       empty page. */
    const listCardWidthPx = isMobile ? mobileCardPx
      : isCompactTablet ? compactTabletCardPx
      : isWideTablet ? wideTabletCardPx
      : desktopCardPx;
    /* Pitch is the box's height plus a gap proportional to it, so the card
       either side always breaks the stage edge by about the same amount
       whatever the viewport. Tying the gap to the viewport instead put the
       neighbours entirely outside the crop on a short window, and the stack
       lost the one thing that makes it read as a stack. */
    const listCardHeightPx = listCardWidthPx / CARD_ASPECT;
    /* On phones the tilted card can project beyond its nominal box. Make the
       pitch unambiguously larger than the card height so adjacent cards can
       never touch, even at the most dramatic entrance angle. */
    const sectionSpacingPx = listCardHeightPx + (isMobile
      ? clampNumber(listCardHeightPx * 1.35, 220, 360)
      : clampNumber(listCardHeightPx * 0.72, 150, 320));

    return {
      isMobile,
      /* Positioning uses the card's visible size; the element itself gets the
         box, which is that plus the headroom. */
      listBoxWidth: `${listCardWidthPx * FRAME_HEADROOM}px`,
      listBoxHeight: `${listCardHeightPx * FRAME_HEADROOM}px`,
      gridBoxWidth: `${gridCardSizePx * FRAME_HEADROOM}px`,
      gridBoxHeight: `${(gridCardSizePx / CARD_ASPECT) * FRAME_HEADROOM}px`,
      gridCardSizePx,
      gridColumns,
      gridColumnGapPx,
      gridRowGapPx,
      gridItemHeightPx,
      gridWidth: `${gridCardSizePx * gridColumns + gridColumnGapPx * Math.max(gridColumns - 1, 0)}px`,
      gridHeight: `${gridRows * gridItemHeightPx + Math.max(gridRows - 1, 0) * gridRowGapPx}px`,
      sectionSpacingPx,
      mobileOpacityFloor: 0.35,
    };
  }, [cards.length, viewportH, viewportW]);

  const isMobile = layout.isMobile;
  const isGrid = !isMobile && viewMode === 'grid';
  const isGridBrowsing = isGrid && gridSettled;

  /* A shorter run can leave the pointer past the end of it. */
  useEffect(() => {
    if (activeIndex <= cards.length - 1) return;
    const next = Math.max(cards.length - 1, 0);
    activeRef.current = next;
    setActiveIndex(next);
  }, [activeIndex, cards.length]);

  /* ---- the first frame every card misses ----
     Every card mounts its canvas on frameloop "demand", which draws only
     when something calls invalidate. MetalCard does call it
     once the artwork resolves, but a canvas that is still settling its
     measured size then clears that frame and nothing asks for another — so
     the stack loads empty and only fills in when the next React commit
     happens to schedule a frame.

     One late re-measure fixes the lot: R3F re-measures on a window resize and
     schedules a frame with it. Twice, because the first can land before the
     slowest card has finished building its textures. Cheap, and it stops the
     page needing a scroll before it looks like anything. */
  useEffect(() => {
    const nudge = () => window.dispatchEvent(new Event('resize'));
    const a = window.setTimeout(nudge, 120);
    const b = window.setTimeout(nudge, 900);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [cards]);

  useEffect(() => { viewModeRef.current = isMobile ? 'list' : viewMode; }, [isMobile, viewMode]);
  useEffect(() => { gridSettledRef.current = gridSettled; }, [gridSettled]);

  /* Bring the focused row to the middle of a grid that is taller than the
     viewport — on a short eased pan, so it flows out of the morph instead of
     jumping once the morph has finished. */
  useLayoutEffect(() => {
    if (!isGridBrowsing) return undefined;
    const scroller = gridScrollerRef.current;
    if (!scroller) return undefined;

    const row = Math.floor(clampNumber(activeRef.current, 0, cards.length - 1) / layout.gridColumns);
    const rowTop = row * (layout.gridItemHeightPx + layout.gridRowGapPx);
    const maxScroll = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    const target = clampNumber(rowTop - (scroller.clientHeight - layout.gridItemHeightPx) / 2, 0, maxScroll);
    const start = scroller.scrollTop;
    const delta = target - start;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(delta) < 1) {
      scroller.scrollTop = target;
      return undefined;
    }

    let raf = 0;
    const startTime = performance.now();
    const tick = (now) => {
      const t = clampNumber((now - startTime) / GRID_SETTLE_SCROLL_MS, 0, 1);
      scroller.scrollTop = start + delta * easeOutStrong(t);
      if (t < 1) raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [isGridBrowsing, layout.gridColumns, layout.gridItemHeightPx, layout.gridRowGapPx, cards.length]);

  /* The grid owns the whole viewport, so the document must stop scrolling
     under it — otherwise the wheel drives both at once. */
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    if (!isMobile && viewMode === 'grid') {
      html.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
    }
    return () => { html.style.overflow = prevHtml; body.style.overflow = prevBody; };
  }, [isMobile, viewMode]);

  /* Mode changes: work out which card the list should come back to. */
  useEffect(() => {
    if (isMobile) {
      previousViewModeRef.current = 'list';
      return undefined;
    }

    const previous = previousViewModeRef.current;

    if (previous !== viewMode && viewMode === 'grid') {
      gridEntryIndexRef.current = clampNumber(Math.round(activeRef.current), 0, cards.length - 1);
      setGridSettled(false);
      gridSettledRef.current = false;
    }

    if (previous === 'grid' && viewMode === 'list') {
      const scroller = gridScrollerRef.current;
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
        const stride = layout.gridItemHeightPx + layout.gridRowGapPx;
        const maxScroll = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
        const lastRow = Math.max(Math.ceil(cards.length / layout.gridColumns) - 1, 0);
        /* If the scroller never moved, the user only looked — return to the
           exact card they left from, column and all. If they scrolled, return
           to the leading card of whatever row they ended on. */
        const entryIndex = gridEntryIndexRef.current;
        const entryRow = Math.floor(entryIndex / layout.gridColumns);
        const entrySettle = clampNumber(
          entryRow * stride - (scroller.clientHeight - layout.gridItemHeightPx) / 2, 0, maxScroll);

        const restored = Math.abs(scroller.scrollTop - entrySettle) < stride / 2
          ? entryIndex
          : clampNumber(
            Math.round((scroller.scrollTop + scroller.clientHeight / 2 - layout.gridItemHeightPx / 2) / stride),
            0, lastRow) * layout.gridColumns;
        morphRawFloatRef.current = clampNumber(restored, 0, cards.length - 1);
        activeRef.current = morphRawFloatRef.current;
        /* The render loop's setActive is a no-op once activeRef already holds
           the value, so writing the ref alone would leave the React-side index
           — which decides what is focused and what stays mounted — pointing at
           whichever card the list was on before the grid. */
        setActiveIndex(activeRef.current);
      }
      /* Leftover scrollTop would push the centred list upward, so pan it back
         on the morph's own clock rather than snapping it to zero. */
      if (scroller && scroller.scrollTop > 0) {
        window.cancelAnimationFrame(scrollResetRafRef.current);
        const startScroll = scroller.scrollTop;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          scroller.scrollTop = 0;
        } else {
          const startTime = performance.now();
          const tick = (now) => {
            const t = clampNumber((now - startTime) / MORPH_DURATION_MS, 0, 1);
            scroller.scrollTop = startScroll * (1 - easeOutCubic(t));
            if (t < 1) scrollResetRafRef.current = window.requestAnimationFrame(tick);
          };
          scrollResetRafRef.current = window.requestAnimationFrame(tick);
        }
      }
      setGridSettled(false);
      gridSettledRef.current = false;
    }

    previousViewModeRef.current = viewMode;
    return () => window.cancelAnimationFrame(scrollResetRafRef.current);
  }, [isMobile, layout.gridColumns, layout.gridItemHeightPx, layout.gridRowGapPx, cards.length, viewMode]);

  /* FLIP play. The grid is top-aligned and the list is centred, so the stage
     moves vertically between them; without this it moves in one frame. */
  useLayoutEffect(() => {
    const from = flipFromTopRef.current;
    flipFromTopRef.current = null;
    const stage = stageRef.current;
    if (from === null || !stage || isMobile) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    flipAnimRef.current?.cancel();
    const dy = from - stage.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    flipAnimRef.current = stage.animate(
      [{ transform: `translateY(${dy.toFixed(1)}px)` }, { transform: 'translateY(0px)' }],
      { duration: MORPH_DURATION_MS, easing: MORPH_EASE_CSS },
    );
  }, [isMobile, viewMode]);

  /* Settle to the real viewport before first paint, so the render loop below
     starts at the correct layout once instead of starting at the SSR default
     and restarting mid-intro. */
  useLayoutEffect(() => {
    setViewportW(window.innerWidth);
    setViewportH(window.innerHeight);
    setViewportSettled(true);
  }, []);

  /* ================= the render loop ================= */
  useEffect(() => {
    if (!viewportSettled) return undefined;
    const root = rootRef.current, track = trackRef.current;
    if (!root || !track) return undefined;

    root.classList.add('is-mounted');

    let frameId = 0;
    let destroyed = false;
    let vh = window.innerHeight;
    let sectionH = layout.sectionSpacingPx;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) introCompleteRef.current = true;

    const lenis = new Lenis({
      smoothWheel: true,
      syncTouch: loop,
      infinite: loop,
      duration: 1.1,
      wheelMultiplier: 0.8,
      touchMultiplier: 1.2,
      autoRaf: false,
    });
    lenisRef.current = lenis;

    const setActive = (index) => {
      if (activeRef.current === index) return;
      activeRef.current = index;
      setActiveIndex(index);
    };

    /* The padded-array slot, not the wrapped card identity above — see the
       note on centeredPos where it's declared. */
    const setCenteredPos = (index) => {
      if (centeredPosRef.current === index) return;
      centeredPosRef.current = index;
      setCenteredPosState(index);
    };

    /* Set once the stack has been centred for the first time, so applyLayout
       can tell "the very first call, which must centre" apart from "a later
       call with nothing to do." Without that distinction every one of these
       counted as a real layout change:
         - each MetalCard dispatches a synthetic `resize` while its own
           canvas is still settling its measured size (MetalCard.jsx), which
           happens for every card, right at mount;
         - this component does the same twice more, at 120ms and 900ms,
           for the same reason (see the effect above).
       A page with several cards fires a burst of these in its first second —
       exactly when someone starts scrolling — and every one called
       lenis.scrollTo(..., { immediate: true }), which resets() Lenis and
       kills whatever scroll animation was in flight, even though the target
       usually worked out to the position the stack was already at. That
       looked like the stack stuttering or snapping the moment you touched
       the wheel. Only a real pitch change (or the first call) needs to move
       anything; every other resize can leave an in-progress scroll alone. */
    let hasCentered = false;

    const applyLayout = () => {
      setViewportW((prev) => (prev === window.innerWidth ? prev : window.innerWidth));
      setViewportH((prev) => (prev === window.innerHeight ? prev : window.innerHeight));
      vh = window.innerHeight;
      const prevSectionH = sectionH;
      sectionH = layout.sectionSpacingPx;
      sectionHRef.current = sectionH;
      const cycleH = Math.max(cards.length * sectionH, sectionH);
      /* Lenis' native infinite mode needs the document's scroll limit to be
         exactly one card cycle. It wraps its internal animated value without
         us rewriting window.scrollY mid-frame, which keeps velocity smooth at
         the seam. */
      track.style.height = `${loop
        ? Math.max(vh + cycleH, vh)
        : Math.max(vh + Math.max(cards.length - 1, 0) * sectionH, vh)}px`;

      /* Preserve the current finite position when the card pitch changes. */
      const pitchChanged = Math.abs(prevSectionH - sectionH) > 0.5;
      if (hasCentered && !pitchChanged) return;
      hasCentered = true;
      if (loop && pitchChanged) {
        const previousCycleH = Math.max(cards.length * prevSectionH, prevSectionH);
        const progress = previousCycleH > 0 ? lenis.scroll / previousCycleH : 0;
        lenis.resize();
        lenis.scrollTo(clampNumber(progress * cycleH, 0, cycleH), {
          immediate: true, force: true,
        });
      } else if (!loop && pitchChanged && lenis.scroll > 0) {
        const target = clampNumber(Math.round(activeRef.current) * sectionH, 0, Math.max(cards.length - 1, 0) * sectionH);
        window.scrollTo({ top: target, behavior: 'auto' });
        lenis.scrollTo(target, { immediate: true, force: true });
      }
    };

    const render = (time) => {
      if (destroyed) return;
      lenis.raf(time);

      const scroll = lenis.scroll;
      const cycleH = Math.max(cards.length * sectionH, sectionH);
      const rawFloat = loop
        ? scroll / Math.max(sectionH, 1)
        : clampNumber(scroll / Math.max(sectionH, 1), 0, Math.max(cards.length - 1, 0));

      let introOffset = 0;
      if (!reduceMotion && !introCompleteRef.current) {
        if (!revealedRef.current) {
          /* Hold the composed WebGL scene at the first ratchet tooth while
             the loader is visible; do not spend the animation off-screen. */
          introOffset = INTRO.startIndexOffset;
        } else {
          if (!introPlayedRef.current) {
            introPlayedRef.current = true;
            introStartRef.current = time + INTRO.delayMs;
          }
          const introElapsed = Math.max(0, time - introStartRef.current);
          const introT = clampNumber(introElapsed / INTRO.durationMs, 0, 1);
          introOffset = INTRO.startIndexOffset * (1 - easeOutStrong(introT));
          if (introT >= 1) {
            introOffset = 0;
            introCompleteRef.current = true;
          }
        }
      }

      /* ---- the morph driver ---- */
      const targetGrid = !isMobile && viewModeRef.current === 'grid' ? 1 : 0;
      if (reduceMotion) {
        gridProgressRef.current = targetGrid;
      } else {
        /* Re-base whenever the target flips, including mid-flight, so a
           reversed toggle decelerates from the speed it actually had. */
        if (targetGrid !== morphTargetRef.current) {
          morphTargetRef.current = targetGrid;
          morphFromRef.current = gridProgressRef.current;
          morphStartTimeRef.current = time;
        }
        const span = Math.abs(targetGrid - morphFromRef.current);
        if (span < GRID_PROGRESS_SNAP) {
          gridProgressRef.current = targetGrid;
        } else {
          /* Shorten the duration in proportion, or a half-done morph takes
             the full time to cover the remaining half. */
          const t = clampNumber((time - morphStartTimeRef.current) / (MORPH_DURATION_MS * span), 0, 1);
          gridProgressRef.current =
            morphFromRef.current + (targetGrid - morphFromRef.current) * easeOutCubic(t);
        }
      }
      const gridProgress = gridProgressRef.current;

      if (!isMobile && targetGrid === 1 && gridProgress === 1 && !gridSettledRef.current) {
        gridSettledRef.current = true;
        setGridSettled(true);
      }
      if ((isMobile || targetGrid === 0) && gridSettledRef.current) {
        gridSettledRef.current = false;
        setGridSettled(false);
      }

      /* Freeze the list position the morph left from, so scrolling behind the
         grid cannot drag the cards' origins around mid-flight. */
      const freeze = !isMobile && (targetGrid === 1 || gridProgress > 0);
      if (freeze && morphRawFloatRef.current === null) morphRawFloatRef.current = rawFloat;
      const morphRawFloat = morphRawFloatRef.current;
      const returning = targetGrid === 0 && morphRawFloat !== null;
      const effectiveFloat = returning ? Math.round(morphRawFloat) : morphRawFloat ?? rawFloat;
      const floatIndex = effectiveFloat + padding + (morphRawFloat === null ? introOffset : 0);

      canvasMotionRef.current.floatIndex = floatIndex;
      canvasMotionRef.current.sectionH = sectionH;
      canvasMotionRef.current.viewportH = vh;
      canvasMotionRef.current.viewportW = viewportW;
      canvasMotionRef.current.gridProgress = gridProgress;
      canvasMotionRef.current.isMobile = isMobile;
      canvasMotionRef.current.gridColumns = layout.gridColumns;
      canvasMotionRef.current.gridCardSizePx = layout.gridCardSizePx;
      canvasMotionRef.current.gridItemHeightPx = layout.gridItemHeightPx;
      canvasMotionRef.current.reducedMotion = reduceMotion;
      canvasMotionRef.current.loop = loop;

      setActive(loop
        ? wrapIndex(Math.round(effectiveFloat), cards.length)
        : clampNumber(Math.round(effectiveFloat), 0, Math.max(cards.length - 1, 0)));
      setCenteredPos(loop
        ? wrapIndex(Math.round(floatIndex), paddedCards.length)
        : clampNumber(Math.round(floatIndex), 0, Math.max(paddedCards.length - 1, 0)));

      const gridRows = Math.ceil(cards.length / layout.gridColumns);
      for (let i = 0; i < paddedCards.length; i += 1) {
        const el = cardRefs.current[i];
        if (!el) continue;

        const cardIndex = i;
        const isRealCard = true;
        const column = cardIndex % layout.gridColumns;
        const row = Math.floor(cardIndex / layout.gridColumns);
        const gridX = isRealCard
          ? (column - (layout.gridColumns - 1) / 2) * (layout.gridCardSizePx + layout.gridColumnGapPx) : 0;
        const gridY = isRealCard
          ? (row - (gridRows - 1) / 2) * (layout.gridItemHeightPx + layout.gridRowGapPx) : 0;

        const linearDist = i - floatIndex;
        const dist = loop
          ? ((linearDist + cards.length / 2) % cards.length + cards.length) % cards.length - cards.length / 2
          : linearDist;
        const absDist = Math.abs(dist);
        const offset = dist * sectionH;
        /* Every card renders at the same size regardless of stack position —
           only opacity and blur fall off with distance from the centre. */
        const scale = 1;
        const listOpacity = isMobile
          ? Math.max(layout.mobileOpacityFloor, 1 - absDist * PARAMS.stack.opacity)
          : Math.max(0, 1 - absDist * PARAMS.stack.opacity);
        const blur = Math.min(absDist * PARAMS.stack.blur, PARAMS.stack.blur);

        /* The padding clones seam the loop; they have no place in a grid and
           must not drift through the centre on the way there. */
        /* Cards that are off-screen in the list enter from a capped distance
           off the nearest edge and fade in, rather than flying their full
           list offset across the centre. Visible cards keep their true
           origin, so the list at gridProgress 0 is pixel-identical. */
        const capped = gridProgress > 0 && isRealCard && Math.abs(offset) > vh * MORPH_OFFSCREEN_VH;
        const travelCap = vh * MORPH_TRAVEL_CAP_VH;
        const originY = capped ? gridY + clampNumber(offset - gridY, -travelCap, travelCap) : offset;
        const t = capped ? smootherstep(gridProgress) : gridProgress;
        const opacity = capped
          ? t
          : listOpacity * (1 - gridProgress) + (isRealCard ? 1 : 0) * gridProgress;
        const x = gridX * t;
        const y = originY * (1 - t) + gridY * t;

        el.style.display = 'flex';
        el.style.transform =
          `translate3d(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px), 0) ` +
          `scale(${(scale * (1 - t) + t).toFixed(3)})`;
        el.style.opacity = opacity.toFixed(3);
        el.style.zIndex = String(Math.round(
          (100 - absDist * 10) * (1 - gridProgress) + (80 - cardIndex) * gridProgress));
        el.style.filter = `blur(${(blur * (1 - gridProgress)).toFixed(2)}px)`;
        el.style.pointerEvents = opacity < 0.05 ? 'none' : 'auto';
      }

      /* The morph is over and the list owns the scroll again — put the real
         scroll position where the frozen float said it was. */
      if (!isMobile && targetGrid === 0 && gridProgress === 0 && morphRawFloatRef.current !== null) {
        morphRawFloatRef.current = null;
      }

      frameId = window.requestAnimationFrame(render);
    };

    /* ---- arrow-key snapping ----
       Keep one interruptible Lenis tween per key step. A separate
       anticipation tween looks attractive, but it can race the infinite
       scroll target at the seam and skip a card. The card's existing roll
       curve provides the anticipation without a second scroll animation. */
    const KEY_SNAP_RESET_MS = 1200;
    const KEY_SNAP_BASE_MS = 760;
    let keySnapResetTimer = 0;
    const heldKeys = new Set();
    const onKeyDown = (e) => {
      if (viewModeRef.current !== 'list' || !introCompleteRef.current || isMobile || !loop) return;
      if (e.target.closest?.('input, textarea')) return;
      if (e.repeat || heldKeys.has(e.key)) return;
      let delta = 0;
      if (e.key === 'ArrowDown' || e.key === 'j') delta = 1;
      else if (e.key === 'ArrowUp' || e.key === 'k') delta = -1;
      else return;
      heldKeys.add(e.key);
      e.preventDefault();

      if (keySnapTargetRef.current === null) {
        keySnapTargetRef.current = Math.round(lenis.scroll / sectionH) * sectionH;
      }
      keySnapTargetRef.current += delta * sectionH;
      const steps = Math.max(1, Math.min(3, Math.abs(delta)));
      lenis.scrollTo(keySnapTargetRef.current, {
        duration: Math.min((KEY_SNAP_BASE_MS + steps * 80) / 1000, 1.0),
        easing: easeInOutCubic,
        force: true,
      });

      window.clearTimeout(keySnapResetTimer);
      keySnapResetTimer = window.setTimeout(() => { keySnapTargetRef.current = null; }, KEY_SNAP_RESET_MS);
    };
    const onKeyUp = (e) => { heldKeys.delete(e.key); };
    const onWindowBlur = () => { heldKeys.clear(); };

    const onResize = () => applyLayout();
    const prevRestoration = 'scrollRestoration' in window.history ? window.history.scrollRestoration : null;
    if (prevRestoration) window.history.scrollRestoration = 'manual';

    applyLayout();
    frameId = window.requestAnimationFrame(render);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('resize', onResize);

    return () => {
      destroyed = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(keySnapResetTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', onResize);
      if (prevRestoration) window.history.scrollRestoration = prevRestoration;
      lenis.destroy();
      lenisRef.current = null;
      keySnapTargetRef.current = null;
    };
  }, [
    isMobile, loop, padding, cards, paddedCards.length, viewportSettled,
    layout.sectionSpacingPx, layout.gridColumns, layout.gridCardSizePx,
    layout.gridColumnGapPx, layout.gridItemHeightPx, layout.gridRowGapPx,
    layout.mobileOpacityFloor,
  ]);

  /* ================= pointer: flick the stack, or click a card =================
     One set of handlers on the stage rather than per card, because a drag
     that starts on a card and ends on the background is still one gesture.

     Touch is deliberately excluded from the flick: Lenis already reads native
     touch scrolling, and claiming the gesture here would replace a scroll
     that works with one that merely imitates it. */
  const onStagePointerDown = useCallback((e) => {
    if (e.button !== 0) return;

    /* The focused card rotates under a drag; the stack is what everything
       else drags. Grid mode has its own scroller, so it is left alone. */
    const onFocusedCard = !!e.target.closest?.('[data-card-focused="true"]');
    const lenis = lenisRef.current;
    if (e.pointerType === 'touch' || onFocusedCard || !lenis || !loop || viewModeRef.current !== 'list') return;
    if (e.target.closest?.('button')) return;

    /* Kill whatever Lenis is mid-way through — the settle from the last
       flick, a key snap — before reading the position the drag is relative
       to. Without this a second flick starting during the first one's settle
       has its per-move writes overwritten by the tween still running
       underneath, and the gesture does nothing at all. */
    lenis.scrollTo(lenis.scroll, { immediate: true, force: true });
    keySnapTargetRef.current = null;

    dragRef.current = {
      id: e.pointerId, y: e.clientY, scroll: lenis.scroll,
      lastY: e.clientY, lastT: performance.now(), v: 0, moved: false,
    };
  }, [loop]);

  const onStagePointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < CLICK_SLOP_PX) return;
    if (!d.moved) {
      d.moved = true;
      /* Captured only once the gesture is definitely a drag. Capturing at
         pointerdown would send the pointerup here instead of to the card,
         and a plain click on a card would stop registering.

         Guarded because capture throws NotFoundError if the pointer is gone
         by the time we ask — the button released between this move and the
         handler running — and an exception here would abandon the drag
         mid-gesture with the stack frozen part-way between two cards. */
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* pointer already up */ }
      introCompleteRef.current = true;
      keySnapTargetRef.current = null;
    }
    const now = performance.now();
    d.v = (e.clientY - d.lastY) / Math.max(now - d.lastT, 1);
    d.lastY = e.clientY;
    d.lastT = now;

    const lenis = lenisRef.current;
    if (!lenis) return;
    const target = d.scroll - dy;
    if (!loop) window.scrollTo({ top: target, behavior: 'auto' });
    lenis.scrollTo(target, { immediate: true, force: true });
  }, [loop]);

  const onStagePointerUp = useCallback((e) => {
    const d = dragRef.current;
    dragRef.current = null;

    if (d && d.id === e.pointerId) {
      try {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch { /* nothing to release */ }
      if (d.moved) {
        /* Throw on the release velocity, then land on a whole card — a stack
           resting half-way between two cards reads as broken, however
           continuous the scale and opacity ramps are. */
        const lenis = lenisRef.current;
        const sectionH = sectionHRef.current;
        if (lenis && sectionH) {
          const settleTarget = Math.round((lenis.scroll - d.v * FLICK_PROJECT_MS) / sectionH) * sectionH;
          /* Keep the landing target interruptible if another gesture starts
             while Lenis is still coasting toward the snap. */
          flickTargetRef.current = settleTarget;
          lenis.scrollTo(settleTarget, {
            duration: FLICK_SETTLE_S, force: true,
            onComplete: () => {
              if (flickTargetRef.current === settleTarget) flickTargetRef.current = null;
            },
          });
        }
      }
    }
  }, []);

  const boxWidth = !isMobile && isGrid ? layout.gridBoxWidth : layout.listBoxWidth;
  const boxHeight = !isMobile && isGrid ? layout.gridBoxHeight : layout.listBoxHeight;
  return (
    <div ref={rootRef} className="garden-mount-gate" data-view={isGrid ? 'grid' : 'list'}>
      {/* The scroll track. It carries no content — its only job is to give the
          document the height the stack reads its position from. */}
      <div ref={trackRef} className="garden-track" aria-hidden="true" />

      <div className="garden-shell">
        <div
          ref={stageRef}
          className="garden-stage"
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
          onPointerCancel={onStagePointerUp}
        >
          <div
            ref={gridScrollerRef}
            className="garden-scroller"
            data-browsing={isGridBrowsing}
            /* Lenis preventDefaults the wheel for the whole window, so a real
               overflow container inside it never receives a tick — and
               lenis.stop() does not help, because a stopped Lenis still
               swallows the event, it just ignores the delta. This attribute
               is its own opt-out: with it present Lenis skips any event whose
               path passes through here, and the grid scrolls natively. Only
               while the grid is up, or the list would stop scrolling too. */
            data-lenis-prevent={isGrid ? '' : undefined}
          >
            <div
              className="garden-cards"
              style={{
                width: isGrid ? layout.gridWidth : '100%',
                height: isGrid ? layout.gridHeight : '100%',
                transition: MORPH_TRANSITION('width', 'height'),
              }}
            >
              {paddedCards.map((entry, i) => {
                const cardIndex = i - padding;
                const isRealCard = cardIndex >= 0 && cardIndex < cards.length;
                /* Whichever padded slot is actually centred — real card or
                   loop clone, it makes no visual difference, same config —
                   gets to be the interactive one. See centeredPos's note. */
                const isFocused = !isGrid && i === centeredPos;
                return (
                  <div
                    key={`${entry.id}-${i}`}
                    ref={(el) => { cardRefs.current[i] = el; }}
                    className="garden-card-frame"
                    data-card-id={entry.id}
                    data-card-focused={isFocused ? 'true' : undefined}
                    style={{
                      width: boxWidth,
                      height: boxHeight,
                      transition: MORPH_TRANSITION('width', 'height'),
                    }}
                  >
                  </div>
                );
              })}
            </div>
          </div>
          <GardenCanvas
            cards={cards}
            motionRef={canvasMotionRef}
            lights={cards[0]?.config?.lights ?? []}
            lensEffects={lensEffects}
            motionTuning={motionTuning}
            onCardReady={onCardReady}
          />
        </div>
      </div>
    </div>
  );
}
