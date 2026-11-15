import test from 'node:test';
import assert from 'node:assert/strict';
import { createTouchControls } from '../src/touch.js';

class Element extends EventTarget {
  constructor() { super(); this.style = {}; this.classList = { add() {}, remove() {}, toggle() {} }; this.captured = new Set(); this.knob = { style: {} }; }
  querySelector() { return this.knob; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  send(type, id, x = 50, y = 50) {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y });
    this.dispatchEvent(e);
  }
}

test('joysticks and boost work independently and reset on cancellation', () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const windowMock = new EventTarget(), documentMock = new EventTarget();
  globalThis.window = windowMock; globalThis.document = documentMock;
  try {
    const elements = Object.fromEntries(['touchLeft','touchRight','touchAscend','touchDescend','touchBoost','touchPause'].map(id => [id,new Element()]));
    const controls = createTouchControls({ root: { getElementById: id => elements[id] } });
    elements.touchLeft.send('pointerdown', 1, 100, 50);
    elements.touchRight.send('pointerdown', 2, 50, 0);
    elements.touchBoost.send('pointerdown', 3);
    assert.equal(controls.state.leftX, 1);
    assert.equal(controls.state.rightY, -1);
    assert.equal(controls.state.boost, true);
    elements.touchRight.send('pointercancel', 2);
    assert.equal(controls.state.rightY, 0);
    assert.equal(controls.state.leftX, 1);
    windowMock.dispatchEvent(new Event('blur'));
    assert.equal(controls.state.leftX, 0);
    assert.equal(controls.state.boost, false);
    controls.destroy();
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});
