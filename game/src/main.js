// Boot, the one loop, and the player's half of the fight.
//
// The loop is fixed-step: the simulation advances in sixtieths of a second no matter what the
// display does, so a bot's burst and a player's spray land the same on a 60 Hz laptop and a
// 240 Hz monitor. Rendering runs at whatever the browser gives us.
//
// Every random choice goes through one seeded generator, so a given seed replays the same round.

import * as THREE from 'three';
import { PALETTE, rgb } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createBody } from './player.js';
import { createWeapon, WEAPONS, ARMOUR, GRENADE, freshAmmo, resolveDamage } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createViewmodel } from './viewmodel.js';
import { createBombModel } from './bomb.js';
import { findPath, createBot } from './bots.js';
import { createMatch, PHASE, ROUND_CONSTANTS, ECONOMY } from './match.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
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

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(rgb('canvas').r, rgb('canvas').g, rgb('canvas').b);
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.04, 200);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const audio = createAudio();
const match = createMatch({ audio, random, sites: world.sites });

// The player
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

// A first-person player has no model, which used to mean no hitbox: every bot bullet passed
// straight through. Two invisible boxes give them a chest and a head, hidden from the camera
// but solid to a raycast.
const proxyMaterial = new THREE.MeshStandardMaterial({ visible: false });
const proxyChest = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.02, 0.46), proxyMaterial);
proxyChest.position.y = 0.9;
const proxyHead = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), proxyMaterial);
proxyHead.position.y = 1.6;
const playerProxy = new THREE.Group();
playerProxy.add(proxyChest, proxyHead);
scene.add(playerProxy);
proxyChest.userData = { bot: playerActor, part: 'body' };
proxyHead.userData = { bot: playerActor, part: 'head' };
playerActor.hitMeshes = [proxyChest, proxyHead];
playerActor.parts = { head: proxyHead, body: proxyChest };

// The bots: four teammates and five opponents
const BOT_NAMES_DOCK = ['Kestrel', 'Marlow', 'Pike', 'Rook'];
const BOT_NAMES_WARDEN = ['Halyard', 'Cinder', 'Dray', 'Voss'];
// Who gets the sniper is fixed, so each squad plays the same way every match: one long rifle, one
// SMG, and rifles for the rest.
const DOCK_KITS = ['longline', 'harbor', 'skiff', 'harbor'];
const WARDEN_KITS = ['harbor', 'longline', 'skiff', 'harbor'];

const bots = [];
BOT_NAMES_DOCK.forEach((name, index) => {
  bots.push(
    createBot(scene, world, {
      team: 'dock',
      name,
      index,
      spawn: world.spawns.dock[index],
      skill: 0.46 + index * 0.06,
      weaponId: DOCK_KITS[index % 4],
      random,
    }),
  );
});
BOT_NAMES_WARDEN.forEach((name, index) => {
  bots.push(
    createBot(scene, world, {
      team: 'warden',
      name,
      index,
      spawn: world.spawns.warden[index],
      skill: 0.5 + index * 0.055,
      weaponId: WARDEN_KITS[index % 4],
      random,
    }),
  );
});

let actors = [playerActor, ...bots];

// Frag grenades
// A frag is the answer to a corner you cannot see into, and the only damage in the game that can
// be committed to before the target is visible. It does not reach through a wall: the same wall
// that hides a defender hides them from the blast, which is what makes holding a corner a plan.
let frags = 0;
let shake = 0;
const blastRay = new THREE.Raycaster();
const blastOrigin = new THREE.Vector3();
const blastDir = new THREE.Vector3();

function losClear(x0, y0, z0, x1, y1, z1) {
  blastOrigin.set(x0, y0, z0);
  blastDir.set(x1 - x0, y1 - y0, z1 - z0);
  const distance = blastDir.length();
  if (distance < 0.001) return true;
  blastDir.multiplyScalar(1 / distance);
  blastRay.set(blastOrigin, blastDir);
  blastRay.far = distance - 0.25;
  return blastRay.intersectObjects(world.shootables, false).length === 0;
}

/** Damage falls off with distance from the blast and stops at the first wall. */
function blast(x, y, z) {
  const radius = GRENADE.radius;
  for (const b of bots) {
    if (!b.alive) continue;
    const p = b.body.state.position;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > radius) continue;
    if (!losClear(x, y + 0.3, z, p.x, p.y + 1.1, p.z)) continue;
    b.hurt(GRENADE.damage * (1 - d / radius), false, playerActor);
  }
  if (playerActor.alive) {
    const p = body.state.position;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < radius && losClear(x, y + 0.3, z, p.x, p.y + 1.2, p.z)) {
      hurtPlayer(GRENADE.damage * (1 - d / radius), false, null);
    }
  }
  shake = Math.max(shake, 0.55);
}

