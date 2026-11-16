// Weapons, ammunition and damage. Four guns and one frag, all numbers: the table below is the only
// place a price, a magazine size or a damage figure lives, and match.js/hud.js/bots.js read it from
// here rather than keeping copies.
//
// One rule keeps the feel honest: a shot's cone grows with how fast the body is moving and with how
// long the trigger has been held, so standing still and tapping beats running and spraying. Aiming
// down the sights multiplies the moving share away (main.js passes the reduced ratio in).

export const WEAPONS = {
  tally: {
    id: 'tally', name: 'Tally', slot: 'sidearm', sound: 'tally',
    price: 0, dmg: 26, head: 3.4, rate: 0.145, mag: 13, reserve: 52, reload: 1.5,
    spreadBase: 0.0055, spreadMove: 0.035, recoilUp: 0.0075, recoilSide: 0.0035,
    decay: 7.5, range: 60, armourPen: 0.5,
  },
  skiff: {
    id: 'skiff', name: 'Skiff', slot: 'primary', sound: 'skiff',
    price: 1250, dmg: 24, head: 3.0, rate: 0.075, mag: 30, reserve: 120, reload: 2.2,
    spreadBase: 0.0075, spreadMove: 0.026, recoilUp: 0.0062, recoilSide: 0.0042,
    decay: 9.5, range: 55, armourPen: 0.55,
  },
  harbor: {
    id: 'harbor', name: 'Harbor', slot: 'primary', sound: 'harbor',
    price: 2900, dmg: 34, head: 4.0, rate: 0.1, mag: 30, reserve: 90, reload: 2.6,
    spreadBase: 0.0028, spreadMove: 0.062, recoilUp: 0.0105, recoilSide: 0.0048,
    decay: 6.4, range: 90, armourPen: 0.78,
  },
  longline: {
    id: 'longline', name: 'Longline', slot: 'primary', sound: 'longline',
    price: 4500, dmg: 118, head: 1.6, rate: 1.42, mag: 5, reserve: 25, reload: 3.4,
    spreadBase: 0.0009, spreadMove: 0.13, recoilUp: 0.02, recoilSide: 0.004,
    decay: 4.0, range: 140, armourPen: 0.95,
  },
};

export const ARMOUR = { id: 'bastion', name: 'Bastion vest', price: 650, points: 100 };

export const GRENADE = {
  id: 'frag', name: 'Frag', price: 300, max: 1, fuse: 2.4, radius: 5.2,
  damage: 118, speed: 16.5, lift: 3.2, restitution: 0.34,
};

// The spray stops climbing at twelve shots: past that a rifle is a garden hose either way.
const CLIMB_CAP = 12;

/** The full magazine and reserve a fresh copy of this weapon is issued with. */
export function freshAmmo(def) {
  return { mag: def.mag, reserve: def.reserve };
}

/**
 * One weapon instance. Everything inside reads `state.def` — never the `def` argument — because
 * swapping state.def is how a bot changes gun between rounds, and a closure would keep the old
 * rate, magazine and recoil while the table says otherwise.
 */
export function createWeapon(def) {
  const state = {
    def,
    mag: def.mag,
    reserve: def.reserve,
    reloading: 0,   // seconds left of a reload, 0 when not reloading
    cooldown: 0,    // seconds until the next shot may leave
    climb: 0,       // shots fired in this burst, decays while the trigger is off
  };

  /** The cone's radius in radians: base, plus the moving share, plus the spray. */
  function cone(speedRatio = 0) {
    const d = state.def;
    const moving = Math.max(0, Math.min(1, speedRatio));
    return d.spreadBase + moving * d.spreadMove + Math.min(CLIMB_CAP, state.climb) * d.recoilUp * 0.55;
  }

  function ready() {
    return state.cooldown <= 0 && state.reloading <= 0 && state.mag > 0;
  }

  /**
   * Fires if it can: spends a round, starts the cooldown, climbs the spray and returns the aim
   * offset for this shot ({ pitch, yaw } in radians). Null when it cannot fire.
   */
  function fire(speedRatio = 0, random = Math.random) {
    if (!ready()) return null;
    const d = state.def;
    state.mag -= 1;
    state.cooldown = d.rate;
    state.climb += 1;

    const radius = cone(speedRatio);
    // A point in the cone's disc, biased up by the kick so a long spray walks toward the sky.
    const angle = random() * Math.PI * 2;
    const spread = Math.sqrt(random()) * radius;
    const pitch = Math.sin(angle) * spread + d.recoilUp * 0.35;
    const yaw = Math.cos(angle) * spread + (random() - 0.5) * d.recoilSide;
    return { pitch, yaw };
  }

  function beginReload() {
    if (state.reloading > 0 || state.mag >= state.def.mag || state.reserve <= 0) return false;
    state.reloading = state.def.reload;
    return true;
  }

  /** Full resupply, as the shop hands it over. */
  function refill() {
    state.mag = state.def.mag;
    state.reserve = state.def.reserve;
    state.reloading = 0;
    state.cooldown = 0;
    state.climb = 0;
  }

  function step(dt) {
    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt);
    if (state.reloading > 0) {
      state.reloading -= dt;
      if (state.reloading <= 0) {
        state.reloading = 0;
        const want = state.def.mag - state.mag;
        const take = Math.min(want, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    if (state.climb > 0) state.climb = Math.max(0, state.climb - state.def.decay * dt);
  }

  return { state, fire, cone, ready, beginReload, refill, step };
}

/**
 * Damage after armour and after range falloff. The vest soaks a share of the hit scaled by the
 * weapon's armour penetration, and half of what it soaks never reaches the body; a shot past the
 * weapon's range loses bite quickly but never becomes a scratch.
 */
export function resolveDamage(def, armour, headshot, distance) {
  let damage = def.dmg * (headshot ? def.head : 1);
  if (distance > def.range) {
    const over = (distance - def.range) / (def.range * 1.6);
    damage *= Math.max(0.25, 1 - over);
  }
  let armourLoss = 0;
  if (armour > 0) {
    armourLoss = Math.min(armour, damage * def.armourPen);
    damage = Math.max(0, damage - armourLoss * 0.5);
  }
  return { damage, armourLoss };
}
