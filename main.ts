// BREAKWATER — the entry program for make.fun's three.js tactical FPS bounty.
//
// The game itself is game/: plain static files, ES modules the browser loads directly, three.js
// pulled in through the one import map in game/index.html. Nothing here builds it. This program
// only hands it in: it mirrors game/ and screenshots/ beside this file into the output directory
// and writes dossier.json, the summary the judge reads, using the vendored make.fun library.
//
// Inside the grader /output is the output directory; anywhere else MAKEFUN_OUTPUT_DIR stands in:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Serve the game locally with `node serve.ts` and open the port it prints.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The directory this file sits in: the repository root, which is where game/ and screenshots/ live.
const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps, taken from the kit's gate: text_max_bytes shapes the dossier's source
// excerpt, the rest refuse an entry the scorer would refuse anyway (more than four screenshots or
// one over 256 KiB, more than 993 files or 48 MiB of game files, counting against /output's own
// 1,000-entry cap which screenshots/ and dossier.json share).
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

mkdirSync(outDir, { recursive: true });

// The game, whole: index.html, its modules, its vendored three.js and its assets.
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });

// The screenshots, when the repository carries them; the first by name becomes the cover.
const shotsFrom = join(repoRoot, 'screenshots');
if (existsSync(shotsFrom)) {
  const shotsTo = join(outDir, 'screenshots');
  mkdirSync(shotsTo, { recursive: true });
  cpSync(shotsFrom, shotsTo, { recursive: true });
}

// The dossier is built from what is actually in the output directory, not from this repository, so
// it describes exactly the bytes the judge will see.
const dossierPath = join(outDir, 'dossier.json');
writeFileSync(dossierPath, buildDossier(outDir, DOSSIER_LIMITS));

// One line on stdout, so a local run says where the entry landed instead of finishing in silence.
console.log(`entry written to ${outDir} (game/, screenshots/, dossier.json)`);