const fragSystem = createGrenades({ scene, world, audio, onBlast: blast });

function throwFrag() {
  if (frags <= 0 || !playerActor.alive) return;
  const eye = body.eyePosition(new THREE.Vector3());
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  fragSystem.throwFrom(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z);
  frags -= 1;
  hud.setGrenades(frags);
}

// The view model: whatever you bought, in the corner of the eye
const viewmodel = createViewmodel(camera);
const bombModel = createBombModel(scene, audio);
let bombShown = false;
const muzzleFlash = new THREE.PointLight(0xffd9a0, 0, 9, 2);
const muzzlePoint = new THREE.Vector3();
camera.add(muzzleFlash);

// Minimap: the yard from above, so the sites are not a rumour
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas?.getContext('2d');
const MM = (() => {
  const b = world.bounds;
  const size = minimapCanvas?.width ?? 190;
  const pad = 7;
  const s = Math.min((size - pad * 2) / (b.maxX - b.minX), (size - pad * 2) / (b.maxZ - b.minZ));
  const ox = pad + ((size - pad * 2) - (b.maxX - b.minX) * s) / 2;
  const oz = pad + ((size - pad * 2) - (b.maxZ - b.minZ) * s) / 2;
  const mx = (wx) => ox + (wx - b.minX) * s;
  const mz = (wz) => oz + (wz - b.minZ) * s;

  // The yard never changes, so it is painted once into an offscreen layer.
  const layer = document.createElement('canvas');
  layer.width = layer.height = size;
  const g = layer.getContext('2d');
  g.fillStyle = 'rgba(27, 34, 41, .92)';
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(58, 70, 82, .95)';
  for (const c of world.colliders) {
    if (c.maxY <= 0.32 || c.minY >= 1.8) continue;
    const x0 = mx(c.minX);
    const x1 = mx(c.maxX);
    const z0 = mz(c.minZ);
    const z1 = mz(c.maxZ);
    if (x1 - x0 < 1.5 || z1 - z0 < 1.5) continue;
    g.fillRect(x0, z0, x1 - x0, z1 - z0);
  }
  for (const site of world.sites) {
    g.beginPath();
    g.arc(mx(site.x), mz(site.z), site.radius * s, 0, Math.PI * 2);
    g.fillStyle = 'rgba(242, 166, 59, .13)';
    g.fill();
    g.strokeStyle = 'rgba(242, 166, 59, .8)';
    g.lineWidth = 1.4;
    g.stroke();
    g.fillStyle = '#f2a63b';
    g.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(site.id, mx(site.x), mz(site.z));
  }
  return { mx, mz, size, layer };
})();

function drawMinimap() {
  if (!minimapCtx) return;
  const g = minimapCtx;
  g.clearRect(0, 0, MM.size, MM.size);
  g.drawImage(MM.layer, 0, 0);

  const bomb = match.state.bomb;
  if (bomb && bomb.state === 'planted') {
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 8);
    g.beginPath();
    g.arc(MM.mx(bomb.x), MM.mz(bomb.z), 3.5 + pulse * 3, 0, Math.PI * 2);
    g.fillStyle = `rgba(242, 166, 59, ${0.3 + pulse * 0.55})`;
    g.fill();
  }

  for (const bot of bots) {
    if (!bot.alive) continue;
    const mate = bot.team === playerActor.team;
    const p = bot.body.state.position;
    g.beginPath();
    g.arc(MM.mx(p.x), MM.mz(p.z), mate ? 3 : 2.6, 0, Math.PI * 2);
    g.fillStyle = mate ? 'rgba(200, 98, 47, .95)' : 'rgba(63, 143, 176, .95)';
    g.fill();
    if (bot.hasBomb) {
      g.strokeStyle = '#f2a63b';
      g.lineWidth = 1.5;
      g.stroke();
    }
  }

  // You: a wedge pointing where you look.
  const p = body.state.position;
  g.save();
  g.translate(MM.mx(p.x), MM.mz(p.z));
  g.rotate(-body.state.yaw);
  g.beginPath();
  g.moveTo(0, -7);
  g.lineTo(4.6, 5.2);
  g.lineTo(0, 2.8);
  g.lineTo(-4.6, 5.2);
  g.closePath();
  g.fillStyle = '#e8e4dc';
  g.fill();
  g.restore();
}

