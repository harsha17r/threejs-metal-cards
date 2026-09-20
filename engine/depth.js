/* ================= depth-mapped artwork =================
   The artwork layer rendered through a grayscale depth map by parallax
   occlusion marching: a view ray is walked through the depth map as if it
   were a heightfield, so near pixels genuinely occlude far ones. That
   occlusion is what reads as depth — a flat per-pixel UV offset only smears
   the picture sideways.

   The march is fed the real view direction in the artwork plane's tangent
   space, not a cursor position, so the depth tracks however the card is
   actually turned and stays correct at every angle. The heightfield descends
   INTO the card, like a window milled into the metal; content standing proud
   of the face would clip against the card's own edge.

   Both artwork materials are patched in place rather than replaced, so
   "milled into the metal" keeps picking up the brush grain, the anisotropy
   and the room's reflections exactly as flat artwork does. */

import * as THREE from 'three';
import { CARD_W, CARD_H, CARD_ASPECT, clamp } from './constants.js';

/* Cover-cropped to the card's own aspect so the picture is never stretched. */
const TEX_W = 1024;
const TEX_H = Math.round(TEX_W / CARD_ASPECT);

/* Deepest the heightfield descends, in card units (inches), at full strength.
   The ceiling is past the point of good taste on purpose — it exists so the
   slider can be pushed until it breaks and then walked back. */
const MAX_DEPTH_IN = 0.75;

/* One program is shared by every card (the shader is identical); three.js
   still binds each material's own uniform values, so cards don't collide. */
const CACHE_KEY_INLAY = 'depth-parallax-inlay-v1';
const CACHE_KEY_PRINT = 'depth-parallax-print-v1';

const VERT_DECL = `
uniform vec3 uCamObj;
varying vec3 vDepthView;
varying vec3 vDepthT;
varying vec3 vDepthB;
`;

/* Object space on this mesh is already the tangent frame: the artwork plane
   is flat in XY with its normal down +Z, and planarUV maps u to +X and v to
   +Y. So the vector from the vertex to the camera in object space IS the
   tangent-space view vector, with no TBN matrix to build — and the same two
   axes through normalMatrix are the tangent and bitangent the relief shading
   needs in view space. */
const VERT_BODY = `
  vDepthView = uCamObj - position;
  vDepthT = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
  vDepthB = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
`;

const FRAG_DECL = `
uniform sampler2D uDepthMap;
uniform vec2 uDepthUV;
uniform vec2 uDepthTexel;
uniform float uPivot;
uniform float uRelief;
uniform float uShade;
uniform float uSteps;
varying vec3 vDepthView;
varying vec3 vDepthT;
varying vec3 vDepthB;

/* Where the march landed and how deep it was there, stashed so the relief
   shading further down can reuse them instead of marching a second time. */
vec2 gDepthUv = vec2(0.0);
float gDepthHit = 0.0;

/* Depth maps are white = near. Convert to height below the near plane, so 0
   sits on the card's surface and 1 is the deepest point of the recess. */
float depthHeightAt(vec2 uv) {
  return 1.0 - texture2D(uDepthMap, uv).r;
}
`;

/* Replaces <map_fragment>: same sample, different UV. Only the diffuse map is
   marched — the brush grain in roughnessMap/normalMap belongs to the metal
   surface itself and must stay put while the picture inside moves. */
const FRAG_BODY = `
#ifdef USE_MAP
  vec3 dv = normalize(vDepthView);

  /* At grazing angles xy/z runs away and the march walks off the far side of
     the image, where there is nothing behind the near pixels to reveal and
     the edges smear. Flooring z caps the displacement instead. */
  float dz = max(dv.z, 0.18);

  /* Full UV displacement at height 1, divided per-axis by the card's own
     width and height so a given physical depth shifts the same real distance
     horizontally and vertically instead of shearing with the aspect. */
  vec2 ray = -(dv.xy / dz) * uDepthUV;

  /* Pin one depth layer to the card face. Without it the whole picture slides
     bodily around inside its frame as the card turns. */
  vec2 uv = vMapUv - ray * (1.0 - uPivot);

  /* layer walks 0 -> 1 in lockstep with uv walking along the ray. layer is
     how far the ray has descended, height is how deep the surface actually is
     here; the ray has hit the moment the surface stops being deeper. */
  vec2 stepUv = ray / uSteps;
  float layerStep = 1.0 / uSteps;
  float layer = 0.0;
  float height = depthHeightAt(uv);
  vec2 prevUv = uv;
  float prevHeight = height;

  for (int i = 0; i < 64; i++) {
    if (float(i) >= uSteps) break;
    if (height <= layer) break;
    prevUv = uv;
    prevHeight = height;
    uv += stepUv;
    layer += layerStep;
    height = depthHeightAt(uv);
  }

  /* Interpolate across the samples either side of the intersection, or the
     fixed slices read as contour banding along every depth edge. */
  float after = height - layer;
  float before = prevHeight - (layer - layerStep);
  float t = clamp(before / max(before - after, 0.0001), 0.0, 1.0);

  gDepthUv = mix(prevUv, uv, t);
  gDepthHit = mix(prevHeight, height, t);

  vec4 sampledDiffuseColor = texture2D(map, gDepthUv);
  diffuseColor *= sampledDiffuseColor;

  /* Deep parts of the recess sit further from the opening and catch less of
     the room, so they go down. Displacement alone gives a picture that
     slides; this is what makes it read as a hollow with something in it. */
  diffuseColor.rgb *= 1.0 - uShade * clamp(gDepthHit, 0.0, 1.0);
#endif
`;

