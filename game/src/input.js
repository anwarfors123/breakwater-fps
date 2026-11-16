// Input: the keyboard as held codes, the mouse as a look delta the frame consumes, pointer
// lock as the thing that makes aiming possible. It reports what the hands did.

const SENSITIVITY = 0.0022; // radians per pixel at the base field of view
const DELTA_CEILING = 220; // pixels: a pointer-lock glitch, never a hand, jumps further than this

export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    aiming: false,
    lookX: 0,
    lookY: 0,
    locked: false,
    sensitivity: SENSITIVITY,
  };

  // Press handlers registered with onKey, called with the code of each key that goes down.
  const listeners = [];

  const clamp = (v) => Math.max(-DELTA_CEILING, Math.min(DELTA_CEILING, v));

  function handleKeyDown(event) {
    // Tab is the scoreboard and must not move focus out of the game; space must not scroll.
    if (event.code === 'Tab' || event.code === 'Space') event.preventDefault();
    state.keys.add(event.code);
    for (const listener of listeners) listener(event.code, event);
  }

  function handleKeyUp(event) {
    state.keys.delete(event.code);
  }

  function handleMouseMove(event) {
    if (!state.locked) return;
    // The ceiling only ever catches a broken delta, never a flick of the hand.
    state.lookX += clamp(event.movementX ?? 0) * state.sensitivity;
    state.lookY += clamp(event.movementY ?? 0) * state.sensitivity;
  }

  function handleMouseDown(event) {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  }

  function handleMouseUp(event) {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  }

  function handleLockChange() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      // A lost lock is a lost trigger: no gun may fire itself after alt-tab.
      state.firing = false;
      state.aiming = false;
      state.keys.clear();
    }
    onLockChange(state.locked);
  }

  function handleBlur() {
    // A window that loses focus holds no keys, or the player walks into a wall forever.
    state.keys.clear();
    state.firing = false;
  }

  const swallow = (event) => event.preventDefault();

  // The right button aims, so neither the window nor the canvas may open a context menu.
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mouseup', handleMouseUp);
  window.addEventListener('contextmenu', swallow);
  canvas.addEventListener('contextmenu', swallow);
  window.addEventListener('blur', handleBlur);
  document.addEventListener('pointerlockchange', handleLockChange);

  /** Rotation accumulated since the last call, in radians. */
  function takeLook() {
    const delta = { x: state.lookX, y: state.lookY };
    state.lookX = 0;
    state.lookY = 0;
    return delta;
  }

  function requestLock() {
    if (document.pointerLockElement === canvas) return;
    const asked = canvas.requestPointerLock?.();
    // Newer Chrome returns a promise; a refused lock is not an error.
    if (asked && typeof asked.catch === 'function') asked.catch(() => {});
  }

  function exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Follow every key press, for the one-shot keys the loop does not poll. */
  function onKey(handler) {
    listeners.push(handler);
  }

  return { state, takeLook, requestLock, exitLock, onKey };
}
