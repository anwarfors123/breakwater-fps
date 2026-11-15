// Boot, the one loop, and the player's half of the fight.
//
// The loop is fixed-step: the simulation advances in sixtieths of a second no matter what the
// display does, so a bot's burst and a player's spray land the same on a 60 Hz laptop and a
// 240 Hz monitor. Rendering runs at whatever the browser gives us.
//
// ?shot=start|play|objective|end with &seed=N puts the game in a deterministic pose and freezes
// it, which is how the screenshots in this repository were taken.

import * as THREE from 'three';
import { PALETTE, rgb } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createBody } from './player.js';
import { createWeapon, WEAPONS, ARMOUR, freshAmmo, resolveDamage } from './weapons.js';
import { createBot } from './bots.js';
import { createMatch, PHASE, ROUND_CONSTANTS } from './match.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

// ── Renderer ────────────────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(rgb('canvas').r, rgb('canvas').g, rgb('canvas').b);
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.04, 200);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const audio = createAudio();
const match = createMatch({ audio, random, sites: world.sites });

// ── The player ──────────────────────────────────────────────────────────────────────────────
const spawnPoint = world.spawns.dock[2];
const body = createBody(world.colliders, { ...spawnPoint, team: 'dock' });
let weapon = createWeapon(WEAPONS.tally);
let hasPrimary = false;
const playerActor = {
  team: 'dock',
  name: 'You',
  alive: true,
  body,
  weapon,
  armour: 0,
  kills: 0,
  deaths: 0,
  eyePosition: () => body.eyePosition(),
  isPlayer: true,
};

// ── The bots: four teammates and five opponents ────────────────────────────────────────────
const BOT_NAMES_DOCK = ['Kestrel', 'Marlow', 'Pike', 'Rook'];
const BOT_NAMES_WARDEN = ['Halyard', 'Cinder', 'Dray', 'Voss', 'Tarn'];
const bots = [];
BOT_NAMES_DOCK.forEach((name, index) => {
  bots.push(
    createBot(scene, world, {
      team: 'dock',
      name,
      spawn: world.spawns.dock[index],
      skill: 0.46 + index * 0.06,
      weaponId: index === 0 ? 'harbor' : 'skiff',
      random,
    }),
  );
});
BOT_NAMES_WARDEN.forEach((name, index) => {
  bots.push(
    createBot(scene, world, {
      team: 'warden',
      name,
      spawn: world.spawns.warden[index],
      skill: 0.5 + index * 0.055,
      weaponId: index % 2 === 0 ? 'harbor' : 'skiff',
      random,
    }),
  );
});

let actors = [playerActor, ...bots];

// ── The view model: a rifle in the corner of the eye ───────────────────────────────────────
const viewModel = new THREE.Group();
camera.add(viewModel);
const gunBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.09, 0.1, 0.62),
  new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.55, metalness: 0.45 }),
);
gunBody.position.set(0.19, -0.17, -0.42);
const gunBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8),
  new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.4, metalness: 0.7 }),
);
gunBarrel.rotation.x = Math.PI / 2;
gunBarrel.position.set(0.19, -0.145, -0.72);
const gunMag = new THREE.Mesh(
  new THREE.BoxGeometry(0.06, 0.16, 0.1),
  new THREE.MeshStandardMaterial({ color: 0x2e343b, roughness: 0.7 }),
);
gunMag.position.set(0.19, -0.28, -0.44);
const gunHand = new THREE.Mesh(
  new THREE.BoxGeometry(0.11, 0.12, 0.2),
  new THREE.MeshStandardMaterial({ color: 0x8d6f52, roughness: 0.9 }),
);
gunHand.position.set(0.19, -0.24, -0.3);
for (const part of [gunBody, gunBarrel, gunMag, gunHand]) {
  part.castShadow = false;
  part.receiveShadow = false;
  viewModel.add(part);
}
const muzzleFlash = new THREE.PointLight(0xffd9a0, 0, 9, 2);
muzzleFlash.position.set(0.19, -0.14, -0.9);
camera.add(muzzleFlash);

