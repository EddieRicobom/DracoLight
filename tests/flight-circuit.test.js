import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFlightCircuit, FlightCircuit, ROOFTOP_GATES } from '../src/flight-circuit.js';

const point = (x, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const gate = (x) => ({ center: point(x), normal: point(1), radius: 8 });

test('the optional circuit counts only the next gate and sweeps fast movement through its opening', () => {
  const gates = [gate(0), gate(25), gate(50)];
  const circuit = new FlightCircuit(gates);
  assert.equal(circuit.update(point(-100), point(100), 1, 1), null);
  assert.equal(circuit.nextGate, null);

  circuit.start();
  circuit.update(point(10), point(60), 2, 1);
  circuit.update(point(-100, 9), point(100, 9), 3, 1);
  assert.equal(circuit.nextGate, gates[0], 'later gates and movements outside the opening do not count');

  const result = circuit.update(point(-100), point(100), 4, 1);
  assert.deepEqual(result, { duration: 250, record: true });
  assert.equal(circuit.nextGate, null);
});

test('the clock starts at the first arc and cancellation keeps the personal record', () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const gates = [gate(0), gate(25)];
  const circuit = new FlightCircuit(gates, storage);
  circuit.start();
  assert.equal(circuit.startedAt, null);
  circuit.update(point(5), point(0), 11, 1);
  assert.equal(circuit.startedAt, 11, 'the start gate also accepts an exact crossing from the opposite side');
  assert.deepEqual(circuit.update(point(20), point(30), 14, 1), { duration: 2500, record: true });

  const reloaded = new FlightCircuit(gates, storage);
  assert.equal(reloaded.best, 2500);
  reloaded.start();
  reloaded.update(point(-1), point(2), 20, 1);
  reloaded.cancel();
  assert.equal(reloaded.nextGate, null);
  assert.equal(reloaded.startedAt, null);
  assert.equal(reloaded.best, 2500);
  assert.equal(memory.size, 1);
});

test('an unavailable browser store leaves the best elapsed time available for the session', () => {
  const reject = () => { throw new Error('storage unavailable'); };
  const circuit = new FlightCircuit([gate(0), gate(25)], { getItem: reject, setItem: reject });
  circuit.start();
  assert.deepEqual(circuit.update(point(-100), point(100), 1, 1), { duration: 125, record: true });
  circuit.start();
  assert.deepEqual(circuit.update(point(-100), point(100), 4, 2), { duration: 250, record: false });
  assert.equal(circuit.best, 125);
});

test('the city circuit closes at its starting point and clears the roofs along each leg', async () => {
  globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }) };
  const { City, CH } = await import('../src/city.js');
  const city = Object.create(City.prototype);
  city._layout();
  assert.ok(ROOFTOP_GATES[0].center.equals(ROOFTOP_GATES.at(-1).center));
  assert.ok(ROOFTOP_GATES[0].normal.angleTo(ROOFTOP_GATES.at(-1).normal) > 0.25);
  const sample = new THREE.Vector3();
  for (let i = 1; i < ROOFTOP_GATES.length; i++) {
    const a = ROOFTOP_GATES[i - 1], b = ROOFTOP_GATES[i];
    const samples = Math.ceil(a.center.distanceTo(b.center) / 2);
    for (let s = 0; s <= samples; s++) {
      sample.lerpVectors(a.center, b.center, s / samples);
      const margin = b.radius + 5;
      for (const lot of city.lots) {
        if (sample.x < lot.x - margin || sample.x > lot.x + lot.w + margin) continue;
        if (sample.z < lot.z - margin || sample.z > lot.z + lot.d + margin) continue;
        assert.ok(sample.y - lot.h * CH >= margin, `leg ${i} clears building at ${lot.x},${lot.z}`);
      }
    }
  }
});

test('the marker guides an enabled dragon through the complete route and clears when switching characters', (t) => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
  t.after(() => {
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
    else delete globalThis.localStorage;
  });
  const scene = new THREE.Scene();
  const button = { addEventListener(event, handler) { this[event] = handler; } };
  const readout = {}, notice = {}, bearing = { style: {} }, record = {};
  const ui = createFlightCircuit(scene, { button, readout, bearing, notice, record });
  const marker = scene.children[0];
  assert.equal(marker.visible, false);
  assert.equal(bearing.hidden, true);
  button.click();
  assert.equal(button.textContent, 'Cancelar percurso');
  assert.equal(marker.visible, true);
  const regularPattern = marker.geometry.attributes.color;
  const center = ROOFTOP_GATES[0].center;
  const before = center.clone().add(point(0, 0, 50));
  ui.update(before, before, Math.PI, 0.5, 0.5);
  assert.equal(readout.textContent, 'Partida · 50 m');
  button.click();
  assert.equal(marker.visible, false);
  button.click();
  for (const [i, gate] of ROOFTOP_GATES.entries()) {
    if (i === ROOFTOP_GATES.length - 1) {
      assert.match(readout.textContent, /^Chegada/);
      assert.notEqual(marker.geometry.attributes.color, regularPattern);
    }
    ui.update(gate.center.clone().addScaledVector(gate.normal, -30),
      gate.center.clone().addScaledVector(gate.normal, 30), 0, i + 1, 1);
  }
  assert.equal(marker.visible, false);
  assert.equal(scene.children.length, 1, 'one reusable mesh covers every gate');
  assert.equal(notice.textContent, 'Novo recorde · 0:07.00');
  assert.equal(record.textContent, 'Seu recorde 0:07.00');
  assert.equal(button.textContent, 'Ativar percurso');
  ui.update(before, before, Math.PI, 13, 1);
  assert.equal(notice.textContent, '');

  button.click();
  ui.setAvailable(false);
  assert.equal(marker.visible, false);
  assert.equal(button.disabled, true);
  assert.equal(bearing.hidden, true);
  assert.equal(readout.textContent, '');
});
