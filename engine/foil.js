/* ================= holo foil shader =================
   One control, six finishes. There used to be two: a "finish" that set the
   colour and a "sparkle type" that set the micro-texture, free to combine.
   They fought — Cosmos already has its own stars, so laying glitter specks
   over it just produced noise, and a dot screen under Gold argued with the
   brushed warmth it was trying to get. In real foil the micro-structure and
   the colour are not two choices: the structure IS what splits the light, so
   a finish is a grating or it is flakes, never both bolted together. Each
   finish below therefore owns its own structure, and there is nothing left
   to mis-pair.

   The rainbow's motion comes from the half-vector dotted against the
   surface's brush-grain tangent, which is why it travels as the card tilts
   instead of sitting still. */

import * as THREE from 'three';

const FOIL_VERT = `
varying vec2 vUv; varying vec3 vWorldPosition; varying vec3 vWorldNormal; varying vec3 vWorldTangent;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPosition = wp.xyz;
  vWorldNormal  = normalize(mat3(modelMatrix) * normal);
  vWorldTangent = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FOIL_FRAG = `
precision highp float;
varying vec2 vUv; varying vec3 vWorldPosition; varying vec3 vWorldNormal; varying vec3 vWorldTangent;
uniform float uStyle, uIntensity, uGlare, uScale;
uniform float uAngle, uDispersion, uBreakup, uSparkle, uEdge;
uniform vec3 uLightDirection;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

/* A plain cosine triad comes out pastel — every channel sits near 0.5 and
   the result reads as coloured milk rather than as split light. Pushing each
   channel through a smoothstep deepens the troughs and lifts the peaks,
   which is the difference between "rainbow" and "oil on water". */
vec3 spectrum(float t) {
  vec3 c = 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67)));
  return c * c * (3.0 - 2.0 * c);
}

vec3 spectral(float t) {
  return spectrum(0.5 + (t - 0.5) * max(uDispersion, 0.05));
}

/* vUv is normalised to the card, and the card is half again as wide as it is
   tall, so any pattern laid out straight in UV comes out stretched — dots
   become ovals, a 45-degree grating lands at 32 degrees. Everything below
   works in this aspect-corrected space. */
const float CARD_ASPECT = 1.586;

/* An anti-aliased linear grating. Once a groove is finer than the pixel it
   lands on, drawing it at all is a lie, so it fades to the pattern's own
   mean (cos-squared averages 0.375) rather than to flat. That fade is what
   stops fine gratings crawling and moireing as the card turns. */
float grating(vec2 pos, vec2 dir, float freq, float phase, out float legible) {
  float f = dot(pos, dir) * freq + phase;
  legible = 1.0 - smoothstep(0.30, 0.85, fwidth(f));
  float g = 0.5 + 0.5 * cos(f * 6.2831853);
  return mix(0.375, g * g, legible);
}

/* Scattered round flakes, each sitting at its own angle and flashing only
   while the half-vector lines up with it — so neighbours are never lit at
   the same moment, which is the whole difference between glitter and a
   checkerboard. The 3x3 sweep lets a flake overlap its cell border instead
   of being clipped square. The hue out-param is the winning flake's own
   colour, so they don't all agree. */