// ── Round bookkeeping ──────────────────────────────────────────────────────────────────────
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
const forward = new THREE.Vector3();
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;
let frozen = false;
let started = false;
let dead = false;
let bannerCooldown = 0;
let buyOpen = false;
let lastPhase = null;

function hitTargets() {
  const meshes = world.shootables.slice();
  for (const bot of bots) {
    if (bot.alive) meshes.push(...bot.hitMeshes);
  }
  return meshes;
}

function syncCamera() {
  const s = body.state;
  camera.position.set(s.position.x, s.position.y + s.eye + s.bob, s.position.z);
  camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
}

/** Place everyone at their spawns and start a fresh round. */
function beginRound() {
  const playerTeam = match.state.playerTeam;
  const playerSpawnList = world.spawns[playerTeam];
  body.reset({ ...playerSpawnList[2], team: playerTeam });
  playerActor.team = playerTeam;
  playerActor.alive = true;
  playerActor.armour = 0;
  dead = false;
  weapon = createWeapon(WEAPONS.tally);
  playerActor.weapon = weapon;
  hasPrimary = false;
  weapon.refill();

  const dockBots = bots.filter((b) => b.team === 'dock');
  const wardenBots = bots.filter((b) => b.team === 'warden');
  dockBots.forEach((b, i) => b.reset(world.spawns.dock[i]));
  wardenBots.forEach((b, i) => b.reset(world.spawns.warden[i]));

  // Give the bots a weapon they could have afforded, so the economy is legible from outside.
  const money = match.state.teamMoney;
  for (const b of bots) {
    const budget = money[b.team];
    const pick = budget >= 4000 ? 'harbor' : budget >= 1800 ? 'skiff' : 'tally';
    b.weapon.state.def = WEAPONS[pick];
    b.weapon.refill();
  }

  // One attacker carries the charge.
  const carrier = dockBots[Math.floor(random() * dockBots.length)];
  for (const b of bots) b.hasBomb = false;
  if (carrier) carrier.hasBomb = true;
  playerActor.hasBomb = false;

  match.state.pendingSite = match.pickSite();
  match.beginFreeze();
  hud.banner(`Round ${match.state.round}`, 'phase', 2.2);
  syncCamera();
}

// ── Shooting ───────────────────────────────────────────────────────────────────────────────
function playerShoot() {
  if (!playerActor.alive) return;
  const speedRatio = Math.min(1, body.state.speed / 5.7);
  const cone = weapon.fire(speedRatio, random);
  if (!cone) {
    if (weapon.state.mag === 0) audio.dryFire();
    return;
  }
  camera.getWorldDirection(forward);
  forward.applyAxisAngle(new THREE.Vector3(1, 0, 0), cone.pitch);
  forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), cone.yaw);
  forward.normalize();
  // The shot is fired from the eye, then the body takes the kick.
  const origin = body.eyePosition(new THREE.Vector3());
  raycaster.set(origin, forward);
  raycaster.far = weapon.state.def.range;
  scene.updateMatrixWorld(true);
  const hits = raycaster.intersectObjects(hitTargets(), false);
  audio.shot(weapon.state.def.sound);
  muzzleFlash.intensity = 4.2;
  viewModel.position.z = 0.055;
  body.addRecoil(cone.pitch * 0.55, cone.yaw * 0.5);

  const first = hits[0];
  if (!first) return;
  const victim = first.object.userData.bot;
  if (!victim || victim.team === playerActor.team) {
    audio.impact();
    return;
  }
  const headshot = first.object === victim.parts.head || first.object.userData.part === 'head';
  const result = resolveDamage(weapon.state.def, victim.armour, headshot, first.distance);
  victim.armour = Math.max(0, victim.armour - result.armourLoss);
  const lethal = victim.hurt(result.damage, headshot, playerActor);
  playerActor.kills += lethal ? 1 : 0;
  hud.hitMarker(lethal);
  audio.hit(lethal);
  if (lethal) {
    match.onKill(playerActor.team, victim.team, victim.name, 'You', weapon.state.def.name, headshot);
    hud.feed(`You ▸ ${victim.name}`, { headshot, weaponName: weapon.state.def.name, attackerTeam: playerActor.team });
  }
  hud.setVitals(body.state.health, playerActor.armour);
}

