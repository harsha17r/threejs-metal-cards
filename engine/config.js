/* ================= the card config =================
   One plain JSON object that fully describes a card: every material value,
   the whole light rig, the engraving, the foil, and the artwork with its
   image bytes embedded. Round-trips through the clipboard and through
   localStorage, and is the single prop the React component takes.

   Everything here is JSON-safe on purpose. No THREE objects, no canvases, no
   Blob URLs — an object URL would be dead the moment the page that made it
   closed, which is exactly the "don't lose my artwork" failure we're avoiding.
   Images live as base64 data URIs so a config is self-contained: paste it
   anywhere, months later, and the card still has its picture. */

export const CONFIG_VERSION = 1;

/* The eight studio panels. `form` is 'rect' or 'ring'; x/y/z are in card
   units with +z toward the viewer. */
export const DEFAULT_RIG = [
  { name:'Front fill',   form:'rect', on:true, intensity:0.02, x:0,     y:0,    z:6,   w:12,   h:9,   rot:0,      color:'#c8c8c6' },
  { name:'Left key',     form:'rect', on:true, intensity:2.5,  x:-3.15, y:0.4,  z:4,   w:1.45, h:7,   rot:27.5,   color:'#eeeeec' },
  { name:'Right key',    form:'rect', on:true, intensity:4.6,  x:2.2,   y:0,    z:4,   w:2.5,  h:7,   rot:-19.5,  color:'#ffffff' },
  { name:'Hot strip',    form:'rect', on:true, intensity:5.0,  x:1.35,  y:0.2,  z:5,   w:0.24, h:6.2, rot:-13.7,  color:'#ffffff' },
  { name:'Black panel',  form:'rect', on:true, intensity:1.0,  x:-0.3,  y:0,    z:4.4, w:1.05, h:6.8, rot:0,      color:'#000000' },
  { name:'Backdrop',     form:'rect', on:true, intensity:0.08, x:0,     y:0,    z:-4,  w:9,    h:7,   rot:180,    color:'#080808' },
  { name:'Overhead ring',form:'ring', on:true, intensity:0.75, x:0,     y:4,    z:-4,  w:5,    h:5,   rot:0,      color:'#d2d2d0' },
  { name:'Floor bounce', form:'rect', on:true, intensity:1.2,  x:-2.6,  y:-3.8, z:2.5, w:4.5,  h:0.4, rot:20,     color:'#e4e4e2' },
];

export const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  name: 'Untitled card',

  /* mode is the switch the whole artwork pipeline turns on:
       'none'  — bare metal, no artwork layer at all
       'flat'  — a single image, pasted on
       'depth' — image + grayscale depth map, marched for real parallax
     The depth.* values are only read in 'depth' mode but are always carried,
     so flipping a saved card from flat to depth doesn't lose its tuning. */
  artwork: {
    mode: 'none',
    image: null,        // data URI or URL
    depthMap: null,     // data URI or URL, grayscale, white = near
    treat: 'inlay',     // 'inlay' (metal-aware) | 'print' (flat)
    opacity: 100,
    depth: { strength: 26, pivot: 52, relief: 30, shade: 25, steps: 48, blur: 40 },
  },

  surface: {
    thickness: 0.8, corner: 17, edge: 50,
    color: '#bcbcb9', polish: 27, env: 155,
    aniso: 68, dir: 1, grain: 100, relief: 70, coat: 3, irid: 0,
  },

  /* The plate fields split by cost, which is why they are grouped this way in
     the panel too: stroke/plating/grain/blotch are baked into the contact
     texture and redrawing it is not free, while relief/contrast/rough are
     material writes that apply on the same frame. */
  chip: {
    show: true, etch: true, height: 8, bevel: 0, seat: 0,
    /* corner is the block's own radius, independent of the card's. gap is the
       reveal around it — the module is a separate part, and 0-10 here is a
       sub-pixel hairline, not a visible margin. */
    corner: 54, gap: 2.9,
    /* The plate's own metal. Applied as the material's base colour so it
       stays properly metallic — a gold plate reflects the room in gold rather
       than being a grey reflection with yellow painted over it. */
    color: '#c6c8c5',
    /* The contact lines are a flat stroke — colour and thickness, no depth. */
    strokeWidth: 0, strokeColor: '#2b2926', stampRound: 0,
    plating: 33, platingAngle: 90, scratch: 0, scratchAngle: 0,
    grain: 0, micro: 32, padVar: 16, edgeWear: 15,
    contrast: 45, rough: 100,
  },

  engraving: { depth: 0, soft: 0, matte: 0, dark: 0, name: 'HARSHA GOWDA' },

  foil: {
    style: -1, intensity: 55, glare: 45, scale: 100,
    angle: 0, dispersion: 100, breakup: 18, sparkle: 100, edge: 100,
  },

  camera: { exposure: 70, zoom: 64, background: 'dark' },

  /* Resting angle, in degrees. Saved so a card reopens looking the way it
     looked when you copied it. */
  view: { rotX: -8, rotY: 22 },

  lights: DEFAULT_RIG,
};

