/* ================= the light rig as an environment map =================
   Metal has no colour of its own — it shows you whatever is in front of it.
   So these panels aren't lighting the card so much as being the thing you see
   in it, which is why they are baked into a cube map rather than added as
   three.js lights.

   Needs a WebGLRenderer for PMREM. The playground owns one; under React it
   comes from useThree(). */

import * as THREE from 'three';

export function createEnvironmentBuilder(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const ringGeo = new THREE.RingGeometry(0.25, 0.5, 64);
  let current = null;

  return {
    /* Returns the env texture for this rig, disposing the previous one. The
       panel meshes are thrown away immediately — only the cube map survives,
       which is the whole point of prefiltering. */
    build(rig) {
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x000000);
      for (const l of rig) {
        if (!l.on) continue;
        const col = new THREE.Color(l.color).multiplyScalar(l.intensity);
        const m = new THREE.Mesh(
          l.form === 'ring' ? ringGeo : planeGeo,
          new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, toneMapped: false })
        );
        m.position.set(l.x, l.y, l.z);
        m.scale.set(l.w, l.h, 1);
        if (l.form === 'ring') m.rotation.set(Math.PI / 2, 0, 0);
        else m.rotation.set(0, THREE.MathUtils.degToRad(l.rot), 0);
        envScene.add(m);
      }
      const next = pmrem.fromScene(envScene, 0.02);
      if (current) current.dispose();
      current = next;
      envScene.traverse(o => { if (o.material) o.material.dispose(); });
      return current.texture;
    },

    dispose() {
      if (current) current.dispose();
      current = null;
      planeGeo.dispose();
      ringGeo.dispose();
      pmrem.dispose();
    },
  };
}
