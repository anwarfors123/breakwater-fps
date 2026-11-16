// The body: one controller shared by the player and by every bot, so a bot cannot out-strafe
// physics. Movement is accelerated with ground friction (the Quake-shaped feel that every
// tactical shooter inherits), the body is a vertical box swept against the map's AABBs one axis
// at a time, and crouching shrinks both the box and the eye.

import * as THREE from 'three';

export const RADIUS = 0.34;
const STAND_HEIGHT = 1.78;
const CROUCH_HEIGHT = 1.24;
const STAND_EYE = 1.62;
const CROUCH_EYE = 1.06;
const GRAVITY = 19;
const JUMP_SPEED = 5.4;
const RUN_SPEED = 5.7;
const WALK_SPEED = 3.1;
const CROUCH_SPEED = 2.1;
const ACCEL = 62;
const AIR_ACCEL = 12;
const FRICTION = 9.5;

export function createBody(colliders, spawn) {
  const state = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    crouch: 0, // 0 standing .. 1 fully crouched
    onGround: true,
    eye: STAND_EYE,
    height: STAND_HEIGHT,
    bob: 0,
    stepPhase: 0,
    speed: 0,
    health: 100,
    armour: 0,
    alive: true,
    team: spawn.team ?? 'dock',
  };

  function heightNow() {
    return STAND_HEIGHT + (CROUCH_HEIGHT - STAND_HEIGHT) * state.crouch;
  }

  /** Push the body out of any collider it has entered, on one axis. */
  function resolveAxis(axis) {
    const half = RADIUS;
    const h = heightNow();
    const p = state.position;
    for (const c of colliders) {
      if (c.maxY <= p.y + 0.34 || c.minY >= p.y + h) continue; // a kerb is a step, not a wall
      const minX = c.minX - half;
      const maxX = c.maxX + half;
      const minZ = c.minZ - half;
      const maxZ = c.maxZ + half;
      if (p.x <= minX || p.x >= maxX || p.z <= minZ || p.z >= maxZ) continue;
      // Smallest push along the requested axis.
      if (axis === 'x') {
        const toLeft = p.x - minX;
        const toRight = maxX - p.x;
        p.x += toLeft < toRight ? -toLeft : toRight;
        state.velocity.x = 0;
      } else {
        const toBack = p.z - minZ;
        const toFront = maxZ - p.z;
        p.z += toBack < toFront ? -toBack : toFront;
        state.velocity.z = 0;
      }
    }
  }

  function step(dt, keys, speedScale = 1) {
    const p = state.position;
    const v = state.velocity;

    // Wish direction in world space from the keys, relative to where the body looks.
    let forward = 0;
    let strafe = 0;
    if (keys.has('KeyW')) forward += 1;
    if (keys.has('KeyS')) forward -= 1;
    if (keys.has('KeyD')) strafe += 1;
    if (keys.has('KeyA')) strafe -= 1;
    const len = Math.hypot(forward, strafe);
    if (len > 1) {
      forward /= len;
      strafe /= len;
    }
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    // yaw 0 looks down -Z; right is +X.
    const wishX = -sin * forward + cos * strafe;
    const wishZ = -cos * forward - sin * strafe;

    const crouching = keys.has('KeyC');
    const walking = keys.has('ShiftLeft');
    state.crouch += ((crouching && state.onGround ? 1 : 0) - state.crouch) * Math.min(1, dt * 12);

    // A scope costs you the run: the caller scales the top speed while the eye is down the tube.
    const maxSpeed = (crouching ? CROUCH_SPEED : walking ? WALK_SPEED : RUN_SPEED) * speedScale;
    const accel = state.onGround ? ACCEL : AIR_ACCEL;

    if (state.onGround) {
      // Friction first, then acceleration: the standard order, and the one that makes a
      // counter-strafe stop feel instant.
      const speed = Math.hypot(v.x, v.z);
      if (speed > 0.0001) {
        const drop = Math.max(speed, 2.4) * FRICTION * dt;
        const factor = Math.max(0, speed - drop) / speed;
        v.x *= factor;
        v.z *= factor;
      }
    }

    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0.001) {
      const current = v.x * wishX + v.z * wishZ;
      const add = Math.min(accel * dt, Math.max(0, maxSpeed - current));
      v.x += wishX * add;
      v.z += wishZ * add;
    }

    if (keys.has('Space') && state.onGround) {
      v.y = JUMP_SPEED;
      state.onGround = false;
    }

    v.y -= GRAVITY * dt;

    // Integrate, resolving X then Z then Y so a corner is two slides, not a stop.
    p.x += v.x * dt;
    resolveAxis('x');
    p.z += v.z * dt;
    resolveAxis('z');
    p.y += v.y * dt;

    // Ground plane and the top of any box we land on.
    let floor = 0;
    for (const c of colliders) {
      if (c.maxY > p.y + 0.4) continue;
      if (p.x > c.minX - RADIUS * 0.6 && p.x < c.maxX + RADIUS * 0.6 && p.z > c.minZ - RADIUS * 0.6 && p.z < c.maxZ + RADIUS * 0.6) {
        if (c.maxY > floor) floor = c.maxY;
      }
    }
    if (p.y <= floor) {
      p.y = floor;
      if (v.y < 0) v.y = 0;
      state.onGround = true;
    } else {
      state.onGround = false;
    }

    // Keep the body inside the yard even if a push put it through a seam.
    p.x = Math.max(-31.5, Math.min(31.5, p.x));
    p.z = Math.max(-33.5, Math.min(33.5, p.z));

    state.height = heightNow();
    state.eye = STAND_EYE + (CROUCH_EYE - STAND_EYE) * state.crouch;
    state.speed = Math.hypot(v.x, v.z);

    // View bob, tied to distance travelled so it is speed-correct.
    if (state.onGround && state.speed > 0.4) {
      state.stepPhase += state.speed * dt * 1.85;
      state.bob = Math.sin(state.stepPhase) * 0.026 * Math.min(1, state.speed / RUN_SPEED);
    } else {
      state.bob *= Math.max(0, 1 - dt * 6);
    }
    return state;
  }

  function look(dx, dy) {
    state.yaw -= dx;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy));
  }

  function addRecoil(pitch, yaw) {
    state.pitch = Math.max(-1.45, Math.min(1.5, state.pitch + pitch));
    state.yaw += yaw;
  }

  function eyePosition(out = new THREE.Vector3()) {
    return out.set(state.position.x, state.position.y + state.eye + state.bob, state.position.z);
  }

  function reset(spawn) {
    state.position.set(spawn.x, spawn.y ?? 0, spawn.z);
    state.velocity.set(0, 0, 0);
    state.yaw = spawn.yaw ?? 0;
    state.pitch = 0;
    state.crouch = 0;
    state.onGround = true;
    state.health = 100;
    state.alive = true;
    state.stepPhase = 0;
    state.bob = 0;
  }

  return { state, step, look, addRecoil, eyePosition, reset, RADIUS, STAND_HEIGHT, CROUCH_HEIGHT };
}

