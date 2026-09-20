/* ================= the house style =================
   Some things about a card belong to the card, and some belong to the whole
   set. The artwork is obviously the card's. The physical form — how thick it
   is, how round the corners are, how the chip sits, how deep the engraving
   cuts — is the same object every time, so carrying a private copy of it in
   every config meant a card saved last week kept last week's corner radius
   forever and nothing could change its mind.

   This is that shared subset, stored once and overlaid onto every config at
   render time. Change it in either playground and every card follows: the
   flat page, the depth page, and everything in the library.

   Deliberately NOT here: metal finish, light rig, foil, camera, resting
   angle, the cardholder's name, and everything about the artwork. Those
   stayed per-card so one card can be a dark mirror shot in a different room
   from the next, which is the whole reason for having more than one. */

import { DEFAULT_CONFIG } from './config.js';

/* Which leaf fields of a config the style owns, by section. Anything not
   listed is the card's own business. The one that looks odd is engraving:
   the treatment is shared but `name` is not, because a name belongs to a
   person rather than to the card design. */
export const HOUSE_STYLE_FIELDS = {
  surface: ['thickness', 'corner', 'edge'],
  chip: ['show', 'etch', 'height', 'bevel', 'seat', 'corner', 'gap', 'color',
         'strokeWidth', 'strokeColor', 'stampRound',
         'plating', 'platingAngle', 'scratch', 'scratchAngle',
         'grain', 'micro', 'padVar', 'edgeWear', 'contrast', 'rough'],
  engraving: ['depth', 'soft', 'matte', 'dark'],
};

/* What each field is allowed to be. The style is a file on disk that both
   halves of the project read on every load, so a single bad write would
   otherwise propagate to every card and stay there — and because the style
   is also what gets SAVED back, a wrong value re-writes itself and sticks.
   A number outside its slider's range, a NaN, or a null is not a preference,
   it is damage; those fall back to the default rather than being honoured.

   Ranges match the sliders in the panel. 0 is legitimate for most of these,
   so this checks the type and the bounds and nothing cleverer. */
const FIELD_RULES = {
  surface: { thickness: [0.4, 2.4], corner: [4, 32], edge: [0, 100] },
  chip: {
    show: 'boolean', etch: 'boolean',
    height: [0, 100], bevel: [0, 100], seat: [0, 100],
    corner: [0, 100], gap: [0, 10],
    color: 'color',
    strokeWidth: [0, 100], strokeColor: 'color', stampRound: [0, 100],
    plating: [0, 100], platingAngle: [0, 360], scratch: [0, 100], scratchAngle: [0, 360],
    grain: [0, 100], micro: [0, 100], padVar: [0, 100], edgeWear: [0, 100],
    contrast: [0, 100], rough: [0, 100],
  },
  engraving: { depth: [0, 100], soft: [0, 100], matte: [0, 100], dark: [0, 100] },
};

function valid(section, key, value) {
  const rule = FIELD_RULES[section]?.[key];
  if (rule === 'boolean') return typeof value === 'boolean';
  /* A colour has to survive the round trip into a file and back, so only the
     hex form the pickers emit is accepted. */
  if (rule === 'color') return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  if (Array.isArray(rule)) {
    return typeof value === 'number' && Number.isFinite(value)
      && value >= rule[0] && value <= rule[1];
  }
  return false;
}

export const HOUSE_STYLE_VERSION = 1;

function pick(source, section) {
  const out = {};
  for (const key of HOUSE_STYLE_FIELDS[section]) {
    const value = source?.[key];
    if (value !== undefined && valid(section, key, value)) out[key] = value;
  }
  return out;
}

export const DEFAULT_HOUSE_STYLE = {
  version: HOUSE_STYLE_VERSION,
  surface: pick(DEFAULT_CONFIG.surface, 'surface'),
  chip: pick(DEFAULT_CONFIG.chip, 'chip'),
  engraving: pick(DEFAULT_CONFIG.engraving, 'engraving'),
};

/* Reads the shared fields out of a full config — how the playground turns
   "what I'm looking at" into "the style everything should follow". */
export function extractHouseStyle(config) {
  return {
    version: HOUSE_STYLE_VERSION,
    surface: pick(config?.surface, 'surface'),
    chip: pick(config?.chip, 'chip'),
    engraving: pick(config?.engraving, 'engraving'),
  };
}

/* Overlays a style onto a config, returning a new one. The card keeps every
   field the style does not claim, so a saved card's artwork, name, foil and
   lighting all survive untouched.

   A missing or malformed style is not an error: the card simply keeps its own
   values. The style is a convenience, and a card that cannot render because a
   JSON file failed to load would be a bad trade. */
export function applyHouseStyle(config, style) {
  if (!style || typeof style !== 'object') return config;
  const out = { ...config };
  for (const section of Object.keys(HOUSE_STYLE_FIELDS)) {
    if (!style[section]) continue;
    out[section] = { ...config[section] };
    for (const key of HOUSE_STYLE_FIELDS[section]) {
      if (style[section][key] !== undefined) out[section][key] = style[section][key];
    }
  }
  return out;
}

/* Fills in anything a stored style is missing and drops anything it should
   not contain, so a hand-edited file cannot smuggle an artwork override in
   through the house style. */
export function normalizeHouseStyle(input) {
  const raw = (input && typeof input === 'object') ? input : {};
  return {
    version: HOUSE_STYLE_VERSION,
    surface: { ...DEFAULT_HOUSE_STYLE.surface, ...pick(raw.surface, 'surface') },
    chip: { ...DEFAULT_HOUSE_STYLE.chip, ...pick(raw.chip, 'chip') },
    engraving: { ...DEFAULT_HOUSE_STYLE.engraving, ...pick(raw.engraving, 'engraving') },
  };
}

export function houseStyleEquals(a, b) {
  return JSON.stringify(normalizeHouseStyle(a)) === JSON.stringify(normalizeHouseStyle(b));
}

/* Both halves of the project read the style from the static server, because
   the playground (:8932) and the library (:8934) are different origins and so
   cannot share localStorage. A file on disk is the only thing they both see —
   and it has the side benefit of putting the house style in version control,
   where a shared design decision arguably belongs anyway. */
export const HOUSE_STYLE_URL = 'http://localhost:8932/shared/house-style.json';

/* The committed seed. The live file above is yours and is gitignored, because
   it is rewritten every time a shared dial moves — tracking a file that the
   app edits constantly meant every test run dirtied the repo, and a set of
   stray values got committed that way once. A fresh clone has only this one,
   and picks it up until the first save creates the live file. */
export const HOUSE_STYLE_DEFAULT_URL = 'http://localhost:8932/shared/house-style.default.json';

async function readStyle(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  return normalizeHouseStyle(await res.json());
}

export async function fetchHouseStyle(url = HOUSE_STYLE_URL) {
  try {
    return (await readStyle(url))
        ?? (await readStyle(HOUSE_STYLE_DEFAULT_URL))
        ?? DEFAULT_HOUSE_STYLE;
  } catch {
    /* Server down, both files missing, first ever run — same answer. */
    return DEFAULT_HOUSE_STYLE;
  }
}

export async function saveHouseStyle(style, url = HOUSE_STYLE_URL) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizeHouseStyle(style), null, 2),
  });
  if (!res.ok) throw new Error(`Could not save the house style (${res.status})`);
  return true;
}
