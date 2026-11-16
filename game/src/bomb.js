// The charge, on the ground where it was planted: a case with a plate, two wires and a lamp that
// blinks faster the closer the fuse gets to zero. Built once; showing and hiding it costs nothing.
import * as THREE from 'three';

const FUSE_SECONDS = 30;

export function createBombModel(scene, audio) {
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x23282d, roughness: 0.7, metalness: 0.25, emissive: 0x0a0d10 });
  const plate = new THREE.MeshStandardMaterial({ color: 0x3a4249, roughness: 0.5, metalness: 0.5, emissive: 0x10161b });
  const wire = new THREE.MeshStandardMaterial({ color: 0x8d3a2c, roughness: 0.9, emissive: 0x1a0806 });

  const box = (w, h, d, mat, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  box(0.44, 0.16, 0.3, shell, 0, 0.08, 0);
  box(0.3, 0.05, 0.2, plate, 0, 0.17, 0);
  const wireA = box(0.03, 0.03, 0.24, wire, 0.1, 0.18, 0);
  wireA.rotation.y = 0.3;
  const wireB = box(0.03, 0.03, 0.2, wire, -0.1, 0.18, 0.02);
  wireB.rotation.y = -0.5;

  const ledMat = new THREE.MeshStandardMaterial({ color: 0x40100c, emissive: 0xd8321e, emissiveIntensity: 0 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), ledMat);
  led.position.set(0.14, 0.19, -0.08);
  group.add(led);

  const light = new THREE.PointLight(0xff3a22, 0, 3.2, 2);
  light.position.set(0, 0.28, 0);
  group.add(light);

  group.visible = false;
  scene.add(group);

  let clock = 0;
  let wasOn = false;

  function show(x, z) {
    group.position.set(x, 0.01, z);
    group.rotation.y = Math.random() * Math.PI * 2;
    group.visible = true;
    clock = 0;
    wasOn = false;
  }

  function hide() {
    group.visible = false;
    ledMat.emissiveIntensity = 0;
    light.intensity = 0;
  }

  /** `fuse` is the seconds left, so the lamp speeds up as the round runs out. */
  function tick(dt, fuse) {
    if (!group.visible) return;
    clock += dt;
    const urgency = 1 - Math.min(1, Math.max(0, fuse) / FUSE_SECONDS);
    const period = 1.1 - urgency * 0.85; // 1.1 s apart at the start, 0.25 s at the end
    const on = clock % period < period * 0.45;
    ledMat.emissiveIntensity = on ? 2.2 : 0;
    light.intensity = on ? 2.6 : 0;
    if (on && !wasOn) audio.beep(1.6 + urgency * 0.8);
    wasOn = on;
  }

  return { show, hide, tick, group };
}
