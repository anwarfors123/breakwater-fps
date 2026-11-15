// The opposition. A bot is a body, a weapon and a small stack of intentions; it has no special
// knowledge of the map beyond the navigation lattice every other actor uses, and no aimbot: it
// sees through a field of view, it needs line of sight, it reacts after a delay that shrinks
// with its skill, and its shots leave through the same cone the player's do. What makes a bot
// feel competent is not accuracy but patience — it holds an angle, it stops to shoot, it
// retreats when it is losing the trade, and it goes where the round needs it to go.

import * as THREE from 'three';
import { createBody } from './player.js';
import { createWeapon, WEAPONS, resolveDamage } from './weapons.js';

const FOV = Math.cos((112 * Math.PI) / 180 / 2);
const SIGHT_RANGE = 72;
const HEARING_RANGE = 26;
const MAX_PATH_AGE = 2.5;

/** A* over the world's navigation lattice. Returns world-space waypoints, or null. */
export function findPath(world, from, to) {
  const nav = world.nav;
  const start = nav.at(from.x, from.z);
  const goal = nav.at(to.x, to.z);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [{ x: to.x, z: to.z }];
  const nodes = nav.nodes;
  const open = [{ id: start, f: 0 }];
  const gScore = new Float32Array(nodes.length).fill(Infinity);
  const cameFrom = new Int32Array(nodes.length).fill(-1);
  const closed = new Uint8Array(nodes.length);
  gScore[start] = 0;
  const heuristic = (a, b) => Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);

  while (open.length) {
    // The lattice is small enough that a linear pick beats the bookkeeping of a heap.
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bestIndex].f) bestIndex = i;
    const current = open.splice(bestIndex, 1)[0];
    if (current.id === goal) {
      const path = [];
      let cursor = goal;
      while (cursor !== -1) {
        path.push({ x: nodes[cursor].x, z: nodes[cursor].z });
        cursor = cameFrom[cursor];
      }
      path.reverse();
      path[path.length - 1] = { x: to.x, z: to.z };
      return smooth(world, path);
    }
    if (closed[current.id]) continue;
    closed[current.id] = 1;
    for (const next of nodes[current.id].links) {
      if (closed[next]) continue;
      const step = heuristic(current.id, next);
      const tentative = gScore[current.id] + step;
      if (tentative >= gScore[next]) continue;
      cameFrom[next] = current.id;
      gScore[next] = tentative;
      open.push({ id: next, f: tentative + heuristic(next, goal) });
    }
  }
  return null;
}

/** Drop every waypoint the bot can already see past, so paths are lines and not staircases. */
function smooth(world, path) {
  if (path.length < 3) return path;
  const out = [path[0]];
  let anchor = 0;
  for (let i = 2; i < path.length; i += 1) {
    if (!clearLine(world, path[anchor], path[i])) {
      out.push(path[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

export function clearLine(world, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const steps = Math.ceil(Math.hypot(dx, dz) / 0.55);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (world.blockedAt(a.x + dx * t, a.z + dz * t, 0.3)) return false;
  }
  return true;
}

/** The visible model: a vest, a helmet, a rifle. Cheap, and readable at 40 m. */
function buildMesh(team, name) {
  const group = new THREE.Group();
  const hue = team === 'dock' ? 'dock' : 'warden';
  const cloth = new THREE.MeshStandardMaterial({
    color: new THREE.Color(
      team === 'dock' ? 0.62 : 0.22,
      team === 'dock' ? 0.30 : 0.48,
      team === 'dock' ? 0.14 : 0.62,
    ),
    roughness: 0.85,
  });
  const gear = new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.7, metalness: 0.3 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x9a7a5c, roughness: 0.9 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.62, 4, 10), cloth);
  torso.position.y = 1.08;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.34), gear);
  vest.position.set(0, 1.14, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 12, 10), skin);
  head.position.y = 1.62;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), gear);
  helmet.position.y = 1.64;
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.5, 4, 8), cloth);
  legs.position.y = 0.44;

  // The rifle points down -Z, which is where the body looks.
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.86), gear);
  rifle.position.set(0.17, 1.16, -0.34);
  const arms = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.3), cloth);
  arms.position.set(0.1, 1.22, -0.24);

  for (const part of [torso, vest, head, helmet, legs, rifle, arms]) {
    part.castShadow = true;
    part.receiveShadow = true;
    group.add(part);
  }

  // A thin team ring at the feet, the only UI the world itself carries.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.42, 16),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(team === 'dock' ? 0.78 : 0.25, team === 'dock' ? 0.38 : 0.56, team === 'dock' ? 0.18 : 0.69),
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);

  group.userData.team = team;
  group.userData.hue = hue;
  group.userData.name = name;
  return {
    group,
    parts: { head, torso, legs, vest, rifle, arms },
    hitMeshes: [head, torso, vest, legs],
  };
}

