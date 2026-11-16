// Every sound in the game, synthesised: no audio files, no network. One AudioContext, one noise
// buffer, one master gain. Each cue is an oscillator or a burst of filtered noise with its own
// envelope.
//
// Two rules that matter. A cue is never scheduled into a suspended context — browsers start the
// context suspended until a real user gesture, and queueing a hundred shots into it makes them all
// fire at once on resume, so every cue checks live() first. And a distant shot is attenuated by
// 1 / (1 + distance / 16), which keeps a firefight across the yard audible without being deafening.

const MAX_DISTANCE_GAIN = 0.06;

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;

  function live() {
    return ctx !== null && ctx.state === 'running' && !muted;
  }

  /** A real user gesture must call this before anything is audible. */
  function unlock() {
    if (ctx === null) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);

      const frames = Math.floor(ctx.sampleRate * 0.4);
      noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function toggle() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    return !muted;
  }

  function panner(pan) {
    if (typeof ctx.createStereoPanner !== 'function') return null;
    const node = ctx.createStereoPanner();
    node.pan.value = Math.max(-1, Math.min(1, pan));
    return node;
  }

  function noise(duration, gain, filterType, frequency, pan) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const envelope = ctx.createGain();
    const now = ctx.currentTime;
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0008, now + duration);
    source.connect(filter);
    filter.connect(envelope);
    const p = panner(pan);
    if (p) {
      envelope.connect(p);
      p.connect(master);
    } else {
      envelope.connect(master);
    }
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  function tone(type, from, to, duration, gain, pan, delay = 0) {
    const osc = ctx.createOscillator();
    osc.type = type;
    const envelope = ctx.createGain();
    const now = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(from, now);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0008, now + duration);
    osc.connect(envelope);
    const p = panner(pan);
    if (p) {
      envelope.connect(p);
      p.connect(master);
    } else {
      envelope.connect(master);
    }
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // One character per gun: the pistol cracks, the SMG snaps, the rifle barks, the sniper booms.
  const SHOTS = {
    tally: { noise: 0.1, gain: 0.22, filter: 'bandpass', frequency: 1800, body: 220, bodyGain: 0.16, bodyType: 'square' },
    skiff: { noise: 0.07, gain: 0.19, filter: 'bandpass', frequency: 2400, body: 300, bodyGain: 0.12, bodyType: 'square' },
    harbor: { noise: 0.12, gain: 0.26, filter: 'lowpass', frequency: 1500, body: 160, bodyGain: 0.2, bodyType: 'sawtooth' },
    longline: { noise: 0.26, gain: 0.3, filter: 'lowpass', frequency: 900, body: 90, bodyGain: 0.26, bodyType: 'sawtooth' },
  };

  /** A shot, panned, quieter with distance: the sound of the other side of the yard. */
  function shot(kind, pan = 0, distance = 0) {
    if (!live()) return;
    const spec = SHOTS[kind] ?? SHOTS.tally;
    const falloff = Math.max(MAX_DISTANCE_GAIN, 1 / (1 + distance / 16));
    noise(spec.noise, spec.gain * falloff, spec.filter, spec.frequency, pan);
    tone(spec.bodyType, spec.body, spec.body * 0.55, spec.noise * 1.4, spec.bodyGain * falloff, pan);
  }

  function dryFire() {
    if (!live()) return;
    tone('square', 900, 320, 0.045, 0.07, 0);
  }

  function impact() {
    if (!live()) return;
    noise(0.06, 0.13, 'highpass', 2600, 0);
  }

  function hit(lethal) {
    if (!live()) return;
    tone('triangle', lethal ? 720 : 1180, lethal ? 300 : 900, lethal ? 0.16 : 0.06, 0.12, 0);
  }

  function reload(kind) {
    if (!live()) return;
    const heavy = kind === 'longline' || kind === 'harbor';
    tone('square', heavy ? 220 : 320, heavy ? 150 : 220, 0.06, 0.09, 0);
    tone('square', heavy ? 180 : 260, heavy ? 120 : 180, 0.08, 0.08, 0, 0.12);
  }

  function footstep(pan = 0) {
    if (!live()) return;
    noise(0.055, 0.05, 'lowpass', 420, pan);
  }

  function beep(pitch = 1.2) {
    if (!live()) return;
    tone('sine', 620 * pitch, 620 * pitch, 0.07, 0.1, 0);
  }

  function explosion() {
    if (!live()) return;
    noise(0.55, 0.42, 'lowpass', 900, 0);
    tone('sawtooth', 120, 32, 0.5, 0.3, 0);
  }

  function sting(win) {
    if (!live()) return;
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    for (let i = 0; i < notes.length; i += 1) {
      tone('triangle', notes[i], notes[i], 0.22, 0.11, 0, i * 0.13);
    }
  }

  /**
   * Where a sound sits between the ears: the offset from the listener projected onto the listener's
   * right-hand vector (yaw 0 looks down -Z, so right is +X).
   */
  function panFor(dx, dz, listenerYaw = 0) {
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001) return 0;
    const rightX = Math.cos(listenerYaw);
    const rightZ = -Math.sin(listenerYaw);
    return Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / distance));
  }

  return { unlock, toggle, shot, dryFire, impact, hit, reload, footstep, beep, explosion, sting, panFor };
}