/* Appended after <normal_fragment_maps> so it perturbs the normal the metal
   lighting is about to use. Parallax alone only tells you where things are;
   it takes the contours actually catching the room's light for the picture to
   look like it has a surface rather than a shifted print. */
const FRAG_NORMAL = `
#ifdef USE_MAP
  {
    /* Sampled a few texels out rather than one, deliberately. A one-texel
       gradient picks up every wobble in the depth map and turns the picture
       into stamped leather; a wider stencil sees only the broad form. */
    vec2 sp = uDepthTexel * 3.0;
    float hL = depthHeightAt(gDepthUv - vec2(sp.x, 0.0));
    float hR = depthHeightAt(gDepthUv + vec2(sp.x, 0.0));
    float hD = depthHeightAt(gDepthUv - vec2(0.0, sp.y));
    float hU = depthHeightAt(gDepthUv + vec2(0.0, sp.y));
    vec3 tilt = (vDepthT * (hR - hL) + vDepthB * (hU - hD)) * uRelief * 6.0;

    /* A real depth map is not the smooth ramp this looked tuned against —
       a photo's own silhouette (hair against background, say) is a near-hard
       edge, and hR-hL across it can approach the full 0-1 height range in
       just a few texels. Added straight onto a unit normal that is enough to
       tip it 60-80 degrees off true, right to the edge of the tangent plane,
       which is a GRAZING normal — and a grazing normal on a part-metal
       material is a mirror: whatever the room reflects there blows out white,
       which reads as the bare card flashing through the picture. It only
       shows up on the specific pixels whose marched UV happens to land on a
       sharp edge, which only happens at some sampling positions and some
       viewing angles — "glitching at a certain angle" is exactly what a
       ray that occasionally crosses that edge looks like.

       Capping the length is the same move as the dz floor above: it bounds
       how far the tilt may go instead of bounding what the artwork is
       allowed to contain. 1.0 still reads as a strong relief — every edge in
       the depth map keeps tilting the normal right up to the cap — it just
       stops the cap itself from being able to reach grazing. */
    float tiltLen = length(tilt);
    if (tiltLen > 1.0) tilt *= 1.0 / tiltLen;

    normal = normalize(normal + tilt);
  }
#endif
`;

/* Draws an image cover-cropped to the card's aspect. `blurPx` softens hard
   steps in the depth map — those steps are exactly where the parallax shear
   is most visible, so a little blur buys a lot of cleanliness. */
function drawCover(img, blurPx) {
  const c = document.createElement('canvas');
  c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext('2d');
  const scale = Math.max(TEX_W / img.naturalWidth, TEX_H / img.naturalHeight);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  if (blurPx > 0) g.filter = `blur(${blurPx.toFixed(2)}px)`;
  g.drawImage(img, (TEX_W - w) / 2, (TEX_H - h) / 2, w, h);
  return c;
}

/* NO MIPMAPS on either map. The march samples the depth map inside divergent
   control flow, where implicit mip selection is undefined and renders as
   per-pixel sandy garbage; the final artwork sample lands on a UV that jumps
   discontinuously at every depth edge, which picks the wrong mip for the same
   reason. Both are downscaled once on the CPU instead, so LINEAR stays clean. */