export function createBot(scene, world, options) {
  const {
    team,
    name,
    spawn,
    skill = 0.55,
    role = 'rifle',
    weaponId = team === 'dock' ? 'skiff' : 'harbor',
    random,
  } = options;

  const body = createBody(world.colliders, { ...spawn, team });
  const model = buildMesh(team, name);
  scene.add(model.group);
  for (const mesh of model.hitMeshes) mesh.userData.bot = null; // filled below

  const weapon = createWeapon(WEAPONS[weaponId]);
  const bot = {
    team,
    name,
    skill,
    role,
    body,
    weapon,
    group: model.group,
    parts: model.parts,
    hitMeshes: model.hitMeshes,
    health: 100,
    armour: team === 'warden' ? 50 : 0,
    alive: true,
    state: 'advance',
    target: null,
    targetSeenAt: -99,
    lastSeen: null,
    reaction: 0,
    path: null,
    pathAge: 0,
    waypoint: 0,
    strafe: random() > 0.5 ? 1 : -1,
    strafeTimer: 0,
    burst: 0,
    burstCooldown: 0,
    thinkTimer: random() * 0.2,
    plantTimer: 0,
    defuseTimer: 0,
    hasBomb: false,
    aiming: new THREE.Vector3(),
    aimError: 0,
    kills: 0,
    deaths: 0,
    recoilControl: 0.35 + skill * 0.5,
  };
  for (const mesh of model.hitMeshes) mesh.userData.bot = bot;

  const eye = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();

  function canSee(world, point, other) {
    eye.copy(body.state.position).setY(body.state.position.y + body.state.eye);
    toTarget.copy(point).sub(eye);
    const distance = toTarget.length();
    if (distance > SIGHT_RANGE) return false;
    toTarget.normalize();
    // Field of view, but a bot that has just been shot at looks wider than its cone.
    const forwardX = -Math.sin(body.state.yaw);
    const forwardZ = -Math.cos(body.state.yaw);
    const dot = forwardX * toTarget.x + forwardZ * toTarget.z;
    if (dot < FOV && !(bot.reaction > 0 && distance < 12)) return false;
    raycaster.set(eye, toTarget);
    raycaster.far = distance - 0.35;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit;
  }

  function visibleEnemies(ctx) {
    const found = [];
    const others = ctx.actors.filter((a) => a !== bot && a.team !== bot.team && a.alive);
    for (const other of others) {
      const point = other.eyePosition
        ? other.eyePosition(new THREE.Vector3())
        : new THREE.Vector3(other.body.state.position.x, other.body.state.position.y + 1.2, other.body.state.position.z);
      if (canSee(world, point, other)) found.push({ other, point, distance: point.distanceTo(eye) });
    }
    found.sort((a, b) => a.distance - b.distance);
    return found;
  }

  function repath(destination) {
    const path = findPath(world, body.state.position, destination);
    bot.path = path;
    bot.waypoint = 0;
    bot.pathAge = 0;
    return path;
  }

  /** Walk the current path; returns true when the destination is reached. */
  function follow(dt) {
    if (!bot.path || bot.waypoint >= bot.path.length) return true;
    const node = bot.path[bot.waypoint];
    const dx = node.x - body.state.position.x;
    const dz = node.z - body.state.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.75) {
      bot.waypoint += 1;
      return bot.waypoint >= bot.path.length;
    }
    // Face the way we are going, but slowly enough that a turn is visible.
    const desired = Math.atan2(-dx, -dz);
    let delta = desired - body.state.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    body.state.yaw += delta * Math.min(1, dt * 7);
    body.state.velocity.x += (dx / distance) * 34 * dt;
    body.state.velocity.z += (dz / distance) * 34 * dt;
    return false;
  }

  function stopMoving(dt) {
    body.state.velocity.x *= Math.max(0, 1 - dt * 10);
    body.state.velocity.z *= Math.max(0, 1 - dt * 10);
  }

  /** Point the body at a world position with a skill-scaled wobble. */
  function aimAt(point, dt, ctx) {
    const ex = body.state.position.x;
    const ez = body.state.position.z;
    const ey = body.state.position.y + body.state.eye;
    const dx = point.x - ex;
    const dy = point.y - ey;
    const dz = point.z - ez;
    const desiredYaw = Math.atan2(-dx, -dz);
    const desiredPitch = Math.atan2(dy, Math.hypot(dx, dz));
    let delta = desiredYaw - body.state.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const turn = (5.5 + bot.skill * 7) * dt;
    body.state.yaw += Math.max(-turn, Math.min(turn, delta));
    body.state.pitch += Math.max(-turn, Math.min(turn, desiredPitch - body.state.pitch));
    bot.aimError = Math.abs(delta);
  }

  function shoot(ctx, point) {
    const speedRatio = Math.min(1, body.state.speed / 5.7);
    const cone = weapon.fire(speedRatio * (1.35 - bot.skill * 0.5), ctx.random);
    if (!cone) return;
    const eyePos = body.eyePosition(new THREE.Vector3());
    const dir = new THREE.Vector3(point.x - eyePos.x, point.y - eyePos.y, point.z - eyePos.z).normalize();
    dir.applyAxisAngle(new THREE.Vector3(1, 0, 0), cone.pitch);
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), cone.yaw);
    raycaster.set(eyePos, dir);
    raycaster.far = weapon.state.def.range;
    const hits = raycaster.intersectObjects(ctx.hitTargets, false);
    ctx.audio.shot(weapon.state.def.sound, ctx.audio.panFor(eyePos.x - ctx.listener.x, eyePos.z - ctx.listener.z, ctx.listener.yaw));
    ctx.onShot?.(eyePos, dir, bot);
    const first = hits[0];
    if (!first) return;
    const victim = first.object.userData.bot;
    if (!victim || victim.team === bot.team) {
      ctx.audio.impact();
      return;
    }
    const headshot = first.object.userData.part === 'head' || first.object === victim.parts.head;
    const result = resolveDamage(weapon.state.def, victim.armour, headshot, first.distance);
    ctx.onDamage(victim, result.damage, headshot, bot);
  }

  /**
   * One fixed tick. `ctx` carries everything the bot is allowed to know about the round:
   * the actors, the bomb, the sites, the clock and the callbacks that change the world.
   */
  function step(dt, ctx) {
    if (!bot.alive) return;
    bot.pathAge += dt;
    bot.thinkTimer -= dt;
    bot.strafeTimer -= dt;
    weapon.step(dt);

    if (weapon.state.mag === 0 && weapon.state.reloading <= 0) weapon.beginReload();

    // Perception runs a few times a second, not every tick: a bot that re-decides at 60 Hz
    // reads as a machine, and it is wasted work.
    if (bot.thinkTimer <= 0) {
      bot.thinkTimer = 0.12 + (1 - bot.skill) * 0.1;
      const seen = visibleEnemies(ctx);
      if (seen.length) {
        bot.target = seen[0].other;
        bot.aiming.copy(seen[0].point);
        bot.lastSeen = { x: seen[0].point.x, y: seen[0].point.y, z: seen[0].point.z };
        bot.targetSeenAt = ctx.time;
        if (bot.reaction <= 0) bot.reaction = (1 - bot.skill) * 0.42 + 0.1;
      } else {
        bot.target = null;
      }
    }

    if (bot.reaction > 0) bot.reaction -= dt;

    // ── Combat ────────────────────────────────────────────────────────────────────────────
    if (bot.target && bot.target.alive) {
      const targetEye = bot.target.eyePosition
        ? bot.target.eyePosition(new THREE.Vector3())
        : new THREE.Vector3(bot.target.body.state.position.x, bot.target.body.state.position.y + 1.2, bot.target.body.state.position.z);
      // Aim at the chest, and let the cone do the rest; better bots lead higher.
      const aimPoint = targetEye.clone();
      aimPoint.y -= 0.28 - bot.skill * 0.16;
      aimAt(aimPoint, dt, ctx);

      // Stand still to shoot: the same rule the player lives by.
      stopMoving(dt);
      // A little strafing while the magazine is between bursts.
      if (bot.strafeTimer <= 0) {
        bot.strafeTimer = 0.4 + ctx.random() * 0.7;
        bot.strafe *= -1;
      }
      if (weapon.state.cooldown > 0.02 && bot.skill > 0.4) {
        const side = bot.strafe * (1.1 + bot.skill * 1.4);
        body.state.velocity.x += Math.cos(body.state.yaw) * side * dt * 22;
        body.state.velocity.z += -Math.sin(body.state.yaw) * side * dt * 22;
      }

      const aimedEnough = bot.aimError < 0.05 + (1 - bot.skill) * 0.12;
      if (bot.reaction <= 0 && aimedEnough) {
        if (bot.burst > 0) {
          shoot(ctx, aimPoint);
          bot.burst -= 1;
        } else if (bot.burstCooldown <= 0) {
          bot.burst = 2 + Math.round(bot.skill * 4) + (weapon.state.def.id === 'longline' ? -2 : 0);
          bot.burst = Math.max(1, bot.burst);
          bot.burstCooldown = 0.16 + (1 - bot.skill) * 0.5 + ctx.random() * 0.12;
        }
      }
      if (bot.burstCooldown > 0) bot.burstCooldown -= dt;
      bot.state = 'engage';
      return;
    }

    if (bot.burstCooldown > 0) bot.burstCooldown -= dt;
    if (bot.burst > 0 && weapon.state.mag > 0) {
      // Finish the burst at the last known position, the way a person would.
      if (bot.lastSeen) {
        aimAt(bot.lastSeen, dt, ctx);
        if (bot.aimError < 0.08) shoot(ctx, bot.lastSeen);
      }
      bot.burst -= 1;
    }

    // ── Objective ─────────────────────────────────────────────────────────────────────────
    const bomb = ctx.bomb;
    if (bomb && bomb.state === 'planted') {
      if (bot.team === 'warden') {
        const site = bomb.site;
        if (Math.hypot(body.state.position.x - bomb.x, body.state.position.z - bomb.z) < 1.7) {
          stopMoving(dt);
          bot.state = 'defuse';
          bot.defuseTimer += dt;
          if (bot.defuseTimer > 6.5) ctx.onDefused?.(bot);
          return;
        }
        if (bot.pathAge > MAX_PATH_AGE || !bot.path) repath({ x: bomb.x, z: bomb.z });
        follow(dt);
        bot.state = 'retake';
        return;
      }
      // Attackers hold the site they just took.
      const hold = ctx.holdPoint ?? { x: bomb.x + 4, z: bomb.z + 5 };
      if (Math.hypot(body.state.position.x - hold.x, body.state.position.z - hold.z) > 2.5) {
        if (bot.pathAge > MAX_PATH_AGE || !bot.path) repath(hold);
        follow(dt);
      } else {
        stopMoving(dt);
        // Watch the most likely entrance.
        const watch = ctx.watchPoint ?? { x: bomb.x, z: bomb.z + 14 };
        const desiredYaw = Math.atan2(-(watch.x - body.state.position.x), -(watch.z - body.state.position.z));
        let delta = desiredYaw - body.state.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        body.state.yaw += delta * Math.min(1, dt * 3);
      }
      bot.state = 'hold';
      return;
    }

    // Carrying the charge: go to the assigned site and plant.
    if (bot.hasBomb && ctx.site) {
      const site = ctx.site;
      const near = Math.hypot(body.state.position.x - site.x, body.state.position.z - site.z) < site.radius - 1;
      if (near) {
        stopMoving(dt);
        bot.state = 'plant';
        bot.plantTimer += dt;
        if (bot.plantTimer > 3.2) ctx.onPlanted?.(bot, site);
        return;
      }
      if (bot.pathAge > MAX_PATH_AGE || !bot.path) repath({ x: site.x, z: site.z });
      follow(dt);
      bot.state = 'advance';
      return;
    }

    // ── Movement ─────────────────────────────────────────────────────────────────────────
    const destination = ctx.objective;
    if (!bot.path || bot.pathAge > MAX_PATH_AGE * 1.6) repath(destination);
    const arrived = follow(dt);
    if (arrived) {
      stopMoving(dt);
      bot.state = 'hold';
      // Scan a held angle rather than stare through it.
      if (bot.strafeTimer <= 0) {
        bot.strafeTimer = 1.2 + ctx.random() * 2.2;
        bot.strafe *= -1;
      }
      body.state.yaw += Math.sin(ctx.time * 0.9 + bot.skill * 10) * dt * 0.55;
    } else {
      bot.state = 'advance';
    }
  }

  function hurt(amount, headshot, attacker) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.deaths += 1;
      if (attacker) attacker.kills = (attacker.kills ?? 0) + 1;
      return true;
    }
    // Being hit turns the body around even if it saw nothing.
    if (attacker?.body) {
      const dx = attacker.body.state.position.x - body.state.position.x;
      const dz = attacker.body.state.position.z - body.state.position.z;
      if (Math.hypot(dx, dz) < HEARING_RANGE && !bot.target) {
        bot.lastSeen = { x: attacker.body.state.position.x, y: 1.3, z: attacker.body.state.position.z };
        bot.reaction = Math.max(bot.reaction, 0.12);
      }
    }
    return false;
  }

  function syncModel() {
    const s = body.state;
    model.group.position.set(s.position.x, s.position.y, s.position.z);
    model.group.rotation.y = s.yaw;
    // Crouch squashes the model; a dead bot lies down.
    const squash = 1 - s.crouch * 0.28;
    model.group.scale.set(1, squash, 1);
    if (!bot.alive) {
      model.group.rotation.z = Math.PI / 2;
      model.group.position.y = s.position.y + 0.2;
      model.group.visible = true;
    }
  }

  function reset(spawnPoint) {
    body.reset({ ...spawnPoint, team });
    bot.health = 100;
    bot.alive = true;
    bot.armour = team === 'warden' ? 50 : 0;
    bot.state = 'advance';
    bot.target = null;
    bot.lastSeen = null;
    bot.path = null;
    bot.pathAge = 99;
    bot.waypoint = 0;
    bot.plantTimer = 0;
    bot.defuseTimer = 0;
    bot.hasBomb = false;
    bot.burst = 0;
    bot.reaction = 0;
    bot.aimError = 1;
    model.group.rotation.z = 0;
    model.group.scale.set(1, 1, 1);
    weapon.refill();
    syncModel();
  }

  syncModel();
  return { ...bot, body, weapon, step, hurt, reset, syncModel, eyePosition: () => body.eyePosition(), team };
}
