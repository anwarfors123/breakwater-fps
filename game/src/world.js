// BREAKWATER — a container terminal at dusk, built out of boxes because a box is honest: it
// collides, it occludes and it reads at a glance. Two sites north of mid, one in a warehouse (A)
// and one in the container stacks (B); attackers come from the south gate, every route meets at
// mid. This module owns the geometry, the colliders, the shootable meshes, the spawns, the sites
// and the navigation lattice the bots path on.

import * as THREE from 'three';
import { PALETTE, rgb } from './palette.js';

const BOUNDS = { minX: -30, maxX: 30, minZ: -32, maxZ: 32 };
const BOT_RADIUS = 0.42;

/** Shared materials, one per surface family: a box never gets its own material. */
function materials() {
  const make = (name, k, roughness = 0.9) =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(rgb(name, k).r, rgb(name, k).g, rgb(name, k).b),
      roughness,
      metalness: name === 'steel' || name === 'rust' ? 0.45 : 0.05,
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
    accent: new THREE.MeshStandardMaterial({
      color: new THREE.Color(rgb('accent').r, rgb('accent').g, rgb('accent').b),
      emissive: new THREE.Color(rgb('accent', 0.55).r, rgb('accent', 0.55).g, rgb('accent', 0.55).b),
      roughness: 0.4,
    }),
  };
}

