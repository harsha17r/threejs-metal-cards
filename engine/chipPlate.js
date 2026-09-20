/* ================= the chip's contact plate =================
   A stamped metal plate is not a picture, so this does not paint one. It
   builds three maps that feed the PBR material separately:

     colour     nearly white off the pads, so the material's own base colour
                decides whether the plate is silver, gold or dark nickel and
                stays metallic — but is the stroke's own colour wherever the
                contact lines are drawn, plus a little per-pad brightness
     roughness  where almost all the character lives: per-pad polish, the
                directional plating pattern, micro scratches, grain, and the
                slight polish that collects along raised edges
     normal     microscopic surface relief and the scratches, as shallow
                furrows — the contact lines are flat ink on the plate, not a
                milled channel, and carry no height of their own

   Three scales, deliberately:
     large   per-pad polish and brightness, so no two contacts match
     medium  the directional brushing the plating was laid down with
     micro   grain and broken scratches, visible mostly as the light moves

   Nothing is uniform. Every pad gets its own seed, and that seed shifts the
   phase, spacing, angle and strength of each layer — procedural regularity is
   the single most recognisable tell that a surface was generated. */

import * as THREE from 'three';
import { clamp } from './constants.js';

export const PLATE_W = 640, PLATE_H = 548;

/* The ISO/IEC 7816-2 contact layout, as data rather than drawing commands, so
   the mask and the pad lookup below cannot drift apart. */
const PLATE = {
  margin: 0.055,
  corner: 0.10,
  centre: { narrow: 0.055, wide: 0.135, yA: 0.20, yB: 0.78 },
  rows: { left: [0.335, 0.60], right: [0.30, 0.50, 0.70] },
};

const hash1 = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const hash2 = (a, b) => hash1(a * 57.31 + b * 13.77);

/* Half-width of the centre column at a given height, so the pad lookup agrees
   with the drawn shape including its waist. */
function centreHalfAt(v) {
  const { narrow, wide, yA, yB } = PLATE.centre;
  if (v < yA) return narrow;
  if (v > yB) return narrow;
  const fade = 0.04;
  if (v < yA + fade) return narrow + (wide - narrow) * ((v - yA) / fade);
  if (v > yB - fade) return narrow + (wide - narrow) * ((yB - v) / fade);
  return wide;
}

/* Which contact a point belongs to. Analytic rather than a flood fill: the
   layout is known, so the answer is a handful of comparisons instead of a
   second pass over the buffer. -1 means outside the plated area. */
export function padIndexAt(u, v) {
  const m = PLATE.margin;
  if (u < m || u > 1 - m || v < m || v > 1 - m) return -1;
  if (Math.abs(u - 0.5) <= centreHalfAt(v)) return 0;

  const left = u < 0.5;
  const rows = left ? PLATE.rows.left : PLATE.rows.right;
  let row = 0;
  while (row < rows.length && v > rows[row]) row++;
  return (left ? 1 : 5) + row;
}

/* The contact lines, as alpha — a flat stroke on the plate, not a milled
   channel. Colour paints straight off this; there is no height field derived
   from it. */
function strokeMaskCanvas(strokeWidth) {
  const W = PLATE_W, H = PLATE_H;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  g.strokeStyle = '#000000';
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const gw = W * (0.008 + 0.030 * clamp(strokeWidth / 100, 0, 1));
  const m = PLATE.margin;

  g.lineWidth = gw;
  g.beginPath();
  g.roundRect(W * m, H * m, W * (1 - m * 2), H * (1 - m * 2), W * PLATE.corner);
  g.stroke();

  const cx = W * 0.5;
  const { narrow, wide, yA, yB } = PLATE.centre;
  const hN = W * narrow, hW = W * wide;
  const yTop = H * m, yBot = H * (1 - m);

  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + side * hN, yTop);
    g.lineTo(cx + side * hN, H * yA - H * 0.03);
    g.quadraticCurveTo(cx + side * hN, H * yA, cx + side * hW, H * yA + H * 0.02);
    g.lineTo(cx + side * hW, H * yB - H * 0.02);
    g.quadraticCurveTo(cx + side * hN, H * yB, cx + side * hN, H * yB + H * 0.03);
    g.lineTo(cx + side * hN, yBot);
    g.stroke();
  }

  g.lineWidth = gw * 0.9;
  for (const [side, ys] of Object.entries(PLATE.rows)) {
    const x0 = side === 'left' ? W * m : cx + hW;
    const x1 = side === 'left' ? cx - hW : W * (1 - m);
    for (const y of ys) {
      g.beginPath();
      g.moveTo(x0, H * y);
      g.lineTo(x1, H * y);
      g.stroke();
    }
  }

  /* Probe dimples punched into several pads. Drawn into the same mask so they
     are recessed and duller like everything else pressed into the plate —
     which is what they are. Deliberately not symmetrical. */
  g.fillStyle = '#000000';
  for (const [vx, vy, vr] of [
    [0.215, 0.235, 1.0], [0.215, 0.755, 0.9], [0.305, 0.47, 0.8],
    [0.775, 0.215, 1.0], [0.775, 0.40, 0.85], [0.775, 0.60, 0.95], [0.70, 0.83, 0.8],
  ]) {
    g.beginPath();
    g.arc(vx * W, vy * H, gw * 0.62 * vr, 0, Math.PI * 2);
    g.fill();
  }

  /* The hooked traces curling in from the top corners. */
  g.lineWidth = gw * 0.75;
  for (const side of [-1, 1]) {
    const x = cx + side * W * 0.40;
    g.beginPath();
    g.moveTo(x, H * m);
    g.lineTo(x, H * 0.115);
    g.quadraticCurveTo(x, H * 0.165, x - side * W * 0.055, H * 0.165);
    g.stroke();
  }

  return c;
}

