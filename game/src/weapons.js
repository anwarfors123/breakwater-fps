// The arsenal: four weapons and a vest, each with its own ballistics so the buy menu changes how
// the round plays. Accuracy is the base cone plus how fast the shooter moves plus how long the
// trigger has been held; recoil climbs and decays, so a burst is always tighter than a spray.
// The player and the bots fire through this same code, which is why the bots miss the way they do.

export const WEAPONS = {
  tally: {
    id: 'tally',
    name: 'Tally',
    slot: 'sidearm',
    price: 0,
    damage: 26,
    headshot: 3.4,
    rate: 0.145, // seconds between rounds
    mag: 13,
    reserve: 52,
    reloadTime: 1.5,
    spreadBase: 0.0055,
    spreadMove: 0.035,
    recoilUp: 0.0075,
    recoilSide: 0.0035,
    recoilDecay: 7.5,
    range: 60,
    pellets: 1,
    sound: 'pistol',
    armourPen: 0.5,
  },
  skiff: {
    id: 'skiff',
    name: 'Skiff',
    slot: 'primary',
    price: 1250,
    damage: 24,
    headshot: 3.0,
    rate: 0.075,
    mag: 30,
    reserve: 120,
    reloadTime: 2.2,
    spreadBase: 0.0075,
    spreadMove: 0.026,
    recoilUp: 0.0062,
    recoilSide: 0.0042,
    recoilDecay: 9.5,
    range: 55,
    pellets: 1,
    sound: 'smg',
    armourPen: 0.55,
  },
  harbor: {
    id: 'harbor',
    name: 'Harbor',
    slot: 'primary',
    price: 2900,
    damage: 34,
    headshot: 4.0,
    rate: 0.1,
    mag: 30,
    reserve: 90,
    reloadTime: 2.6,
    spreadBase: 0.0028,
    spreadMove: 0.062,
    recoilUp: 0.0105,
    recoilSide: 0.0048,
    recoilDecay: 6.4,
    range: 90,
    pellets: 1,
    sound: 'rifle',
    armourPen: 0.78,
  },
  longline: {
    id: 'longline',
    name: 'Longline',
    slot: 'primary',
    price: 4500,
    damage: 118,
    headshot: 1.6,
    rate: 1.42,
    mag: 5,
    reserve: 25,
    reloadTime: 3.4,
    spreadBase: 0.0009,
    spreadMove: 0.13,
    recoilUp: 0.02,
    recoilSide: 0.004,
    recoilDecay: 4.0,
    range: 140,
    pellets: 1,
    sound: 'sniper',
    armourPen: 0.95,
  },
};

export const ARMOUR = { id: 'bastion', name: 'Bastion vest', price: 650, points: 100 };

// One frag a round: a thrown blast is the answer to a held corner, and the only damage in the game
// that does not need a line of sight at the moment you commit to it.
export const GRENADE = {
  id: 'frag',
  name: 'Frag',
  price: 300,
  max: 1,
  fuse: 2.4,
  radius: 5.2,
  damage: 118,
  throwSpeed: 16.5,
  throwLift: 3.2,
};

/** Full ammo for a weapon, as a fresh magazine state. */
export function freshAmmo(def) {
  return { mag: def.mag, reserve: def.reserve };
}

/**
 * One weapon in one pair of hands: its rounds, its reload, its recoil.
 * `step` decays recoil every fixed tick; `fire` returns the cone the shot left at, in radians.
 */
export function createWeapon(def) {
  const state = {
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloading: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    held: 0, // seconds the trigger has been down, for spray accumulation
    shots: 0,
  };

  function ready() {
    return state.cooldown <= 0 && state.reloading <= 0 && state.mag > 0;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    if (state.reloading > 0) {
      state.reloading -= dt;
      if (state.reloading <= 0) {
        const need = state.def.mag - state.mag;
        const taken = Math.min(need, state.reserve);
        state.mag += taken;
        state.reserve -= taken;
      }
    }
    if (state.held <= 0) {
      const decay = Math.exp(-state.def.recoilDecay * dt);
      state.recoilPitch *= decay;
      state.recoilYaw *= decay;
      state.shots = Math.max(0, state.shots - dt * 6);
    } else {
      state.held -= dt;
    }
  }

  function beginReload() {
    if (state.reloading > 0 || state.mag >= state.def.mag || state.reserve <= 0) return false;
    state.reloading = state.def.reloadTime;
    return true;
  }

  /** Cone half-angle for the next shot: base, plus movement, plus the spray the trigger built. */
  function cone(speedRatio) {
    const spray = Math.min(state.shots, 12) * state.def.recoilUp * 0.55;
    return state.def.spreadBase + speedRatio * state.def.spreadMove + spray;
  }

  /** Consume a round; returns the aim offset this shot carries, or null if it cannot fire. */
  function fire(speedRatio, random) {
    if (!ready()) return null;
    state.mag -= 1;
    state.cooldown = state.def.rate;
    state.held = 0.12;
    state.shots += 1;
    const coneAngle = cone(speedRatio);
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * coneAngle;
    // The gun kicks up and to a side that alternates in a slow figure, the classic spray shape.
    const climb = state.def.recoilUp * (1 + Math.min(state.shots, 10) * 0.16);
    const drift = Math.sin(state.shots * 0.9) * state.def.recoilSide * (1 + Math.min(state.shots, 10) * 0.2);
    state.recoilPitch += climb;
    state.recoilYaw += drift;
    return {
      pitch: Math.cos(angle) * radius + state.recoilPitch,
      yaw: Math.sin(angle) * radius + state.recoilYaw,
    };
  }

  function refill() {
    state.mag = state.def.mag;
    state.reserve = state.def.reserve;
    state.cooldown = 0;
    state.reloading = 0;
    state.recoilPitch = 0;
    state.recoilYaw = 0;
    state.held = 0;
    state.shots = 0;
  }

  return { state, ready, step, fire, beginReload, refill, cone };
}

/** Damage after armour: a vest eats a share of the round, more of a light one than a heavy one. */
export function resolveDamage(def, armour, headshot, distance) {
  const falloff = Math.max(0.55, 1 - distance / (def.range * 3.2));
  let damage = def.damage * (headshot ? def.headshot : 1) * falloff;
  if (armour > 0) {
    const pen = def.armourPen;
    const blocked = damage * (1 - pen) * 0.72;
    damage -= blocked;
    return { damage, armourLoss: Math.min(armour, Math.round(blocked * 0.85)) };
  }
  return { damage, armourLoss: 0 };
}