// Round bookkeeping
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
const forward = new THREE.Vector3();
const spectateEye = new THREE.Vector3();
// Both long guns aim: the rifle narrows the field of view, the long rifle adds the tube as well.
const SCOPES = { harbor: 52, longline: 26 };
const scopeEl = document.getElementById('scope');
const BASE_FOV = 78;
let aimBlend = 0;
let roundsPlayed = 0;
const LOOK_CEILING = 0.32; // radians a single tick may turn, ~18°
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;
let started = false;
let dead = false;
let bannerCooldown = 0;
let buyOpen = false;
let lastPhase = null;

/** The nearest point on the navigation lattice: every post the bots are sent to is walkable. */
function navPost(x, z) {
  const id = world.nav?.at(x, z);
  if (id == null || id < 0) return { x, z };
  const node = world.nav.nodes[id];
  return { x: node.x, z: node.z };
}

// Two target lists, rebuilt once a frame instead of once per shooter: you hit the world and the
// bots, a bot hits the world, the other bots and you. Nothing here allocates while the round runs.
const playerTargets = [];
const botTargets = [];

function refreshTargets() {
  playerTargets.length = 0;
  botTargets.length = 0;
  for (const mesh of world.shootables) {
    playerTargets.push(mesh);
    botTargets.push(mesh);
  }
  for (const b of bots) {
    if (!b.alive) continue;
    for (const mesh of b.hitMeshes) {
      playerTargets.push(mesh);
      botTargets.push(mesh);
    }
  }
  if (playerActor.alive) for (const mesh of playerActor.hitMeshes) botTargets.push(mesh);
}

function hitTargets() {
  return playerTargets;
}

let scopeVisible = false;

/**
 * Right button down: the eye goes to the scope. The field of view narrows, the mouse turns less per
 * pixel so the feel is the same, the cone tightens and the body slows — that is what makes stopping
 * to aim pay. Only the two long guns have a scope; the pistol and the SMG do nothing.
 */
function updateAim(dt) {
  const def = weapon.state.def;
  const scoped = SCOPES[def.id] !== undefined;
  const want = scoped && input.state.aiming && playerActor.alive && !buyOpen && weapon.state.reloading <= 0;
  aimBlend += ((want ? 1 : 0) - aimBlend) * Math.min(1, dt * 12);
  if (aimBlend < 0.002) aimBlend = 0;
  const fovTarget = scoped ? SCOPES[def.id] : BASE_FOV;
  const fov = BASE_FOV + (fovTarget - BASE_FOV) * aimBlend;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    input.state.sensitivity = 0.0022 * (fov / BASE_FOV);
  }
  // Only the long rifle draws a tube over the screen. The rifle just brings the world closer:
  // same narrowing, no optic, so you keep the whole picture while you aim.
  const show = def.id === 'longline' && aimBlend > 0.55;
  if (show !== scopeVisible) {
    scopeVisible = show;
    scopeEl.hidden = !show;
    document.body.classList.toggle('scoped', show);
  }
}

function syncCamera() {
  const s = body.state;
  // Dead: the camera sits in the watched bot's head and looks where they look.
  if (!playerActor.alive && spectateTarget && spectateTarget.alive) {
    const watched = spectateTarget;
    camera.position.copy(watched.eyePosition(spectateEye));
    camera.rotation.set(watched.body.state.pitch * 0.85, watched.body.state.yaw, 0, 'YXZ');
    playerProxy.visible = false;
    playerProxy.position.set(s.position.x, s.position.y, s.position.z);
    playerProxy.updateMatrixWorld(true);
    return;
  }
  camera.position.set(s.position.x, s.position.y + s.eye + s.bob, s.position.z);
  if (shake > 0.001) {
    // A blast you cannot feel is a bang, not a grenade: the view kicks and settles.
    camera.position.x += (random() - 0.5) * shake * 0.2;
    camera.position.y += (random() - 0.5) * shake * 0.16;
  }
  camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
  // Keep the hitbox where the camera is, and take it out of the world when you are down.
  playerProxy.position.set(s.position.x, s.position.y, s.position.z);
  playerProxy.rotation.y = s.yaw;
  playerProxy.scale.y = 1 - s.crouch * 0.3;
  playerProxy.visible = playerActor.alive;
  playerProxy.updateMatrixWorld(true);
}

/** What a bot's bullet can hit: the world, the other bots, and you. */
function botHitTargets() {
  return botTargets;
}

// A bot wants one class of gun and takes the best it can pay for on the way down to a pistol. The
// variety is the point: four bots with the same rifle read as one bot copied four times.
const PREF_LADDER = {
  longline: ['longline', 'harbor', 'skiff', 'tally'],
  harbor: ['harbor', 'skiff', 'tally'],
  skiff: ['skiff', 'tally'],
  tally: ['tally'],
};

