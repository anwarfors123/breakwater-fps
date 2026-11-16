// One movement body, shared by the player and every bot. It owns a position, a velocity and a pair
// of look angles, and it knows only two things about the world: the list of box colliders it may not
// walk through, and the floor it stands on. Weapons, teams and rendering live elsewhere.
//
// The one subtlety worth keeping: a kerb is a step, not a wall. A collider whose top is at most
// STEP_UP above the feet is skipped by the sweep and walked onto instead, and the nav lattice calls
// anything under 0.32 m walkable, so the bots and the player agree about the same ledge.

import * as THREE from 'three';

export const RADIUS = 0.34;

export const SPEEDS = { run: 5.7, walk: 3.1, crouch: 2.1 };

const STAND_HEIGHT = 1.78;
const CROUCH_HEIGHT = 1.24;
const STAND_EYE = 1.62;
const CROUCH_EYE = 1.06;
const GRAVITY = 19;
const JUMP = 5.4;
const GROUND_ACCEL = 62;
const AIR_ACCEL = 12;
const FRICTION = 9.5;
const STEP_UP = 0.34;
const CROUCH_EASE = 9;
const MAX_PITCH = 1.5;
const MAX_HEALTH = 100;

export function createBody(colliders, spawn) {
  const state = {
    position: new THREE.Vector3(spawn.x, spawn.y ?? 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    crouch: 0,        // 0 standing … 1 crouched, eased toward the key
    grounded: true,
    speed: 0,         // horizontal speed in m/s, what the spread and the bob read
    eye: STAND_EYE,
    height: STAND_HEIGHT,
    bob: 0,           // head bob, the camera's own small vertical offset while walking
    health: MAX_HEALTH,
  };

  let bobPhase = 0;
  let bobAmount = 0;

  // Does a body standing at (x, z) with its feet at feetY overlap anything it may not pass?
  function solidAt(x, z, feetY, height) {
    const minX = x - RADIUS;
    const maxX = x + RADIUS;
    const minZ = z - RADIUS;
    const maxZ = z + RADIUS;
    const lowY = feetY + STEP_UP;      // anything at or under the step height is walked over
    const highY = feetY + height;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (c.maxY <= lowY || c.minY >= highY) continue;
      if (c.maxX <= minX || c.minX >= maxX) continue;
      if (c.maxZ <= minZ || c.minZ >= maxZ) continue;
      return true;
    }
    return false;
  }

  // The highest surface under the feet that a body may stand on.
  function floorAt(x, z, feetY) {
    let top = 0;
    const minX = x - RADIUS;
    const maxX = x + RADIUS;
    const minZ = z - RADIUS;
    const maxZ = z + RADIUS;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (c.maxY > feetY + 0.02 || c.maxY <= top) continue;
      if (c.maxX <= minX || c.minX >= maxX) continue;
      if (c.maxZ <= minZ || c.minZ >= maxZ) continue;
      top = c.maxY;
    }
    return top;
  }

  function stanceSpeed(keys) {
    if (state.crouch > 0.55) return SPEEDS.crouch;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) return SPEEDS.walk;
    return SPEEDS.run;
  }

  /**
   * One fixed step. `keys` is the held key set, `speedScale` lets the caller slow the body down
   * (aiming down the sights passes 1 - 0.45 * aimBlend).
   */
  function step(dt, keys, speedScale = 1) {
    const wanted = keys.has('KeyC') ? 1 : 0;
    state.crouch += (wanted - state.crouch) * Math.min(1, CROUCH_EASE * dt);
    state.height = STAND_HEIGHT + (CROUCH_HEIGHT - STAND_HEIGHT) * state.crouch;
    state.eye = STAND_EYE + (CROUCH_EYE - STAND_EYE) * state.crouch;

    // Wish direction in the body's own frame: yaw 0 looks down -Z and right is +X.
    let forward = 0;
    let strafe = 0;
    if (keys.has('KeyW')) forward += 1;
    if (keys.has('KeyS')) forward -= 1;
    if (keys.has('KeyD')) strafe += 1;
    if (keys.has('KeyA')) strafe -= 1;
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    let wishX = -sin * forward + cos * strafe;
    let wishZ = -cos * forward - sin * strafe;
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 0) {
      wishX /= wishLength;
      wishZ /= wishLength;
    }

    const target = stanceSpeed(keys) * Math.max(0, speedScale);
    const accel = state.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const velocity = state.velocity;

    if (wishLength > 0) {
      // Accelerate toward the wish velocity, never past it in one step.
      const wantX = wishX * target;
      const wantZ = wishZ * target;
      const k = Math.min(1, (accel * dt) / Math.max(1, target));
      velocity.x += (wantX - velocity.x) * k;
      velocity.z += (wantZ - velocity.z) * k;
    } else if (state.grounded) {
      const keep = Math.max(0, 1 - FRICTION * dt);
      velocity.x *= keep;
      velocity.z *= keep;
    }

    if (state.grounded && keys.has('Space')) {
      velocity.y = JUMP;
      state.grounded = false;
    }

    // Horizontal movement, one axis at a time, so a body slides along a wall instead of sticking.
    const feetY = state.position.y;
    const nextX = state.position.x + velocity.x * dt;
    if (!solidAt(nextX, state.position.z, feetY, state.height)) {
      state.position.x = nextX;
    } else {
      velocity.x = 0;
    }
    const nextZ = state.position.z + velocity.z * dt;
    if (!solidAt(state.position.x, nextZ, feetY, state.height)) {
      state.position.z = nextZ;
    } else {
      velocity.z = 0;
    }

    // Vertical movement against gravity and the floor under the feet.
    velocity.y -= GRAVITY * dt;
    state.position.y += velocity.y * dt;
    const floor = floorAt(state.position.x, state.position.z, Math.max(feetY, state.position.y));
    if (state.position.y <= floor) {
      state.position.y = floor;
      velocity.y = 0;
      state.grounded = true;
    } else {
      state.grounded = false;
    }

    state.speed = Math.hypot(velocity.x, velocity.z);

    // Head bob: a short, fast cycle that fades in with speed and out when the body stops.
    bobPhase += state.speed * dt * 2.4;
    const wantBob = state.grounded ? Math.min(0.03, state.speed * 0.0055) : 0;
    bobAmount += (wantBob - bobAmount) * Math.min(1, 8 * dt);
    state.bob = Math.sin(bobPhase * 2) * bobAmount;
  }

  /** Mouse delta in radians, already scaled by the input layer. */
  function look(dx, dy) {
    state.yaw -= dx;
    state.pitch -= dy;
    if (state.pitch > MAX_PITCH) state.pitch = MAX_PITCH;
    if (state.pitch < -MAX_PITCH) state.pitch = -MAX_PITCH;
  }

  /** The kick a shot gives the view: up, and a little to one side. */
  function addRecoil(pitch, yaw) {
    state.pitch += pitch;
    state.yaw += yaw;
    if (state.pitch > MAX_PITCH) state.pitch = MAX_PITCH;
  }

  function eyePosition(out) {
    const target = out ?? new THREE.Vector3();
    target.set(state.position.x, state.position.y + state.eye, state.position.z);
    return target;
  }

  function reset(spawnPoint) {
    state.position.set(spawnPoint.x, spawnPoint.y ?? 0, spawnPoint.z);
    state.velocity.set(0, 0, 0);
    state.yaw = spawnPoint.yaw ?? 0;
    state.pitch = 0;
    state.crouch = 0;
    state.height = STAND_HEIGHT;
    state.eye = STAND_EYE;
    state.grounded = true;
    state.speed = 0;
    state.bob = 0;
    bobPhase = 0;
    bobAmount = 0;
    state.health = MAX_HEALTH;
  }

  return { state, step, look, addRecoil, eyePosition, reset, RADIUS };
}