/* Separable box blur over a Float32 field. Used to soften the stroke's own
   edge and to build the distance-from-pad-edge band below — an infinitely
   sharp edge on anything stamped or printed is the giveaway that nothing
   physical made it. */
function blurField(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const span = r * 2 + 1;
  const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * w + cl(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / span;
      acc -= src[y * w + cl(x - r, 0, w - 1)];
      acc += src[y * w + cl(x + r + 1, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[cl(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / span;
      acc -= tmp[cl(y - r, 0, h - 1) * w + x];
      acc += tmp[cl(y + r + 1, 0, h - 1) * w + x];
    }
  }
  return out;
}

/* Fine broken abrasion along the brushing direction. Deliberately sparse and
   interrupted — a continuous line reads as a drawn stroke, and what makes a
   scratch look like a scratch is that it starts and stops. */
function scratchAt(t, s, density, seed) {
  const row = Math.floor(s * density + seed * 37);
  const jitter = hash1(row) * 0.6;
  const seg = Math.floor(t * (5 + hash1(row + 3) * 7) + jitter * 9);
  if (hash2(row, seg) < 0.74) return 0;
  const across = Math.abs((s * density + seed * 37) % 1 - 0.5) * 2;
  return Math.pow(1 - across, 10) * (0.5 + hash2(row, seg + 1) * 0.5);
}

function makeTex(data, w, h, srgb) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/* Builds all three maps in one pass over the buffer. Returns textures the
   caller owns. */
export function buildChipPlate({
  strokeWidth = 0,    // how thick the contact lines are drawn
  strokeColor = '#2b2926', // the lines' own colour — flat ink, not a groove
  stampRound = 0,     // radius on every stamped edge
  plating = 33,       // medium-scale directional brushing
  platingAngle = 90,  // direction of the plating passes: 0 horizontal, 90 vertical
  scratch = 0,        // micro abrasion
  scratchAngle = 0,   // degrees, shared with the material's anisotropy
  grain = 0,           // micro tooth
  micro = 32,          // microscopic surface relief
  padVar = 16,         // per-contact polish and brightness
  edgeWear = 15,       // polish collecting along raised edges
} = {}) {
  const W = PLATE_W, H = PLATE_H, N = W * H;

  const pl = clamp(plating / 100, 0, 1);
  const sc = clamp(scratch / 100, 0, 1);
  const gr = clamp(grain / 100, 0, 1);
  const mi = clamp(micro / 100, 0, 1);
  const pv = clamp(padVar / 100, 0, 1);
  const ew = clamp(edgeWear / 100, 0, 1);

  const ang = (platingAngle * Math.PI) / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang);

  /* The stroke's own colour, read straight off the hex the same way the
     colour map's white starts at 1 — no gamma step, since the texels below
     are written directly into a texture already flagged sRGB. */
  const scHex = strokeColor.replace('#', '');
  const scR = parseInt(scHex.slice(0, 2), 16) / 255;
  const scG = parseInt(scHex.slice(2, 4), 16) / 255;
  const scB = parseInt(scHex.slice(4, 6), 16) / 255;

  /* Stroke coverage as a field, then softened — the blur radius IS the stamp
     radius, so Edge Softness widens the line itself, not just the pads. */
  const maskCanvas = strokeMaskCanvas(strokeWidth);
  const md = maskCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  let field = new Float32Array(N);
  for (let i = 0; i < N; i++) field[i] = md[i * 4 + 3] / 255;

  const radius = Math.max(1, Math.round(1 + (stampRound / 100) * (W * 0.012)));
  field = blurField(field, W, H, radius);
  field = blurField(field, W, H, Math.max(1, Math.round(radius * 0.45)));

  /* Distance-from-edge, cheaply: a blurred pad mask is ~0.5 at a boundary and
     saturates away from one, so the band peaks exactly where a stamped edge
     would have been worked smooth by handling. */
  const padBand = blurField(field, W, H, Math.max(2, Math.round(radius * 2.2)));

  const colour = new Uint8Array(N * 4);
  const rough = new Uint8Array(N * 4);
  const height = new Float32Array(N);

  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W;

      const inStroke = field[i];
      const pad = padIndexAt(u, v);
      const seed = pad < 0 ? 0.5 : hash1(pad * 7.13 + 1.7);
      const seed2 = pad < 0 ? 0.5 : hash1(pad * 3.91 + 9.2);

      /* Rotated frame: t runs along the brushing, s across it. */
      const t = u * ca + v * sa;
      const s = -u * sa + v * ca;

      /* MEDIUM — the passes the plating was laid down in, each pad running at
         its own spacing and phase so the pattern never lines up across a
         stroke the way a single global sine would. */
      /* Kept well below Nyquist for the buffer. At ~210 cycles across 640
         texels the passes land 2-3 texels apart, beat against the sampling
         grid, and moire into wide corrugations that look nothing like
         brushing — the pattern has to be resolvable to read as fine. */
      const freq = 90 + seed * 55;
      const brush = Math.sin(s * freq + seed2 * 6.283) * 0.5 + 0.5;

      /* MICRO — grain, and broken abrasion along the same direction. */
      const noise = hash2(x * 1.7, y * 2.3);
      const scr = sc > 0 ? scratchAt(t, s, 150 + seed * 120, seed2) : 0;

      /* LARGE — this contact's own polish. */
      const padPolish = (seed - 0.5) * 2;

      /* Raised edges get handled, so they polish slightly smoother. */
      const band = 1 - Math.abs(padBand[i] * 2 - 1);

      let r = 0.52
        + padPolish * 0.16 * pv
        + (brush - 0.5) * 0.16 * pl
        + (noise - 0.5) * 0.13 * gr
        - scr * 0.30 * sc
        - band * 0.26 * ew;
      /* The ink sits duller than the plating around it, so the line still
         reads under a moving light rather than vanishing into the reflection
         whenever its colour happens to match the room. Fixed, not a dial —
         the stroke is colour and thickness, nothing else. */
      r += inStroke * 0.18;
      r = clamp(r, 0.04, 1);

      const rv = Math.round(r * 255);
      const o = i * 4;
      rough[o] = 0; rough[o + 1] = rv; rough[o + 2] = 0; rough[o + 3] = 255;

      /* Colour stays close to white off the pads, so the material's base
         colour still decides the metal there. Under the stroke it IS the
         stroke colour — the mask's own coverage is the only blend, so the
         line is drawn at full strength and feathers only at its edge. No
         separate darkness dial: thickness sets how much line there is, colour
         sets what it is. */
      const base = clamp(1 + padPolish * 0.035 * pv + band * 0.05 * ew, 0, 1);
      const mix = clamp(inStroke, 0, 1);
      const cr = clamp(base * (1 - mix) + scR * mix, 0, 1);
      const cg = clamp(base * (1 - mix) + scG * mix, 0, 1);
      const cb = clamp(base * (1 - mix) + scB * mix, 0, 1);
      colour[o] = Math.round(cr * 255);
      colour[o + 1] = Math.round(cg * 255);
      colour[o + 2] = Math.round(cb * 255);
      colour[o + 3] = 255;

      /* Height feeding the normal map. Kept tiny — this is a stamped foil a
         few tens of microns thick, not terrain. Only the micro relief and
         the scratches live here now; the stroke contributes nothing, because
         a line of ink on a plate has no wall to tip. */
      height[i] = (noise - 0.5) * 0.005 * mi
        + Math.sin(s * freq * 0.5) * 0.004 * mi
        - scr * 0.035 * sc;
    }
  }

  /* Height -> normal. The gradient is scaled by the map size so the slope
     stays consistent whatever resolution the plate is built at. */
  const normal = new Uint8Array(N * 4);
  /* The micro terms above were scaled to this gain back when a groove wall
     shared it. The wall is gone; the gain stays so the relief and scratches
     keep exactly the strength they were tuned at. */
  const gain = W * 0.05;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xm = x > 0 ? i - 1 : i, xp = x < W - 1 ? i + 1 : i;
      const ym = y > 0 ? i - W : i, yp = y < H - 1 ? i + W : i;
      const dx = (height[xp] - height[xm]) * gain;
      /* Canvas y runs down, normal maps expect +Y up. */
      const dy = (height[ym] - height[yp]) * gain;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const o = i * 4;
      normal[o] = clamp(Math.round((nx * 0.5 + 0.5) * 255), 0, 255);
      normal[o + 1] = clamp(Math.round((ny * 0.5 + 0.5) * 255), 0, 255);
      normal[o + 2] = clamp(Math.round((nz * 0.5 + 0.5) * 255), 0, 255);
      normal[o + 3] = 255;
    }
  }

  return {
    colorMap: makeTex(colour, W, H, true),
    roughnessMap: makeTex(rough, W, H, false),
    normalMap: makeTex(normal, W, H, false),
  };
}