/**
 * A bot shops from its team's wallet: the best gun on its ladder it can pay for, then a vest, then a
 * frag. `carried` is what a survivor already holds, so the team is not charged twice for one rifle —
 * and a survivor is not locked out of the shop either: a pistol from last round is what a buy phase
 * is for.
 */
function botShop(bot, wallet, carried) {
  const ladder = PREF_LADDER[bot.pref] || PREF_LADDER.harbor;
  let pick = 'tally';
  for (const id of ladder) {
    if (wallet.money >= WEAPONS[id].price) {
      pick = id;
      break;
    }
  }
  if (pick !== carried) {
    wallet.money -= WEAPONS[pick].price;
    bot.weapon.state.def = WEAPONS[pick];
    bot.weapon.refill();
    bot.model.setGun(pick);
  }
  if (bot.armour < ARMOUR.points && wallet.money >= ARMOUR.price) {
    wallet.money -= ARMOUR.price;
    bot.armour = ARMOUR.points;
  }
  if (bot.frags < 1 && wallet.money >= GRENADE.price) {
    wallet.money -= GRENADE.price;
    bot.frags = 1;
  }
}

function beginRound() {
  const playerTeam = match.state.playerTeam;
  const playerSpawnList = world.spawns[playerTeam];
  // Who lived through the last round keeps what they were carrying; who died starts over with a
  // pistol. That is the whole point of a buy phase: a rifle is an investment across rounds.
  const firstRound = roundsPlayed === 0;
  roundsPlayed += 1;
  const playerSurvived = !firstRound && playerActor.alive;
  const survived = new Map(
    (firstRound ? [] : bots.filter((b) => b.alive)).map((b) => [b.name, { armour: b.armour, frags: b.frags }]),
  );

  body.reset({ ...playerSpawnList[2], team: playerTeam });
  playerActor.team = playerTeam;
  playerActor.alive = true;
  spectateTarget = null;
  dead = false;
  if (!playerSurvived) {
    weapon = createWeapon(WEAPONS.tally);
    weapon.refill();
    hasPrimary = false;
    playerActor.armour = 0;
    frags = 0;
  }
  playerActor.weapon = weapon;
  viewmodel.setWeapon(weapon.state.def.id);
  fragSystem.reset();
  hud.setGrenades(frags);

  const dockBots = bots.filter((b) => b.team === 'dock');
  const wardenBots = bots.filter((b) => b.team === 'warden');
  dockBots.forEach((b, i) => b.reset(world.spawns.dock[i]));
  wardenBots.forEach((b, i) => b.reset(world.spawns.warden[i]));

  // The bots shop in the same freeze the player does, out of their team's wallet, best first: a
  // survivor keeps the rifle it bought, a body coming back from a death buys again.
  const wallet = { money: 0 };
  for (const team of ['dock', 'warden']) {
    wallet.money = match.state.teamMoney[team];
    const squad = bots.filter((b) => b.team === team).sort((a, b) => b.skill - a.skill);
    for (const b of squad) {
      const kept = survived.get(b.name);
      if (kept) {
        b.armour = kept.armour;
        b.frags = kept.frags;
      }
      botShop(b, wallet, kept ? b.weapon.state.def.id : null);
    }
    match.state.teamMoney[team] = wallet.money;
  }

  // The charge is yours when your side is attacking: a bot carrier that never reaches a site
  // leaves the round unfinishable, and planting is the player's job.
  for (const b of bots) b.hasBomb = false;
  playerActor.hasBomb = match.state.playerTeam === 'dock';
  if (!playerActor.hasBomb) {
    // You are defending this half: a bot takes the charge and the bots have to plant it.
    const carrier = bots.filter((b) => b.team === 'dock').sort((a, b) => b.skill - a.skill)[0];
    if (carrier) carrier.hasBomb = true;
  }

  match.state.pendingSite = match.pickSite();
  match.beginFreeze();
  hud.banner(`Round ${match.state.round} — buy ${Math.round(match.state.phaseTime)}s (B)`, 'phase', 2.4);
  syncCamera();
}

// Damage numbers
const damageLayer = document.getElementById('damage-layer');
const dmgVec = new THREE.Vector3();