/* Deep clone via JSON — safe precisely because the config is JSON-only, and
   it doubles as an assertion that nothing non-serialisable crept in. */
export function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function mergeSection(base, incoming) {
  if (!incoming || typeof incoming !== 'object') return { ...base };
  const out = { ...base };
  for (const key of Object.keys(base)) {
    if (incoming[key] === undefined) continue;
    out[key] = (base[key] && typeof base[key] === 'object' && !Array.isArray(base[key]))
      ? mergeSection(base[key], incoming[key])
      : incoming[key];
  }
  return out;
}

/* Fills in anything a pasted config is missing rather than throwing. A config
   saved before a control existed should still open — it just picks up that
   control's default. Unknown keys are dropped, so a hand-edited config can't
   smuggle junk into the renderer. */
export function normalizeConfig(input) {
  const raw = (input && typeof input === 'object') ? input : {};
  const out = mergeSection(DEFAULT_CONFIG, raw);
  out.version = CONFIG_VERSION;
  out.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : DEFAULT_CONFIG.name;

  const lights = Array.isArray(raw.lights) && raw.lights.length ? raw.lights : DEFAULT_RIG;
  out.lights = lights.map((l, i) => mergeSection(DEFAULT_RIG[i % DEFAULT_RIG.length], l));

  /* A config claiming 'depth' without both halves would march against a
     missing texture, so it degrades to whatever it actually has. */
  if (out.artwork.mode === 'depth' && !(out.artwork.image && out.artwork.depthMap)) {
    out.artwork.mode = out.artwork.image ? 'flat' : 'none';
  }
  if (out.artwork.mode === 'flat' && !out.artwork.image) out.artwork.mode = 'none';

  return out;
}

export function serializeConfig(config, { pretty = true } = {}) {
  return JSON.stringify(normalizeConfig(config), null, pretty ? 2 : 0);
}

/* Returns { ok, config, error } rather than throwing — every caller is a
   paste box that wants to show the problem, not a stack trace. */
export function parseConfig(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'Nothing pasted.' };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `That isn't valid JSON — ${err.message}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Expected a card config object.' };
  }
  const looksLikeCard = raw.surface || raw.artwork || raw.foil || raw.lights;
  if (!looksLikeCard) {
    return { ok: false, error: 'That JSON parsed, but it has no card fields in it.' };
  }
  return { ok: true, config: normalizeConfig(raw) };
}

/* Rough byte weight of the embedded artwork, for the UI to warn with before
   someone commits a 12MB component to a repo. */
export function artworkBytes(config) {
  const of = (uri) => (typeof uri === 'string' && uri.startsWith('data:'))
    ? Math.floor((uri.length - uri.indexOf(',') - 1) * 0.75)
    : 0;
  return of(config?.artwork?.image) + of(config?.artwork?.depthMap);
}