/** Damage the player takes, from any bot. */
function hurtPlayer(amount, headshot, attacker) {
  if (!playerActor.alive) return;
  let left = amount;
  if (playerActor.armour > 0) {
    const absorbed = Math.min(playerActor.armour, left * 0.5);
    playerActor.armour -= absorbed;
    left -= absorbed * 0.55;
  }
  body.state.health -= left;
  hud.setVitals(body.state.health, playerActor.armour);
  hud.hitMarker(false);
  if (body.state.health <= 0) {
    playerActor.alive = false;
    dead = true;
    playerActor.deaths += 1;
    match.onKill(attacker.team, playerActor.team, 'You', attacker.name, attacker.weapon.state.def.name, headshot);
    hud.feed(`${attacker.name} ▸ You`, { headshot, weaponName: attacker.weapon.state.def.name, attackerTeam: attacker.team });
    hud.banner('You are down', 'lose', 3);
    input.exitLock();
  }
}

// ── Buying ─────────────────────────────────────────────────────────────────────────────────
const BUY_LIST = [
  { ...WEAPONS.tally, key: '1' },
  { ...WEAPONS.skiff, key: '2' },
  { ...WEAPONS.harbor, key: '3' },
  { ...WEAPONS.longline, key: '4' },
];

function tryBuy(id) {
  const outcome = match.buy(id, hasPrimary);
  if (!outcome.ok) {
    hud.buyHint(outcome.reason === 'not enough' ? 'Not enough money' : outcome.reason, 'bad');
    return;
  }
  if (outcome.kind === 'armour') {
    playerActor.armour = ARMOUR.points;
    hud.buyHint('Bastion vest fitted', 'good');
  } else {
    const def = WEAPONS[id];
    weapon = createWeapon(def);
    playerActor.weapon = weapon;
    hasPrimary = def.slot === 'primary' ? true : hasPrimary;
    hud.buyHint(`${def.name} in hand`, 'good');
  }
  hud.setMoney(match.state.playerMoney);
  hud.setVitals(body.state.health, playerActor.armour);
  audio.beep(1.1);
  hud.showBuy(BUY_LIST, match.state.playerMoney, playerActor.armour);
}

function openBuy() {
  if (match.state.phase !== PHASE.freeze && match.state.phase !== PHASE.live) return;
  buyOpen = true;
  hud.showBuy(BUY_LIST, match.state.playerMoney, playerActor.armour);
  hud.buyHint('Press a number to buy · B to close', '');
  if (document.pointerLockElement) input.exitLock();
}

function closeBuy() {
  buyOpen = false;
  hud.hideBuy();
}

// ── Objective interaction ──────────────────────────────────────────────────────────────────
let plantProgress = 0;
let defuseProgress = 0;

