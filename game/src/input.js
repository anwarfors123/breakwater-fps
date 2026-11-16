// Input: the keyboard as a set of held codes, the mouse as a look delta the frame consumes, and
// pointer lock as the thing that makes aiming possible. Nothing here knows about the game — it
// reports what the hands did, and the loop decides what that means.

export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    aiming: false,
    lookX: 0,
    lookY: 0,
    locked: false,
    sensitivity: 0.0022,
  };
  const pressed = new Set(); // one-shot presses, drained by the loop
  const handlers = { key: [], click: [] };

  function onKeyDown(event) {
    // Tab is the scoreboard, so it must not move focus; space must not scroll.
    if (event.code === 'Tab' || event.code === 'Space') event.preventDefault();
    if (!state.keys.has(event.code)) pressed.add(event.code);
    state.keys.add(event.code);
    for (const handler of handlers.key) handler(event.code, event);
  }

  function onKeyUp(event) {
    state.keys.delete(event.code);
  }

  function onMouseMove(event) {
    if (!state.locked) return;
    // A pointer-lock glitch can report a jump of thousands of pixels; a hand never does in one event.
    const dx = Math.max(-220, Math.min(220, event.movementX));
    const dy = Math.max(-220, Math.min(220, event.movementY));
    state.lookX += dx * state.sensitivity;
    state.lookY += dy * state.sensitivity;
  }

  function onMouseDown(event) {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) {
      state.aiming = true;
      pressed.add('Mouse2');
    }
  }

  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  }

  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      state.firing = false;
      state.aiming = false;
      state.keys.clear();
    }
    onLockChange(state.locked);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  // The right button aims, so it must not open the browser's menu over the yard.
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', () => {
    state.keys.clear();
    state.firing = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', onLock);

  function requestLock() {
    if (document.pointerLockElement !== canvas) {
      const result = canvas.requestPointerLock?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    }
  }

  function exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Consume the accumulated look delta. */
  function takeLook() {
    const out = { x: state.lookX, y: state.lookY };
    state.lookX = 0;
    state.lookY = 0;
    return out;
  }

  /** True once per physical press. */
  function consume(code) {
    if (!pressed.has(code)) return false;
    pressed.delete(code);
    return true;
  }

  function clearPressed() {
    pressed.clear();
  }

  function onKey(handler) {
    handlers.key.push(handler);
  }

  return { state, takeLook, consume, clearPressed, requestLock, exitLock, onKey };
}
