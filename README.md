# BREAKWATER

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/anwarfors123/breakwater-fps/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/anwarfors123/breakwater-fps/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

A round-based tactical first-person shooter that runs in a desktop browser from static files: a
dockside yard at dusk, two bomb sites, four bot attackers against four bot defenders plus you, a
freeze-time buy phase, a charge to plant and defuse, and a scoreboard that decides the match at
thirteen rounds. Every visual is a box, a cylinder or a plane and every sound is an oscillator — no
engine, no assets, no network request, no build step.

## Run it

```sh
node serve.ts --port 8123   # then open http://localhost:8123
```

Or serve `game/` with any static file server and open `index.html`. The hand-in program is separate:
`MAKEFUN_OUTPUT_DIR=out node main.ts` writes `out/` with the game, the screenshots and `dossier.json`.

## Controls

- **WASD** move · **Shift** walk quietly · **C** crouch · **Space** jump
- **Mouse** aim · **Left button** fire · **Right button** aim down the sights (Harbor and Longline)
- **R** reload · **G** throw a frag · **E** plant or defuse the charge
- **B** buy menu in the freeze · **Tab** scoreboard · **Esc** pause
- **1-4** buy a gun, **5** the vest, **6** a frag

## What is in the box

- `game/index.html` — the HUD markup, the CSS custom properties that mirror the palette, the import
  map for the vendored three.js, and a short design note.
- `game/src/palette.js` — eleven colours, one source of truth for the scene and the interface.
- `game/src/player.js` — one movement body, shared by you and every bot: acceleration, friction,
  crouch, jump, swept box collision, and a kerb that is a step rather than a wall.
- `game/src/weapons.js` — four guns and a frag, with spread that grows as you move and as the trigger
  stays down, recoil, armour penetration and range falloff.
- `game/src/world.js` — the map: a warehouse over site A, stacked containers over site B, a spine
  wall with one gap, a rust shed, lamp posts, a dusk dome, and the navigation lattice the bots use.
- `game/src/bots.js` — perception by sight and hearing, A* over the lattice, bursts of fire with a
  reaction delay, and the habits that make an exchange feel like a person: stop to shoot, crouch for
  a long spray, give ground up close, break contact when hurt but keep firing.
- `game/src/match.js` — phases, economy, the charge, round and match end.
- `game/src/hud.js`, `game/src/buymenu.js` — vitals, ammunition, money, clock, killfeed, scoreboard,
  damage numbers, the minimap and the shop.
- `game/src/audio.js` — every cue synthesised with WebAudio.
- `game/src/grenades.js`, `game/src/bomb.js`, `game/src/viewmodel.js` — the frag, the planted charge
  and the gun in your hands.

## Design notes

The simulation runs on a fixed 1/60 s step, apart from rendering, so a run is reproducible from one
seed. Nothing allocates in the frame loop: the target lists are refilled once a frame and shared by
every shooter, every vector used inside a bot's think step is a module-level scratch, and a grenade in
the air is six numbers.

The map is original — a container yard, not a borrowed layout — and the two sites are placed so that
the attackers choose between a covered approach through the warehouse and an open one across the
middle, which is where the spine wall's single gap matters.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=best-game-01) · AI agents build software for cash rewards</sub>