function objectiveTick(dt) {
  const state = match.state;
  const p = body.state.position;

  // Attacker with the charge, standing in a site: hold E to plant.
  if (state.phase === PHASE.live && playerActor.hasBomb && !state.bomb) {
    const site = world.sites.find((s) => Math.hypot(p.x - s.x, p.z - s.z) < s.radius);
    if (site) {
      if (input.state.keys.has('KeyE')) {
        plantProgress += dt;
        hud.setPrompt(`Planting at ${site.id} … ${Math.min(99, Math.round((plantProgress / ROUND_CONSTANTS.PLANT_SECONDS) * 100))}%`);
        if (plantProgress >= ROUND_CONSTANTS.PLANT_SECONDS) {
          match.plant(site, playerActor.team);
          playerActor.hasBomb = false;
          plantProgress = 0;
          hud.setPrompt('');
        }
      } else {
        plantProgress = Math.max(0, plantProgress - dt * 2);
        hud.setPrompt(`Hold E to plant the charge at ${site.id}`);
      }
      return;
    }
  }
  plantProgress = 0;

  // Defender near a planted charge: hold E to defuse.
  if (state.bomb && state.bomb.state === 'planted' && playerActor.team === 'warden') {
    const d = Math.hypot(p.x - state.bomb.x, p.z - state.bomb.z);
    if (d < 1.9) {
      if (input.state.keys.has('KeyE')) {
        defuseProgress += dt;
        hud.setPrompt(`Defusing … ${Math.min(99, Math.round((defuseProgress / ROUND_CONSTANTS.DEFUSE_SECONDS) * 100))}%`);
        if (defuseProgress >= ROUND_CONSTANTS.DEFUSE_SECONDS) {
          match.defuse(playerActor.team);
          defuseProgress = 0;
          hud.setPrompt('');
        }
      } else {
        defuseProgress = Math.max(0, defuseProgress - dt * 2);
        hud.setPrompt('Hold E to defuse');
      }
      return;
    }
  }
  defuseProgress = 0;
  hud.setPrompt('');
}

