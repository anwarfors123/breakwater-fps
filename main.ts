// BREAKWATER — hand-in program for make.fun's best-game-01 bounty.
//
// The game is game/: static files only, ES modules the browser loads straight from disk, three.js
// reached through the single import map in game/index.html. Nothing is built or bundled here. This
// program has one job — it mirrors game/ and screenshots/ into the output directory and writes
// dossier.json, the file the judge reads, with the kit's own vendored library.
//
// In the grader /output is the output directory; anywhere else MAKEFUN_OUTPUT_DIR stands in for it:
//   MAKEFUN_OUTPUT_DIR=out node main.ts
// Play it locally with `node serve.ts` and open the port it prints.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps, copied from the kit's gate: text_max_bytes only shapes how much source the
// dossier carries, the rest refuse an entry the scorer refuses anyway.
const LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

mkdirSync(outDir, { recursive: true });

// The game, whole: index.html, its modules, its vendored three.js.
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });

// The screenshots, when the repository carries them; the first by name is the cover.
if (existsSync(join(repoRoot, 'screenshots'))) {
  const shotsTo = join(outDir, 'screenshots');
  mkdirSync(shotsTo, { recursive: true });
  cpSync(join(repoRoot, 'screenshots'), shotsTo, { recursive: true });
}

// Built from what is in the output directory, not from the repository, so it describes exactly the
// bytes the judge will see.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, LIMITS));

console.log(`entry written to ${outDir}: game/, screenshots/, dossier.json`);
