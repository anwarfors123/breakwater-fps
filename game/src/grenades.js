// Frag grenades: bought in the freeze, thrown from the eye, a short fuse, and a blast that walls
// cut. The flight is plain numbers rather than vectors on purpose — nothing in this module makes a
// new object while a grenade is in the air, only when one is thrown or bursts.
import * as THREE from 'three';
import { GRENADE } from './weapons.js';

const GRAVITY = 19;
const SHELL = 0.09;
const BOUNCE = 0.34;
const RUB = 0.62;

export function createGrenades({ scene, world, audio, onBlast }) {
  const live = [];
  const flashes = [];
  const shellGeo = new THREE.SphereGeometry(SHELL, 10, 8);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x39412f, roughness: 0.85, metalness: 0.12 });
  const flashGeo = new THREE.SphereGeometry(1, 12, 9);

  /** Throw one, from a point, along a unit direction. */
  function throwFrom(x, y, z, dx, dy, dz) {
    const mesh = new THREE.Mesh(shellGeo, shellMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    scene.add(mesh);
    live.push({
      x,
      y,
      z,
      vx: dx * GRENADE.throwSpeed,
      vy: dy * GRENADE.throwSpeed + GRENADE.throwLift,
      vz: dz * GRENADE.throwSpeed,
      fuse: GRENADE.fuse,
      mesh,
    });
    audio.beep(0.7);
  }

  function burst(g) {
    scene.remove(g.mesh);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb257,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(flashGeo, mat);
    mesh.position.set(g.x, g.y, g.z);
    mesh.scale.setScalar(0.4);
    scene.add(mesh);
    flashes.push({ mesh, mat, t: 0, life: 0.34 });
    audio.explosion();
    onBlast(g.x, g.y, g.z);
  }

  function step(dt) {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const g = live[i];
      g.vy -= GRAVITY * dt;
      let nx = g.x + g.vx * dt;
      const ny = g.y + g.vy * dt;
      let nz = g.z + g.vz * dt;

      if (ny < SHELL) {
        // A floor bounce keeps most of the speed across the ground and very little of the drop.
        g.y = SHELL;
        g.vy = Math.abs(g.vy) * BOUNCE;
        g.vx *= RUB;
        g.vz *= RUB;
        if (g.vy < 0.9) g.vy = 0;
      } else {
        g.y = ny;
      }

      if (world.blockedAt(nx, nz, SHELL)) {
        // Slide along whichever axis is still free; a wall costs the speed on the other one.
        if (!world.blockedAt(nx, g.z, SHELL)) {
          nz = g.z;
          g.vz *= -BOUNCE;
        } else if (!world.blockedAt(g.x, nz, SHELL)) {
          nx = g.x;
          g.vx *= -BOUNCE;
        } else {
          nx = g.x;
          nz = g.z;
          g.vx *= -BOUNCE;
          g.vz *= -BOUNCE;
        }
      }
      g.x = nx;
      g.z = nz;
      g.mesh.position.set(g.x, g.y, g.z);
      g.mesh.rotation.x += dt * 7;
      g.mesh.rotation.z += dt * 4;

      g.fuse -= dt;
      if (g.fuse <= 0) {
        live.splice(i, 1);
        burst(g);
      }
    }

    for (let i = flashes.length - 1; i >= 0; i -= 1) {
      const f = flashes[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.life);
      f.mesh.scale.setScalar(0.4 + k * (GRENADE.radius * 0.55));
      f.mat.opacity = 0.85 * (1 - k);
      if (k >= 1) {
        scene.remove(f.mesh);
        f.mat.dispose();
        flashes.splice(i, 1);
      }
    }
  }

  function reset() {
    for (const g of live) scene.remove(g.mesh);
    for (const f of flashes) {
      scene.remove(f.mesh);
      f.mat.dispose();
    }
    live.length = 0;
    flashes.length = 0;
  }

  return { throwFrom, step, reset, get live() { return live.length; } };
}
