/* ================= card geometry =================
   Pure shape builders. Nothing here holds state or touches a scene; every
   function returns a fresh BufferGeometry the caller owns and must dispose.
   That "fresh every time" rule matters now that more than one card can exist
   at once — a shared geometry disposed by one card would blank the others. */

import * as THREE from 'three';
import { CARD_W, CARD_H, CHIP, clamp } from './constants.js';

export function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const l = -w/2, rr = w/2, t = h/2, b = -h/2;
  s.moveTo(l+r, b);
  s.lineTo(rr-r, b); s.quadraticCurveTo(rr, b, rr, b+r);
  s.lineTo(rr, t-r); s.quadraticCurveTo(rr, t, rr-r, t);
  s.lineTo(l+r, t);  s.quadraticCurveTo(l, t, l, t-r);
  s.lineTo(l, b+r);  s.quadraticCurveTo(l, b, l+r, b);
  return s;
}

export function planarUV(geo, w = CARD_W, h = CARD_H) {
  const p = geo.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i*2] = p.getX(i)/w + 0.5; uv[i*2+1] = p.getY(i)/h + 0.5; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/* The bevel scales with the card's own thickness, so a thin card gets a thin
   edge rather than being mostly bevel. Total depth always comes out equal to
   cardD. `edgeSmooth` (0-100) sets how many flat facets approximate the
   curved edge — low is a faceted, cut-diamond look; high is one continuous
   sweep, which is what makes a highlight glide along the rim instead of
   breaking into a couple of hard glints. */
export function makeBodyGeo(cardD, cornerR, edgeSmooth) {
  const bevelThickness = clamp(cardD * 0.14, 0.0012, 0.0055);
  const bevelSize = clamp(cardD * 0.20, 0.0016, 0.0075);
  const flat = Math.max(0.003, cardD - bevelThickness * 2);
  const bevelSegments = Math.round(THREE.MathUtils.lerp(1, 10, clamp(edgeSmooth/100, 0, 1)));
  const g = new THREE.ExtrudeGeometry(roundedShape(CARD_W, CARD_H, cornerR), {
    depth: flat, steps: 1, curveSegments: 20,
    bevelEnabled: true, bevelSegments, bevelSize, bevelThickness });
  g.center(); g.computeVertexNormals(); planarUV(g);
  g.userData.total = flat + bevelThickness * 2;
  return g;
}

export function makeFaceGeo(cornerR) {
  return planarUV(new THREE.ShapeGeometry(roundedShape(CARD_W*0.998, CARD_H*0.998, cornerR), 20));
}

export const chipW = CARD_W * CHIP.width;
export const chipH = chipW / CHIP.aspect;
export const chipX = -CARD_W/2 + CARD_W*CHIP.left + chipW/2;
export const chipY =  CARD_H/2 - CARD_H*CHIP.top - chipH/2;

/* The chip's corner radius in card units, from a 0-100 dial. The ceiling is
   deliberately short of chipH/2 (0.217, where the block would collapse into a
   pill and lose the flat run the contact rows need). 30 reproduces the 0.045
   the chip was cut at before this was adjustable. */
export const chipCornerRadius = (pct) => 0.002 + clamp(pct / 100, 0, 1) * 0.145;

/* The reveal around the module, in card units. A chip is a separate part
   dropped into a pocket milled slightly oversize, and the hairline of shadow
   that leaves is most of what tells the eye it is an attachment rather than
   something printed on the card.

   The whole range is tiny on purpose: 10 lands at 0.007 units, a little over
   one screen pixel at the default zoom, so the interesting part of the dial is
   the sub-pixel end. */
export const chipGapSize = (v) => clamp(v, 0, 10) * 0.0007;

/* The chip's top face, for the contact pattern that sits on it.

   `inset` matters: beveling the block pulls the flat top in from the
   silhouette by the bevel size, so a face drawn at the full chipW x chipH
   overhangs the chamfer and the pattern spills down the side. It is sized to
   the real top face instead, and the UVs still span the full chip so the
   artwork lands where the layout says it should. */
export function makeChipFaceGeo(inset = 0, cornerR = 0.045, gap = 0) {
  const w = Math.max(0.01, chipW - (gap + inset) * 2);
  const h = Math.max(0.01, chipH - (gap + inset) * 2);
  const r = clamp(cornerR - gap - inset, 0.001, Math.min(w, h) / 2);
  return planarUV(new THREE.ShapeGeometry(roundedShape(w, h, r), 24), w, h);
}

/* Solid version — a block with chamfered edges. `height` is how far it stands
   proud of the card; `bevel` is the chamfer that makes the rim catch light.

   `gap` shrinks the whole silhouette inward, and takes the corner radius down
   with it by the same amount. That second half is what keeps the reveal an
   even width: offsetting a rounded rectangle inward reduces its radius by the
   offset, and holding the radius fixed instead would pinch the gap shut on the
   straights or balloon it at the corners. */
export function makeChipGeo(height, bevelPct, cornerR = 0.045, gap = 0) {
  const bevel = 0.0004 + 0.0052 * clamp(bevelPct/100, 0, 1);
  const depth = Math.max(0.0010, height);
  const bevelThickness = Math.min(bevel, depth * 0.42);
  const w = Math.max(0.02, chipW - gap * 2);
  const h = Math.max(0.02, chipH - gap * 2);
  const r = clamp(cornerR - gap, 0.001, Math.min(w, h) / 2);
  const g = new THREE.ExtrudeGeometry(roundedShape(w, h, r), {
    depth, steps: 1, curveSegments: 24,
    bevelEnabled: true, bevelSegments: 5,
    bevelSize: bevel, bevelThickness,
  });
  g.center();
  g.computeVertexNormals();
  planarUV(g, w, h);
  g.userData.total = depth + bevelThickness * 2;
  /* How far the flat top is pulled in from the silhouette, so the face that
     carries the contact pattern can be cut to match. */
  g.userData.topInset = bevel;
  return g;
}

/* The floor of the pocket, cut to the chip's nominal footprint. The module
   shrinks inside this, so the only part that ever shows is the hairline all
   the way round — which is the gap. Drawing the slot rather than faking a dark
   outline means the reveal follows the corner radius for free and cannot drift
   out of register with the block sitting in it. */
export function makeChipPocketGeo(cornerR = 0.045) {
  const r = clamp(cornerR, 0.001, Math.min(chipW, chipH) / 2);
  return planarUV(new THREE.ShapeGeometry(roundedShape(chipW, chipH, r), 24), chipW, chipH);
}
