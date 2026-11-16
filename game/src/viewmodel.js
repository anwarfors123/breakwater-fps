// The gun in your hands. One silhouette per weapon, built once at boot from a parts table, so what
// you bought in the freeze is what you are holding: a service pistol, a compact SMG, a rifle, and
// the long rifle with the scope. Switching weapons only toggles visibility — no mesh is built while
// the round runs.
import * as THREE from 'three';

const BASE = { x: 0.155, y: -0.12, z: -0.33 };

// A view model is not lit like the world: it hangs 30 cm from the eye, in a dusk yard, so a
// metallic surface with no environment map would render as a black shape. Low metalness plus a
// little emissive keeps every edge readable, and a short-range lamp attached to the camera finishes
// the job without spilling onto the map.
function materials() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: 0x39434d, roughness: 0.52, metalness: 0.3, emissive: 0x141a20 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1d2329, roughness: 0.44, metalness: 0.4, emissive: 0x0e1216 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x6b5138, roughness: 0.85, metalness: 0.05, emissive: 0x150f09 }),
    glove: new THREE.MeshStandardMaterial({ color: 0xa07f5e, roughness: 0.9, metalness: 0.02, emissive: 0x171009 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2c3d4a, roughness: 0.15, metalness: 0.2, emissive: 0x0a141a }),
  };
}

// A box: size, material name, position, and an optional tilt in radians.
const b = (w, h, d, mat, x, y, z, rx = 0) => ({ kind: 'box', w, h, d, mat, x, y, z, rx });
// A cylinder lying along the barrel axis.
const c = (r, len, mat, x, y, z, rx = Math.PI / 2) => ({ kind: 'cyl', r, len, mat, x, y, z, rx });

// Local origin sits at the grip, the barrel runs toward -Z, and `muzzle` is where the flash goes.
const GUNS = {
  tally: {
    muzzle: [0, 0.03, -0.27],
    parts: [
      b(0.048, 0.062, 0.24, 'steel', 0, 0.03, -0.1),
      b(0.022, 0.022, 0.07, 'dark', 0, 0.03, -0.25),
      b(0.046, 0.13, 0.07, 'grip', 0, -0.07, 0.01, 0.18),
      b(0.05, 0.012, 0.05, 'dark', 0, -0.02, -0.05),
      b(0.075, 0.1, 0.1, 'glove', 0, -0.08, 0.03),
    ],
  },
  skiff: {
    muzzle: [0, 0.02, -0.44],
    parts: [
      b(0.07, 0.085, 0.34, 'steel', 0, 0.02, -0.14),
      b(0.05, 0.02, 0.2, 'dark', 0, 0.07, -0.16),
      c(0.016, 0.16, 'dark', 0, 0.02, -0.38),
      b(0.045, 0.15, 0.075, 'dark', 0, -0.1, -0.14, -0.12),
      b(0.05, 0.06, 0.14, 'grip', 0, 0.01, 0.1),
      b(0.05, 0.11, 0.07, 'grip', 0, -0.07, 0.02, 0.15),
      b(0.075, 0.1, 0.1, 'glove', 0, -0.09, 0.02),
      b(0.07, 0.07, 0.09, 'glove', 0, -0.05, -0.26),
    ],
  },
  harbor: {
    muzzle: [0, 0.02, -0.75],
    parts: [
      b(0.075, 0.09, 0.46, 'steel', 0, 0.02, -0.18),
      b(0.06, 0.06, 0.18, 'grip', 0, 0.01, -0.44),
      c(0.018, 0.36, 'dark', 0, 0.02, -0.58),
      b(0.05, 0.17, 0.09, 'dark', 0, -0.11, -0.1, -0.1),
      b(0.055, 0.075, 0.2, 'grip', 0, 0.01, 0.14),
      b(0.03, 0.03, 0.05, 'dark', 0, 0.08, -0.26),
      b(0.075, 0.1, 0.1, 'glove', 0, -0.09, 0.02),
      b(0.07, 0.07, 0.09, 'glove', 0, -0.05, -0.36),
    ],
  },
  longline: {
    hideOnAim: true, // looking through the scope, not over the barrel
    muzzle: [0, 0.02, -1.0],
    parts: [
      b(0.07, 0.085, 0.56, 'steel', 0, 0.02, -0.22),
      c(0.016, 0.46, 'dark', 0, 0.02, -0.74),
      b(0.036, 0.036, 0.07, 'dark', 0, 0.02, -0.98),
      c(0.042, 0.26, 'dark', 0, 0.11, -0.24),
      c(0.03, 0.02, 'glass', 0, 0.11, -0.38),
      b(0.03, 0.05, 0.03, 'dark', 0, 0.075, -0.32),
      b(0.03, 0.05, 0.03, 'dark', 0, 0.075, -0.14),
      b(0.014, 0.014, 0.11, 'steel', 0.05, 0.03, 0.02),
      b(0.05, 0.08, 0.26, 'grip', 0, 0.0, 0.2),
      b(0.05, 0.11, 0.07, 'grip', 0, -0.07, 0.02, 0.15),
      b(0.075, 0.1, 0.1, 'glove', 0, -0.09, 0.02),
      b(0.07, 0.07, 0.09, 'glove', 0, -0.05, -0.42),
    ],
  },
};

