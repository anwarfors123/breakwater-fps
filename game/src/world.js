// The map: a dockside yard at dusk, two bomb sites, and everything the rest of the game asks of the
// world — the boxes a body may not walk through, the meshes a bullet stops at, the spawns, the
// sites, and the navigation lattice the bots path over.
//
// Every visual is a box, a cylinder or a plane. One thing here is load-bearing and was paid for in
// a lost day: group.updateMatrixWorld(true) before returning. The ground and the painted lines are
// planes rotated flat, and until their matrix is baked a raycast sees the floor standing upright at
// the origin — an invisible wall across the middle of the map that blocks sight from one side only.

import * as THREE from 'three';
import { PALETTE, rgb } from './palette.js';

export const BOT_RADIUS = 0.42;
const WALK_BAND_LOW = 0.32;    // anything shorter than this is walkable, for bots and player alike
const WALK_BAND_HIGH = 1.7;    // anything taller than this is over a body's head
const NAV_SPACING = 2.5;
const NAV_INSET = 1.2;

export function createWorld(scene) {
  const group = new THREE.Group();
  const colliders = [];
  const shootables = [];
  const bounds = { minX: -30, maxX: 30, minZ: -32, maxZ: 32 };

  // rgb() hands back plain channels; a material wants a THREE.Color, and anything else silently
  // renders white — which is exactly how the first pass turned a dusk yard into a snowfield.
  const tint = (name, k) => {
    const c = rgb(name, k);
    return new THREE.Color(c.r, c.g, c.b);
  };

  const materials = {
    asphalt: new THREE.MeshStandardMaterial({ color: tint('canvas', 0.5), roughness: 0.94, metalness: 0.02 }),
    concrete: new THREE.MeshStandardMaterial({ color: tint('concrete', 0.45), roughness: 0.86, metalness: 0.03 }),
    wall: new THREE.MeshStandardMaterial({ color: tint('surface', 0.5), roughness: 0.78, metalness: 0.12 }),
    steel: new THREE.MeshStandardMaterial({ color: tint('steel', 0.45), roughness: 0.44, metalness: 0.4 }),
    rust: new THREE.MeshStandardMaterial({ color: tint('rust', 0.55), roughness: 0.82, metalness: 0.18 }),
    crate: new THREE.MeshStandardMaterial({ color: tint('rust', 0.5), roughness: 0.88, metalness: 0.06 }),
    dockPaint: new THREE.MeshBasicMaterial({ color: PALETTE.dock, transparent: true, opacity: 0.16 }),
    wardenPaint: new THREE.MeshBasicMaterial({ color: PALETTE.warden, transparent: true, opacity: 0.16 }),
    line: new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.14 }),
  };

  // ---------------------------------------------------------------- geometry helpers

  /**
   * One box of world. `opts.solid === false` leaves it out of the collider list, `opts.shootable
   * === false` out of the shootable list, and `opts.round` swaps the box for a cylinder.
   */
  function block(x, y, z, w, h, d, material, opts = {}) {
    let mesh;
    if (opts.round) {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 14), material);
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    }
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = opts.shadow !== false;
    mesh.receiveShadow = true;
    group.add(mesh);

    if (opts.solid !== false) {
      const collider = {
        minX: x - w / 2, maxX: x + w / 2,
        minY: y, maxY: y + h,
        minZ: z - d / 2, maxZ: z + d / 2,
      };
      colliders.push(collider);
      if (opts.actor) collider.actor = opts.actor;
    }
    if (opts.shootable !== false) shootables.push(mesh);
    return mesh;
  }

  function paint(x, z, w, d, material) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.015, z);
    group.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------- ground and sky

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), materials.asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  shootables.push(ground);

  // A dusk dome: one canvas, one vertical gradient, wrapped on the inside of a big sphere. It gives
  // the yard a horizon instead of a flat background colour, and a texture sidesteps the colour-space
  // trap a hand-written shader falls into (its output skips the renderer's conversion and comes out
  // wrong on screen).
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const skyGradient = skyCtx.createLinearGradient(0, 256, 0, 0);
  skyGradient.addColorStop(0, '#a9793f');
  skyGradient.addColorStop(0.42, '#46606f');
  skyGradient.addColorStop(1, '#1b2a38');
  skyCtx.fillStyle = skyGradient;
  skyCtx.fillRect(0, 0, 4, 256);
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(150, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }),
  );
  dome.position.y = -6;
  group.add(dome);

  // ---------------------------------------------------------------- lighting

  const hemisphere = new THREE.HemisphereLight(0xa8c4d8, 0x5a5145, 1.5);
  group.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffe0b8, 1.5);
  sun.position.set(-38, 46, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -46;
  sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 46;
  sun.shadow.camera.bottom = -46;
  sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0006;
  group.add(sun);

  // A flat fill so the shadowed faces are not black, the one thing that made the first pass a night.
  group.add(new THREE.AmbientLight(0xdfe8f2, 0.85));

  // ---------------------------------------------------------------- perimeter

  const WALL_H = 6.5;
  const WALL_T = 0.6;
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  block(0, 0, bounds.minZ, spanX + WALL_T, WALL_H, WALL_T, materials.wall);
  block(0, 0, bounds.maxZ, spanX + WALL_T, WALL_H, WALL_T, materials.wall);
  block(bounds.minX, 0, 0, WALL_T, WALL_H, spanZ, materials.wall);
  block(bounds.maxX, 0, 0, WALL_T, WALL_H, spanZ, materials.wall);

  // ---------------------------------------------------------------- site A: the warehouse

  const WARE_X = -17;
  const WARE_Z = -11;
  const WARE_HALF = 10.5;          // 21 m square
  const WARE_H = 4.6;
  const northZ = WARE_Z - WARE_HALF;   // the back, away from both spawns
  const southZ = WARE_Z + WARE_HALF;   // faces the middle of the yard

  // Back wall, split by the 6 m back door with a header over it.
  block(WARE_X - 7, 0, northZ, 7, WARE_H, 0.5, materials.wall);
  block(WARE_X + 7, 0, northZ, 7, WARE_H, 0.5, materials.wall);
  block(WARE_X, 2.6, northZ, 6, WARE_H - 2.6, 0.5, materials.wall);

  // Front wall, split by a 6 m doorway at its centre.
  block(WARE_X - 7.25, 0, southZ, 6.5, WARE_H, 0.5, materials.wall);
  block(WARE_X + 7.25, 0, southZ, 6.5, WARE_H, 0.5, materials.wall);
  block(WARE_X, 2.6, southZ, 6, WARE_H - 2.6, 0.5, materials.wall);

  // Solid sides.
  block(WARE_X - WARE_HALF, 0, WARE_Z, 0.5, WARE_H, 21, materials.wall);
  block(WARE_X + WARE_HALF, 0, WARE_Z, 0.5, WARE_H, 21, materials.wall);

  // Roof: decorative, so it never blocks a shot or a body.
  block(WARE_X, 5.4, WARE_Z, 21.6, 0.3, 21.6, materials.steel, { solid: false, shootable: false });
  for (let i = -2; i <= 2; i += 1) {
    block(WARE_X + i * 4, 4.9, WARE_Z, 0.24, 0.5, 21, materials.steel, { solid: false, shootable: false });
  }

  // Crates inside, one stacked: cover to fight around, not a maze.
  block(WARE_X - 5.5, 0, WARE_Z + 2.5, 1.6, 1.6, 1.6, materials.crate);
  block(WARE_X - 5.5, 1.6, WARE_Z + 2.5, 1.6, 1.6, 1.6, materials.crate);
  block(WARE_X + 4.2, 0, WARE_Z - 3.4, 1.6, 1.6, 1.6, materials.crate);
  block(WARE_X + 2.4, 0, WARE_Z + 5.2, 1.6, 1.6, 1.6, materials.crate);
  block(WARE_X - 3.2, 0, WARE_Z - 5.6, 1.6, 1.6, 1.6, materials.crate);

  // ---------------------------------------------------------------- site B: the container yard

  const YARD_X = 17;
  const YARD_Z = -13;
  const CONT_W = 6.1;
  const CONT_H = 2.55;
  const CONT_D = 2.5;

  function container(x, z, tiers, material) {
    for (let t = 0; t < tiers; t += 1) {
      block(x, t * CONT_H, z, CONT_W, CONT_H, CONT_D, material);
    }
  }

  const yardSteel = materials.rust;
  const yardSteel2 = materials.steel;
  container(YARD_X - 5.4, YARD_Z - 5.6, 3, yardSteel);
  container(YARD_X + 0.9, YARD_Z - 5.6, 2, yardSteel2);
  // The third column stays open: the lane that makes the yard a place you can cross.
  container(YARD_X - 5.4, YARD_Z + 0.4, 2, yardSteel2);
  container(YARD_X + 0.9, YARD_Z + 0.4, 3, yardSteel);
  container(YARD_X - 5.4, YARD_Z + 6.4, 1, yardSteel);
  container(YARD_X + 0.9, YARD_Z + 6.4, 2, yardSteel2);

  block(YARD_X + 1.2, 0, YARD_Z + 3.4, 1.6, 1.6, 1.6, materials.crate);
  block(YARD_X - 2.4, 0, YARD_Z + 3.4, 1.6, 1.6, 1.6, materials.crate);
  block(YARD_X - 0.6, 0, YARD_Z - 2.6, 1.6, 1.6, 1.6, materials.crate);

  // ---------------------------------------------------------------- the middle spine

  // A low wall across the yard at z ~ 2, with the gap at x ~ 0 that every rotation runs through.
  block(-7.5, 0, 2, 13, 1.15, 0.55, materials.concrete);
  block(7.5, 0, 2, 13, 1.15, 0.55, materials.concrete);
  block(0, 2.1, 2, 3.2, 0.7, 0.55, materials.concrete, { solid: false });

  // Crates around the crossing, so the gap is a decision and not a doorway.
  block(-2.6, 0, 5.2, 1.6, 1.6, 1.6, materials.crate);
  block(2.8, 0, -1.4, 1.6, 1.6, 1.6, materials.crate);
  block(-3.4, 0, -2.2, 1.6, 1.6, 1.6, materials.crate);
  block(3.2, 0, 5.6, 1.6, 1.6, 1.6, materials.crate);

  // Two long low walls that give the flanks a shape.
  block(-13.5, 0, 9, 0.6, 1.5, 12, materials.concrete);
  block(13.5, 0, 9, 0.6, 1.5, 12, materials.concrete);

  // The rust shed on the east flank: a small hard corner to hold.
  block(13.5, 0, -4.5, 5.4, 3.1, 0.5, materials.rust);
  block(13.5, 0, -8.6, 5.4, 3.1, 0.5, materials.rust);
  block(10.9, 0, -6.55, 0.5, 3.1, 4.2, materials.rust);
  block(16.1, 0, -6.55, 0.5, 3.1, 4.2, materials.rust);
  block(13.5, 3.1, -6.55, 5.4, 0.25, 4.6, materials.steel, { solid: false });

  // Barrels and pallets: small cover that breaks up the open ground between the lanes.
  const BARRELS = [[-5.6, 8.4], [-4.7, 8.9], [6.2, 6.3], [7.1, 6.8], [-9.6, -6.4], [9.9, 12.3], [-19.5, 6.2], [19.8, 2.4]];
  for (const [bx, bz] of BARRELS) {
    block(bx, 0, bz, 0.64, 1.06, 0.64, materials.rust, { round: true });
  }

  // ---------------------------------------------------------------- spawn decks

  paint(0, 26, 22, 6, materials.dockPaint);
  paint(0, -28, 22, 6, materials.wardenPaint);
  paint(0, 2, 26, 0.18, materials.line);
  paint(-13.5, 20, 0.18, 24, materials.line);
  paint(13.5, 20, 0.18, 24, materials.line);

  // ---------------------------------------------------------------- lamp posts

  const halos = [];
  const LAMPS = [
    [-8, 16], [8, 16], [-8, -4], [8, -4],
    [-24, 6], [24, 6], [-24, -24], [24, -24],
  ];
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd9a0, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const haloGeometry = new THREE.SphereGeometry(0.85, 10, 8);
  for (const [lx, lz] of LAMPS) {
    block(lx, 0, lz, 0.24, 4.2, 0.24, materials.steel, { round: true, shadow: false });
    const lamp = new THREE.PointLight(0xffd9a0, 1.15, 19, 2);
    lamp.position.set(lx, 4.35, lz);
    group.add(lamp);
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.position.set(lx, 4.35, lz);
    group.add(halo);
    halos.push(halo);
  }

  // ---------------------------------------------------------------- sites

  const sites = [
    { id: 'A', name: 'Warehouse', x: -16.5, z: -12.5, radius: 5.2 },
    { id: 'B', name: 'Container yard', x: 17, z: -13, radius: 5.0 },
  ];

  const ringGeometry = new THREE.RingGeometry(0.86, 1, 40);
  const rings = [];
  for (const site of sites) {
    const ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    ring.scale.setScalar(site.radius);
    group.add(ring);
    rings.push(ring);

    // The letter, painted on a canvas once and floated over the site.
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE.accent;
    ctx.font = 'bold 46px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(site.id, 32, 34);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.position.set(site.x, 3.1, site.z);
    sprite.scale.set(1.6, 1.6, 1.6);
    group.add(sprite);
  }

  // ---------------------------------------------------------------- spawns

  // yaw 0 looks down -Z and yaw PI looks down +Z, so each side faces the middle of the yard.
  const spawns = {
    dock: [
      { x: -5, z: 27, yaw: 0 },
      { x: -2, z: 28, yaw: 0 },
      { x: 2, z: 28, yaw: 0 },
      { x: 5, z: 27, yaw: 0 },
      { x: 0, z: 26, yaw: 0 },
    ],
    warden: [
      { x: -5, z: -28, yaw: Math.PI },
      { x: -2, z: -29, yaw: Math.PI },
      { x: 2, z: -29, yaw: Math.PI },
      { x: 5, z: -28, yaw: Math.PI },
      { x: 0, z: -27, yaw: Math.PI },
    ],
  };

  // ---------------------------------------------------------------- queries

  /** Is a body of radius r standing at (x, z) inside something it may not pass? */
  function blockedAt(x, z, r = BOT_RADIUS) {
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (c.maxY <= WALK_BAND_LOW || c.minY >= WALK_BAND_HIGH) continue;
      const nx = Math.max(c.minX, Math.min(x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
      const dx = x - nx;
      const dz = z - nz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /** The highest surface under (x, z) that is at or below `from`. */
  function groundAt(x, z, from = 10) {
    let top = 0;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (c.maxY > from + 0.1 || c.maxY <= top) continue;
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      top = c.maxY;
    }
    return top;
  }

  // ---------------------------------------------------------------- navigation lattice

  function buildNav() {
    const xs = [];
    for (let x = bounds.minX + NAV_INSET; x <= bounds.maxX - NAV_INSET; x += NAV_SPACING) xs.push(x);
    const zs = [];
    for (let z = bounds.minZ + NAV_INSET; z <= bounds.maxZ - NAV_INSET; z += NAV_SPACING) zs.push(z);
    const cols = xs.length;
    const nodes = [];

    for (let zi = 0; zi < zs.length; zi += 1) {
      for (let xi = 0; xi < cols; xi += 1) {
        nodes.push({
          id: zi * cols + xi,
          x: xs[xi],
          z: zs[zi],
          col: xi,
          row: zi,
          walkable: !blockedAt(xs[xi], zs[zi], BOT_RADIUS),
          links: [],
        });
      }
    }

    // A walkable pair of nodes 2.5 m apart can still have a wall between them, so the segment is
    // sampled before the two are linked. Linking on distance alone sends bots into that wall forever.
    const steps = Math.max(2, Math.ceil(NAV_SPACING / 0.5));
    function segmentClear(a, b) {
      for (let s = 1; s < steps; s += 1) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        if (blockedAt(x, z, BOT_RADIUS * 0.8)) return false;
      }
      return true;
    }

    const OFFSETS = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node.walkable) continue;
      for (const [dx, dz] of OFFSETS) {
        const col = node.col + dx;
        const row = node.row + dz;
        if (col < 0 || col >= cols || row < 0 || row >= zs.length) continue;
        const other = nodes[row * cols + col];
        if (!other.walkable) continue;
        if (!segmentClear(node, other)) continue;
        node.links.push(other.id);
      }
    }

    function at(x, z) {
      const col = Math.round((x - (bounds.minX + NAV_INSET)) / NAV_SPACING);
      const row = Math.round((z - (bounds.minZ + NAV_INSET)) / NAV_SPACING);
      const clampedCol = Math.max(0, Math.min(cols - 1, col));
      const clampedRow = Math.max(0, Math.min(zs.length - 1, row));
      return clampedRow * cols + clampedCol;
    }

    function neighbours(id) {
      const node = nodes[id];
      return node ? node.links : [];
    }

    return { nodes, at, neighbours, cols, rows: zs.length, spacing: NAV_SPACING };
  }

  const nav = buildNav();

  // The map joins the scene itself, and the haze that gives the far containers depth.
  scene.add(group);
  scene.fog = new THREE.Fog(0x46606f, 52, 150);

  // The one line the map cannot work without.
  group.updateMatrixWorld(true);

  // ---------------------------------------------------------------- animation

  let clock = 0;
  function tick(dt) {
    clock += dt;
    for (let i = 0; i < rings.length; i += 1) {
      const ring = rings[i];
      ring.material.opacity = 0.3 + Math.sin(clock * 1.6 + i * 1.7) * 0.14;
      ring.scale.setScalar(sites[i].radius * (1 + Math.sin(clock * 1.1 + i) * 0.02));
    }
    for (let i = 0; i < halos.length; i += 1) {
      halos[i].material.opacity = 0.1 + Math.sin(clock * 2.3 + i * 2.1) * 0.035;
    }
  }

  return {
    group, colliders, shootables, spawns, sites, nav, bounds,
    blockedAt, groundAt, tick,
    BOT_RADIUS,
    materials,
    fogColor: new THREE.Color('#46606f'),
  };
}