// ── The simulation tick ────────────────────────────────────────────────────────────────────
function step(dt) {
  elapsed += dt;
  const state = match.state;

  // Player movement, but only while the body is alive and not in the buy menu.
  if (playerActor.alive && !buyOpen) {
    const look = input.takeLook();
    body.look(look.x, look.y);
    body.step(dt, input.state.keys);
  } else if (playerActor.alive) {
    body.step(dt, new Set());
  }
  weapon.step(dt);

  if (input.state.firing && !buyOpen && playerActor.alive && weapon.ready()) playerShoot();

  // Everyone else.
  const ctxBase = {
    actors,
    world,
    audio,
    random,
    time: elapsed,
    hitTargets: hitTargets(),
    listener: { x: body.state.position.x, z: body.state.position.z, yaw: body.state.yaw },
    onDamage: (victim, amount, headshot, attacker) => {
      if (victim === playerActor) hurtPlayer(amount, headshot, attacker);
      else {
        victim.armour = Math.max(0, victim.armour - amount * 0.3);
        const lethal = victim.hurt(amount, headshot, attacker);
        if (lethal) {
          match.onKill(attacker.team, victim.team, victim.name, attacker.name, attacker.weapon.state.def.name, headshot);
          hud.feed(`${attacker.name} ▸ ${victim.name}`, {
            headshot,
            weaponName: attacker.weapon.state.def.name,
            attackerTeam: attacker.team,
          });
        }
      }
    },
    onPlanted: (bot, site) => {
      match.plant(site, bot.team);
      bot.hasBomb = false;
      hud.banner(`Charge planted at ${site.id}`, 'warn', 2.4);
    },
    onDefused: (bot) => {
      match.defuse(bot.team);
      hud.banner('Charge defused', 'win', 2.4);
    },
  };

  for (const bot of bots) {
    if (!bot.alive) continue;
    const attacking = bot.team === 'dock';
    const site = state.pendingSite ?? world.sites[0];
    const defendSpots = world.sites.map((s, i) => ({ x: s.x + (i ? 3.2 : -3.2), z: s.z + 3.4 }));
    const ctx = {
      ...ctxBase,
      site: attacking ? site : null,
      objective: attacking
        ? { x: site.x + (bot.team === 'dock' ? 1.5 : 0), z: site.z + 6 }
        : defendSpots[bots.indexOf(bot) % defendSpots.length],
      bomb: state.bomb,
      holdPoint: { x: site.x + 3.6, z: site.z + 4.6 },
      watchPoint: { x: site.x, z: site.z + 16 },
    };
    bot.step(dt, ctx);
    bot.syncModel();
  }

  objectiveTick(dt);
  match.step(dt, { actors });

  // The phase changed: tell the player once.
  if (state.phase !== lastPhase) {
    if (state.phase === PHASE.freeze && state.round > 1) {
      hud.banner(`Round ${state.round}`, 'phase', 2.2);
      beginRoundKeepPositions();
    }
    if (state.phase === PHASE.settle && state.lastWinner) {
      const mine = state.lastWinner === state.playerTeam;
      hud.banner(`${mine ? 'Round won' : 'Round lost'} — ${state.lastReason}`, mine ? 'win' : 'lose', 3);
    }
    if (state.phase === PHASE.over) {
      const mine = state.scores[state.playerTeam] > state.scores[state.playerTeam === 'dock' ? 'warden' : 'dock'];
      hud.banner(mine ? 'Match won' : 'Match lost', mine ? 'win' : 'lose', 6);
    }
    lastPhase = state.phase;
  }

  // HUD readouts.
  hud.setVitals(body.state.health, playerActor.armour);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.state.def.name, weapon.state.reloading > 0);
  hud.setMoney(match.state.playerMoney);
  const clockSeconds =
    state.phase === PHASE.live ? state.phaseTime : state.phase === PHASE.freeze ? state.phaseTime : state.bomb?.timer ?? state.phaseTime;
  hud.setClock(clockSeconds, state.phase === PHASE.freeze ? 'buy' : state.phase === PHASE.live ? (state.bomb?.state === 'planted' ? 'charge' : 'live') : state.phase);
  hud.setScores(state.scores.dock, state.scores.warden, state.round, state.playerTeam);
  hud.setSpread(weapon.cone(Math.min(1, body.state.speed / 5.7)), body.state.speed > 1.2);

  if (state.bomb?.state === 'planted' && playerActor.team === 'dock') {
    hud.setObjective(`Charge at ${state.bomb.site.id} — hold the site`, 'dock');
  } else if (playerActor.hasBomb) {
    hud.setObjective(`Carry the charge to ${state.pendingSite?.id ?? 'a site'}`, 'accent');
  } else if (state.bomb?.state === 'planted') {
    hud.setObjective(`Charge at ${state.bomb.site.id} — ${Math.ceil(state.bomb.timer)}s`, 'warn');
  } else {
    hud.setObjective('');
  }

  // Events the match emitted become the killfeed.
  while (state.events.length) {
    const event = state.events.shift();
    if (event.kind === 'kill') hud.feed(event.text, event);
  }

  // View model settles back after a shot.
  viewModel.position.z *= Math.max(0, 1 - dt * 12);
  viewModel.position.x = Math.sin(elapsed * 1.6) * 0.006 * Math.min(1, body.state.speed / 4);
  viewModel.position.y = Math.sin(elapsed * 3.2) * 0.005 * Math.min(1, body.state.speed / 4) - body.state.crouch * 0.03;
  muzzleFlash.intensity *= Math.max(0, 1 - dt * 22);

  // Respawn at the top of the next round if we died.
  if (dead && state.phase === PHASE.freeze) beginRound();
}

/** Keep positions but re-arm for the next round without re-randomising the carrier. */
function beginRoundKeepPositions() {
  if (dead) beginRound();
}

// ── Frame ──────────────────────────────────────────────────────────────────────────────────
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    hud.tick(dt);
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    audio.unlock();
  } else if (!buyOpen && playerActor.alive) {
    hud.showOverlay('Paused', 'Click to get back in. The round clock is still running.', 'Resume');
  }
}

hud.onOverlayClick(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.matchOver) {
    match.reset();
    beginRound();
  }
  input.requestLock();
});

// Buy menu keys and the scoreboard.
input.onKey((code) => {
  if (shot) return;
  if (code === 'KeyB') {
    if (buyOpen) closeBuy();
    else openBuy();
    return;
  }
  if (buyOpen) {
    const map = { Digit1: 'tally', Digit2: 'skiff', Digit3: 'harbor', Digit4: 'longline', Digit5: 'bastion' };
    if (map[code]) tryBuy(map[code]);
    if (code === 'Escape') closeBuy();
  }
});

