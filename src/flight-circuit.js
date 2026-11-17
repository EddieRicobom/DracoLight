import * as THREE from 'three';

const RECORD_KEY = 'draco-light-rooftop-circuit-ms-v1';
const GATE_RADIUS = 22;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const route = [
  [0, 295, 45],
  [0, 295, -225],
  [220, 100, -410],
  [500, 70, -340],
  [590, 70, -40],
  [365, 80, 235],
  [90, 130, 295],
  [0, 295, 45],
];

export const ROOFTOP_GATES = route.map(([x, y, z], i) => {
  const from = route[Math.max(0, i - 1)], to = route[Math.max(1, i)];
  const normal = new THREE.Vector3(to[0] - from[0], 0, to[2] - from[2]).normalize();
  return { center: new THREE.Vector3(x, y, z), normal, radius: GATE_RADIUS };
});

function crossing(start, end, { center, normal, radius }) {
  const x = start.x - center.x, y = start.y - center.y, z = start.z - center.z;
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const before = x * normal.x + y * normal.y + z * normal.z;
  const after = before + dx * normal.x + dy * normal.y + dz * normal.z;
  if (before === 0 || (before < 0 && after < 0) || (before > 0 && after > 0)) return -1;

  const t = before / (before - after);
  return (x + t * dx) ** 2 + (y + t * dy) ** 2 + (z + t * dz) ** 2 <= radius ** 2 ? t : -1;
}

function loadBest(storage) {
  try {
    const value = Number(storage?.getItem(RECORD_KEY));
    if (Number.isSafeInteger(value) && value > 0) return value;
  } catch { /* Flight remains available without storage. */ }
  return null;
}

export class FlightCircuit {
  constructor(gates, storage) {
    this.gates = gates;
    this.storage = storage;
    this.best = loadBest(storage);
    this.cancel();
  }

  get nextGate() { return this.gates[this.index] ?? null; }

  start() {
    this.cancel();
    this.index = 0;
  }

  cancel() {
    this.index = -1;
    this.startedAt = null;
  }

  update(start, end, elapsed, dt) {
    let previousCrossing = -1;
    while (this.nextGate) {
      const t = crossing(start, end, this.nextGate);
      if (t <= previousCrossing) return null;
      previousCrossing = t;
      const crossedAt = elapsed - dt * (1 - t);
      if (this.index === 0) this.startedAt = crossedAt;
      if (++this.index < this.gates.length) continue;

      const duration = Math.max(1, Math.round((crossedAt - this.startedAt) * 1000));
      const saved = loadBest(this.storage);
      if (saved !== null && (this.best === null || saved < this.best)) this.best = saved;
      const record = this.best === null || duration < this.best;
      if (record) {
        this.best = duration;
        try { this.storage?.setItem(RECORD_KEY, String(duration)); }
        catch { /* Keep the record for this session when saving is unavailable. */ }
      }
      this.cancel();
      return { duration, record };
    }
    return null;
  }
}

function formatTime(milliseconds) {
  const centiseconds = Math.floor(milliseconds / 10);
  const seconds = Math.floor(centiseconds / 100);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
}

function createMarker() {
  const segments = 40;
  const geometry = new THREE.RingGeometry(GATE_RADIUS, GATE_RADIUS + 4.5, segments, 3);
  const regular = new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3);
  const finish = regular.clone();
  const ink = new THREE.Color(0x202020), paper = new THREE.Color(0xf5f5f5);
  for (let strip = 0; strip < 4; strip++) {
    for (let i = 0; i <= segments; i++) {
      const index = (strip * (segments + 1) + i) * 3;
      const edge = strip === 0 || strip === 3;
      (edge ? ink : paper).toArray(regular.array, index);
      (edge || Math.floor(i / 4) % 2 ? ink : paper).toArray(finish.array, index);
    }
  }
  geometry.setAttribute('color', regular);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: true, toneMapped: false });
  const marker = new THREE.Mesh(geometry, material);
  marker.name = 'Arco da Costura dos Telhados';
  marker.visible = false;
  return { marker, regular, finish };
}

export function createFlightCircuit(scene, { button, readout, bearing, notice, record }) {
  let storage;
  try { storage = globalThis.localStorage; }
  catch { /* Browsers can block access to storage. */ }
  const circuit = new FlightCircuit(ROOFTOP_GATES, storage);
  const { marker, regular, finish } = createMarker();
  scene.add(marker);
  let available = true;
  let noticeUntil = 0;
  let shownGate = null;
  let shownText = '';

  function showText(text) {
    if (shownText === text) return;
    readout.textContent = text;
    shownText = text;
  }

  function showGate(gate) {
    if (shownGate === gate) return;
    marker.visible = !!gate;
    bearing.hidden = !gate;
    if (gate) {
      marker.position.copy(gate.center);
      marker.quaternion.setFromUnitVectors(Z_AXIS, gate.normal);
      marker.geometry.setAttribute('color', circuit.index === circuit.gates.length - 1 ? finish : regular);
    } else showText('');
    shownGate = gate;
  }

  function updateMenu() {
    button.disabled = !available;
    button.textContent = circuit.nextGate ? 'Cancelar percurso' : 'Ativar percurso';
    record.textContent = circuit.best === null ? '' : `Seu recorde ${formatTime(circuit.best)}`;
  }

  function clearNotice() {
    notice.textContent = '';
    noticeUntil = 0;
  }

  bearing.hidden = true;
  updateMenu();
  button.addEventListener('click', () => {
    if (!available) return;
    if (circuit.nextGate) circuit.cancel();
    else circuit.start();
    clearNotice();
    showGate(circuit.nextGate);
    updateMenu();
  });

  return {
    setAvailable(nextAvailable) {
      available = nextAvailable;
      if (!available) {
        circuit.cancel();
        showGate(null);
        clearNotice();
      }
      updateMenu();
    },
    update(start, end, yaw, elapsed, dt) {
      const result = circuit.update(start, end, elapsed, dt);
      if (result) {
        notice.textContent = `${result.record ? 'Novo recorde' : 'Percurso concluído'} · ${formatTime(result.duration)}`;
        noticeUntil = elapsed + 5;
        updateMenu();
      } else if (noticeUntil > 0 && elapsed >= noticeUntil) clearNotice();

      const gate = circuit.nextGate;
      showGate(gate);
      if (!gate) return;

      const center = gate.center;
      const distance = Math.ceil(center.distanceTo(end) / 5) * 5;
      const height = Math.round((center.y - end.y) / 5) * 5;
      const altitude = Math.abs(height) < 5 ? '' : height > 0 ? ` · suba ${height} m` : ` · desça ${-height} m`;
      const label = circuit.index === 0 ? 'Partida' : circuit.index === circuit.gates.length - 1
        ? 'Chegada' : `Arco ${circuit.index + 1}/${circuit.gates.length}`;
      const clock = circuit.startedAt === null ? '' : ` · ${formatTime((elapsed - circuit.startedAt) * 1000)}`;
      showText(`${label} · ${distance} m${altitude}${clock}`);
      const angle = yaw - Math.atan2(center.x - end.x, center.z - end.z);
      bearing.style.transform = `rotate(${angle}rad)`;
    },
  };
}