function makeTexture(canvas, isDepth) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = isDepth ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${String(src).slice(0, 80)}`));
    img.src = src;
  });
}

/* Builds the parallax controller for ONE card. Nothing here is module-level
   state, so any number of cards can run their own march at once. */
export function createDepthParallax({ inlayMaterial, printMaterial }) {
  const uniforms = {
    uDepthMap:   { value: null },
    uDepthUV:    { value: new THREE.Vector2() },
    uDepthTexel: { value: new THREE.Vector2(1 / TEX_W, 1 / TEX_H) },
    uPivot:      { value: 0.52 },
    uRelief:     { value: 0.30 },
    uShade:      { value: 0.125 },
    uSteps:      { value: 48 },
    uCamObj:     { value: new THREE.Vector3(0, 0, 10) },
  };

  function patch(material, cacheKey) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
      /* The relief append is a no-op on the flat "printed" material, which
         has no lighting and so no <normal_fragment_maps> to attach to. */
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
        .replace('#include <map_fragment>', FRAG_BODY)
        .replace('#include <normal_fragment_maps>',
                 `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
    };
    /* Without this three.js would hand the material the cached UNPATCHED
       program compiled for the same feature set. */
    material.customProgramCacheKey = () => cacheKey;
    material.needsUpdate = true;
  }

  patch(inlayMaterial, CACHE_KEY_INLAY);
  patch(printMaterial, CACHE_KEY_PRINT);

  /* Kept so the blur slider can re-derive the depth texture without going
     back to the network, and so the focal picker can read the same pixels
     the shader is marching through. */
  let sourceDepth = null;
  let depthSampler = null;
  let settings = { strength: 26, pivot: 52, relief: 30, shade: 25, steps: 48, blur: 40 };
  const lastCamObj = new THREE.Vector3(0, 0, 10);

  function rebuildDepthTexture() {
    if (!sourceDepth) return;
    if (uniforms.uDepthMap.value) uniforms.uDepthMap.value.dispose();
    const blurPx = (settings.blur / 100) * (TEX_W * 0.006);
    const canvas = drawCover(sourceDepth, blurPx);
    depthSampler = canvas.getContext('2d', { willReadFrequently: true });
    uniforms.uDepthMap.value = makeTexture(canvas, true);
  }

  /* CanvasTexture flips Y, so texture v = 0 is the canvas's bottom row. */
  function sampleDepth(u, v) {
    if (!depthSampler) return 0;
    const x = clamp(Math.round(u * (TEX_W - 1)), 0, TEX_W - 1);
    const y = clamp(Math.round((1 - v) * (TEX_H - 1)), 0, TEX_H - 1);
    return depthSampler.getImageData(x, y, 1, 1).data[0] / 255;
  }

  /* The JS twin of the shader's marching loop, so clicking a feature pins the
     layer actually drawn there. It has to stay in step with FRAG_BODY. */
  function marchDepthAt(u, v) {
    const px = (u - 0.5) * CARD_W, py = (v - 0.5) * CARD_H;
    const dv = lastCamObj.clone().sub(new THREE.Vector3(px, py, 0)).normalize();
    const dz = Math.max(dv.z, 0.18);
    const depthIn = (settings.strength / 100) * MAX_DEPTH_IN;
    const rayU = -(dv.x / dz) * (depthIn / CARD_W);
    const rayV = -(dv.y / dz) * (depthIn / CARD_H);

    const steps = clamp(Math.round(settings.steps), 4, 64);
    const layerStep = 1 / steps;
    const anchor = 1 - clamp(settings.pivot / 100, 0, 1);

    let uu = u - rayU * anchor, vv = v - rayV * anchor;
    let layer = 0, height = 1 - sampleDepth(uu, vv);
    let prevHeight = height;

    for (let i = 0; i < steps; i++) {
      if (height <= layer) break;
      prevHeight = height;
      uu += rayU / steps;
      vv += rayV / steps;
      layer += layerStep;
      height = 1 - sampleDepth(uu, vv);
    }

    const after = height - layer;
    const before = prevHeight - (layer - layerStep);
    const t = clamp(before / Math.max(before - after, 0.0001), 0, 1);
    return 1 - (prevHeight + (height - prevHeight) * t);   // back to a pivot value
  }

  return {
    uniforms,

    /* Decodes both halves before touching anything, so a failed depth map
       can't leave the card marching against a stale one. Returns the decoded
       artwork image for the caller to turn into the diffuse map. */
    async setSources(imageSrc, depthSrc) {
      const [art, depth] = await Promise.all([loadImage(imageSrc), loadImage(depthSrc)]);
      sourceDepth = depth;
      rebuildDepthTexture();
      return { artCanvas: drawCover(art, 0), artImage: art };
    },

    apply(next) {
      const blurChanged = next.blur !== settings.blur;
      settings = { ...settings, ...next };
      if (blurChanged) rebuildDepthTexture();
      const depthIn = (settings.strength / 100) * MAX_DEPTH_IN;
      uniforms.uDepthUV.value.set(depthIn / CARD_W, depthIn / CARD_H);
      uniforms.uPivot.value = clamp(settings.pivot / 100, 0, 1);
      uniforms.uRelief.value = clamp(settings.relief / 100, 0, 1);
      uniforms.uShade.value = clamp(settings.shade / 100, 0, 1) * 0.5;
      uniforms.uSteps.value = clamp(Math.round(settings.steps), 4, 64);
    },

    /* The camera moves relative to the card every frame the card turns, so
       the tangent-space view vector is re-derived per frame. Doing it from
       the mesh's own onBeforeRender keeps it correct no matter what moved —
       drag, flip, auto-sway, resize, zoom, or a React camera. */
    trackCamera(artMesh, camera) {
      const camObj = camera.position.clone();
      artMesh.worldToLocal(camObj);
      uniforms.uCamObj.value.copy(camObj);
      lastCamObj.copy(camObj);
    },

    /* Returns the pivot (0-100) for the point at these artwork UVs. */
    pivotAtUV(u, v) {
      if (!depthSampler) return null;
      return clamp(Math.round(marchDepthAt(u, v) * 100), 0, 100);
    },

    makeArtTexture(canvas) { return makeTexture(canvas, false); },

    dispose() {
      if (uniforms.uDepthMap.value) uniforms.uDepthMap.value.dispose();
      uniforms.uDepthMap.value = null;
      sourceDepth = null;
      depthSampler = null;
    },
  };
}

export { TEX_W, TEX_H, drawCover, makeTexture, MAX_DEPTH_IN };
