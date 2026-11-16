// BREAKWATER — a container terminal at dusk. Every solid thing in it is a box, because a box is
// honest: it collides, it occludes and it reads at a glance. Two objectives sit north of mid, one in
// the warehouse (A) and one among the container stacks (B); attackers enter from the south gate and
// every route funnels through mid. This module owns the geometry, the colliders, the shootables, the
// spawns, the objectives and the navigation lattice.

import * as THREE from 'three';
import { PALETTE, rgb } from './palette.js';

const BOUNDS = { minX: -30, maxX: 30, minZ: -32, maxZ: 32 };
const BOT_RADIUS = 0.42;

/** Every surface family gets one material and keeps it: no box is allowed to own its own. */
function surfaceMaterials() {
  const tint = (name, k) => {
    const c = rgb(name, k);
    return new THREE.Color(c.r, c.g, c.b);
  };
  const metal = (name) => (name === 'steel' || name === 'rust' ? 0.45 : 0.05);
  const make = (name, k, roughness = 0.9) =>
    new THREE.MeshStandardMaterial({
      color: tint(name, k),
      roughness,
      metalness: metal(name),
    });
  const glow = new THREE.MeshStandardMaterial({
    color: tint('accent'),
    emissive: tint('accent', 0.55),
    roughness: 0.4,
  });
  return {
    asphalt: make('canvas', 1.95),
    concrete: make('concrete', 1.1),
    wall: make('concrete', 0.92),
    steel: make('steel', 1.0, 0.5),
    rust: make('rust', 1.05, 0.55),
    crate: make('rust', 1.35),
    surface: make('surface', 1.2),
    hairline: make('hairline', 1.4),
    dock: make('dock', 1.0, 0.7),
    warden: make('warden', 1.0, 0.7),
    accent: glow,
  };
}

