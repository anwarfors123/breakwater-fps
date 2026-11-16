// Input: pointer lock, the held key set, the two mouse buttons and the mouse delta.
//
// Two rules learned the hard way. The delta is banked as raw pixels and handed over on the tick it
// arrives — a smoothing chaser kept state between frames, so a stutter banked rotation and the next
// tick spent it all at once, which the player reports as "the sensitivity suddenly spikes". And a
// single movement event is clamped, because pointer lock occasionally reports a jump of thousands of
// pixels when a window regains focus.

const LOOK_CLAMP_PX = 220;

export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    aiming: false,
    locked: false,
    sensitivity: 0.0022,
  };

  let deltaX = 0;
  let deltaY = 0;
  const keyHandlers = [];

  function clampDelta(value) {
    if (value > LOOK_CLAMP_PX) return LOOK_CLAMP_PX;
    if (value < -LOOK_CLAMP_PX) return -LOOK_CLAMP_PX;
    return value;
  }

  function onMouseMove(event) {
    if (!state.locked) return;
    deltaX += clampDelta(event.movementX ?? 0);
    deltaY += clampDelta(event.movementY ?? 0);
  }

  function onMouseDown(event) {
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  }

  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  }

  function onKeyDown(event) {
    // Tab would move focus out of the canvas and Ctrl+W would close the tab, so both are swallowed
    // here and answered in the HUD instead.
    if (event.code === 'Tab') event.preventDefault();
    state.keys.add(event.code);
    if (!event.repeat) {
      for (let i = 0; i < keyHandlers.length; i += 1) keyHandlers[i](event.code);
    }
  }

  function onKeyUp(event) {
    state.keys.delete(event.code);
  }

  function onBlur() {
    state.keys.clear();
    state.firing = false;
    state.aiming = false;
  }

  function onLockEvent() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      state.firing = false;
      state.aiming = false;
    }
    deltaX = 0;
    deltaY = 0;
    if (onLockChange) onLockChange(state.locked);
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('pointerlockchange', onLockEvent);

  /** The look delta banked since the last call, in radians; zeroes the accumulator. */
  function takeLook() {
    const x = deltaX * state.sensitivity;
    const y = deltaY * state.sensitivity;
    deltaX = 0;
    deltaY = 0;
    return { x, y };
  }

  function onKey(handler) {
    keyHandlers.push(handler);
  }

  function requestLock() {
    if (document.pointerLockElement !== canvas) {
      const request = canvas.requestPointerLock?.();
      if (request && typeof request.catch === 'function') request.catch(() => {});
    }
  }

  function exitLock() {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  return { state, takeLook, onKey, requestLock, exitLock };
}