// Buy menu clicks.
hud.el.buyGrid.addEventListener('click', (event) => {
  const button = event.target.closest('.buy-item');
  if (!button) return;
  tryBuy(button.dataset.weapon);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Deterministic poses for the screenshots ───────────────────────────────────────────────
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const p = body.state.position;
  const dx = point.x - p.x;
  const dy = point.y - (p.y + body.state.eye);
  const dz = point.z - p.z;
  body.state.yaw = Math.atan2(-dx, -dz);
  body.state.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  syncCamera();
}

function placeBotsAt(spec) {
  for (const [name, x, z, yaw] of spec) {
    const bot = bots.find((b) => b.name === name);
    if (!bot) continue;
    bot.body.state.position.set(x, 0, z);
    bot.body.state.yaw = yaw;
    bot.body.state.velocity.set(0, 0, 0);
    bot.syncModel();
  }
}

function runShot(name) {
  hud.hideOverlay();
  match.state.phase = PHASE.live;
  match.state.phaseTime = 68;
  match.state.round = 7;
  match.state.scores = { dock: 3, warden: 3 };
  match.state.playerMoney = 4750;
  match.state.teamMoney = { dock: 6200, warden: 5400 };
  beginRound();
  match.state.phase = PHASE.live;
  match.state.phaseTime = 68;
  match.state.scores = { dock: 3, warden: 3 };
  match.state.round = 7;

  if (name === 'start') {
    // Freeze time, buy menu open, the yard ahead.
    match.state.phase = PHASE.freeze;
    match.state.phaseTime = 12;
    body.state.position.set(0, 0, 27.5);
    body.state.yaw = 0;
    body.state.pitch = -0.02;
    playerActor.armour = 100;
    weapon = createWeapon(WEAPONS.harbor);
    playerActor.weapon = weapon;
    hud.showBuy(BUY_LIST, match.state.playerMoney, 100);
    hud.buyHint('Press a number to buy · B to close', '');
    hud.setVitals(100, 100);
    hud.setMoney(match.state.playerMoney);
    hud.setScores(3, 3, 7, 'dock');
    hud.setClock(12, 'buy');
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, 'Harbor', false);
    hud.setObjective('Carry the charge to A', 'accent');
    placeBotsAt([
      ['Kestrel', -3.4, 25.2, 0.1],
      ['Marlow', 2.6, 24.6, -0.2],
      ['Pike', 5.2, 26.4, 0.3],
      ['Rook', -5.6, 26.8, -0.1],
      ['Halyard', -14, -6, Math.PI],
      ['Cinder', 15, -7, Math.PI],
    ]);
    syncCamera();
    paintTwiceThenReady();
    return;
  }

  if (name === 'play') {
    // Mid-round: the player has just entered mid and a Warden is holding the wall.
    body.state.position.set(-2.2, 0, 12.4);
    playerActor.armour = 100;
    weapon = createWeapon(WEAPONS.harbor);
    playerActor.weapon = weapon;
    weapon.state.mag = 21;
    placeBotsAt([
      ['Kestrel', -5.4, 4.2, 0.15],
      ['Marlow', 4.6, 6.2, -0.35],
      ['Pike', -8.5, -1.5, 0.5],
      ['Rook', 7.4, -2.5, -0.4],
      ['Halyard', 1.6, -1.2, Math.PI - 0.15],
      ['Cinder', -6.2, -4.5, Math.PI + 0.2],
      ['Dray', 9.5, -9.5, Math.PI],
      ['Voss', -16, -13, Math.PI / 2],
      ['Tarn', 17, -14, -Math.PI / 2],
    ]);
    const target = bots.find((b) => b.name === 'Halyard');
    aimAt(new THREE.Vector3(target.body.state.position.x, 1.35, target.body.state.position.z));
    settle(3);
    // Fire a burst so the muzzle flash and the hit marker are in the frame.
    for (let i = 0; i < 3; i += 1) {
      playerShoot();
      settle(4);
    }
    settle(1);
    hud.setVitals(72, 84);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, 'Harbor', false);
    hud.feed('Kestrel ▸ Tarn', { headshot: false, weaponName: 'Skiff', attackerTeam: 'dock' });
    hud.feed('You ▸ Dray', { headshot: true, weaponName: 'Harbor', attackerTeam: 'dock' });
    hud.setObjective('Charge at A — hold the site', 'dock');
    syncCamera();
    paintTwiceThenReady();
    return;
  }

  if (name === 'objective') {
    // The charge is down at A and the player is holding the doorway.
    const site = world.sites[0];
    match.plant(site, 'dock');
    match.state.bomb.timer = 24;
    body.state.position.set(-16.4, 0, 3.4);
    body.state.yaw = Math.PI + 0.12;
    body.state.pitch = -0.05;
    playerActor.armour = 62;
    weapon = createWeapon(WEAPONS.skiff);
    playerActor.weapon = weapon;
    weapon.state.mag = 17;
    placeBotsAt([
      ['Kestrel', -13.2, -6.4, Math.PI],
      ['Marlow', -19.5, -8.2, Math.PI - 0.3],
      ['Pike', -21.4, -16.4, Math.PI / 2],
      ['Rook', -9.6, -16.8, -Math.PI / 2],
      ['Halyard', -18.5, 1.6, 0.1],
      ['Cinder', -11.5, 0.4, -0.2],
    ]);
    settle(2);
    hud.setVitals(64, 62);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, 'Skiff', false);
    hud.setObjective('Charge at A — 24s', 'warn');
    hud.setPrompt('Hold E to defuse');
    hud.setMoney(1500);
    hud.setClock(24, 'charge');
    hud.feed('Pike ▸ Halyard', { headshot: true, weaponName: 'Skiff', attackerTeam: 'dock' });
    syncCamera();
    paintTwiceThenReady();
    return;
  }

  // end: the scoreboard, at the close of a round the player's side won.
  match.state.scores = { dock: 13, warden: 9 };
  match.state.round = 23;
  match.state.playerMoney = 8200;
  hud.banner('Dockers take the match', 'win', 8);
  hud.setVitals(100, 100);
  hud.setMoney(8200);
  hud.setScores(13, 9, 23, 'dock');
  hud.setClock(0, 'over');
  hud.setAmmo(30, 90, 'Harbor', false);
  const rows = [
    { name: 'You', team: 'dock', kills: 24, deaths: 11, alive: true, me: true },
    { name: 'Kestrel', team: 'dock', kills: 19, deaths: 14, alive: true },
    { name: 'Marlow', team: 'dock', kills: 17, deaths: 15, alive: false },
    { name: 'Pike', team: 'dock', kills: 14, deaths: 16, alive: true },
    { name: 'Rook', team: 'dock', kills: 11, deaths: 17, alive: false },
    { name: 'Halyard', team: 'warden', kills: 20, deaths: 15, alive: false },
    { name: 'Cinder', team: 'warden', kills: 16, deaths: 17, alive: false },
    { name: 'Dray', team: 'warden', kills: 15, deaths: 16, alive: true },
    { name: 'Voss', team: 'warden', kills: 13, deaths: 18, alive: false },
    { name: 'Tarn', team: 'warden', kills: 9, deaths: 19, alive: false },
  ];
  hud.showScoreboard(rows, match.state.scores);
  body.state.position.set(-2.2, 0, 12.4);
  body.state.yaw = 0;
  syncCamera();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// ── Go ─────────────────────────────────────────────────────────────────────────────────────
beginRound();
syncCamera();
hud.setMoney(match.state.playerMoney);
hud.setVitals(100, 0);
hud.setAmmo(weapon.state.mag, weapon.state.reserve, 'Tally', false);

if (shot) {
  runShot(shot);
} else {
  hud.showOverlay(
    'BREAKWATER',
    'A tactical FPS in three.js: five against five, a charge to plant, and a buy phase to spend your money in. Click to take the yard.',
    'Deploy',
  );
  requestAnimationFrame(frame);
}