/** Float the number over the actor that just took the hit. */
function popDamage(actor, amount, kind = '') {
  if (!damageLayer || amount <= 0) return;
  const p = actor.body?.state?.position;
  if (!p) return;
  dmgVec.set(p.x, p.y + 1.85, p.z);
  camera.updateMatrixWorld();
  dmgVec.project(camera);
  if (dmgVec.z > 1) return; // behind the camera
  const x = (dmgVec.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-dmgVec.y * 0.5 + 0.5) * window.innerHeight;
  const el = document.createElement('div');
  el.className = `dmg ${kind}`.trim();
  el.textContent = Math.round(amount);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  damageLayer.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

/** Damage you take has no body to hang over, so it lands under the crosshair. */
function popDamageTaken(amount) {
  if (!damageLayer || amount <= 0) return;
  const el = document.createElement('div');
  el.className = 'dmg taken';
  el.textContent = `-${Math.round(amount)}`;
  el.style.left = `${window.innerWidth / 2}px`;
  el.style.top = `${window.innerHeight * 0.58}px`;
  damageLayer.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// Shooting
function playerShoot() {
  if (!playerActor.alive) return;
  const speedRatio = Math.min(1, body.state.speed / 5.7);
  const cone = weapon.fire(speedRatio * (1 - 0.72 * aimBlend), random);
  if (!cone) {
    if (weapon.state.mag === 0) audio.dryFire();
    return;
  }
  camera.getWorldDirection(forward);
  forward.applyAxisAngle(AXIS_X, cone.pitch);
  forward.applyAxisAngle(AXIS_Y, cone.yaw);
  forward.normalize();
  // The shot is fired from the eye, then the body takes the kick.
  const origin = body.eyePosition(new THREE.Vector3());
  raycaster.set(origin, forward);
  raycaster.far = weapon.state.def.range;
  scene.updateMatrixWorld(true);
  const hits = raycaster.intersectObjects(hitTargets(), false);
  audio.shot(weapon.state.def.sound);
  muzzleFlash.intensity = 4.2;
  viewmodel.fire();
  viewmodel.muzzle(muzzlePoint);
  muzzleFlash.position.copy(muzzlePoint);
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
  popDamage(victim, result.damage, headshot ? 'head' : '');
  const lethal = victim.hurt(result.damage, headshot, playerActor);
  playerActor.kills += lethal ? 1 : 0;
  hud.hitMarker(lethal);
  audio.hit(lethal);
  if (lethal) {
    match.onKill(playerActor.team, victim.team, victim.name, 'You', weapon.state.def.name, headshot, true);
    hud.killNotice(victim.name, { headshot, reward: ECONOMY.kill, weapon: weapon.state.def.name });
    hud.setMoney(match.state.playerMoney);
  }
  hud.setVitals(body.state.health, playerActor.armour);
}

/** Pass the charge on: a carrier that dies must not leave the round unwinnable. */
function handOffCharge(fromActor) {
  const team = fromActor.team;
  fromActor.hasBomb = false;
  const heir = bots
    .filter((b) => b.team === team && b.alive)
    .sort(
      (a, b) =>
        Math.hypot(a.body.state.position.x - fromActor.body.state.position.x, a.body.state.position.z - fromActor.body.state.position.z) -
        Math.hypot(b.body.state.position.x - fromActor.body.state.position.x, b.body.state.position.z - fromActor.body.state.position.z),
    )[0];
  if (heir) {
    heir.hasBomb = true;
    hud.banner(`${heir.name} has the charge`, 'phase', 1.8);
  }
  return heir;
}

// Spectating: dead is not the end of the round
let spectateTarget = null;
let boardShown = false;
let boardRefresh = 0;

/** Everyone still standing, teammates first — you can watch either side once you are down. */
function spectateList() {
  const mates = bots.filter((b) => b.alive && b.team === playerActor.team);
  const foes = bots.filter((b) => b.alive && b.team !== playerActor.team);
  return [...mates, ...foes];
}

function cycleSpectate(dir = 1) {
  const list = spectateList();
  if (!list.length) {
    spectateTarget = null;
    return;
  }
  const index = list.indexOf(spectateTarget);
  spectateTarget = index === -1 ? list[0] : list[(index + dir + list.length) % list.length];
}

function beginSpectate() {
  spectateTarget = null;
  cycleSpectate(1);
  if (spectateTarget) hud.banner(`Spectating ${spectateTarget.name}`, 'phase', 2);
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
  popDamageTaken(left);
  body.state.health = Math.max(0, body.state.health - left);
  hud.setVitals(body.state.health, playerActor.armour);
  hud.hitMarker(false);
  if (body.state.health <= 0) {
    playerActor.alive = false;
    dead = true;
    playerActor.deaths += 1;
    if (playerActor.hasBomb) handOffCharge(playerActor);
    match.onKill(attacker.team, playerActor.team, 'You', attacker.name, attacker.weapon.state.def.name, headshot);
    hud.banner('You are down', 'lose', 3);
    input.exitLock();
    beginSpectate();
  }
}

// Buying
const BUY_LIST = [
  { ...WEAPONS.tally, key: '1' },
  { ...WEAPONS.skiff, key: '2' },
  { ...WEAPONS.harbor, key: '3' },
  { ...WEAPONS.longline, key: '4' },
];

function tryBuy(id) {
  const outcome = match.buy(id, hasPrimary, weapon.state.def.id);
  if (!outcome.ok) {
    hud.buyHint(outcome.reason === 'not enough' ? 'Not enough money' : outcome.reason, 'bad');
    return;
  }
  if (outcome.kind === 'armour') {
    playerActor.armour = ARMOUR.points;
    hud.buyHint('Bastion vest fitted', 'good');
  } else if (outcome.kind === 'grenade') {
    frags = Math.min(GRENADE.max, frags + 1);
    hud.setGrenades(frags);
    hud.buyHint('Frag in the pouch — G to throw', 'good');
  } else {
    const def = WEAPONS[id];
    weapon = createWeapon(def);
    playerActor.weapon = weapon;
    hasPrimary = def.slot === 'primary' ? true : hasPrimary;
    viewmodel.setWeapon(def.id);
    hud.buyHint(`${def.name} in hand`, 'good');
  }
  hud.setMoney(match.state.playerMoney);
  hud.setVitals(body.state.health, playerActor.armour);
  audio.beep(1.1);
  hud.showBuy(BUY_LIST, match.state.playerMoney, playerActor.armour, frags);
}

function openBuy() {
  if (match.state.phase !== PHASE.freeze && match.state.phase !== PHASE.live) return;
  buyOpen = true;
  hud.showBuy(BUY_LIST, match.state.playerMoney, playerActor.armour, frags);
  hud.buyHint('Press a number to buy · B to close', '');
  if (document.pointerLockElement) input.exitLock();
}

function closeBuy() {
  buyOpen = false;
  hud.hideBuy();
  // Leaving the menu must hand the mouse back, or the next thing you do is nothing.
  if (playerActor.alive) input.requestLock();
}

// Objective interaction
let plantProgress = 0;
let defuseProgress = 0;

function objectiveTick(dt) {
  const state = match.state;
  const p = body.state.position;

  // Dead: hand the screen to whoever is still standing.
  if (!playerActor.alive) {
    if (!spectateTarget || !spectateTarget.alive) cycleSpectate(1);
    hud.setPrompt(
      spectateTarget ? `Spectating ${spectateTarget.name} — click or A / D to switch` : 'Waiting for the next round',
    );
    return;
  }

  // Attacker with the charge, standing in a site: hold E to plant.
  if (state.phase === PHASE.live && playerActor.hasBomb && !state.bomb) {
    const site = world.sites.find((s) => Math.hypot(p.x - s.x, p.z - s.z) < s.radius);
    if (site) {
      if (input.state.keys.has('KeyE')) {
        plantProgress += dt;
        hud.setPrompt(`Planting at ${site.id} … ${Math.min(99, Math.round((plantProgress / ROUND_CONSTANTS.PLANT_SECONDS) * 100))}%`);
        if (plantProgress >= ROUND_CONSTANTS.PLANT_SECONDS) {
          match.plant(site, playerActor.team, body.state.position.x, body.state.position.z);
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

// The simulation tick
function step(dt) {
  elapsed += dt;
  const state = match.state;
  fragSystem.step(dt);
  world.tick(dt);
  if (shake > 0) shake = Math.max(0, shake - dt * 1.7);
  refreshTargets();

  updateAim(dt);

  // Player movement, but only while the body is alive and not in the buy menu.
  if (playerActor.alive && !buyOpen) {
    const look = input.takeLook();
    // One pixel of mouse is one fixed turn, applied the tick it arrives. The old damped follow
    // carried a share of every delta into later frames, so a stutter banked rotation and then spent
    // it at once: that is the "sensitivity suddenly spikes" report. A hard per-tick ceiling still
    // guards against a pointer-lock glitch reporting a 3000 px jump.
    body.look(
      Math.max(-LOOK_CEILING, Math.min(LOOK_CEILING, look.x)),
      Math.max(-LOOK_CEILING, Math.min(LOOK_CEILING, look.y)),
    );
    body.step(dt, input.state.keys, 1 - 0.45 * aimBlend);
  } else if (playerActor.alive) {
    body.step(dt, new Set());
  }
  weapon.step(dt);

  if (input.state.firing && !buyOpen && playerActor.alive && weapon.ready()) playerShoot();
  // A dry magazine reloads itself, the way every shooter since 1999 has taught us to expect.
  if (playerActor.alive && weapon.state.mag === 0 && weapon.state.reloading <= 0 && weapon.state.reserve > 0) {
    if (weapon.beginReload()) audio.reload(weapon.state.def.sound);
  }

  // Everyone else.
  const ctxBase = {
    actors,
    world,
    audio,
    random,
    time: elapsed,
    hitTargets: botHitTargets(),
    listener: { x: body.state.position.x, z: body.state.position.z, yaw: body.state.yaw },
    liveAge: state.phase === PHASE.live ? Math.max(0, ROUND_CONSTANTS.ROUND_SECONDS - state.phaseTime) : 0,
    phase: state.phase,
    onDamage: (victim, amount, headshot, attacker) => {
      if (victim === playerActor) hurtPlayer(amount, headshot, attacker);
      else {
        victim.armour = Math.max(0, victim.armour - amount * 0.3);
        const lethal = victim.hurt(amount, headshot, attacker);
        if (lethal) {
          match.onKill(attacker.team, victim.team, victim.name, attacker.name, attacker.weapon.state.def.name, headshot);
          if (victim.hasBomb) handOffCharge(victim);
        }
      }
    },
    onPlanted: (bot, site) => {
      match.plant(site, bot.team, bot.body.state.position.x, bot.body.state.position.z);
      bot.hasBomb = false;
      hud.banner(`Charge planted at ${site.id}`, 'warn', 2.4);
    },
    onDefused: (bot) => {
      match.defuse(bot.team);
      hud.banner('Charge defused', 'win', 2.4);
    },
    throwFrag: (x, y, z, dx, dy, dz) => fragSystem.throwFrom(x, y, z, dx, dy, dz),
  };

  for (const bot of bots) {
    if (!bot.alive) {
      bot.syncModel(dt);
      continue;
    }
    const attacking = bot.team === 'dock';
    const site = state.pendingSite ?? world.sites[0];
    const index = bots.indexOf(bot);
    // Each bot takes its own post around the site instead of standing in the same square metre,
    // and every one of them watches the approach from the attackers' side of the yard.
    const ring = [
      [0, 0], [3.1, 1.6], [-3.1, 1.6], [2.2, -1.9], [-2.2, -1.9],
    ][index % 5];
    const post = navPost(site.x + ring[0], site.z + 4.2 + ring[1]);
    const defendRing = [
      [0, 9], [5.5, 10.5], [-5.5, 10.5], [3.5, -6.5], [-3.5, -6.5],
    ][index % 5];
    const defendSpots = [navPost(site.x + defendRing[0], site.z + defendRing[1])];
    // CS bots stop camping when the round is running out or the enemy is nearly gone: they hunt.
    const foes = [
      ...bots.filter((b) => b.alive && b.team !== bot.team),
      ...(playerActor.alive && playerActor.team !== bot.team ? [playerActor] : []),
    ];
    const hunt = (ctxBase.liveAge > 55 || foes.length <= 2) && foes.length > 0;
    let objective = attacking ? post : defendSpots[index % defendSpots.length];
    let holdPoint = post;
    let watchPoint = navPost(post.x + ring[0] * 0.4, post.z - 14);
    const planted = state.bomb && state.bomb.state === 'planted';
    if (planted) {
      // The charge is what the round is about now: attackers close a ring around it and watch the
      // way the defenders have to come, defenders go to the charge itself to take it back.
      const guardRing = [[3.2, 2.4], [-3.2, 2.4], [0, -3.6], [4.2, -1.8], [-4.2, -1.8]][index % 5];
      const guard = navPost(state.bomb.x + guardRing[0], state.bomb.z + guardRing[1]);
      objective = attacking ? guard : { x: state.bomb.x, z: state.bomb.z };
      holdPoint = guard;
      watchPoint = navPost(state.bomb.x + guardRing[0] * 0.6, state.bomb.z + guardRing[1] - 12);
    }
    if (hunt) {
      const nearest = foes.sort(
        (a, b) =>
          Math.hypot(a.body.state.position.x - bot.body.state.position.x, a.body.state.position.z - bot.body.state.position.z) -
          Math.hypot(b.body.state.position.x - bot.body.state.position.x, b.body.state.position.z - bot.body.state.position.z),
      )[0];
      objective = { x: nearest.body.state.position.x, z: nearest.body.state.position.z };
    }
    const ctx = {
      ...ctxBase,
      attacking,
      hunting: hunt,
      site: attacking ? site : null,
      objective,
      bomb: state.bomb,
      holdPoint,
      watchPoint,
    };
    bot.step(dt, ctx);
    bot.syncModel(dt);
  }

  objectiveTick(dt);

  // Tab: the scoreboard, held open for as long as the key is down.
  const wantBoard = input.state.keys.has('Tab') && !buyOpen;
  if (wantBoard !== boardShown) {
    boardShown = wantBoard;
    if (wantBoard) {
      hud.showScoreboard(scoreRows(), state.scores);
      boardRefresh = 0.4;
    } else {
      hud.hideScoreboard();
    }
  } else if (boardShown) {
    boardRefresh -= dt;
    if (boardRefresh <= 0) {
      boardRefresh = 0.4;
      hud.showScoreboard(scoreRows(), state.scores);
    }
  }

  match.step(dt, { actors });

  // The phase changed: tell the player once.
  if (state.phase !== lastPhase) {
    if (state.phase === PHASE.freeze && state.round > 1) {
      hud.banner(`Round ${state.round} — buy ${Math.round(state.phaseTime)}s (B)`, 'phase', 2.4);
      beginRound();
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

  // The gun sways, kicks and dips on its own clock.
  viewmodel.update(dt, body.state.speed, body.state.crouch, weapon.state.reloading, playerActor.alive, aimBlend > 0.5);
  const bomb = state.bomb;
  if (bomb && bomb.state === 'planted') {
    if (!bombShown) {
      bombModel.show(bomb.x, bomb.z);
      bombShown = true;
    }
    bombModel.tick(dt, bomb.timer);
  } else if (bombShown) {
    bombModel.hide();
    bombShown = false;
  }
  muzzleFlash.intensity *= Math.max(0, 1 - dt * 22);

  // A dead player waits for the next round; beginRound() on the phase change puts them back.
}

// Frame
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    drawMinimap();
    hud.tick(dt);
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (locked) {
    started = true;
    hud.hideOverlay();
    audio.unlock();
  } else if (!buyOpen && playerActor.alive) {
    hud.showOverlay('Paused', 'Click to get back in. The round clock is still running.', 'Resume');
  }
}

hud.onOverlayClick(() => {
  audio.unlock();
  if (match.state.matchOver) {
    match.reset();
    beginRound();
  }
  input.requestLock();
});

/** Everyone in the round, for the scoreboard: your own row first, then both teams. */
function scoreRows() {
  const rows = [
    { name: 'You', team: playerActor.team, kills: playerActor.kills, deaths: playerActor.deaths, alive: playerActor.alive, me: true },
    ...bots.map((b) => ({ name: b.name, team: b.team, kills: b.kills, deaths: b.deaths, alive: b.alive })),
  ];
  return rows.sort((a, b) => b.kills - a.kills);
}

// Buy menu keys and the scoreboard.
input.onKey((code) => {
  audio.unlock();
  // Ctrl is a trap: Ctrl+W closes the tab and no page may block it, so crouch lives on C and
  // reaching for Ctrl says so instead of letting the browser take the round away.
  if (code === 'ControlLeft' || code === 'ControlRight') {
    hud.banner('Crouch is C — Ctrl+W closes the tab', 'warn', 2.2);
    return;
  }
  if (code === 'KeyB') {
    if (buyOpen) closeBuy();
    else openBuy();
    return;
  }
  if (buyOpen) {
    const map = { Digit1: 'tally', Digit2: 'skiff', Digit3: 'harbor', Digit4: 'longline', Digit5: 'bastion', Digit6: 'frag' };
    if (map[code]) tryBuy(map[code]);
    if (code === 'Escape') closeBuy();
    return;
  }
  if (!playerActor.alive) {
    if (code === 'KeyA') cycleSpectate(-1);
    else if (code === 'KeyD' || code === 'Space') cycleSpectate(1);
    return;
  }
  if (code === 'KeyG') {
    if (frags > 0) throwFrag();
    else hud.banner('No frag — buy one in the freeze (6)', 'warn', 1.8);
    return;
  }
  if (code === 'KeyR') {
    if (playerActor.alive && weapon.beginReload()) {
      audio.reload(weapon.state.def.sound);
      hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.state.def.name, true);
    }
    return;
  }
});

// Buy menu clicks.
hud.el.buyGrid.addEventListener('click', (event) => {
  const button = event.target.closest('.buy-item');
  if (!button) return;
  tryBuy(button.dataset.weapon);
});

// A click anywhere on the yard takes the mouse back after a pause or a menu.
renderer.domElement.addEventListener('click', () => {
  if (buyOpen) return;
  // While you are down, a click is how you change who you are watching.
  if (!playerActor.alive) {
    cycleSpectate(1);
    return;
  }
  if (!document.pointerLockElement) input.requestLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Go
beginRound();
syncCamera();
hud.setMoney(match.state.playerMoney);
hud.setVitals(100, 0);
hud.setAmmo(weapon.state.mag, weapon.state.reserve, 'Tally', false);

hud.showOverlay(
  'BREAKWATER',
  'A tactical FPS in three.js: four bots a side and you, a charge to plant, and a buy phase to spend your money in. Click to take the yard.',
  'Deploy',
);
requestAnimationFrame(frame);