export function createWorld(scene) {
  const mats = materials();
  const colliders = [];
  const shootables = [];
  const group = new THREE.Group();
  scene.add(group);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);

  /**
   * One solid volume: mesh for the eye, collider for the feet, shootable for the bullets.
   * `solid: false` adds a decorative piece that stops nothing (a roof lip, a painted line).
   */
  function block(x, y, z, w, h, d, mat, opts = {}) {
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

  // Ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mats.asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  shootables.push(ground);

  // Painted lane markings, so the eye can read distance and the floor is not one flat slab.
  for (let i = -3; i <= 3; i += 1) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 64), mats.hairline);
    line.rotation.x = -Math.PI / 2;
    line.position.set(i * 8.5, 0.012, 0);
    group.add(line);
  }

  // Perimeter
  const W = 6.5; // perimeter height
  block(0, 0, BOUNDS.minZ - 0.6, 62, W, 1.2, mats.wall);
  block(0, 0, BOUNDS.maxZ + 0.6, 62, W, 1.2, mats.wall);
  block(BOUNDS.minX - 0.6, 0, 0, 1.2, W, 66, mats.wall);
  block(BOUNDS.maxX + 0.6, 0, 0, 1.2, W, 66, mats.wall);

  // Warehouse, site A (west)
  // Four walls with a wide south doorway and a loading bay on the east face.
  const wx = -17;
  block(wx - 6.5, 0, -21, 7, 5.4, 0.9, mats.wall); // north, west of the back door
  block(wx + 6.5, 0, -21, 7, 5.4, 0.9, mats.wall); // north, east of the back door
  block(wx, 3.9, -21, 6, 1.5, 0.9, mats.wall); // header over the back door
  block(wx - 10.4, 0, -11, 0.9, 5.4, 20, mats.wall); // west
  block(wx + 10.4, 0, -11, 0.9, 5.4, 20, mats.wall); // east, with a bay cut below
  // South face, split around a 6 m doorway at the middle.
  block(wx - 6.5, 0, -1, 7, 5.4, 0.9, mats.wall);
  block(wx + 6.5, 0, -1, 7, 5.4, 0.9, mats.wall);
  block(wx, 3.9, -1, 6, 1.5, 0.9, mats.wall); // header over the doorway
  // Roof, and the trusses that hold it, so the interior is a room and not an open pen.
  block(wx, 5.4, -11, 21, 0.5, 21, mats.concrete, { solid: false, cast: true });
  for (let i = -2; i <= 2; i += 1) {
    block(wx + i * 4.6, 4.6, -11, 0.35, 0.8, 20, mats.steel, { solid: false });
  }
  // Interior cover: two crate walls that make the site defensible from the doorway.
  block(wx - 5.5, 0, -9, 1.6, 1.6, 6.5, mats.crate);
  block(wx + 5.5, 0, -14, 1.6, 1.6, 5.5, mats.crate);
  block(wx - 1.5, 0, -18.5, 3.4, 1.6, 1.6, mats.crate);
  block(wx + 2.5, 1.6, -18.5, 1.6, 1.6, 1.6, mats.crate);

  // Container yard, site B (east)
  const bx = 17;
  const stack = (x, z, along, tiers = 2, mat = mats.steel) => {
    for (let t = 0; t < tiers; t += 1) {
      const jitter = (t % 2) * 0.06;
      block(x, t * 2.6, z, along === 'x' ? 6.1 : 2.5, 2.55, along === 'x' ? 2.5 : 6.1, t === tiers - 1 ? mat : mats.rust, {
        solid: true,
      });
      if (jitter) continue;
    }
  };
  stack(bx - 5, -18, 'x', 2);
  stack(bx + 5, -18, 'x', 2, mats.rust);
  stack(bx - 5, -13, 'z', 1);
  stack(bx + 6.5, -12.5, 'z', 2);
  stack(bx, -7.5, 'x', 1);
  stack(bx - 8.5, -8, 'z', 1);
  // The site itself: a ring of low cover around a stack the defenders can hold behind.
  block(bx, 0, -12.5, 2.5, 1.4, 2.5, mats.crate);
  block(bx + 3.5, 0, -15.5, 1.4, 1.4, 1.4, mats.crate);
  block(bx - 3.5, 0, -15.5, 1.4, 1.4, 1.4, mats.crate);

  // Mid
  // A spine wall down the middle with two gaps: the long door and the short door.
  block(-3.5, 0, 2, 9, 2.3, 0.8, mats.concrete);
  block(4.2, 0, 2, 5.6, 2.3, 0.8, mats.concrete);
  block(0, 2.3, 2, 1.4, 1.2, 0.8, mats.concrete, { solid: false });
  // Crates that break the long sightline without closing it.
  block(-7.5, 0, 6.5, 1.6, 1.6, 1.6, mats.crate);
  block(-6.2, 0, 6.5, 1.6, 1.6, 1.6, mats.crate);
  block(7.8, 0, 6.5, 1.6, 1.6, 1.6, mats.crate);
  block(9.1, 1.6, 6.5, 1.6, 1.6, 1.6, mats.crate);
  block(-11, 0, -2, 1.4, 1.4, 1.4, mats.crate);
  block(11.5, 0, -1, 1.4, 1.4, 1.4, mats.crate);

  // Connectors
  // West long: the wall that separates the warehouse approach from mid.
  block(-13.5, 0, 8, 0.9, 3.2, 14, mats.concrete);
  block(-23.5, 0, 9, 0.9, 3.2, 10, mats.concrete);
  // East short: a container wall that makes the B approach tight.
  block(13.5, 0, 9, 2.5, 2.6, 13, mats.rust);
  block(24.5, 0, 12, 2.5, 2.6, 8, mats.steel);

  // Spawn yards
  block(0, 0, 24, 14, 0.06, 10, mats.dock, { solid: false, shootable: false });
  block(0, 0, -26, 14, 0.06, 10, mats.warden, { solid: false, shootable: false });
  // A few crates to break the spawn silhouettes.
  for (const [x, z] of [[-7.5, 26], [7.5, 26], [-7.5, -28], [7.5, -28]]) {
    block(x, 0, z, 1.5, 1.5, 1.5, mats.crate);
  }

  // Dock lamps: the light the scene is really lit by, and the map's depth cues
  const halos = [];
  const rings = [];
  const lampPosts = [
    [-9, 0, 14],
    [9, 0, 14],
    [-9, 0, -14],
    [9, 0, -14],
    [0, 0, 0],
  ];
  for (const [x, , z] of lampPosts) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8), mats.steel);
    pole.position.set(x, 2.7, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mats.accent);
    head.position.set(x, 5.35, z);
    group.add(head);
    // A halo, not a bigger bulb: the glow is what reads at a distance, and it costs one sphere.
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.68, 12, 10),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(rgb('accent').r, rgb('accent').g, rgb('accent').b),
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.position.set(x, 5.35, z);
    group.add(halo);
    halos.push(halo);
    const lamp = new THREE.PointLight(new THREE.Color(rgb('accent').r, rgb('accent').g, rgb('accent').b), 18, 26, 2);
    lamp.position.set(x, 5.2, z);
    group.add(lamp);
    shootables.push(pole);
  }

  // Bomb sites: a painted ring and a mast, so both are readable from across the yard
  const sites = [
    { id: 'A', name: 'Warehouse', x: wx + 0.5, z: -12.5, radius: 5.2 },
    { id: 'B', name: 'Container yard', x: bx, z: -13, radius: 5.0 },
  ];
  for (const site of sites) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.18, site.radius, 48),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(rgb('accent').r, rgb('accent').g, rgb('accent').b),
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

  // Sky: a dusk gradient dome, so the yard has a horizon instead of a flat fill
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x1b2a38) },
        mid: { value: new THREE.Color(0x46606f) },
        low: { value: new THREE.Color(0xa9793f) },
      },
      vertexShader: `
        varying float h;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          h = normalize(world.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 low;
        varying float h;
        void main() {
          float t = clamp(h * 1.7 + 0.22, 0.0, 1.0);
          vec3 c = mix(low, mid, smoothstep(0.0, 0.38, t));
          c = mix(c, top, smoothstep(0.34, 1.0, t));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  sky.frustumCulled = false;
  scene.add(sky);

  // Light
  // A working yard at dusk, not a night: fog that lifts, a strong low sun and a bright sky bounce.
  scene.fog = new THREE.Fog(new THREE.Color(rgb('canvas').r, rgb('canvas').g, rgb('canvas').b), 52, 150);
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
  // A flat ambient floor: shadowed faces stay readable instead of going black, which is what makes
  // a dusk map feel like a dusk map instead of a night one.
  const ambient = new THREE.AmbientLight(0xdfe8f2, 0.55);
  scene.add(ambient);
  const rim = new THREE.DirectionalLight(0x4a6f8c, 0.5);
  rim.position.set(-24, 16, -26);
  scene.add(rim);

  // Spawns
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

  // Navigation grid
  // A coarse 8-connected lattice, one node every 2.5 m, pruned of every cell a bot could not
  // stand in. Paths are A* over it with a straight-line shortcut pass, which is enough for a
  // map this size and costs nothing to build.
  const nav = buildNav(colliders);

  function blockedAt(x, z, radius = BOT_RADIUS) {
    for (const c of colliders) {
      if (c.maxY <= 0.32) continue; // a painted slab or a kerb is not an obstacle
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

  /** Highest walkable surface under a point, so a bot on a crate is not a bug. */
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

  // The map breathes: the site rings pulse so they read from the far spawn, and the lamp halos
  // flicker a little so the yard is not lit by a still photograph.
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

/** Build the walkable lattice and its adjacency list. */
function buildNav(colliders) {
  const step = 2.5;
  const nodes = [];
  const index = new Map();
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
      index.set(`${Math.round(x * 10)}:${Math.round(z * 10)}`, id);
    }
  }
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
  /** Is the straight line between two nodes actually walkable, or is a wall between them? */
  const segmentClear = (ax, az, bx, bz) => {
    const length = Math.hypot(bx - ax, bz - az);
    const samples = Math.max(2, Math.ceil(length / 0.45));
    for (let i = 1; i < samples; i += 1) {
      const t = i / samples;
      if (!walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  };
  for (const node of nodes) {
    for (let dz = -step; dz <= step; dz += step) {
      for (let dx = -step; dx <= step; dx += step) {
        if (!dx && !dz) continue;
        const other = index.get(`${Math.round((node.x + dx) * 10)}:${Math.round((node.z + dz) * 10)}`);
        if (other === undefined) continue;
        if (dx && dz) {
          // No cutting a corner: a diagonal needs both of its orthogonal neighbours.
          const a = index.get(`${Math.round((node.x + dx) * 10)}:${Math.round(node.z * 10)}`);
          const b = index.get(`${Math.round(node.x * 10)}:${Math.round((node.z + dz) * 10)}`);
          if (a === undefined || b === undefined) continue;
        }
        if (!segmentClear(node.x, node.z, nodes[other].x, nodes[other].z)) continue;
        node.links.push(other);
      }
    }
  }
  return { nodes, at, step };
}
