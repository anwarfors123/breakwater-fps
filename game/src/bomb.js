// The charge where it was planted: a case, a plate, two wires and a lamp that blinks
// faster as the fuse runs out. Built once; planting costs a position.
import * as THREE from 'three';

const FUSE_SECONDS = 30;

export function createBombModel(scene, audio) {
  const group = new THREE.Group();

  // Three materials, no textures: a dark case, a machined plate and a red wire.
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x23282d, roughness: 0.7, metalness: 0.25, emissive: 0x0a0d10 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x3a4249, roughness: 0.5, metalness: 0.5, emissive: 0x10161b });
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x8d3a2c, roughness: 0.9, emissive: 0x1a0806 });

  /** A part of the charge: sized, placed, shadowed and parented. */
  function part(w, h, d, mat, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  part(0.44, 0.16, 0.3, caseMat, 0, 0.08, 0);
  part(0.3, 0.05, 0.2, plateMat, 0, 0.17, 0);
  const wireA = part(0.03, 0.03, 0.24, wireMat, 0.1, 0.18, 0);
  wireA.rotation.y = 0.3;
  const wireB = part(0.03, 0.03, 0.2, wireMat, -0.1, 0.18, 0.02);
  wireB.rotation.y = -0.5;


  const ledMat = new THREE.MeshStandardMaterial({ color: 0x40100c, emissive: 0xd8321e, emissiveIntensity: 0 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), ledMat);
  led.position.set(0.14, 0.19, -0.08);
  group.add(led);

  const lamp = new THREE.PointLight(0xff3a22, 0, 3.2, 2);
  lamp.position.set(0, 0.28, 0);
  group.add(lamp);

  group.visible = false;
  scene.add(group);

  let elapsed = 0;
  let litLastTick = false;

  /** Put the charge down, turned to a fresh angle so two plants never look alike. */
  function show(x, z) {
    group.position.set(x, 0.01, z);
    group.rotation.y = Math.random() * Math.PI * 2;
    group.visible = true;
    elapsed = 0;
    litLastTick = false;
  }

  function hide() {
    group.visible = false;
    ledMat.emissiveIntensity = 0;
    lamp.intensity = 0;
  }

  /** `fuse` is the seconds left, so the lamp speeds up as the round runs out. */
  function tick(dt, fuse) {
    if (!group.visible) return;
    elapsed += dt;
    // 0 at the start of the fuse, 1 when it is out: the lamp and beep ride it.
    const urgency = 1 - Math.min(1, Math.max(0, fuse) / FUSE_SECONDS);
    const period = 1.1 - urgency * 0.85; // 1.1 s apart at the start, 0.25 s at the end
    const lit = elapsed % period < period * 0.45;
    ledMat.emissiveIntensity = lit ? 2.2 : 0;
    lamp.intensity = lit ? 2.6 : 0;
    // One beep per blink: the rising edge, not every frame the lamp is on.
    if (lit && !litLastTick) audio.beep(1.6 + urgency * 0.8);
    litLastTick = lit;
  }

  return { show, hide, tick, group };
}
