// Live, normalized touch input. The caller reads `state` each frame and owns
// the game state (including whether a pause request can be accepted).
export function createTouchControls({ root = document, onPause = () => {} } = {}) {
  const find = (id) => root.getElementById?.(id) ?? root.querySelector?.(`#${id}`);
  const state = {
    leftX: 0, leftY: 0, rightX: 0, rightY: 0,
    ascend: false, descend: false, boost: false,
  };
  const controllers = new AbortController();
  const { signal } = controllers;
  const sticks = [];
  const buttons = [];

  function bindStick(id, xKey, yKey) {
    const base = find(id);
    if (!base) return;
    const knob = base.querySelector('.touch-knob');
    let pointer = null;
    const center = { x: 0, y: 0, radius: 1 };

    function move(event) {
      if (event.pointerId !== pointer) return;
      const dx = (event.clientX - center.x) / center.radius;
      const dy = (event.clientY - center.y) / center.radius;
      const length = Math.hypot(dx, dy);
      const scale = length > 1 ? 1 / length : 1;
      state[xKey] = dx * scale;
      state[yKey] = dy * scale;
      if (knob) knob.style.translate = `${state[xKey] * center.radius}px ${state[yKey] * center.radius}px`;
    }
    function release(event) {
      if (event.pointerId !== pointer) return;
      pointer = null;
      state[xKey] = state[yKey] = 0;
      if (knob) knob.style.translate = '';
      base.classList.remove('active');
      if (base.hasPointerCapture?.(event.pointerId)) base.releasePointerCapture(event.pointerId);
    }
    function reset() {
      if (pointer !== null && base.hasPointerCapture?.(pointer)) base.releasePointerCapture(pointer);
      pointer = null;
      state[xKey] = state[yKey] = 0;
      if (knob) knob.style.translate = '';
      base.classList.remove('active');
    }
    base.addEventListener('pointerdown', (event) => {
      if (pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      const rect = base.getBoundingClientRect();
      center.x = rect.left + rect.width / 2;
      center.y = rect.top + rect.height / 2;
      center.radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
      pointer = event.pointerId;
      base.setPointerCapture?.(pointer);
      base.classList.add('active');
      move(event);
    }, { signal });
    base.addEventListener('pointermove', move, { signal });
    base.addEventListener('pointerup', release, { signal });
    base.addEventListener('pointercancel', release, { signal });
    base.addEventListener('lostpointercapture', release, { signal });
    sticks.push(reset);
  }

  function bindButton(id, key) {
    const element = find(id);
    if (!element) return;
    const held = new Set();
    function release(event) {
      held.delete(event.pointerId);
      state[key] = held.size > 0;
      element.classList.toggle('active', state[key]);
      if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    }
    function reset() {
      for (const pointer of held) {
        if (element.hasPointerCapture?.(pointer)) element.releasePointerCapture(pointer);
      }
      held.clear();
      state[key] = false;
      element.classList.remove('active');
    }
    element.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      held.add(event.pointerId);
      element.setPointerCapture?.(event.pointerId);
      state[key] = true;
      element.classList.add('active');
    }, { signal });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      element.addEventListener(name, release, { signal });
    }
    buttons.push(reset);
  }

  bindStick('touchLeft', 'leftX', 'leftY');
  bindStick('touchRight', 'rightX', 'rightY');
  bindButton('touchAscend', 'ascend');
  bindButton('touchDescend', 'descend');
  bindButton('touchBoost', 'boost');
  find('touchPause')?.addEventListener('click', onPause, { signal });

  function reset() {
    sticks.forEach((release) => release());
    buttons.forEach((release) => release());
  }
  window.addEventListener('blur', reset, { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) reset();
  }, { signal });

  return { state, reset, destroy() { reset(); controllers.abort(); } };
}
