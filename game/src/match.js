// The round: a freeze to spend money in, a live round that ends on elimination or on the charge,
// and a settle before the next one. Money is the spine — lose a round, keep a little, buy what you
// can afford. First to thirteen, sides swap at twelve. No geometry and no bodies live here: this
// module owns the clock, the score, the economy, the charge and the callbacks.
import { WEAPONS } from './weapons.js';

export const PHASE = {
  warmup: 'warmup',
  freeze: 'freeze',
  live: 'live',
  settle: 'settle',
  halftime: 'halftime',
  over: 'over',
};

const FREEZE_SECONDS = 15;
const ROUND_SECONDS = 100;
const SETTLE_SECONDS = 5;
const HALFTIME_SECONDS = 8;
const BOMB_SECONDS = 30;
const PLANT_SECONDS = 3.2;
const DEFUSE_SECONDS = 6.5;
const ROUNDS_PER_HALF = 12;
const WIN_ROUNDS = 13;

export const ECONOMY = {
  start: 800,
  max: 16000,
  kill: 300,
  assist: 100,
  winElimination: 3250,
  winObjective: 3500,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  plantBonus: 300,
  defuseBonus: 300,
};

export function createMatch({ audio, random, sites }) {
  const state = {
    phase: PHASE.warmup,
    phaseTime: 0,
    round: 1,
    scores: { dock: 0, warden: 0 },
    lossStreak: { dock: 0, warden: 0 },
    teamMoney: { dock: ECONOMY.start, warden: ECONOMY.start },
    playerMoney: ECONOMY.start,
    playerTeam: 'dock',
    bomb: null,
    lastWinner: null,
    lastReason: '',
    matchOver: false,
    events: [],
  };

  function emit(kind, text, extra = {}) {
    state.events.push({ kind, text, at: performance.now(), ...extra });
  }

  function siteFor(siteId) {
    return sites.find((s) => s.id === siteId) ?? sites[0];
  }

  /** Which site the attacking side is committing to this round. */
  function pickSite() {
    return sites[random() < 0.5 ? 0 : 1];
  }

  function beginFreeze() {
    state.phase = PHASE.freeze;
    state.phaseTime = FREEZE_SECONDS;
    state.bomb = null;
    emit('phase', `Round ${state.round} — buy phase`);
  }

  function beginLive(site) {
    state.phase = PHASE.live;
    state.phaseTime = ROUND_SECONDS;
    state.attackSite = site;
    emit('phase', 'Round live');
  }

  function endRound(winner, reason) {
    if (state.phase === PHASE.settle || state.phase === PHASE.over) return;
    state.phase = PHASE.settle;
    state.phaseTime = SETTLE_SECONDS;
    state.lastWinner = winner;
    state.lastReason = reason;
    state.scores[winner] += 1;
    const loser = winner === 'dock' ? 'warden' : 'dock';
    // The winning side banks the round; the losing side banks a bonus that grows with its streak.
    state.teamMoney[winner] = Math.min(ECONOMY.max, state.teamMoney[winner] + (reason === 'elimination' ? ECONOMY.winElimination : ECONOMY.winObjective));
    const streak = Math.min(4, state.lossStreak[loser]);
    state.teamMoney[loser] = Math.min(ECONOMY.max, state.teamMoney[loser] + ECONOMY.lossBase + streak * ECONOMY.lossStep);
    state.lossStreak[loser] += 1;
    state.lossStreak[winner] = 0;
    if (state.playerTeam === winner) {
      state.playerMoney = Math.min(ECONOMY.max, state.playerMoney + (reason === 'elimination' ? ECONOMY.winElimination : ECONOMY.winObjective));
    } else {
      const bonus = ECONOMY.lossBase + streak * ECONOMY.lossStep;
      state.playerMoney = Math.min(ECONOMY.max, state.playerMoney + bonus);
    }
    const label = winner === 'dock' ? 'Dockers' : 'Wardens';
    emit('round', `${label} take the round — ${reason}`, { winner });
    audio.sting(winner === state.playerTeam);

    if (state.scores[winner] >= WIN_ROUNDS) {
      state.matchOver = true;
      emit('match', `${label} win the match ${state.scores.dock}–${state.scores.warden}`);
    }
  }

  /** Called by whoever resolves a kill, so the economy and the feed stay in one place. */
  function onKill(attackerTeam, victimTeam, victimName, attackerName, weaponName, headshot, byPlayer = false) {
    if (attackerTeam !== victimTeam) {
      // Only your own kills pay you: a teammate's kill pays the team, not your wallet.
      if (byPlayer && attackerTeam === state.playerTeam) state.playerMoney = Math.min(ECONOMY.max, state.playerMoney + ECONOMY.kill);
      state.teamMoney[attackerTeam] = Math.min(ECONOMY.max, state.teamMoney[attackerTeam] + ECONOMY.kill);
    }
    emit('kill', `${attackerName} ▸ ${victimName}`, { headshot, weaponName, attackerTeam });
  }

  function plant(site, byTeam, x = site.x, z = site.z) {
    if (state.bomb) return false;
    state.bomb = {
      state: 'planted',
      x,
      z,
      site,
      timer: BOMB_SECONDS,
      defuseProgress: 0,
      plantedBy: byTeam,
    };
    if (byTeam === state.playerTeam) state.playerMoney = Math.min(ECONOMY.max, state.playerMoney + ECONOMY.plantBonus);
    state.teamMoney[byTeam] = Math.min(ECONOMY.max, state.teamMoney[byTeam] + ECONOMY.plantBonus);
    emit('objective', `Charge planted at ${site.id}`, { site: site.id });
    audio.beep(1.4);
    return true;
  }

  function defuse(byTeam) {
    if (!state.bomb || state.bomb.state !== 'planted') return false;
    state.bomb.state = 'defused';
    if (byTeam === state.playerTeam) state.playerMoney = Math.min(ECONOMY.max, state.playerMoney + ECONOMY.defuseBonus);
    emit('objective', 'Charge defused');
    endRound('warden', 'defused');
    return true;
  }

  function explode() {
    if (!state.bomb) return;
    state.bomb.state = 'exploded';
    audio.explosion();
    emit('objective', 'The charge detonated');
    endRound('dock', 'detonation');
  }

  /**
   * Advance the clock. `world` is the live round state: the actors, their teams and whether
   * anyone is still standing.
   */
  function step(dt, world) {
    if (state.matchOver) {
      state.phase = PHASE.over;
      return state;
    }
    state.phaseTime -= dt;

    if (state.phase === PHASE.freeze) {
      if (state.phaseTime <= 0) beginLive(state.pendingSite ?? pickSite());
      return state;
    }

    if (state.phase === PHASE.live) {
      // The charge burns down independently of the round clock.
      if (state.bomb && state.bomb.state === 'planted') {
        state.bomb.timer -= dt;
        const beat = Math.max(0.12, state.bomb.timer / BOMB_SECONDS) * 1.1;
        state.bomb.nextBeep = (state.bomb.nextBeep ?? 0) - dt;
        if (state.bomb.nextBeep <= 0) {
          state.bomb.nextBeep = beat;
          audio.beep(0.8 + (1 - state.bomb.timer / BOMB_SECONDS) * 1.2);
        }
        if (state.bomb.timer <= 0) {
          explode();
          return state;
        }
      }

      const aliveDock = world.actors.filter((a) => a.alive && a.team === 'dock').length;
      const aliveWarden = world.actors.filter((a) => a.alive && a.team === 'warden').length;
      const bombPlanted = state.bomb && state.bomb.state === 'planted';

      if (aliveWarden === 0 && !bombPlanted) {
        endRound('dock', 'elimination');
        return state;
      }
      if (aliveDock === 0) {
        // Attackers wiped: defenders still take it, unless the charge is already ticking.
        if (!bombPlanted) {
          endRound('warden', 'elimination');
          return state;
        }
      }
      if (state.phaseTime <= 0) {
        if (bombPlanted) return state; // the charge outlives the round clock
        endRound('warden', 'time');
        return state;
      }
      return state;
    }

    if (state.phase === PHASE.settle) {
      if (state.phaseTime <= 0) {
        if (state.matchOver) {
          state.phase = PHASE.over;
          return state;
        }
        // Sides swap at the half, and the economy resets for the second half.
        if (state.round === ROUNDS_PER_HALF) {
          state.phase = PHASE.halftime;
          state.phaseTime = HALFTIME_SECONDS;
          state.round += 1;
          return state;
        }
        state.round += 1;
        beginFreeze();
      }
      return state;
    }

    if (state.phase === PHASE.halftime) {
      if (state.phaseTime <= 0) {
        const swap = state.scores.dock;
        state.scores.dock = state.scores.warden;
        state.scores.warden = swap;
        state.playerTeam = state.playerTeam === 'dock' ? 'warden' : 'dock';
        state.teamMoney = { dock: ECONOMY.start, warden: ECONOMY.start };
        state.playerMoney = ECONOMY.start;
        state.lossStreak = { dock: 0, warden: 0 };
        emit('phase', 'Sides swap — second half');
        beginFreeze();
      }
      return state;
    }

    return state;
  }

  function buy(weaponId, playerHasPrimary, currentWeaponId) {
    if (state.phase !== PHASE.freeze && state.phase !== PHASE.live) return { ok: false, reason: 'buy time is over' };
    if (weaponId === 'bastion') {
      if (state.playerMoney < 650) return { ok: false, reason: 'not enough' };
      state.playerMoney -= 650;
      return { ok: true, kind: 'armour' };
    }
    if (weaponId === 'frag') {
      if (state.playerMoney < 300) return { ok: false, reason: 'not enough' };
      state.playerMoney -= 300;
      return { ok: true, kind: 'grenade' };
    }
    const def = WEAPONS_PRICE[weaponId];
    if (!def) return { ok: false, reason: 'unknown' };
    // A primary you already carry is swapped for the new one: a rifle kept across rounds must not
    // lock you out of the shop. Buying the one you already hold is the only refusal.
    if (playerHasPrimary && def.slot === 'primary' && weaponId === currentWeaponId) {
      return { ok: false, reason: 'already armed' };
    }
    if (state.playerMoney < def.price) return { ok: false, reason: 'not enough' };
    state.playerMoney -= def.price;
    return { ok: true, kind: 'weapon' };
  }

  function reset() {
    state.phase = PHASE.warmup;
    state.round = 1;
    state.scores = { dock: 0, warden: 0 };
    state.lossStreak = { dock: 0, warden: 0 };
    state.teamMoney = { dock: ECONOMY.start, warden: ECONOMY.start };
    state.playerMoney = ECONOMY.start;
    state.playerTeam = 'dock';
    state.bomb = null;
    state.matchOver = false;
    state.events.length = 0;
  }

  return { state, step, beginFreeze, beginLive, endRound, onKill, plant, defuse, explode, buy, reset, pickSite, siteFor, PHASE };
}

// Prices come from the arsenal itself: one table, so the buy menu and the economy cannot disagree.
const WEAPONS_PRICE = WEAPONS;

export const ROUND_CONSTANTS = { FREEZE_SECONDS, ROUND_SECONDS, BOMB_SECONDS, PLANT_SECONDS, DEFUSE_SECONDS, WIN_ROUNDS };