float flakes(vec2 pos, float density, float sweep, out float hue) {
  vec2 g = pos * density;
  vec2 cell = floor(g), gf = fract(g);
  float lit = 0.0;
  hue = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 id = cell + o;
      float hx = hash(id), hy = hash(id + 41.7), hk = hash(id + 93.1);
      float d = length(gf - (o + vec2(hx, hy)));
      float r = 0.16 + 0.20 * hk;
      float blob = 1.0 - smoothstep(r * 0.35, r, d);
      float phase = fract(sweep + hk * 1.7);
      float flash = pow(max(1.0 - abs(phase - 0.5) * 2.0, 0.0), 5.0);
      float v = blob * (0.12 + flash * 2.4);
      if (v > lit) { lit = v; hue = hk; }
    }
  }
  return lit;
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPosition);
  vec3 L = normalize(uLightDirection);
  vec3 H = normalize(V + L);
  float NdotV = max(dot(N, V), 0.0), NdotL = max(dot(N, L), 0.0), NdotH = max(dot(N, H), 0.0);
  float specular = pow(NdotH, 46.0) * NdotL;
  float broad    = pow(NdotH, 8.0) * NdotL;
  float fresnel  = pow(1.0 - NdotV, 5.0);
  float diffraction = dot(H, normalize(vWorldTangent)) * 1.65;
  float reflection  = dot(reflect(-L, N), V);

  vec2 p = (vUv - 0.5) / max(uScale, 0.2);
  float ca = cos(uAngle), sa = sin(uAngle);
  p = mat2(ca, -sa, sa, ca) * p + 0.5;
  vec2 q = p * vec2(CARD_ASPECT, 1.0);

  float strength = 0.24;
  vec3 color = vec3(0.86);
  float legible, hue;

  if (uStyle < 0.5) {
    /* CLASSIC HOLO — a fine grating under a broad spectrum sweep. The one
       that already worked; left alone apart from the shared AA. */
    float g = grating(q, normalize(vec2(0.92, 0.39)), 190.0, diffraction * 5.0, legible);
    color = spectral(p.x * 0.28 + p.y * 1.9 + diffraction + (g - 0.375) * 0.22);
    strength = 0.55 * (0.72 + g * 0.75);

  } else if (uStyle < 1.5) {
    /* COSMOS — was a flat blue field with square blocks for stars, because
       the stars were step() on a grid hash. Now: a dark nebula that barely
       registers through the additive blend, with real flakes twinkling over
       it. The darkness is the point — it's what makes the stars read as
       points of light rather than as texture. */
    float stars = flakes(q, 78.0, diffraction * 0.26, hue) * uSparkle;
    /* The base has to carry actual colour. Additive blending cannot darken
       anything, so a dark navy field adds nothing at all and what you get is
       plain silver glitter on bare metal. Tinting the nebula hard toward
       blue-violet is what makes it read as space rather than as a generic
       rainbow with specks on it. */
    vec3 nebula = spectral(q.x * 0.24 - q.y * 0.34 + diffraction * 0.7);
    color = mix(vec3(0.16, 0.10, 0.52), nebula * vec3(0.55, 0.48, 1.0), 0.55)
          + spectral(hue) * stars * 1.1;
    strength = 0.52 + stars * 0.8;

  } else if (uStyle < 2.5) {
    /* RADIANT — was two sines crossed into a hard plaid, which is a
       crosshatch, not a radiance. Rays actually radiate: struck around a
       centre with the spectrum travelling outward along them. */
    vec2 c = q - vec2(CARD_ASPECT * 0.5, 0.5);
    float ang = atan(c.y, c.x);
    float rad = length(c);
    /* fwidth on the angle explodes at the centre, which correctly fades the
       rays to smooth there instead of tearing into a pinwheel of aliasing */
    float f = ang * 44.0 + diffraction * 3.0;
    float lg = 1.0 - smoothstep(0.30, 0.85, fwidth(f));
    float rays = mix(0.5, 0.5 + 0.5 * cos(f), lg);
    color = spectral(rad * 1.5 - diffraction * 0.85 + rays * 0.12);
    strength = 0.5 + rays * 0.32;

  } else if (uStyle < 3.5) {
    /* RAINBOW — was mixed 68% toward white, which is why it came out as
       pastel wash rather than as a rainbow. Full saturation now, broad clean
       bands, and only the faintest grating so the surface has some tooth
       without turning into a pattern. */
    float g = grating(q, normalize(vec2(0.25, 1.0)), 128.0, diffraction * 4.0, legible);
    color = spectral(q.x * 0.55 + q.y * 0.42 + diffraction * 1.1);
    color = mix(color, vec3(1.0), 0.08);
    strength = 0.78 * (0.84 + g * 0.42);

  } else if (uStyle < 4.5) {
    /* ULTRA — was two opposing sines beating against each other into noise.
       The premium trading-card look is lenticular: the same spectrum
       repeating several times across the card, banded tight and sweeping
       hard, over a dot screen. Dense and deliberate rather than busy. */
    vec2 cells = abs(fract(q * 54.0) - 0.5);
    float dots = 1.0 - smoothstep(0.05, 0.13, length(cells));
    color = spectral((q.x * 0.9 + q.y * 0.55) * 2.6 + diffraction * 1.4);
    strength = 0.6 * (0.78 + dots * 0.62);

  } else {
    /* GOLD — was a dark brown mixed against yellow on a 34-cycle sine, so it
       striped. Gold is a warm metal, not a pattern: a tight brushed grating
       carries it, and the only colour that isn't gold is the whisper of
       spectrum that shows up where the light glances off at an angle. */
    float g = grating(q, normalize(vec2(0.96, 0.28)), 150.0, diffraction * 3.0, legible);
    vec3 warm = mix(vec3(0.42, 0.24, 0.05), vec3(1.0, 0.82, 0.38),
                    clamp(0.34 + g * 0.9 + fresnel * 0.3, 0.0, 1.0));
    color = mix(warm, spectral(diffraction * 0.6 + q.y * 0.3), fresnel * 0.32);
    strength = 0.76;
  }

  float breakup = mix(1.0, 0.82 + 0.18 * hash(floor(q * 18.0)), uBreakup);
  color *= breakup;
  float illumination = 0.16 + NdotL * 0.24 + broad * 0.32;
  float glare = (specular * 1.2 + fresnel * (0.2 + 0.3 * uEdge) + max(reflection, 0.0) * 0.18) * uGlare;
  float alpha = uIntensity * strength * (illumination + glare);
  gl_FragColor = vec4(color + vec3(glare * 0.44), clamp(alpha, 0.0, 0.88));
}`;

/* A fresh material + uniform set per card. These used to be module-level
   singletons, which is fine for exactly one card on one page and wrong the
   moment a React page mounts several — they would have shared one uStyle and
   fought over it. */
export function createFoil() {
  const uniforms = {
    uStyle:     { value: 0 },
    uIntensity: { value: 0.55 },
    uGlare:     { value: 0.45 },
    uScale:     { value: 1 },
    uAngle:     { value: 0 },
    uDispersion: { value: 1 },
    uBreakup:   { value: 0.18 },
    uSparkle:   { value: 1 },
    uEdge:      { value: 1 },
    uLightDirection: { value: new THREE.Vector3(-4, 5, 7).normalize() },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: FOIL_VERT, fragmentShader: FOIL_FRAG, uniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    toneMapped: false, side: THREE.FrontSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  return { material, uniforms };
}
