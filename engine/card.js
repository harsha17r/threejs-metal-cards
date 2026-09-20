/* ================= the card itself =================
   createCard(config) builds one complete card as a THREE.Group and hands back
   update() / dispose(). Everything the old scene.js did at module scope now
   happens per call, which is what lets more than one card exist at a time —
   the playground is simply the first consumer, React is the second.

   The layer stack, a few thousandths of a card-width apart: body slab, front
   and back caps, artwork, foil, chip seating shadow, chip pad, chip etch,
   logo mark, name plate. They are separate meshes, never one flat picture,
   because each needs its own material response to the room.

   update(next) diffs against the config it is already showing and rebuilds
   only what actually changed. That matters: regenerating the brushed-grain
   textures or re-extruding the body on every slider tick would drop frames,
   and the playground drags sliders continuously. */

import * as THREE from 'three';
import {
  CARD_W, CARD_H, DIR_RAD, clamp, thicknessToDepth,
} from './constants.js';
import {
  makeBodyGeo, makeFaceGeo, makeChipGeo, makeChipFaceGeo, makeChipPocketGeo,
  chipCornerRadius, chipGapSize,
  chipW, chipH, chipX, chipY,
} from './geometry.js';
import {
  makeBrushed, makeRelief, makeEngraveShading,
  labelTexture, markTexture, visaTexture, contactlessTexture, seatShadowTexture,
} from './textures.js';
import { buildChipPlate } from './chipPlate.js';
import { createFoil } from './foil.js';
import { createDepthParallax, loadImage, drawCover, makeTexture } from './depth.js';
import { DEFAULT_CONFIG, normalizeConfig, cloneConfig } from './config.js';

/* Which config fields force which rebuild. Anything not listed is a cheap
   material write applied every update. */
const changed = (a, b, keys) => keys.some(k => a[k] !== b[k]);