export function createViewmodel(camera) {
  const mats = materials();
  const root = new THREE.Group();
  root.position.set(BASE.x, BASE.y, BASE.z);
  camera.add(root);

  const keyLight = new THREE.PointLight(0xffe6c4, 3.4, 1.4, 2);
  keyLight.position.set(0.16, 0.16, 0.1);
  root.add(keyLight);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const models = new Map();

  for (const [id, spec] of Object.entries(GUNS)) {
    const group = new THREE.Group();
    for (const part of spec.parts) {
      const geo = part.kind === 'box' ? boxGeo : cylGeo;
      const mesh = new THREE.Mesh(geo, mats[part.mat]);
      if (part.kind === 'box') mesh.scale.set(part.w, part.h, part.d);
      else mesh.scale.set(part.r, part.len, part.r);
      mesh.position.set(part.x, part.y, part.z);
      mesh.rotation.x = part.rx;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    group.visible = false;
    root.add(group);
    models.set(id, { group, muzzle: new THREE.Vector3(...spec.muzzle), hideOnAim: !!spec.hideOnAim });
  }

  let current = null;
  let kick = 0;
  let dip = 0;
  let aim = 0;
  let clock = 0;

  function setWeapon(id) {
    const next = models.get(id) ?? models.tally;
    if (current === next) return;
    if (current) current.group.visible = false;
    current = next;
    current.group.visible = true;
  }

  function fire() {
    kick = 1;
  }

  /** World position of the barrel mouth, so the flash and its light sit on the right gun. */
  function muzzle(out) {
    if (!current) return out.set(BASE.x, BASE.y, BASE.z);
    out.copy(current.muzzle);
    current.group.localToWorld(out);
    return out;
  }

  /**
   * Idle sway, the walk bob, the kick of a shot, and the dip of a reload. `reloading` is the
   * fraction of the reload left, so the gun comes back up as the magazine seats.
   */
  function update(dt, speed, crouch, reloading, alive, aiming = false) {
    clock += dt;
    kick = Math.max(0, kick - dt * 7);
    const target = reloading > 0 ? 1 : 0;
    dip += (target - dip) * Math.min(1, dt * 9);
    // Aiming brings the gun to the centre of the eye and takes the sway out of it.
    aim += ((aiming && reloading <= 0 ? 1 : 0) - aim) * Math.min(1, dt * 11);
    const bob = Math.min(1, speed / 5.7) * (1 - aim * 0.8);
    root.visible = alive && !(current?.hideOnAim && aim > 0.9);
    if (!alive) return;
    root.position.set(
      BASE.x * (1 - aim) + Math.sin(clock * 1.7) * 0.007 * bob + dip * 0.03,
      BASE.y + aim * 0.055 + Math.sin(clock * 3.4) * 0.006 * bob - crouch * 0.03 - dip * 0.11,
      BASE.z + aim * 0.06 + kick * 0.055,
    );
    root.rotation.set(kick * 0.2 + dip * 0.55, dip * 0.3 - aim * 0.02, -bob * 0.04 + dip * 0.12);
  }

  setWeapon('tally');
  return { setWeapon, fire, muzzle, update, root };
}
