/* ================= generated textures =================
   Everything drawn or computed at runtime instead of downloaded: the
   procedural brushed-metal grain, the engraving relief-map generator, and the
   2D-canvas textures (chip etch, cardholder name, logo mark, seating shadow).

   All pure: each call returns fresh textures the caller owns and disposes.
   These need a DOM canvas, so the engine assumes a browser — which is true of
   both consumers, the playground and React in the browser. */

import * as THREE from 'three';
import { clamp } from './constants.js';

export function makeBrushed(size, grainPct, reliefPct) {
  const grain = clamp(grainPct/100, 0, 1), relief = clamp(reliefPct/100, 0, 1);
  const nrm = new Uint8Array(size*size*4), rgh = new Uint8Array(size*size*4);
  for (let y = 0; y < size; y++) {
    const streak = 0.52*Math.sin(0.43*y) + 0.24*Math.sin(1.77*y) + 0.10*Math.sin(4.13*y);
    for (let x = 0; x < size; x++) {
      const i = (y*size + x) * 4;
      const h = 43758.5453 * Math.sin(12.9898*x + 78.233*y);
      const n = h - Math.floor(h) - 0.5;
      nrm[i]   = clamp(128 + Math.round(1.2*n), 0, 255);
      nrm[i+1] = clamp(128 + Math.round(streak*(1.6 + 6.4*grain) + n*(0.5 + 2.2*grain)), 0, 255);
      nrm[i+2] = 253; nrm[i+3] = 255;
      const r = clamp(218 + streak*(4 + 11*grain) + n*(2 + 5*grain), 190, 238);
      rgh[i] = rgh[i+1] = rgh[i+2] = r; rgh[i+3] = 255;
    }
  }
  const normal = new THREE.DataTexture(nrm, size, size, THREE.RGBAFormat);
  const roughness = new THREE.DataTexture(rgh, size, size, THREE.RGBAFormat);
  for (const t of [normal, roughness]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.5, 7);
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
  }
  return { normal, roughness,
    normalScale: new THREE.Vector2(0.01 + 0.055*grain, 0.025 + 0.17*relief) };
}

export function labelTexture(text) {
  const label = (text || ' ').toUpperCase();
  const font = '600 78px Chivo, Helvetica, Arial, sans-serif';
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  if ('letterSpacing' in probe) probe.letterSpacing = '7px';
  const w = Math.max(40, Math.ceil(probe.measureText(label).width) + 16), h = 116;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = font;
  if ('letterSpacing' in g) g.letterSpacing = '7px';
  g.fillStyle = '#ffffff'; g.textBaseline = 'alphabetic';
  g.fillText(label, 8, 88);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { texture: t, aspect: w / h, canvas: c };
}
/* Shared card logo. Keep the SVG path here so the playground, flat card,
   depth card, and garden all derive their top-left mark from one source. The
   white stencil is later turned into the card's engraved relief by card.js. */
const SHARED_LOGO_PATH = 'M0 15.415c0 .468.38.85.848.85h5.937V.575L0 7.72zm15.416 8.582c.467 0 .846-.38.846-.849v-5.937H.573l7.146 6.785h7.697M24 8.587a.844.844 0 0 0-.847-.846h-5.938V23.43l6.782-7.148zM8.585.003a.847.847 0 0 0-.847.847v5.94h15.688L16.282.003z';

export function markTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.save();
  g.scale(c.width / 24, c.height / 24);
  g.fill(new Path2D(SHARED_LOGO_PATH));
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { texture: t, canvas: c };
}

/* Visa wordmark source. It is intentionally generated as a transparent
   stencil, then passed through the same engraved relief/shading pipeline as
   the shared top mark and cardholder name. */
const VISA_PATH = 'M1 8.5h2.698a1 1 0 0 1 .976.783L5.5 13L7 8.5h2l-2.5 7h-2L3 9.5zm9 0h1.5l-1 7H9zm5.003 0c.8 0 1.62.124 1.954.291l-.236 1.426c-.303-.165-.99-.31-1.648-.31s-.846.415-.846.595c0 .247.333.424.756.648c.734.39 1.738.923 1.738 2.217c0 1.502-1.902 2.133-2.903 2.133c-.8 0-1.778-.124-2.112-.291l.235-1.426c.299.103 1.123.333 1.781.333c.66 0 1.147-.333 1.147-.618c0-.426-.422-.646-.915-.903c-.694-.362-1.529-.797-1.529-1.985c0-1.502 1.577-2.11 2.578-2.11m1.497 7h2l.343-1h2.29l.223 1H23l-1.5-7h-2zm4.311-2.502h-1.48l.936-2.527z';

export function visaTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 180;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.save();
  g.translate(12, -145);
  g.scale(20, 20);
  g.fill(new Path2D(VISA_PATH));
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { texture: t, canvas: c };
}

/* Contactless/wave mark. The isolated dot from the source SVG is omitted so
   the mark reads as three clean radiating waves. */
