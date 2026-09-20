/* ================= engine constants =================
   Dimensions and tiny helpers, shared by every consumer of the engine. No
   THREE import, no DOM — this file is safe to pull into anything. */

/* Straight off a real ID-1 card, in inches, so thickness lives in the same
   units: 1 inch = 25.4mm. A real card is ~0.8mm. */
export const CARD_W = 3.37;
export const CARD_H = 2.125;
export const MM_PER_IN = 25.4;
export const CARD_ASPECT = CARD_W / CARD_H;

/* The shared chip is 20% smaller than the previous 0.1497 width. Its left
   edge remains anchored by chipX, so only the footprint changes. */
/* Upper-left placement: inset from the left edge and positioned beneath the
   shared logo/mark, matching the reference card composition. */
export const CHIP = { left: 0.10, top: 0.31, width: 0.11976, aspect: 140 / 120 };

export const DIR_LABEL = ['along', 'across', 'diagonal'];
export const DIR_RAD = [0, Math.PI / 2, Math.PI / 4];

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* Card thickness is the one dimension the user can change, so it is derived
   per card rather than being a module constant the way W and H are. */
export const thicknessToDepth = (mm) => mm / MM_PER_IN;