export function createWorld(scene) {
  const mats = surfaceMaterials();
  const colliders = [];
  const shootables = [];
  const group = new THREE.Group();
  scene.add(group);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);

  /**
   * One solid volume, three jobs: a mesh for the eye, a collider for the feet, a shootable for the
   * bullets. `solid: false` builds a decorative piece that stops nothing — a roof lip, a painted
   * line, a spawn apron.
   */
  function solid(x, y, z, w, h, d, mat, opts = {}) {
    const mesh = new THREE.Mesh(opts.round ? cylinderGeo : boxGeo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (opts.shootable !== false) shootables.push(mesh);
    if (opts.solid !== false) {
      colliders.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minY: y,
        maxY: y + h,
        minZ: z - d / 2,
        maxZ: z + d / 2,
        tag: opts.tag ?? 'wall',
      });
    }
    return mesh;
  }

  // The apron: one plane, and it takes bullets so a missed shot still raises dust.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mats.asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  shootables.push(ground);

  // Painted lane lines: they stop nothing, and they give the eye a ruler for distance.
  for (let i = -3; i <= 3; i += 1) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 64), mats.hairline);
    line.rotation.x = -Math.PI / 2;
    line.position.set(i * 8.5, 0.012, 0);
    group.add(line);
  }

  // Perimeter wall, high enough that nobody reads the void past it.
  const WALL_H = 6.5;
  solid(0, 0, BOUNDS.minZ - 0.6, 62, WALL_H, 1.2, mats.wall);
  solid(0, 0, BOUNDS.maxZ + 0.6, 62, WALL_H, 1.2, mats.wall);
  solid(BOUNDS.minX - 0.6, 0, 0, 1.2, WALL_H, 66, mats.wall);
  solid(BOUNDS.maxX + 0.6, 0, 0, 1.2, WALL_H, 66, mats.wall);

  // Warehouse, objective A (west): four walls, a wide south doorway, a bay cut into the east face.
  const wx = -17;
  solid(wx - 6.5, 0, -21, 7, 5.4, 0.9, mats.wall); // north wall, west of the back door
  solid(wx + 6.5, 0, -21, 7, 5.4, 0.9, mats.wall); // north wall, east of the back door
  solid(wx, 3.9, -21, 6, 1.5, 0.9, mats.wall); // header over the back door
  solid(wx - 10.4, 0, -11, 0.9, 5.4, 20, mats.wall); // west wall
  solid(wx + 10.4, 0, -11, 0.9, 5.4, 20, mats.wall); // east wall, with the bay cut below
  solid(wx - 6.5, 0, -1, 7, 5.4, 0.9, mats.wall); // south wall, west of the doorway
  solid(wx + 6.5, 0, -1, 7, 5.4, 0.9, mats.wall); // south wall, east of the doorway
  solid(wx, 3.9, -1, 6, 1.5, 0.9, mats.wall); // header over the doorway
  // Roof and trusses: the interior is a room, not an open pen.
  solid(wx, 5.4, -11, 21, 0.5, 21, mats.concrete, { solid: false, cast: true });
  for (let i = -2; i <= 2; i += 1) {
    solid(wx + i * 4.6, 4.6, -11, 0.35, 0.8, 20, mats.steel, { solid: false });
  }
  // Interior cover: two crate walls that make the objective defensible from the doorway.
  solid(wx - 5.5, 0, -9, 1.6, 1.6, 6.5, mats.crate);
  solid(wx + 5.5, 0, -14, 1.6, 1.6, 5.5, mats.crate);
  solid(wx - 1.5, 0, -18.5, 3.4, 1.6, 1.6, mats.crate);
  solid(wx + 2.5, 1.6, -18.5, 1.6, 1.6, 1.6, mats.crate);

  // Container yard, objective B (east). A stack is one call: tiers of 2.6 m, top tier in the
  // caller's material so the silhouettes differ.
  const bx = 17;
  const stack = (x, z, along, tiers = 2, mat = mats.steel) => {
    for (let t = 0; t < tiers; t += 1) {
      solid(x, t * 2.6, z, along === 'x' ? 6.1 : 2.5, 2.55, along === 'x' ? 2.5 : 6.1, t === tiers - 1 ? mat : mats.rust);
    }
  };
  stack(bx - 5, -18, 'x', 2);
  stack(bx + 5, -18, 'x', 2, mats.rust);
  stack(bx - 5, -13, 'z', 1);
  stack(bx + 6.5, -12.5, 'z', 2);
  stack(bx, -7.5, 'x', 1);
  stack(bx - 8.5, -8, 'z', 1);
  // Low cover in a ring around the objective: holdable from behind, crossable when you have to.
  solid(bx, 0, -12.5, 2.5, 1.4, 2.5, mats.crate);
  solid(bx + 3.5, 0, -15.5, 1.4, 1.4, 1.4, mats.crate);
  solid(bx - 3.5, 0, -15.5, 1.4, 1.4, 1.4, mats.crate);

  // Mid: a spine wall with two gaps, so the long sightline exists but is never free.
  solid(-3.5, 0, 2, 9, 2.3, 0.8, mats.concrete);
  solid(4.2, 0, 2, 5.6, 2.3, 0.8, mats.concrete);
  solid(0, 2.3, 2, 1.4, 1.2, 0.8, mats.concrete, { solid: false });
  // Crates that break the sightline without closing it.
  solid(-7.5, 0, 6.5, 1.6, 1.6, 1.6, mats.crate);
  solid(-6.2, 0, 6.5, 1.6, 1.6, 1.6, mats.crate);
  solid(7.8, 0, 6.5, 1.6, 1.6, 1.6, mats.crate);
  solid(9.1, 1.6, 6.5, 1.6, 1.6, 1.6, mats.crate);
  solid(-11, 0, -2, 1.4, 1.4, 1.4, mats.crate);
  solid(11.5, 0, -1, 1.4, 1.4, 1.4, mats.crate);

  // Connectors: the west wall separates the warehouse approach from mid; the east container wall
  // makes the B approach tight.
  solid(-13.5, 0, 8, 0.9, 3.2, 14, mats.concrete);
  solid(-23.5, 0, 9, 0.9, 3.2, 10, mats.concrete);
  solid(13.5, 0, 9, 2.5, 2.6, 13, mats.rust);
  solid(24.5, 0, 12, 2.5, 2.6, 8, mats.steel);

  // Spawn aprons, painted not built, plus a few crates so a spawn is not a lineup.
  solid(0, 0, 24, 14, 0.06, 10, mats.dock, { solid: false, shootable: false });
  solid(0, 0, -26, 14, 0.06, 10, mats.warden, { solid: false, shootable: false });
  for (const [x, z] of [[-7.5, 26], [7.5, 26], [-7.5, -28], [7.5, -28]]) {
    solid(x, 0, z, 1.5, 1.5, 1.5, mats.crate);
  }

  // Dock lamps: the light the yard is really lit by, and its depth cues.
  const halos = [];
  const rings = [];
  const lampPosts = [
    [-9, 0, 14],
    [9, 0, 14],
    [-9, 0, -14],
    [9, 0, -14],
    [0, 0, 0],
  ];
  const accentColor = () => {
    const c = rgb('accent');
    return new THREE.Color(c.r, c.g, c.b);
  };
  for (const [x, , z] of lampPosts) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8), mats.steel);
    pole.position.set(x, 2.7, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mats.accent);
    head.position.set(x, 5.35, z);
    group.add(head);
    // A halo rather than a bigger bulb: the glow is what carries at distance and it costs one sphere.
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.68, 12, 10),
      new THREE.MeshBasicMaterial({
        color: accentColor(),
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.position.set(x, 5.35, z);
    group.add(halo);
    halos.push(halo);
    const lamp = new THREE.PointLight(accentColor(), 18, 26, 2);
    lamp.position.set(x, 5.2, z);
    group.add(lamp);
    shootables.push(pole);
  }

  // Objectives: a painted ring and a mast each, readable from the opposite spawn.
  const sites = [
    { id: 'A', name: 'Warehouse', x: wx + 0.5, z: -12.5, radius: 5.2 },
    { id: 'B', name: 'Container yard', x: bx, z: -13, radius: 5.0 },
  ];
  for (const site of sites) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.18, site.radius, 48),
      new THREE.MeshBasicMaterial({
        color: accentColor(),
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    group.add(ring);
    rings.push(ring);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), mats.accent);
    mast.position.set(site.x, 1.1, site.z);
    group.add(mast);
  }

  // Sky: a three-band dome, so the yard has a horizon instead of a flat fill behind the wall.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        band: { value: new THREE.Color(0x1b2a38) },
        haze: { value: new THREE.Color(0x46606f) },
        dusk: { value: new THREE.Color(0xa9793f) },
      },
      vertexShader: `
        varying float elev;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          elev = normalize(world.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform vec3 band; uniform vec3 haze; uniform vec3 dusk;
        varying float elev;
        void main() {
          float t = clamp(elev * 1.7 + 0.22, 0.0, 1.0);
          vec3 c = mix(dusk, haze, smoothstep(0.0, 0.38, t));
          c = mix(c, band, smoothstep(0.34, 1.0, t));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  sky.frustumCulled = false;
  scene.add(sky);

  // Light. A working yard at dusk, not a night: fog that lifts, a strong low sun, a bright sky
  // bounce and a flat ambient floor so shadowed faces stay readable.
  const fogColor = rgb('canvas');
  scene.fog = new THREE.Fog(new THREE.Color(fogColor.r, fogColor.g, fogColor.b), 52, 150);
  const hemi = new THREE.HemisphereLight(0xa8c4d8, 0x5a5145, 1.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b8, 2.15);
  sun.position.set(26, 34, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -42;
  sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 42;
  sun.shadow.camera.bottom = -42;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const ambient = new THREE.AmbientLight(0xdfe8f2, 0.55);
  scene.add(ambient);
  const rim = new THREE.DirectionalLight(0x4a6f8c, 0.5);
  rim.position.set(-24, 16, -26);
  scene.add(rim);

  // Spawns, five a side, facing the map's middle.
  const spawns = {
    dock: [
      { x: -5, z: 27, yaw: Math.PI },
      { x: -2, z: 28, yaw: Math.PI },
      { x: 2, z: 28, yaw: Math.PI },
      { x: 5, z: 27, yaw: Math.PI },
      { x: 0, z: 26, yaw: Math.PI },
    ],
    warden: [
      { x: -5, z: -28, yaw: 0 },
      { x: -2, z: -29, yaw: 0 },
      { x: 2, z: -29, yaw: 0 },
      { x: 5, z: -28, yaw: 0 },
      { x: 0, z: -27, yaw: 0 },
    ],
  };

  // The lattice the bots path on: coarse, pruned and built once.
  const nav = buildLattice(colliders);

  function blockedAt(x, z, radius = BOT_RADIUS) {
    for (const c of colliders) {
      if (c.maxY <= 0.32) continue; // a painted apron or a kerb is not an obstacle
      if (
        x + radius > c.minX &&
        x - radius < c.maxX &&
        z + radius > c.minZ &&
        z - radius < c.maxZ &&
        c.minY < 1.8
      ) {
        return true;
      }
    }
    return false;
  }

  /** The highest walkable surface under a point, so a bot standing on a crate is not a bug. */
  function groundAt(x, z, from = 2.2) {
    let best = 0;
    for (const c of colliders) {
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && c.maxY <= from && c.maxY > best) {
        best = c.maxY;
      }
    }
    return best;
  }

  // Bake the transforms now: the world never moves, and a raycast before the first render would
  // otherwise see every plane in its unrotated pose.
  group.updateMatrixWorld(true);

  // The map breathes: objective rings pulse, lamp halos flicker, so the yard is not a photograph.
  let clock = 0;
  function tick(dt) {
    clock += dt;
    for (let i = 0; i < rings.length; i += 1) {
      rings[i].material.opacity = 0.34 + 0.16 * Math.sin(clock * 1.7 + i * 2.1);
    }
    for (let i = 0; i < halos.length; i += 1) {
      halos[i].material.opacity = 0.16 + 0.05 * Math.sin(clock * 2.6 + i * 1.3);
    }
  }

  return { group, colliders, shootables, spawns, sites, nav, bounds: BOUNDS, blockedAt, groundAt, tick, BOT_RADIUS };
}

/** The walkable lattice and its adjacency list: one node every 2.5 m, 8-connected, pruned. */
function buildLattice(colliders) {
  const step = 2.5;
  const nodes = [];
  const index = new Map();
  const key = (x, z) => `${Math.round(x * 10)}:${Math.round(z * 10)}`;

  const walkable = (x, z) => {
    if (x < BOUNDS.minX + 1.2 || x > BOUNDS.maxX - 1.2) return false;
    if (z < BOUNDS.minZ + 1.2 || z > BOUNDS.maxZ - 1.2) return false;
    for (const c of colliders) {
      if (c.maxY <= 0.32 || c.minY >= 1.7) continue;
      if (x > c.minX - BOT_RADIUS && x < c.maxX + BOT_RADIUS && z > c.minZ - BOT_RADIUS && z < c.maxZ + BOT_RADIUS) {
        return false;
      }
    }
    return true;
  };

  for (let z = BOUNDS.minZ + 1.2; z <= BOUNDS.maxZ - 1.2; z += step) {
    for (let x = BOUNDS.minX + 1.2; x <= BOUNDS.maxX - 1.2; x += step) {
      if (!walkable(x, z)) continue;
      const id = nodes.length;
      nodes.push({ id, x, z, links: [] });
      index.set(key(x, z), id);
    }
  }

  /** The node nearest a point: every post a bot is sent to is one of these. */
  const at = (x, z) => {
    let best = -1;
    let bestD = Infinity;
    for (const node of nodes) {
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = node.id;
      }
    }
    return best;
  };

  /** Is the straight line between two nodes walkable, or is there a wall in it? */
  const segmentClear = (ax, az, bx2, bz) => {
    const length = Math.hypot(bx2 - ax, bz - az);
    const samples = Math.max(2, Math.ceil(length / 0.45));
    for (let i = 1; i < samples; i += 1) {
      const t = i / samples;
      if (!walkable(ax + (bx2 - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  };

  for (const node of nodes) {
    for (let dz = -step; dz <= step; dz += step) {
      for (let dx = -step; dx <= step; dx += step) {
        if (!dx && !dz) continue;
        const other = index.get(key(node.x + dx, node.z + dz));
        if (other === undefined) continue;
        if (dx && dz) {
          // No cutting a corner: a diagonal link needs both of its orthogonal neighbours to exist.
          const a = index.get(key(node.x + dx, node.z));
          const b = index.get(key(node.x, node.z + dz));
          if (a === undefined || b === undefined) continue;
        }
        if (!segmentClear(node.x, node.z, nodes[other].x, nodes[other].z)) continue;
        node.links.push(other);
      }
    }
  }
  return { nodes, at, step };
}
