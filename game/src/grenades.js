// The frag. One pool of eight, all of it plain numbers: a grenade in the air owns no Vector3 and
// allocates nothing, so a firefight with three of them going off costs the frame loop nothing.
// The blast itself is resolved by the caller (main.js), which knows the actors; this module only
// says where and when it went off, and plays the cue.

import * as THREE from 'three';
import { GRENADE } from './weapons.js';

const POOL = 8;
const GRAVITY = 19;
const BOUNCE = GRENADE.restitution;
const GROUND_FRICTION = 0.72;
const RADIUS = 0.11;

export function createGrenades({ scene, world, audio, onBlast }) {
  const geometry = new THREE.IcosahedronGeometry(RADIUS, 0);
  const material = new THREE.MeshStandardMaterial({
    color: '#3f4a3a',
    roughness: 0.72,
    metalness: 0.2,
    emissive: '#16200f',
    emissiveIntensity: 0.6,
  });

  const frags = [];
  for (let i = 0; i < POOL; i += 1) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.castShadow = true;
    scene.add(mesh);
    frags.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, live: false, mesh });
  }

  let count = 0;

  function free() {
    for (let i = 0; i < frags.length; i += 1) {
      if (!frags[i].live) return frags[i];
    }
    return null;
  }

  /** Throws from a point along a direction, at the frag's own speed plus a little lift. */
  function throwFrom(x, y, z, dx, dy, dz) {
    const frag = free();
    if (!frag) return false;
    frag.x = x;
    frag.y = y;
    frag.z = z;
    frag.vx = dx * GRENADE.speed;
    frag.vy = dy * GRENADE.speed + GRENADE.lift;
    frag.vz = dz * GRENADE.speed;
    frag.fuse = GRENADE.fuse;
    frag.live = true;
    frag.mesh.visible = true;
    frag.mesh.position.set(x, y, z);
    count += 1;
    return true;
  }

  function explode(frag) {
    frag.live = false;
    frag.mesh.visible = false;
    count = Math.max(0, count - 1);
    if (audio) audio.explosion();
    if (onBlast) onBlast(frag.x, frag.y, frag.z);
  }

  function step(dt) {
    for (let i = 0; i < frags.length; i += 1) {
      const frag = frags[i];
      if (!frag.live) continue;

      frag.vy -= GRAVITY * dt;

      // Walls: test each axis on its own so a frag thrown at a container slides along it.
      const nextX = frag.x + frag.vx * dt;
      if (world.blockedAt(nextX, frag.z, RADIUS)) frag.vx *= -0.25;
      else frag.x = nextX;

      const nextZ = frag.z + frag.vz * dt;
      if (world.blockedAt(frag.x, nextZ, RADIUS)) frag.vz *= -0.25;
      else frag.z = nextZ;

      frag.y += frag.vy * dt;
      if (frag.y <= RADIUS) {
        frag.y = RADIUS;
        if (frag.vy < 0) frag.vy = -frag.vy * BOUNCE;
        frag.vx *= GROUND_FRICTION;
        frag.vz *= GROUND_FRICTION;
        if (Math.abs(frag.vy) < 0.6) frag.vy = 0;
      }

      frag.fuse -= dt;
      if (frag.fuse <= 0) {
        explode(frag);
        continue;
      }
      frag.mesh.position.set(frag.x, frag.y, frag.z);
      frag.mesh.rotation.x += frag.vx * dt * 2.2;
      frag.mesh.rotation.z += frag.vz * dt * 2.2;
    }
  }

  function reset() {
    for (let i = 0; i < frags.length; i += 1) {
      frags[i].live = false;
      frags[i].mesh.visible = false;
    }
    count = 0;
  }

  return {
    throwFrom,
    step,
    reset,
    get count() {
      return count;
    },
  };
}