const CONTACTLESS_PATH = 'M12 13c1.38 0 2.632.56 3.536 1.464a1 1 0 0 1-1.415 1.415A3 3 0 0 0 12 15c-.829 0-1.577.335-2.121.879a1 1 0 0 1-1.415-1.415A5 5 0 0 1 12 13m0-4a8.98 8.98 0 0 1 6.364 2.636a1 1 0 0 1-1.414 1.414A6.98 6.98 0 0 0 12 11a6.98 6.98 0 0 0-4.95 2.05a1 1 0 0 1-1.414-1.414A8.98 8.98 0 0 1 12 9m0-4c3.59 0 6.84 1.456 9.192 3.808a1 1 0 0 1-1.414 1.414A10.96 10.96 0 0 0 12 7a10.96 10.96 0 0 0-7.778 3.222a1 1 0 0 1-1.414-1.414A12.96 12.96 0 0 1 12 5';

export function contactlessTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.save();
  g.translate(8, -2);
  g.scale(10, 10);
  g.fill(new Path2D(CONTACTLESS_PATH));
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { texture: t, canvas: c };
}

/* ---- relief: turn a flat stencil into a chamfered edge -------------------
   Real engraving is far too shallow to see as a shape. What sells it is the
   sloped wall at the edge of each letter picking up a different reflection
   from the flat metal beside it. So: blur the letter shape to get a ramp at
   every edge, read the slope of that ramp, and write it into a normal map. */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w*h), out = new Float32Array(w*h);
  const span = r*2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y*w + clamp(k, 0, w-1)];
    for (let x = 0; x < w; x++) {
      tmp[y*w + x] = acc / span;
      acc -= src[y*w + clamp(x - r, 0, w-1)];
      acc += src[y*w + clamp(x + r + 1, 0, w-1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, h-1)*w + x];
    for (let y = 0; y < h; y++) {
      out[y*w + x] = acc / span;
      acc -= tmp[clamp(y - r, 0, h-1)*w + x];
      acc += tmp[clamp(y + r + 1, 0, h-1)*w + x];
    }
  }
  return out;
}
export function makeRelief(canvas, softPct, depthPct) {
  const w = canvas.width, h = canvas.height;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let a = new Float32Array(w*h);
  for (let i = 0; i < w*h; i++) a[i] = px[i*4 + 3] / 255;

  /* The blur radius controls how WIDE the chamfer is. Tie it to the shape's
     own scale (its shorter side), not the canvas width, so a long name and a
     compact logo both get a proportionate ramp — and floor it well above a
     couple of pixels so the raw font antialiasing never leaks straight into
     the normal map as noise. Three light passes beat one heavy one: it
     smooths the corners of a stroke without rounding the whole letterform
     into a blob. */
  const base = Math.min(w, h);
  const r = Math.max(2, Math.round(1 + (softPct/100) * Math.max(2, base/24)));
  a = boxBlur(a, w, h, r);
  a = boxBlur(a, w, h, Math.max(1, Math.round(r*0.6)));
  a = boxBlur(a, w, h, Math.max(1, Math.round(r*0.35)));

  /* Flatten the floor. A blurred filled glyph is a smooth dome, and the
     gradient of a dome points inward everywhere — which is precisely why this
     used to read as a puffy pillow rather than a cut. Rescaling the middle of
     the ramp to the full range saturates the interior to 1, so the slope
     survives only in a narrow band at the boundary: a flat floor with a wall
     around it, which is what an engraving actually is. */
  for (let i = 0; i < a.length; i++) {
    a[i] = clamp((a[i] - 0.28) / 0.44, 0, 1);
  }

  /* A box blur of radius r flattens a hard edge's gradient in proportion to
     1/r, so multiplying by r here (not dividing, as before) cancels that
     out — the wall's STEEPNESS then comes from Depth alone, and Softness
     only changes how WIDE it is. Dividing by r, as this used to, made a
     tight edge's gradient explode right when it was already least smoothed
     — that combination is what read as jagged, crooked letters. */
  /* Always negative: the shape is cut INTO the metal. The raised version was
     removed — it read as a puffy sticker rather than anything pressed. */
  /* Gentler than it was. Flattening the floor already concentrated the whole
     slope into a narrow band, so the old multiplier on top of that turned a
     thin stroke — the logo's arcs especially — into a tube with no floor left
     in the middle of it. */
  const gain = -(Math.abs(depthPct)/100) * 0.95 * r;
  const data = new Uint8Array(w*h*4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y*w + x;
      const gx = a[y*w + clamp(x+1, 0, w-1)] - a[y*w + clamp(x-1, 0, w-1)];
      // canvas y runs downward, normal maps expect +Y up, hence the flip
      const gy = a[clamp(y-1, 0, h-1)*w + x] - a[clamp(y+1, 0, h-1)*w + x];
      let nx = -gx * gain, ny = -gy * gain, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const o = i*4;
      data[o]   = clamp(Math.round((nx*0.5 + 0.5)*255), 0, 255);
      data[o+1] = clamp(Math.round((ny*0.5 + 0.5)*255), 0, 255);
      data[o+2] = clamp(Math.round((nz*0.5 + 0.5)*255), 0, 255);
      data[o+3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/* the thin dark line where the chip meets the metal — without it, anything
   resting on a surface reads as floating */
export function seatShadowTexture() {
  const S = 256, pad = 30;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const inner = { x: pad, y: pad, w: S - pad*2, h: S - pad*2, r: 26 };
  g.save();
  g.filter = 'blur(11px)';
  g.fillStyle = '#000000';
  g.beginPath();
  g.roundRect(inner.x, inner.y + 3, inner.w, inner.h, inner.r);
  g.fill();
  g.restore();
  // punch out the footprint so the shadow only shows around the chip
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.roundRect(inner.x + 2, inner.y + 2, inner.w - 4, inner.h - 4, inner.r);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ---- the shading that makes a cut look cut -------------------------------
   A normal map alone only tilts the wall so it catches a different
   reflection. It cannot darken anything, so it can never say "this surface is
   further away and sees less of the room" — and without that the engraving
   reads as a shape drawn on the metal rather than taken out of it.

   This bakes the three cues a normal map cannot carry, into the glyph's own
   diffuse map. At metalness 1 that map tints the reflected environment, so
   darkening it genuinely removes reflected light rather than just painting
   grey on:

     the floor      sits below the surface, so it sees less of the room
     a contact band hugs the inside of the edge all the way round, which is
                    the occlusion from the wall standing over it
     a lit wall     on the far side from the key light, and a deeper shadow
                    on the near side

   The direction is passed in rather than assumed, because assuming it got it
   backwards: the default rig's two brightest panels (Right key 4.6, Hot strip
   5.0) both sit on the +x side, so the card is lit from the RIGHT, and a
   shadow baked at the top-left fought the normal map instead of reinforcing
   it. card.js derives the direction from whichever panels are actually on.

   Baking a direction at all is safe here because the logo and the name exist
   only on the front face — flip the card and you are looking at the back. */
export function makeEngraveShading(glyph, softPct, depthPct, light = { x: 1, y: 0 }) {
  const w = glyph.width, h = glyph.height;
  const depth = clamp(Math.abs(depthPct) / 100, 0, 1);
  const base = Math.min(w, h);

  /* Same scale rule as the relief: proportional to the shape, not the canvas,
     so a long name and a compact logo get the same apparent wall. */
  const band = Math.max(1.5, (0.55 + (softPct / 100) * 1.9) * Math.max(2, base / 26));
  const throw_ = Math.max(1, Math.round(band * 0.6));

  /* Everything below is deliberately restrained. A thin stroke is narrower
     than the band, so its two edges overlap and every layer stacks on the
     same pixels — strengths that look right on a fat letter turn the logo's
     arcs into dark tubes. Depth earns its effect slowly. */

  const layer = () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  /* Everything EXCEPT the glyph shifted by (dx,dy), then blurred. Composited
     back inside the glyph it leaves a band hugging the inner edge — centred
     when the offset is zero, pushed to one side when it is not. */
  const innerBand = (dx, dy, colour) => {
    const cut = layer();
    const cg = cut.getContext('2d');
    cg.fillStyle = colour;
    cg.fillRect(0, 0, w, h);
    cg.globalCompositeOperation = 'destination-out';
    cg.drawImage(glyph, dx, dy);

    const soft = layer();
    const sg = soft.getContext('2d');
    sg.filter = `blur(${band.toFixed(2)}px)`;
    sg.drawImage(cut, 0, 0);
    return soft;
  };

  const out = layer();
  const g = out.getContext('2d');

  /* The glyph itself carries the alpha, so alphaTest still cuts the letters
     out of the plate exactly as before. */
  g.drawImage(glyph, 0, 0);

  /* Everything from here only paints where the glyph already is. */
  g.globalCompositeOperation = 'source-atop';

  g.fillStyle = `rgba(0,0,0,${(0.06 + 0.22 * depth).toFixed(3)})`;
  g.fillRect(0, 0, w, h);

  g.globalAlpha = 0.22 + 0.30 * depth;
  g.drawImage(innerBand(0, 0, '#000000'), 0, 0);

  /* Canvas y runs downward and the rig's y runs up, hence the flip. Shifting
     the glyph by -light leaves the band on the side FACING AWAY from the
     light: the wall in shadow. */
  const lx = light.x * throw_;
  const ly = -light.y * throw_;

  g.globalAlpha = 0.24 + 0.34 * depth;
  g.drawImage(innerBand(-lx, -ly, '#000000'), 0, 0);

  /* The opposite wall faces into the light. Kept deliberately weak: the
     normal map already produces this highlight and moves it correctly as the
     card turns, so a strong baked one on top reads as a bright outline
     around the letters — which looks raised, not cut. */
  g.globalAlpha = 0.08 + 0.14 * depth;
  g.drawImage(innerBand(lx, ly, '#ffffff'), 0, 0);

  g.globalAlpha = 1;
  return out;
}