export function createCard(inputConfig = DEFAULT_CONFIG) {
  let config = normalizeConfig(inputConfig);

  const group = new THREE.Group();
  group.userData.isMetalCard = true;

  /* ---- materials ---- */
  const bodyMat  = new THREE.MeshPhysicalMaterial({ side: THREE.FrontSide });
  const frontMat = new THREE.MeshPhysicalMaterial({ side: THREE.FrontSide });
  const backMat  = new THREE.MeshPhysicalMaterial({ side: THREE.FrontSide });

  const chipMat = new THREE.MeshPhysicalMaterial({ metalness:1, side:THREE.FrontSide });

  /* The plate's character lives in its roughness and normal maps rather than
     in a picture of a chip. The colour map is near-white and only carries the
     channels, so the material's base colour decides the metal and the plate
     stays properly metallic.

     Note what is NOT here any more: the luminance-flattening shader this
     material used to carry. It existed to neutralise a photographic plate,
     and it worked by forcing diffuseColor to greyscale — which would throw
     away any plate colour the moment one could be chosen. */
  let plate = buildChipPlate(config.chip);
  const chipEtchMat = new THREE.MeshPhysicalMaterial({
    map: plate.colorMap,
    roughnessMap: plate.roughnessMap,
    normalMap: plate.normalMap,
    metalness: 1,
    transparent: true, opacity: 0.62, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    side: THREE.FrontSide,
  });

  const labelMat = new THREE.MeshPhysicalMaterial({
    color:'#5e5e5e', transparent:true, alphaTest:0.08, depthWrite:false, metalness:1,
    polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2, side:THREE.FrontSide });
  const markMat = labelMat.clone();
  const visaMat = labelMat.clone();

  const seatTex = seatShadowTexture();
  const seatMat = new THREE.MeshBasicMaterial({
    map: seatTex, transparent:true, depthWrite:false, toneMapped:false,
    opacity:0.55, color:'#000000', side:THREE.FrontSide,
    polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3 });

  /* The slot floor showing through the reveal. Not black: the gap is a
     shadowed sliver of the same card, and at well under a pixel wide a true
     black reads as a drawn outline around the chip rather than as a space
     behind it. Unlit on purpose too — a line this thin picking up the moving
     key light would shimmer as the card turns. */
  const pocketMat = new THREE.MeshBasicMaterial({
    /* Keep the reveal dark enough to separate the module, but not black
       enough to read as a printed outline. A softer, neutral pocket lets the
       artwork's colour bleed naturally into the hairline around the chip. */
    color:'#242824', transparent:true, opacity:0.48, depthWrite:false,
    toneMapped:false, side:THREE.FrontSide,
    polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 });

  /* Artwork gets two materials: "milled in" (metal-aware) and "printed"
     (flat). Both exist always; which one is on the mesh is a config switch.

     Both carry a polygon offset, like every other layer stacked on the card
     face (foil, chip, label, seat, pocket) — all of them except this one. The
     artwork sits only 0.00015" in front of frontFace, a real gap but a thin
     one, and depth-buffer precision is worst exactly where the card is
     turned furthest from the camera. Without the offset the GPU's per-pixel
     depth test starts flip-flopping between the two coplanar-ish surfaces at
     a grazing angle, which reads as the picture glitching and the bare metal
     face flickering through it. depth mode makes the flicker obvious because
     the two surfaces it's choosing between look nothing alike — flat mode has
     the same race, it's just less visible when both sides show similar
     colour. */
  const artInlayMat = new THREE.MeshPhysicalMaterial({
    transparent:true, alphaTest:0.01, depthWrite:false, side:THREE.FrontSide, metalness:0.56,
    polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 });
  const artPrintMat = new THREE.MeshBasicMaterial({
    transparent:true, depthWrite:false, toneMapped:false, side:THREE.FrontSide,
    polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 });

  const foil = createFoil();
  const depthFx = createDepthParallax({ inlayMaterial: artInlayMat, printMaterial: artPrintMat });

  let brushed = makeBrushed(512, config.surface.grain, config.surface.relief);

  /* ---- meshes ---- */
  let cardD = thicknessToDepth(config.surface.thickness);
  let faceGeo = makeFaceGeo(config.surface.corner / 100);

  const bodyMesh = new THREE.Mesh(makeBodyGeo(cardD, config.surface.corner / 100, config.surface.edge), bodyMat);
  group.add(bodyMesh);

  const frontFace = new THREE.Mesh(faceGeo, frontMat);
  frontFace.renderOrder = 5; group.add(frontFace);

  const backFace = new THREE.Mesh(faceGeo, backMat);
  backFace.rotation.y = Math.PI; backFace.renderOrder = 5; group.add(backFace);

  const artMesh = new THREE.Mesh(faceGeo, artInlayMat);
  artMesh.renderOrder = 8; group.add(artMesh);

  const foilMesh = new THREE.Mesh(faceGeo, foil.material);
  foilMesh.renderOrder = 9; group.add(foilMesh);

  const chipSeat = new THREE.Mesh(new THREE.PlaneGeometry(chipW * 1.34, chipH * 1.34), seatMat);
  chipSeat.renderOrder = 9; group.add(chipSeat);

  const chipPocket = new THREE.Mesh(
    makeChipPocketGeo(chipCornerRadius(config.chip.corner)), pocketMat);
  chipPocket.renderOrder = 10; group.add(chipPocket);

  const chipPad = new THREE.Mesh(makeChipGeo(0.012, config.chip.bevel), chipMat);
  chipPad.renderOrder = 11; group.add(chipPad);

  const chipEtch = new THREE.Mesh(makeChipFaceGeo(chipPad.geometry.userData.topInset), chipEtchMat);
  chipEtch.renderOrder = 12; group.add(chipEtch);

  const markSrc = markTexture();
  /* The flat white glyph is only the source the engraving is derived from;
     engraveOne() builds the map that actually renders. */
  markSrc.texture.dispose();
  const markGeo = new THREE.PlaneGeometry(0.28, 0.28);
  const mark = new THREE.Mesh(markGeo, markMat);
  mark.position.set(-CARD_W/2 + 0.34, CARD_H/2 - 0.32, 0);
  mark.renderOrder = 13; group.add(mark);

  const visaSrc = visaTexture();
  visaSrc.texture.dispose();
  const visaW = 0.6264, visaH = 0.1944;
  const visa = new THREE.Mesh(new THREE.PlaneGeometry(visaW, visaH), visaMat);
  const nameBottom = -CARD_H/2 + 0.26 - 0.19/2;
  visa.position.set(CARD_W/2 - 0.26 - visaW/2, nameBottom + visaH/2, 0);
  visa.renderOrder = 13; group.add(visa);

  const contactlessSrc = contactlessTexture();
  const contactlessMat = new THREE.MeshPhysicalMaterial({
    map: contactlessSrc.texture, color: '#ffffff', metalness: 0.72,
    roughness: 0.18, clearcoat: 0.42, clearcoatRoughness: 0.2,
    transparent: true, alphaTest: 0.12, depthWrite: false,
    side: THREE.FrontSide,
  });
  const contactlessW = 0.2052;
  const contactless = new THREE.Mesh(
    new THREE.PlaneGeometry(contactlessW, contactlessW), contactlessMat);
  contactless.rotation.z = -Math.PI / 2;
  contactless.position.set(CARD_W/2 - 0.22 - contactlessW/2, chipY, 0);
  contactless.renderOrder = 13; group.add(contactless);

  let namePlate = null;
  let nameCanvas = null;

  /* The camera has to reach the depth march every frame the card turns.
     Hanging it off the artwork mesh's own onBeforeRender means it fires from
     whatever render loop is driving — vanilla rAF or R3F's — with no wiring. */
  artMesh.onBeforeRender = (renderer, scene, camera) => {
    if (config.artwork.mode === 'depth') depthFx.trackCamera(artMesh, camera);
  };

  /* ---------------------------------------------------------------- pieces */

  /* Everything baked into the three maps comes through here. Building them is
     a full pass over a 640x548 buffer plus several blurs, far too slow for
     every frame of a slider drag — so these settle first, while plate colour,
     contrast and overall roughness stay material writes that land immediately. */
  function rebuildChipFace() {
    plate.colorMap.dispose();
    plate.roughnessMap.dispose();
    plate.normalMap.dispose();
    plate = buildChipPlate(config.chip);
    chipEtchMat.map = plate.colorMap;
    chipEtchMat.roughnessMap = plate.roughnessMap;
    chipEtchMat.normalMap = plate.normalMap;
    chipEtchMat.needsUpdate = true;
  }

  function layoutChip() {
    const base = cardD/2 + 0.0018;
    const height = 0.0016 + (config.chip.height/100) * 0.040;
    const cornerR = chipCornerRadius(config.chip.corner);
    const gap = chipGapSize(config.chip.gap);
    const geo = makeChipGeo(height, config.chip.bevel, cornerR, gap);
    chipPad.geometry.dispose();
    chipPad.geometry = geo;
    /* The bevel decides how far the flat top is inset, so the face carrying
       the contact pattern has to be recut whenever the chamfer moves — and now
       whenever the corner or the reveal moves too, since both change the
       outline the pattern has to stay inside. */
    chipEtch.geometry.dispose();
    chipEtch.geometry = makeChipFaceGeo(geo.userData.topInset, cornerR, gap);
    chipPocket.geometry.dispose();
    chipPocket.geometry = makeChipPocketGeo(cornerR);
    const total = geo.userData.total;
    chipPad.position.set(chipX, chipY, base + total/2);
    chipEtch.position.set(chipX, chipY, base + total + 0.0004);
    chipSeat.position.set(chipX, chipY, base + 0.0002);
    /* Between the card face and the top of the block, so the annulus reads as
       a space the module is sitting down inside rather than a ring painted
       around it. The pad covers everything but that annulus. */
    chipPocket.position.set(chipX, chipY, base + 0.0004);
  }

  /* Every layer above the body is pinned to the card's own thickness and
     corner shape, so changing thickness / corner / edge means re-deriving
     every dependent mesh, not just the slab. */
  function rebuildGeometry() {
    cardD = thicknessToDepth(config.surface.thickness);

    const oldBody = bodyMesh.geometry;
    bodyMesh.geometry = makeBodyGeo(cardD, config.surface.corner/100, config.surface.edge);
    oldBody.dispose();

    const oldFace = faceGeo;
    faceGeo = makeFaceGeo(config.surface.corner/100);
    frontFace.geometry = faceGeo;
    backFace.geometry = faceGeo;
    artMesh.geometry = faceGeo;
    foilMesh.geometry = faceGeo;
    oldFace.dispose();

    frontFace.position.z =  cardD/2 + 0.0015;
    backFace.position.z  = -cardD/2 - 0.0015;
    artMesh.position.z   =  cardD/2 + 0.00165;
    foilMesh.position.z  =  cardD/2 + 0.0024;
    mark.position.z      =  cardD/2 + 0.013;
    if (namePlate) namePlate.position.z = cardD/2 + 0.013;
    visa.position.z       =  cardD/2 + 0.013;
    contactless.position.z = cardD/2 + 0.013;

    layoutChip();
  }

  /* Two textures per engraved shape, doing different jobs. The normal map
     tilts the wall so it catches a different reflection as the card turns —
     that has to stay live. The shading map bakes what a normal map cannot
     express at all: that the floor of the cut sees less of the room than the
     surface around it. Without the second one the engraving is a shape drawn
     on the metal rather than taken out of it. */
  /* Where the room's light actually comes from, as a direction in the card's
     own plane. Derived from the rig rather than assumed, because assuming it
     got it backwards — the default rig's two brightest panels both sit on the
     +x side, so the card is lit from the RIGHT, and a shadow baked at the
     top-left fought the normal map instead of reinforcing it.

     Weighted by intensity and panel area, since a big dim wash contributes
     differently from a narrow hot strip. */
  function keyLightDirection() {
    let sx = 0, sy = 0, total = 0;
    for (const l of config.lights) {
      if (!l.on || l.intensity <= 0) continue;
      const weight = l.intensity * Math.max(0.05, Math.abs(l.w * l.h));
      sx += l.x * weight;
      sy += l.y * weight;
      total += weight;
    }
    if (!total) return { x: 1, y: 0 };
    const x = sx / total, y = sy / total;
    const len = Math.hypot(x, y);
    /* A perfectly balanced rig has no direction to speak of; fall back to the
       right rather than dividing by ~0 and getting noise. */
    return len < 0.05 ? { x: 1, y: 0 } : { x: x / len, y: y / len };
  }

  function engraveOne(material, sourceCanvas) {
    const { soft, depth } = config.engraving;

    if (material.normalMap) material.normalMap.dispose();
    material.normalMap = makeRelief(sourceCanvas, soft, depth);
    material.bumpMap = null;

    if (material.map) material.map.dispose();
    const shaded = new THREE.CanvasTexture(
      makeEngraveShading(sourceCanvas, soft, depth, keyLightDirection())
    );
    shaded.colorSpace = THREE.SRGBColorSpace;
    shaded.anisotropy = 8;
    material.map = shaded;

    material.needsUpdate = true;
  }

  function rebuildRelief() {
    engraveOne(markMat, markSrc.canvas);
    engraveOne(visaMat, visaSrc.canvas);
    if (nameCanvas) engraveOne(labelMat, nameCanvas);
  }

  function rebuildName() {
    if (namePlate) {
      group.remove(namePlate);
      namePlate.geometry.dispose();
      namePlate = null;
    }
    const text = (config.engraving.name || '').trim();
    if (!text) { nameCanvas = null; return; }
    const lab = labelTexture(config.engraving.name);
    /* Only the canvas is kept — the flat white glyph is the SOURCE for the
       engraving, not the thing that gets rendered. engraveOne() turns it into
       the shaded map. */
    lab.texture.dispose();
    nameCanvas = lab.canvas;
    const h = 0.19, w = h * lab.aspect;
    namePlate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), labelMat);
    namePlate.position.set(-CARD_W/2 + 0.24 + w/2, -CARD_H/2 + 0.26, cardD/2 + 0.013);
    namePlate.renderOrder = 13;
    group.add(namePlate);
  }

  function setArtTexture(tex) {
    if (artInlayMat.map && artInlayMat.map !== tex) artInlayMat.map.dispose();
    artInlayMat.map = tex;
    artPrintMat.map = tex;
    artInlayMat.needsUpdate = true;
    artPrintMat.needsUpdate = true;
  }

  /* Artwork loading is the one asynchronous part of the card. A token guards
     against an older load finishing after a newer one and stomping it — easy
     to hit when someone changes the image twice quickly. */
  let artToken = 0;
  let artReady = Promise.resolve();

  function loadArtwork() {
    const token = ++artToken;
    const { mode, image, depthMap } = config.artwork;

    if (mode === 'none' || !image) {
      setArtTexture(null);
      artMesh.visible = false;
      return Promise.resolve();
    }

    if (mode === 'depth' && depthMap) {
      artReady = depthFx.setSources(image, depthMap)
        .then(({ artCanvas }) => {
          if (token !== artToken) return;
          setArtTexture(depthFx.makeArtTexture(artCanvas));
          depthFx.apply(config.artwork.depth);
          artMesh.visible = config.artwork.opacity > 0;
        })
        .catch((err) => { if (token === artToken) console.warn('Card artwork failed to load.', err); });
      return artReady;
    }

    /* Flat mode: the same cover-crop so a flat and a depth card frame their
       artwork identically, and no mipmaps for the same LINEAR-only reason. */
    artReady = loadImage(image)
      .then((img) => {
        if (token !== artToken) return;
        setArtTexture(makeTexture(drawCover(img, 0), false));
        artMesh.visible = config.artwork.opacity > 0;
      })
      .catch((err) => { if (token === artToken) console.warn('Card artwork failed to load.', err); });
    return artReady;
  }

  /* ---- the cheap per-update material writes ---- */
  function applyMaterials() {
    const s = config.surface;
    const rough = clamp(s.polish/100, 0.02, 1);
    const envI  = s.env/100;
    const coat  = s.coat/100;
    const aniso = s.aniso/100;
    const rotA  = DIR_RAD[s.dir] ?? DIR_RAD[1];
    const irid  = s.irid/100 * 0.6;

    for (const [m, isBack] of [[bodyMat,false],[frontMat,false],[backMat,true]]) {
      m.color.set(s.color);
      m.metalness = 1;
      m.roughness = isBack ? Math.max(rough, 0.5) : rough;
      m.roughnessMap = brushed.roughness;
      m.normalMap = brushed.normal;
      m.normalScale.copy(brushed.normalScale);
      m.anisotropy = aniso;
      m.anisotropyRotation = rotA;
      m.envMapIntensity = isBack ? envI*0.6 : envI;
      m.clearcoat = isBack ? 0 : coat;
      m.clearcoatRoughness = 0.38;
      m.iridescence = irid;
      m.iridescenceIOR = 1.32;
      m.iridescenceThicknessRange = [260, 400];
      m.needsUpdate = true;
    }

    /* The plate can be polished brighter or scuffed duller than the card it
       sits on. 50 is the card's own finish, so the dial reads as a departure
       from the metal rather than an absolute. */
    const chipRough = clamp(config.chip.rough, 0, 100);
    chipMat.color.set(config.chip.color);
    chipMat.roughness = clamp(rough * 0.7 * (0.35 + (chipRough / 100) * 1.3), 0.02, 0.95);

    /* The plating was laid down in one direction, so the highlight should
       stretch along it. Strength follows how much brushing and abrasion is
       actually in the maps — a mirror-smooth plate has no grain to stretch. */
    const chipAniso = clamp((config.chip.plating * 0.6 + config.chip.scratch * 0.4) / 100, 0, 1);
    const chipAngle = THREE.MathUtils.degToRad(config.chip.scratchAngle);
    chipMat.anisotropy = chipAniso * 0.6;
    chipMat.anisotropyRotation = chipAngle;
    chipMat.envMapIntensity = envI*1.08;
    chipMat.clearcoat = clamp(0.28 + coat*0.35, 0.0, 0.65);
    chipMat.clearcoatRoughness = 0.28;
    chipMat.anisotropy = aniso;
    chipMat.anisotropyRotation = rotA;
    chipMat.iridescence = Math.max(0.18, irid);
    chipMat.iridescenceIOR = 1.34;
    chipMat.iridescenceThicknessRange = [270, 380];
    chipMat.needsUpdate = true;

    chipEtchMat.color.set(config.chip.color);
    /* roughnessMap multiplies this, and the map averages around 0.6 — so this
       is the plate's overall polish and the map supplies the variation. */
    chipEtchMat.roughness = clamp(0.15 + (chipRough / 100) * 0.70, 0.04, 1);
    chipEtchMat.envMapIntensity = chipMat.envMapIntensity;
    chipEtchMat.clearcoat = chipMat.clearcoat;
    chipEtchMat.anisotropy = chipAniso * 0.85;
    chipEtchMat.anisotropyRotation = chipAngle;
    /* How strongly the plate reads over the metal beneath it. */
    chipEtchMat.opacity = clamp(config.chip.contrast, 0, 100) / 100;
    chipEtchMat.needsUpdate = true;

    /* Engraved metal goes duller and darker than the polished face beside it
       — that contrast does more work than the geometry ever could. */
    const e = config.engraving;
    const matte = e.matte/100;
    const dark  = e.dark/100;
    /* Lower than it was, because flattening the floor concentrated the whole
       slope into a narrow band and so made the walls much steeper — the old
       multiplier on top of that was most of the puffiness. */
    const nScale = 0.28 + (Math.abs(e.depth)/100) * 0.55;
    for (const m of [labelMat, markMat, visaMat]) {
      m.roughness = clamp(rough*0.7 + matte*0.55, 0.04, 0.95);
      m.envMapIntensity = envI * (1.08 - matte*0.45);
      m.clearcoat = 0.35 * (1 - matte*0.7);
      m.clearcoatRoughness = 0.28;
      m.color.set(s.color);
      /* Gentler than it was, because the shading map now carries the depth
         cue. This is only the overall tint of the cut metal — pile flat
         darkening on top of a baked floor and the letters go to mud. */
      m.color.multiplyScalar(clamp(1 - dark * 0.34, 0.2, 1));
      m.normalScale.set(nScale, nScale);
      m.needsUpdate = true;
    }

    seatMat.opacity = Math.max((config.chip.seat/100) * 0.8, config.chip.gap > 0 ? 0.12 : 0);
    chipSeat.visible = config.chip.show && (config.chip.seat > 0 || config.chip.gap > 0);
    chipPad.visible = config.chip.show;
    chipPocket.visible = config.chip.show && chipGapSize(config.chip.gap) > 0;
    chipEtch.visible = config.chip.show && config.chip.etch;

    artInlayMat.roughness = clamp(rough + 0.08, 0.16, 0.8);
    artInlayMat.roughnessMap = brushed.roughness;
    artInlayMat.normalMap = brushed.normal;
    artInlayMat.normalScale.copy(brushed.normalScale);
    artInlayMat.anisotropy = aniso;
    artInlayMat.anisotropyRotation = rotA;
    artInlayMat.envMapIntensity = envI*0.88;
    artInlayMat.clearcoat = coat*0.7;
    artInlayMat.clearcoatRoughness = 0.32;
    artInlayMat.opacity = config.artwork.opacity/100;
    artInlayMat.needsUpdate = true;
    artPrintMat.opacity = config.artwork.opacity/100;

    artMesh.visible = config.artwork.mode !== 'none' && config.artwork.opacity > 0 && !!artInlayMat.map;
    artMesh.material = config.artwork.treat === 'inlay' ? artInlayMat : artPrintMat;

    foil.uniforms.uStyle.value     = Math.max(0, config.foil.style);
    foil.uniforms.uIntensity.value = config.foil.intensity/100;
    foil.uniforms.uGlare.value     = config.foil.glare/100;
    foil.uniforms.uScale.value     = config.foil.scale/100;
    foil.uniforms.uAngle.value     = config.foil.angle * Math.PI / 180;
    foil.uniforms.uDispersion.value = config.foil.dispersion / 100;
    foil.uniforms.uBreakup.value   = config.foil.breakup / 100;
    foil.uniforms.uSparkle.value   = config.foil.sparkle / 100;
    foil.uniforms.uEdge.value      = config.foil.edge / 100;
    foilMesh.visible = config.foil.style >= 0 && config.foil.intensity > 0;
  }

  /* NOTE ON LIGHTING — deliberately NOT set per material.
     Assigning the same PMREM texture to material.envMap instead of
     scene.environment renders measurably brighter in three.js r180 (mean
     luminance 53.1 vs 48.9 on an identical frame; the front face accounts for
     most of it). The two are supposed to be equivalent and are not, so the
     card takes the scene.environment path — that is the look every value in
     this file was tuned against, and matching it is what keeps the React
     component identical to the playground.

     The cost is that the environment belongs to the scene rather than to the
     card, so two cards with different light rigs need two scenes. In practice
     that is one <Canvas> per card, which is what a grid of cards wants
     anyway. createEnvironmentBuilder() in environment.js builds the texture;
     the consumer assigns it. */

  /* ---- first build ---- */
  rebuildGeometry();
  rebuildName();
  rebuildRelief();
  applyMaterials();
  depthFx.apply(config.artwork.depth);
  loadArtwork();

  return {
    group,
    artMesh,
    get config() { return cloneConfig(config); },

    /* Applies a new config, rebuilding only what the diff says has to be. */
    update(nextInput) {
      const prev = config;
      const next = normalizeConfig(nextInput);
      config = next;

      const geoDirty = changed(prev.surface, next.surface, ['thickness', 'corner', 'edge']);
      const brushDirty = changed(prev.surface, next.surface, ['grain', 'relief']);
      const chipDirty = changed(prev.chip, next.chip, ['height', 'bevel', 'corner', 'gap']);
      const nameDirty = prev.engraving.name !== next.engraving.name;
      /* The baked shadow is oriented by the rig, so moving a light has to
         re-bake it or the shadow keeps pointing at where the light used to be. */
      const lightsDirty = JSON.stringify(prev.lights) !== JSON.stringify(next.lights);
      const reliefDirty = nameDirty || lightsDirty
        || changed(prev.engraving, next.engraving, ['depth', 'soft']);
      const artDirty = changed(prev.artwork, next.artwork, ['mode', 'image', 'depthMap']);
      const depthDirty = JSON.stringify(prev.artwork.depth) !== JSON.stringify(next.artwork.depth);

      if (brushDirty) {
        brushed.normal.dispose();
        brushed.roughness.dispose();
        brushed = makeBrushed(512, next.surface.grain, next.surface.relief);
      }
      if (geoDirty) rebuildGeometry();
      else if (chipDirty) layoutChip();
      if (changed(prev.chip, next.chip, [
        'strokeWidth', 'strokeColor', 'stampRound',
        'plating', 'platingAngle', 'scratch', 'scratchAngle',
        'grain', 'micro', 'padVar', 'edgeWear',
      ])) rebuildChipFace();
      if (nameDirty) rebuildName();
      if (reliefDirty) rebuildRelief();
      if (artDirty) loadArtwork();
      else if (depthDirty && next.artwork.mode === 'depth') depthFx.apply(next.artwork.depth);

      applyMaterials();
    },

    /* Unconditional text rebuild, for when nothing in the config changed but
       the rendering of it did — specifically a web font arriving after the
       first frame, which leaves the name drawn in a fallback face. The diff
       in update() cannot see that, because the name string is identical. */
    refreshText() {
      rebuildName();
      rebuildRelief();
      applyMaterials();
    },

    /* Pivot value (0-100) for a point on the artwork, marched the way the
       shader marches it. Null if there is no depth map loaded. */
    pivotAtUV: (u, v) => depthFx.pivotAtUV(u, v),

    /* Resolves once the artwork has decoded — so a screenshot or a first
       frame can wait for the real picture rather than catching bare metal. */
    ready: () => artReady,

    dispose() {
      artToken++;
      group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      for (const t of [plate.colorMap, plate.roughnessMap, plate.normalMap,
                       seatTex, brushed.normal, brushed.roughness]) t?.dispose();
      for (const m of [labelMat, markMat, visaMat]) { m.map?.dispose(); m.normalMap?.dispose(); }
      artInlayMat.map?.dispose();
      depthFx.dispose();
      for (const m of [bodyMat, frontMat, backMat, chipMat, chipEtchMat, labelMat, markMat, visaMat,
                       contactlessMat,
                       seatMat, pocketMat, artInlayMat, artPrintMat, foil.material]) m.dispose();
      group.clear();
    },
  };
}
