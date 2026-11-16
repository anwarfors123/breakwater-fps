// The charge, as a thing on the floor: a case, a plate, two wires and a red LED. The main loop shows
// it whenever the match says the charge is planted and hides it otherwise, so a defusal, a
// detonation and a round reset all take it off the map without any bookkeeping here.
//
// The lamp is the round's clock: its period runs from 1.1 s at the start of the fuse to 0.25 s at the
// end, and every rise plays a beep that climbs with the urgency.

import * as THREE from 'three';

const FUSE_SECONDS = 30;      // the charge's own fuse, for the urgency ramp
const SLOW_PERIOD = 1.1;
const FAST_PERIOD = 0.25;

export function createBombModel(scene, audio) {
  const group = new THREE.Group();
  group.visible = false;

  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.2, 0.28),
    new THREE.MeshStandardMaterial({ color: '#2b343d', roughness: 0.62, metalness: 0.35 }),
  );
  caseMesh.position.y = 0.1;
  caseMesh.castShadow = true;
  group.add(caseMesh);

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.03, 0.16),
    new THREE.MeshStandardMaterial({ color: '#12171c', roughness: 0.5, metalness: 0.6 }),
  );
  plate.position.set(0.06, 0.21, 0);
  group.add(plate);

  const wireMaterial = new THREE.MeshStandardMaterial({ color: '#c8622f', roughness: 0.7, metalness: 0.1 });
  const wireGeometry = new THREE.BoxGeometry(0.16, 0.012, 0.012);
  const wireA = new THREE.Mesh(wireGeometry, wireMaterial);
  wireA.position.set(-0.1, 0.21, 0.06);
  wireA.rotation.y = 0.5;
  group.add(wireA);
  const wireB = new THREE.Mesh(wireGeometry, wireMaterial);
  wireB.position.set(-0.1, 0.21, -0.06);
  wireB.rotation.y = -0.5;
  group.add(wireB);

  const ledMaterial = new THREE.MeshStandardMaterial({
    color: '#3a0d0a',
    emissive: '#ff3b2f',
    emissiveIntensity: 0.4,
    roughness: 0.4,
  });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), ledMaterial);
  led.position.set(0.06, 0.24, 0);
  group.add(led);

  const glow = new THREE.PointLight('#ff3b2f', 0, 3.2, 2);
  glow.position.set(0.06, 0.34, 0);
  group.add(glow);

  scene.add(group);

  let phase = 0;       // seconds into the current lamp period
  let rising = false;
  let urgency = 0;

  function show(x, z) {
    group.position.set(x, 0, z);
    group.visible = true;
    phase = 0;
    rising = false;
    urgency = 0;
  }

  function hide() {
    group.visible = false;
    glow.intensity = 0;
    ledMaterial.emissiveIntensity = 0.4;
  }

  /** dt in seconds, fuse the seconds left on the charge. */
  function tick(dt, fuse) {
    if (!group.visible) return;
    urgency = 1 - Math.max(0, Math.min(1, fuse / FUSE_SECONDS));
    const period = SLOW_PERIOD + (FAST_PERIOD - SLOW_PERIOD) * urgency;

    phase += dt;
    if (phase >= period) {
      phase -= period;
      rising = true;
      if (audio) audio.beep(1.6 + urgency * 0.8);
    }

    // A short rise and a longer fall: a lamp, not a sine wave.
    const rise = Math.min(1, phase / (period * 0.18));
    const level = rising && phase < period * 0.3 ? rise : Math.max(0, 1 - phase / (period * 0.55));
    ledMaterial.emissiveIntensity = 0.35 + level * 3.1;
    glow.intensity = level * (0.6 + urgency * 1.6);
  }

  return { show, hide, tick, group };
}
