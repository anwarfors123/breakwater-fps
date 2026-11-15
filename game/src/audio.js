// All sound is synthesised at runtime with WebAudio: no audio files ship with the game, so the
// repository stays a few hundred kilobytes of readable source. Every cue is a short graph of an
// oscillator, a noise buffer and a filter envelope; the mix is deliberately dry and close, the
// way a small concrete yard sounds. The context is created lazily on the first user gesture,
// because browsers refuse to start one before that.

const NOISE_SECONDS = 1;

export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;
  let muted = false;

  function ensure() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    // One second of white noise, reused by every cue that needs a transient.
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
    const data = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      // Slightly darkened noise: cheaper on the ear than pure white, and it reads as gravel.
      const white = Math.random() * 2 - 1;
      last = last * 0.35 + white * 0.65;
      data[i] = last;
    }
    return ctx;
  }

  /** Resume the context; call from a click or key handler. */
  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  function gain(level, pan = 0) {
    const g = ctx.createGain();
    g.gain.value = level;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(master);
    } else {
      g.connect(master);
    }
    return g;
  }

  function burst({ level, decay, filter, q = 1, pan = 0 }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bq = ctx.createBiquadFilter();
    bq.type = 'lowpass';
    bq.frequency.setValueAtTime(filter, ctx.currentTime);
    bq.frequency.exponentialRampToValueAtTime(Math.max(120, filter * 0.18), ctx.currentTime + decay);
    bq.Q.value = q;
    const g = gain(level, pan);
    g.gain.setValueAtTime(level, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + decay);
    src.connect(bq);
    bq.connect(g);
    src.start();
    src.stop(ctx.currentTime + decay + 0.02);
  }

  function tone({ freq, to, level, decay, type = 'sine', pan = 0 }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + decay);
    const g = gain(level, pan);
    g.gain.setValueAtTime(level, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + decay);
    osc.connect(g);
    osc.start();
    osc.stop(ctx.currentTime + decay + 0.02);
  }

  // A shot is three layers: the crack, the body and a short tail. Heavier rounds are lower and
  // longer, which is what makes the rifle and the SMG tell apart with the eyes closed.
  function shot(kind, pan = 0) {
    if (!ctx || muted) return;
    if (kind === 'rifle') {
      burst({ level: 0.5, decay: 0.19, filter: 3200, q: 0.8, pan });
      tone({ freq: 190, to: 60, level: 0.34, decay: 0.16, type: 'triangle', pan });
    } else if (kind === 'smg') {
      burst({ level: 0.34, decay: 0.1, filter: 4200, q: 0.7, pan });
      tone({ freq: 260, to: 120, level: 0.2, decay: 0.08, type: 'square', pan });
    } else if (kind === 'sniper') {
      burst({ level: 0.6, decay: 0.34, filter: 2600, q: 1.1, pan });
      tone({ freq: 130, to: 42, level: 0.4, decay: 0.3, type: 'triangle', pan });
    } else {
      burst({ level: 0.28, decay: 0.08, filter: 3600, q: 0.6, pan });
      tone({ freq: 320, to: 160, level: 0.16, decay: 0.06, type: 'square', pan });
    }
  }

  function dryFire() {
    if (!ctx || muted) return;
    burst({ level: 0.12, decay: 0.035, filter: 2400, q: 2 });
  }

  function impact(pan = 0) {
    if (!ctx || muted) return;
    burst({ level: 0.16, decay: 0.06, filter: 1800, q: 3, pan });
  }

  function hit(lethal) {
    if (!ctx || muted) return;
    tone({ freq: lethal ? 880 : 620, to: lethal ? 440 : 500, level: 0.16, decay: 0.09, type: 'square' });
  }

  function reload(kind) {
    if (!ctx || muted) return;
    const at = ctx.currentTime;
    // Two mechanical clicks: magazine out, magazine in.
    for (const [offset, level] of [[0, 0.16], [kind === 'sniper' ? 0.75 : 0.42, 0.2]]) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bq = ctx.createBiquadFilter();
      bq.type = 'bandpass';
      bq.frequency.value = 1500;
      bq.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at + offset);
      g.gain.exponentialRampToValueAtTime(level, at + offset + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.07);
      src.connect(bq);
      bq.connect(g);
      g.connect(master);
      src.start(at + offset);
      src.stop(at + offset + 0.09);
    }
  }

  function footstep(pan = 0) {
    if (!ctx || muted) return;
    burst({ level: 0.07, decay: 0.05, filter: 900, q: 1.4, pan });
  }

  function beep(pitch = 1) {
    if (!ctx || muted) return;
    tone({ freq: 1180 * pitch, level: 0.14, decay: 0.07, type: 'square' });
  }

  function explosion() {
    if (!ctx || muted) return;
    burst({ level: 0.7, decay: 0.9, filter: 1800, q: 0.5 });
    tone({ freq: 90, to: 30, level: 0.5, decay: 0.8, type: 'triangle' });
  }

  function sting(win) {
    if (!ctx || muted) return;
    const notes = win ? [392, 523.25, 659.25] : [392, 329.63, 261.63];
    notes.forEach((freq, index) => {
      setTimeout(() => {
        if (!ctx || muted) return;
        tone({ freq, level: 0.14, decay: 0.34, type: 'triangle' });
      }, index * 110);
    });
  }

  function toggle() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  return {
    unlock,
    shot,
    dryFire,
    impact,
    hit,
    reload,
    footstep,
    beep,
    explosion,
    sting,
    toggle,
    get muted() {
      return muted;
    },
    /** Stereo position of a world point relative to the listener, for positional cues. */
    panFor(dx, dz, yaw) {
      const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
      const ahead = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
      if (ahead <= 0.2) return 0;
      return Math.max(-0.9, Math.min(0.9, right / Math.max(6, Math.hypot(dx, dz))));
    },
  };
}
