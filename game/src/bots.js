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
const SIGHT_RANGE = 36; // contact range, not sniper range
const HEARING_RANGE = 26;
const MAX_PATH_AGE = 2.5;
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

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

  // The gun in the hands is the gun in the state: a pistol is short, the long rifle runs past the
  // shoulder. One box, resized, so the silhouette still tells you what you are facing at 40 m.
  const GUN_SHAPE = {
    tally: [0.7, 0.72, 0.34, 0.24, 1.1, -0.26],
    skiff: [0.9, 0.95, 0.62, 0.18, 1.15, -0.3],
    harbor: [1, 1, 1, 0.17, 1.16, -0.34],
    longline: [0.85, 0.92, 1.3, 0.17, 1.17, -0.5],
  };
  let gunId = 'harbor';
  function setGun(id) {
    if (id === gunId) return;
    const s = GUN_SHAPE[id] || GUN_SHAPE.harbor;
    gunId = id;
    rifle.scale.set(s[0], s[1], s[2]);
    rifle.position.set(s[3], s[4], s[5]);
  }

  group.userData.team = team;
  group.userData.hue = hue;
  group.userData.name = name;
  return {
    group,
    parts: { head, torso, legs, vest, rifle, arms },
    hitMeshes: [head, torso, vest, legs],
    setGun,
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
    stuck: 0,
    watchT: 0,
    watchX: 0,
    watchZ: 0,
    sideTimer: 0,
    side: 1,
    mode: '',
    trace: '',
    pathKey: '',
    strafe: random() > 0.5 ? 1 : -1,
    strafeTimer: 0,
    burst: 0,
    burstCooldown: 0,
    thinkTimer: random() * 0.2,
    plantTimer: 0,
    defuseTimer: 0,
    hasBomb: false,
    frags: 0,
    lastSeenAt: -99,
    aiming: new THREE.Vector3(),
    aimError: 0,
    kills: 0,
    deaths: 0,
    recoilControl: 0.35 + skill * 0.5,
  };
  for (const mesh of model.hitMeshes) mesh.userData.bot = bot;

  const eye = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const otherEye = new THREE.Vector3();
  const shotEye = new THREE.Vector3();
  const shotDir = new THREE.Vector3();
  const aimPoint = new THREE.Vector3();
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
        ? other.eyePosition(otherEye)
        : otherEye.set(other.body.state.position.x, other.body.state.position.y + 1.2, other.body.state.position.z);
      if (canSee(world, point, other)) {
        found.push({ other, x: point.x, y: point.y, z: point.z, distance: point.distanceTo(eye) });
      }
    }
    found.sort((a, b) => a.distance - b.distance);
    return found;
  }


  /** Head straight for a point; returns true when it is close enough to stand on. */
  function goTo(destination, dt) {
    const dx = destination.x - body.state.position.x;
    const dz = destination.z - body.state.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.9) {
      bot.moveDir = null;
      return true;
    }
    const desired = Math.atan2(-dx, -dz);
    let delta = desired - body.state.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    body.state.yaw += delta * Math.min(1, dt * 7);
    bot.moveDir = { x: dx / distance, z: dz / distance };
    return false;
  }

  /**
   * Get to a point. A clear line is walked directly; anything behind a building goes through the
   * navigation lattice, one node at a time, so a defender can walk around the warehouse instead
   * of leaning on its north wall for the whole round.
   */
  function travel(destination, dt) {
    const pos = body.state.position;
    const straight = Math.hypot(destination.x - pos.x, destination.z - pos.z);
    if (straight < 0.9) {
      bot.moveDir = null;
      bot.path = null;
      return true;
    }
    if (clearLine(world, pos, destination)) {
      bot.path = null;
      bot.mode = 'straight';
      return goTo(destination, dt);
    }
    const key = `${Math.round(destination.x)}:${Math.round(destination.z)}`;
    bot.pathAge += dt;
    if (!bot.path || bot.pathKey !== key || bot.pathAge > 5) {
      bot.path = findPath(world, pos, destination);
      bot.pathKey = key;
      bot.pathAge = 0;
      bot.waypoint = 0;
    }
    if (!bot.path || bot.path.length === 0) return goTo(destination, dt);
    while (
      bot.waypoint < bot.path.length - 1 &&
      Math.hypot(bot.path[bot.waypoint].x - pos.x, bot.path[bot.waypoint].z - pos.z) < 1.1
    ) {
      bot.waypoint += 1;
    }
    if (bot.waypoint >= bot.path.length - 1) {
      bot.mode = 'last';
      return goTo(destination, dt);
    }
    bot.mode = `path ${bot.waypoint}/${bot.path.length} → ${bot.path[bot.waypoint].x.toFixed(1)},${bot.path[bot.waypoint].z.toFixed(1)}`;
    goTo(bot.path[bot.waypoint], dt);
    return false;
  }


  function stopMoving() {
    bot.moveDir = null;
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
    const reach = Math.hypot(point.x - body.state.position.x, point.z - body.state.position.z);
    const cone = weapon.fire(speedRatio, ctx.random);
    if (!cone) return;
    const eyePos = body.eyePosition(shotEye);
    const dir = shotDir.set(point.x - eyePos.x, point.y - eyePos.y, point.z - eyePos.z).normalize();
    // Its own aim error: tight up close, loose across the yard, worse for a poor shot.
    const reachSpread = 0.004 + reach * 0.0006 * (1.8 - bot.skill);
    const roll = ctx.random() * Math.PI * 2;
    const radius = Math.sqrt(ctx.random()) * reachSpread;
    dir.applyAxisAngle(AXIS_X, cone.pitch + Math.cos(roll) * radius);
    dir.applyAxisAngle(AXIS_Y, cone.yaw + Math.sin(roll) * radius);
    raycaster.set(eyePos, dir);
    raycaster.far = weapon.state.def.range;
    const hits = raycaster.intersectObjects(ctx.hitTargets, false);
    ctx.audio.shot(
      weapon.state.def.sound,
      ctx.audio.panFor(eyePos.x - ctx.listener.x, eyePos.z - ctx.listener.z, ctx.listener.yaw),
      Math.hypot(eyePos.x - ctx.listener.x, eyePos.z - ctx.listener.z),
    );
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
  const EMPTY_KEYS = new Set();

  /** Turn the bot's wish into the keys the shared movement code reads, then move the body. */
  function integrate(dt) {
    const keys = new Set();
    if (bot.moveDir && !Number.isFinite(bot.moveDir.x + bot.moveDir.z)) bot.moveDir = null;
    if (bot.moveDir) {
      const sin = Math.sin(body.state.yaw);
      const cos = Math.cos(body.state.yaw);
      // yaw 0 looks down -Z, right is +X (player.js): project the wish onto that frame.
      const fwd = -sin * bot.moveDir.x - cos * bot.moveDir.z;
      const right = cos * bot.moveDir.x - sin * bot.moveDir.z;
      if (fwd > 0.25) keys.add('KeyW');
      else if (fwd < -0.25) keys.add('KeyS');
      if (right > 0.25) keys.add('KeyD');
      else if (right < -0.25) keys.add('KeyA');
    }
    // CS habits: go quiet near the enemy, and crouch to tighten the spray.
    if (bot.wantWalk) keys.add('ShiftLeft');
    if (bot.wantCrouch) keys.add('KeyC');
    body.step(dt, keys.size ? keys : EMPTY_KEYS);
  }

  function unstick(dt) {
    // A body that wants to move but barely does is pushing a wall: slide along it instead of
    // leaning on it for the rest of the round.
    bot.watchT += dt;
    if (bot.watchT >= 0.7) {
      const moved = Math.hypot(body.state.position.x - bot.watchX, body.state.position.z - bot.watchZ);
      if (bot.moveDir && moved < 0.4) {
        bot.sideTimer = 0.75;
        bot.side *= -1;
      }
      bot.watchX = body.state.position.x;
      bot.watchZ = body.state.position.z;
      bot.watchT = 0;
    }
    if (bot.sideTimer > 0) {
      bot.sideTimer -= dt;
      if (bot.moveDir) {
        const px = -bot.moveDir.z * bot.side;
        const pz = bot.moveDir.x * bot.side;
        bot.moveDir = { x: bot.moveDir.x * 0.3 + px, z: bot.moveDir.z * 0.3 + pz };
      }
    }
  }

  function step(dt, ctx) {
    if (!bot.alive) return;
    // If the body ends up inside a wall (spawn overlap, a shove), put it back on the lattice.
    const here = body.state.position;
    if (world.blockedAt(here.x, here.z, 0.42)) {
      const id = world.nav.at(here.x, here.z);
      if (id >= 0) {
        const node = world.nav.nodes[id];
        body.state.position.set(node.x, 0, node.z);
        body.state.velocity.set(0, 0, 0);
        bot.path = null;
        bot.stuck = 0;
      }
    }
    bot.moveDir = null;
    think(dt, ctx);
    unstick(dt);
    integrate(dt);
  }

  function think(dt, ctx) {
    bot.trace = 'start';
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
      bot.seenCount = seen.length;
      if (seen.length) {
        bot.target = seen[0].other;
        bot.aiming.set(seen[0].x, seen[0].y, seen[0].z);
        bot.lastSeen = { x: seen[0].x, y: seen[0].y, z: seen[0].z };
        bot.lastSeenAt = ctx.time;
        bot.targetSeenAt = ctx.time;
        if (bot.reaction <= 0) bot.reaction = (1 - bot.skill) * 0.5 + 0.18;
      } else {
        bot.target = null;
      }
    }

    if (bot.reaction > 0) bot.reaction -= dt;

    // Freeze time: everyone stands at their spawn and waits for the whistle.
    if (ctx.phase && ctx.phase !== 'live') {
      stopMoving();
      bot.state = 'ready';
      return;
    }

    // Soldier habits (the CS 1.6 ones)
    bot.wantWalk = false;
    bot.wantCrouch = false;
    if (bot.wantRetreat) {
      bot.wantRetreat = false;
      bot.retreatUntil = ctx.time + 2.2;
    }
    const recentSighting = bot.lastSeen && ctx.time - bot.targetSeenAt < 2.5;
    if (recentSighting) bot.wantWalk = true; // do not sprint into a fight you already heard
    bot.retreating = bot.retreatUntil > ctx.time;
    if (bot.retreating) {
      // Hurt badly: give ground, but keep the rifle up — turning your back is how you die.
      bot.state = 'retreat';
      const away = bot.lastSeen ?? {
        x: body.state.position.x + Math.sin(body.state.yaw) * 4,
        z: body.state.position.z + Math.cos(body.state.yaw) * 4,
      };
      const dx = body.state.position.x - away.x;
      const dz = body.state.position.z - away.z;
      const d = Math.hypot(dx, dz) || 1;
      bot.moveDir = { x: dx / d, z: dz / d };
      bot.wantWalk = false;
      if (!bot.target || !bot.target.alive) return; // nothing to shoot at: just leave
    }

    // Combat
    if (bot.target && bot.target.alive) {
      const targetEye = bot.target.eyePosition
        ? bot.target.eyePosition(otherEye)
        : otherEye.set(bot.target.body.state.position.x, bot.target.body.state.position.y + 1.2, bot.target.body.state.position.z);
      // Aim at the chest, and let the cone do the rest; better bots lead higher.
      aimPoint.copy(targetEye);
      aimPoint.y -= 0.46 - bot.skill * 0.12;
      aimAt(aimPoint, dt, ctx);

      // Positioning: walk the fight into range, give ground when someone is in your face, and
      // shuffle sideways between bursts. Standing still to trade shots is a duelling rule.
      const tpos = bot.target.body.state.position;
      const gap = Math.hypot(tpos.x - body.state.position.x, tpos.z - body.state.position.z) || 1;
      if (bot.retreating) {
        // Keep the retreat vector, keep aiming, keep firing.
        bot.wantCrouch = false;
      } else {
      stopMoving();
      if (bot.strafeTimer <= 0) {
        bot.strafeTimer = 0.4 + ctx.random() * 0.7;
        bot.strafe *= -1;
      }
      // A crouched rifle is a steadier rifle; a reloading one is a reason to step back.
      if (gap > 9 && bot.skill > 0.4 && weapon.state.mag > 0) bot.wantCrouch = true;
      if (weapon.state.reloading > 0 || weapon.state.mag === 0) {
        bot.moveDir = { x: -(tpos.x - body.state.position.x) / gap, z: -(tpos.z - body.state.position.z) / gap };
      } else if (gap > 24) {
        // Out of useful range: close the distance, and do not waste the magazine doing it.
        bot.moveDir = { x: (tpos.x - body.state.position.x) / gap, z: (tpos.z - body.state.position.z) / gap };
      } else if (gap < 6.5) {
        // Muzzle to muzzle: take a step back so the rifle has room.
        bot.moveDir = { x: -(tpos.x - body.state.position.x) / gap, z: -(tpos.z - body.state.position.z) / gap };
      } else if (weapon.state.cooldown > 0.02 && bot.skill > 0.4) {
        // Shuffle sideways between bursts, in the body's own frame.
        const side = bot.strafe * (0.35 + bot.skill * 0.4);
        bot.moveDir = { x: Math.cos(body.state.yaw) * side, z: -Math.sin(body.state.yaw) * side };
      }
      }

      // A planted charge outranks the duel: keep the sights on the target, but walk the fight to
      // the bomb instead of trading shots from across the room while the fuse burns.
      if (ctx.bomb && ctx.bomb.state === 'planted') {
        const toBomb = Math.hypot(ctx.bomb.x - body.state.position.x, ctx.bomb.z - body.state.position.z);
        if (toBomb > 2.2) {
          bot.moveDir = {
            x: (ctx.bomb.x - body.state.position.x) / toBomb,
            z: (ctx.bomb.z - body.state.position.z) / toBomb,
          };
        }
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
      bot.state = bot.retreating ? 'retreat' : 'engage';
      bot.trace = 'combat';
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

    // A frag into the last place an enemy was seen: the answer to a corner you cannot look into,
    // and the reason a bot that vanishes behind cover is not automatically safe.
    if (bot.frags > 0 && !bot.target && bot.lastSeen && ctx.throwFrag) {
      const age = ctx.time - bot.lastSeenAt;
      const dx = bot.lastSeen.x - body.state.position.x;
      const dz = bot.lastSeen.z - body.state.position.z;
      const reach = Math.hypot(dx, dz);
      if (age < 4 && reach > 6 && reach < 19 && ctx.random() < 0.04) {
        const lift = Math.min(0.55, reach / 42);
        ctx.throwFrag(body.state.position.x, body.state.position.y + 1.35, body.state.position.z, dx / reach, lift, dz / reach);
        bot.frags -= 1;
        bot.trace = 'frag';
      }
    }

    // Objective
    const bomb = ctx.bomb;
    if (bomb && bomb.state === 'planted') {
      if (bot.team === 'warden') {
        const site = bomb.site;
        if (Math.hypot(body.state.position.x - bomb.x, body.state.position.z - bomb.z) < 1.7) {
          stopMoving();
          bot.state = 'defuse';
          bot.defuseTimer += dt;
          if (bot.defuseTimer > 6.5) ctx.onDefused?.(bot);
          return;
        }
        if (!travel({ x: bomb.x, z: bomb.z }, dt)) {
          bot.state = 'retake';
          return;
        }
        bot.state = 'defuse';
        bot.defuseTimer += dt;
        if (bot.defuseTimer > 6.5) ctx.onDefused?.(bot);
        return;
      }
      // Attackers hold the site they just took.
      const hold = ctx.holdPoint ?? { x: bomb.x + 4, z: bomb.z + 5 };
      if (!travel(hold, dt)) {
        // still walking to the post
      } else {
        stopMoving();
        // Watch the most likely entrance.
        const watch = ctx.watchPoint ?? { x: bomb.x, z: bomb.z + 14 };
        const desiredYaw = Math.atan2(-(watch.x - body.state.position.x), -(watch.z - body.state.position.z));
        let delta = desiredYaw - body.state.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        body.state.yaw += delta * Math.min(1, dt * 3);
      }
      bot.state = 'hold';
      bot.trace = 'bomb-hold';
      return;
    }

    // Carrying the charge: go to the assigned site and plant.
    if (bot.hasBomb && ctx.site) {
      const site = ctx.site;
      const near = Math.hypot(body.state.position.x - site.x, body.state.position.z - site.z) < site.radius - 1;
      if (near) {
        stopMoving();
        bot.state = 'plant';
        bot.plantTimer += dt;
        if (bot.plantTimer > 3.2) ctx.onPlanted?.(bot, site);
        bot.trace = 'planting';
        return;
      }
      if (!travel({ x: site.x, z: site.z }, dt)) {
        bot.state = 'advance';
        return;
      }
      bot.state = 'plant';
      bot.plantTimer += dt;
      if (bot.plantTimer > 3.2) ctx.onPlanted?.(bot, site);
      return;
    }

    // Movement
    // A CS bot does not sprint out of spawn alone: it lets the squad form, then pushes.
    if (ctx.attacking && ctx.liveAge !== undefined && ctx.liveAge < bot.pushDelay) {
      stopMoving();
      bot.state = 'stage';
      body.state.yaw += Math.sin(ctx.time * 1.4 + bot.skill * 6) * dt * 0.5;
      return;
    }
    const destination = ctx.objective;
    bot.trace = 'move';
    const arrived = travel(destination, dt);
    if (arrived) {
      stopMoving();
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
    bot.health = Math.max(0, bot.health - amount);
    if (bot.health <= 0) {
      bot.alive = false;
      bot.deaths += 1;
      if (attacker) attacker.kills = (attacker.kills ?? 0) + 1;
      return true;
    }
    // Below a third of your health a CS bot disengages; so does this one.
    if (bot.health < 35 && bot.health + amount >= 35) bot.wantRetreat = true;
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

  function syncModel(dt = 0) {
    const s = body.state;
    model.group.position.set(s.position.x, s.position.y, s.position.z);
    model.group.rotation.y = s.yaw;
    model.group.updateMatrixWorld(true);
    if (!bot.alive) {
      // A body goes down: it tips over on its side, bounces once and settles.
      bot.deathT = Math.min(2, (bot.deathT ?? 0) + dt);
      const fall = Math.min(1, bot.deathT / 0.55);
      const eased = 1 - (1 - fall) * (1 - fall);
      model.group.rotation.z = (Math.PI / 2) * eased * bot.deathSide;
      model.group.rotation.x = 0.22 * eased;
      model.group.position.y = s.position.y + 0.18 * eased + Math.sin(fall * Math.PI) * 0.14;
      model.group.scale.set(1, 1, 1);
      model.group.visible = true;
      return;
    }
    bot.deathT = 0;
    // Crouch squashes the model.
    const squash = 1 - s.crouch * 0.28;
    model.group.scale.set(1, squash, 1);
  }

  function reset(spawnPoint) {
    body.reset({ ...spawnPoint, team });
    bot.health = 100;
    bot.alive = true;
    bot.armour = 0; // the shop fits the vest now, not the spawn
    bot.state = 'advance';
    bot.target = null;
    bot.lastSeen = null;
    bot.path = null;
    bot.pathAge = 99;
    bot.waypoint = 0;
    bot.stuck = 0;
    bot.plantTimer = 0;
    bot.defuseTimer = 0;
    bot.deathT = 0;
    bot.retreatUntil = 0;
    bot.wantRetreat = false;
    bot.hasBomb = false;
    bot.burst = 0;
    bot.reaction = 0;
    bot.aimError = 1;
    model.group.rotation.z = 0;
    model.group.rotation.x = 0;
    model.group.scale.set(1, 1, 1);
    weapon.refill();
    model.setGun(weapon.state.def.id);
    syncModel();
  }

  // Deterministic roll direction, so a body always falls the same way for the same bot.
  bot.deathSide = name.length % 2 === 0 ? 1 : -1;
  // Staggered so the squad leaves spawn in a trickle, not a stampede.
  bot.pushDelay = 1.6 + (options.index ?? 0) * 0.45;
  syncModel();
  // The same object the closure mutates: a copy would freeze alive, health, path and hasBomb
  // at their spawn values for whoever holds the reference.
  return Object.assign(bot, {
    body,
    model,
    weapon,
    pref: weaponId,
    step,
    hurt,
    reset,
    syncModel,
    eyePosition: (out) => body.eyePosition(out),
  });
}
