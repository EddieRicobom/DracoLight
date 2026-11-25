import * as THREE from 'three';
import { GameAudio } from './audio.js';
import { Dragon, PALETTES } from './dragon.js';
import { GroundCharacter } from './ground-character.js';
import { ZODIAC_ANIMALS, createZodiacAvatar } from './zodiac.js';
import { ZodiacAbilities, ZODIAC_ABILITIES, ZODIAC_IMPACTS } from './zodiac-abilities.js';
import { readCoopState, readCoopZodiacImpact, readCoopZodiacPaint, readCoopZodiacBurst, readCoopZodiacMark, readCoopZodiacScent } from './coop-state.js';
import { createCoop } from './coop.js';
import { City, CH, HALF } from './city.js';
import { createCityRelics } from './relics.js';
import { createFlightCircuit } from './flight-circuit.js';
import { createUrbanDetails } from './urban.js';
import { createPedestrians } from './pedestrians.js';
import { createPilotPark } from './pilot-park.js';
import { createPolyProps } from './polyprops.js';
import { FX } from './fx.js';
import { InkTrail } from './ink.js';
import { createTouchControls } from './touch.js';
import { advanceDiveSpeed, advanceDiveImpact } from './dive.js';
import { PaintTornado } from './tornado.js';
import { createTornadoHud } from './tornado-hud.js';
import { PaintMeteor } from './meteor.js';
import { PaintBallEffects } from './paint-ball-effects.js';
import { ZODIAC_INK, inkPatternPoints, InkFlow } from './zodiac-ink.js';
import { DestructionChain } from './destruction-chain.js';
import { makeMonochrome } from './monochrome.js';
import { addInkOutline } from './outline.js';
import { clamp, damp, turnToward, U } from './util.js';
import { createSky, createVisualPipeline } from './visual.js';
import { createClouds } from './clouds.js';
import { applyHalftone, halftoneUniform } from './halftone.js';
import { createPlayerCamera } from './player-camera.js';

const $ = (id) => document.getElementById(id);
let recordWorld = () => {};
const canvas = $('c'), menu = $('menu'), hud = $('hud'), go = $('go');
const audio = new GameAudio();
const soundButton = $('sound');
soundButton.addEventListener('click', () => {
  audio.muted = !audio.muted;
  soundButton.textContent = audio.muted ? 'Som: desligado' : 'Som: ligado';
  soundButton.setAttribute('aria-pressed', String(!audio.muted));
  audio.setFlight(0, false);
  if (!audio.muted) audio.start().catch(() => {});
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x34202a);
scene.fog = new THREE.FogExp2(0x8d554b, 0.0017);
const camera = new THREE.PerspectiveCamera(70, 1, 1, 30000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const touchDevice = matchMedia('(pointer: coarse)').matches;
const maxPixelRatio = Math.min(devicePixelRatio || 1, touchDevice ? 0.85 : 1.25);
const resolutionScales = { normal: 1, pixel: 0.5, crunchy: 0.33 };
let resolutionMode = 'normal';
try {
  const savedMode = localStorage.getItem('draco-resolution-mode');
  if (Object.hasOwn(resolutionScales, savedMode)) resolutionMode = savedMode;
} catch { /* Private browsing may block local storage. */ }
let renderPixelRatio = maxPixelRatio * resolutionScales[resolutionMode];
canvas.style.imageRendering = resolutionMode === 'normal' ? '' : 'pixelated';
renderer.setPixelRatio(renderPixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Rendering the entire city into a shadow map every frame is expensive. The
// moving sun and characters still refresh several times per second.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
scene.add(new THREE.HemisphereLight(0x8da9d2, 0x48302e, 1.55));
const sun = new THREE.DirectionalLight(0xffb88a, 3.2);
sun.position.set(-180, 260, 130);
sun.castShadow = true;
sun.shadow.mapSize.set(touchDevice ? 1024 : 2048, touchDevice ? 1024 : 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -420;
sun.shadow.camera.right = sun.shadow.camera.top = 420;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 850;
sun.shadow.bias = -0.0003;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x819cca, 0.8);
fill.position.set(160, 100, -220);
scene.add(fill);
const sky = createSky(scene);
makeMonochrome(sky);
sky.scale.setScalar(25);
const composer = createVisualPipeline(renderer, scene, camera);
const dioramaCameraControl = $('dioramaCamera');
const dioramaCameraKey = 'dracoLight.dioramaCamera';
try { dioramaCameraControl.checked = localStorage.getItem(dioramaCameraKey) === 'on'; }
catch { /* The control still works for the current session. */ }
dioramaCameraControl.addEventListener('change', () => {
  try { localStorage.setItem(dioramaCameraKey, dioramaCameraControl.checked ? 'on' : 'off'); }
  catch { /* The control still works for the current session. */ }
});
const clouds = createClouds(scene);
makeMonochrome(clouds.mesh);

// The flight, world and presentation systems share only the local player state.
// This leaves room for other pilots later without adding a network dependency now.
const fx = new FX(scene, camera);
for (const item of scene.children) makeMonochrome(item);
const inkLeft = new InkTrail(scene, camera, -9);
const inkRight = new InkTrail(scene, camera, 9);
// Ground characters paint with a single, lower ribbon instead of dragon wings.
let zodiacInk = null;
const tornado = new PaintTornado(scene);
const updateTornadoHud = createTornadoHud(hud, tornado.detector);
const paintColor = $('paintColor');
const paintPresets = document.querySelectorAll('input[name="paintPreset"]');
function choosePaint(color) {
  inkLeft.setColor(color);
  inkRight.setColor(color);
  zodiacInk?.setColor(color);
  paintColor.value = color;
}
paintPresets.forEach((preset) => preset.addEventListener('change', () => {
  if (preset.checked) choosePaint(preset.value);
}));
paintColor.addEventListener('input', () => {
  paintPresets.forEach((preset) => { preset.checked = false; });
  choosePaint(paintColor.value);
});
$('clearPaint').addEventListener('click', () => {
  inkLeft.clear();
  inkRight.clear();
  zodiacInk?.clear();
  animalInkEffects.reset();
  animalFlow.reset();
  wallBreachAt = -Infinity;
  zodiacAbilities.ink = 0;
  tornado.clear();
  city.clearPaint();
  recordWorld({ kind: 'clear' });
  $('status').textContent = 'Tinta removida.';
});
choosePaint(paintColor.value);
const beforeCity = new Set(scene.children);
const city = new City(scene, fx);
createPilotPark(scene, city);
const pedestrians = createPedestrians(scene, city.blocks);
const paintWorld = (position, radius, color) => {
  const changed = city.paintSphere(position, radius, color);
  if (changed > 0)
    recordWorld({ kind: 'paint', p: position.toArray(), r: radius, color: new THREE.Color(color).getHex() });
  return changed;
};
const destroyWorld = city.destroySphere.bind(city);
city.destroySphere = (position, radius, power, maxN, forceSync = false) => {
  const count = destroyWorld(position, radius, power, maxN);
  if (count > 0 || forceSync) recordWorld({ kind: 'destroy', p: position.toArray(), r: radius, power, maxN });
  return count;
};
inkLeft.onPaint = paintWorld;
inkRight.onPaint = paintWorld;
tornado.onPaint = paintWorld;
const urban = createUrbanDetails(scene, city);
const polyProps = createPolyProps(scene, city);
for (const item of scene.children) if (!beforeCity.has(item)) makeMonochrome(item);
const relics = createCityRelics(scene, city, CH, {
  count: $('relicCount'), hint: $('relicHint'), bearing: $('relicBearing'), notice: $('relicNotice'),
});
const flightCircuit = createFlightCircuit(scene, {
  button: $('flightButton'), readout: $('flightReadout'), bearing: $('flightBearing'),
  notice: $('flightNotice'), record: $('flightRecord'),
});
polyProps.ready.then(() => {
  for (const item of scene.children) if (item.name.startsWith('Poly Haven ')) makeMonochrome(item);
});
const meteor = new PaintMeteor(scene, city, fx, audio);
meteor.tornado = tornado;
meteor.onPaint = paintWorld;
const destructionChain = new DestructionChain();
const comboReadout = $('destructionChain');
let shownCombo = 0, shownComboSeconds = 0;
const resetButton = $('resetCity');
resetButton.addEventListener('click', () => {
  city.reset();
  destructionChain.reset();
  zodiacInk?.clear();
  animalInkEffects.reset();
  animalFlow.reset();
  inkSurfBoost = 0;
  wallBreachAt = -Infinity;
  guestBurstSentAt.clear();
  zodiacAbilities.ink = 0;
  recordWorld({ kind: 'reset' });
  urban.reset();
  polyProps.reset();
  fx.burning.length = 0;
  meteor.reset();
  $('sc').textContent = '0';
  $('status').textContent = 'Cidade reconstruída.';
});
const beforeDragon = new Set(scene.children);
const player = new Dragon(scene, PALETTES.red);
for (const item of scene.children) if (!beforeDragon.has(item)) item.traverse((object) => {
  if (object.material) for (const material of [object.material].flat()) addInkOutline(material);
});
player.pos.set(0, 115, 115);
player.fwd.set(0, 0, -1);
player.resetTrail();
player.update(0, 0);

const FLIGHT = Object.freeze({
  ceiling: 20000,
  cruise: 95,
  accelerate: 160,
  brake: 42,
  boost: 400,
  turnRate: 5.8,
  boostDrain: 20,
  recovery: 18,
});
const human = new GroundCharacter(scene, city, { position: new THREE.Vector3(0, 0, 115), yaw: Math.PI });
human.root.visible = false;
let playerMode = 'dragon';
let activeSpecies = 'rat', zodiacAvatar = null;
const switchButton = $('switchCharacter');
const characterSelect = $('characterSelect');
for (const [id, label] of [['dragon', 'Dragão'], ...ZODIAC_ANIMALS.map(({ id, label }) => [id, label])]) {
  const option = document.createElement('option'); option.value = id; option.textContent = label; characterSelect.append(option);
}
const zodiacAbilities = new ZodiacAbilities({ city, onEffect: handleZodiacEffect });
zodiacInk = new InkTrail(scene, camera, 0);
zodiacInk.onPaint = (position, radius, color) => {
  if (paintWorld(position, radius, color) > 0) {
    zodiacAbilities.addInk(0.004);
    syncGuestMark(position, radius, color);
  }
};
zodiacInk.setColor(paintColor.value);
const animalInkEffects = new PaintBallEffects(scene);
const animalFlow = new InkFlow();
let inkSurfBoost = 0, inkNoticeUntil = 0, inkScentTime = 0, guestInkSentAt = -Infinity, guestMarkSentAt = -Infinity;
let wallBreachAt = -Infinity;
const guestBurstSentAt = new Map();
const inkPaintPoint = new THREE.Vector3();
const inkTrailPoint = new THREE.Vector3();
const inkEffectOrigin = new THREE.Vector3();
const breachOrigin = new THREE.Vector3();
const breachDirection = new THREE.Vector3();
const cometOrigin = new THREE.Vector3();
const cometDirection = new THREE.Vector3();

function showInkNotice(text, seconds = 2) {
  $('inkNotice').textContent = text;
  inkNoticeUntil = elapsed + seconds;
}

function paintInkPattern(id, position, direction, scale = 1, color = paintColor.value, creditInk = true) {
  const descriptor = ZODIAC_INK[id];
  if (!descriptor) return 0;
  const points = inkPatternPoints(descriptor.style, position, direction, scale);
  let painted = 0;
  for (const point of points) {
    inkPaintPoint.set(point.x, point.y, point.z);
    painted += paintWorld(inkPaintPoint, point.r, color);
  }
  if (creditInk && painted > 0) zodiacAbilities.addInk(Math.min(0.1, 0.008 + painted * 0.0004));
  return painted;
}

function sprayInk(position, radius, velocity = 0, color = paintColor.value) {
  inkEffectOrigin.set(position.x, Math.max(0.6, position.y - 1), position.z);
  animalInkEffects.burst(inkEffectOrigin, radius, new THREE.Color(color),
    new THREE.Vector3(velocity * Math.sin(yaw), 0, velocity * Math.cos(yaw)));
}

function triggerInkSurf() {
  if (!ZODIAC_ABILITIES[activeSpecies]) return;
  inkSurfBoost = 0.9;
  zodiacAbilities.refund(0.75);
  zodiacAbilities.addInk(0.18);
  paintInkPattern(activeSpecies, human.position, humanForward, 1.15);
  syncGuestInk(activeSpecies, human.position, humanForward, 1.15);
  fx.bigDust(human.position, 3);
  fx.sparks(human.position, 8);
  fx.shake = Math.max(fx.shake, 0.28);
  sprayInk(human.position, 2.5, actualSpeed * 0.2);
  audio.play('charge');
  showInkNotice('Laço de tinta! Ímpeto renovado', 1.8);
}

function syncGuestInk(id, position, direction, scale) {
  if (coop.role !== 'guest' || elapsed - guestInkSentAt < 0.12) return;
  const sent = coop.send({
    type: 'zodiac-paint',
    species: id,
    p: [position.x, position.y, position.z],
    yaw: Math.atan2(direction.x, direction.z),
    scale,
    color: paintColor.value,
  });
  if (sent) guestInkSentAt = elapsed;
}

function syncGuestMark(position, radius, color) {
  if (coop.role !== 'guest' || elapsed - guestMarkSentAt < 0.12) return;
  const sent = coop.send({ type: 'zodiac-mark', species: activeSpecies,
    p: [position.x, position.y, position.z], radius: Math.min(5, radius),
    color: `#${new THREE.Color(color).getHexString(THREE.SRGBColorSpace)}` });
  if (sent) guestMarkSentAt = elapsed;
}

function syncGuestBurst(kind, position, direction, color = paintColor.value) {
  if (coop.role !== 'guest' || elapsed - (guestBurstSentAt.get(kind) ?? -Infinity) < 0.2) return;
  const sent = coop.send({
    type: 'zodiac-burst',
    species: activeSpecies,
    kind,
    p: [position.x, position.y, position.z],
    yaw: Math.atan2(direction.x, direction.z),
    color,
  });
  if (sent) guestBurstSentAt.set(kind, elapsed);
}

function launchInkComet(position, direction, color = paintColor.value, visualOnly = false) {
  cometOrigin.set(position.x, Math.max(position.y + 40, 45), position.z);
  cometDirection.set(direction.x * 0.65, -0.8, direction.z * 0.65);
  if (cometDirection.lengthSq() < 1e-6) cometDirection.set(0, -1, 0);
  cometDirection.normalize();
  meteor.launch(cometOrigin, cometDirection, 75, color, { visualOnly });
}

function applyRemoteBurst(request) {
  const p = new THREE.Vector3().fromArray(request.p);
  const direction = new THREE.Vector3(Math.sin(request.yaw), 0, Math.cos(request.yaw));
  if (request.kind === 'comet') {
    launchInkComet(p, direction, request.color);
    paintInkPattern(request.species, p, direction, 2.6, request.color, false);
    return;
  }
  city.destroySphere(p, 4.8, 32, 18, true);
  paintInkPattern(request.species, p, direction, 0.9, request.color, false);
  sprayInk(p, 4, 20, request.color);
  fx.bigDust(p, 6);
  fx.shake = Math.max(fx.shake, 0.35);
  audio.play('impact');
}

function breachWall() {
  if (!ZODIAC_ABILITIES[activeSpecies] || elapsed - wallBreachAt < 0.42) return false;
  breachDirection.set(Math.sin(yaw), 0, Math.cos(yaw));
  breachOrigin.copy(human.position);
  breachOrigin.y += human.height * 0.5;
  const hit = city.raycast(breachOrigin, breachDirection, 3.5);
  if (hit > 3.5) return false;
  breachOrigin.addScaledVector(breachDirection, hit);
  wallBreachAt = elapsed;
  if (coop.role !== 'guest') city.destroySphere(breachOrigin, 4.8, 32, 18, true);
  paintInkPattern(activeSpecies, breachOrigin, breachDirection, 0.9);
  sprayInk(breachOrigin, 4, 22);
  fx.bigDust(breachOrigin, 6);
  fx.sparks(breachOrigin, 8);
  fx.shake = Math.max(fx.shake, 0.42);
  audio.play('impact');
  zodiacAbilities.addInk(0.05);
  syncGuestBurst('breach', breachOrigin, breachDirection);
  if (inkNoticeUntil <= elapsed) showInkNotice('Passagem de tinta!', 1.1);
  return true;
}

function updateScentPath(dt) {
  inkScentTime -= dt;
  if (inkScentTime > 0) return;
  inkScentTime = 0.35;
  const target = relics.nearest(human.position, zodiacAbilities.relicGuideRange ?? 1100);
  if (!target) return;
  const dx = target.x - human.position.x, dz = target.z - human.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 2) return;
  for (let step = 7; step <= Math.min(distance, 42); step += 7) {
    inkPaintPoint.set(human.position.x + dx / distance * step, 0.7, human.position.z + dz / distance * step);
    paintWorld(inkPaintPoint, 1.4, paintColor.value);
  }
  if (coop.role === 'guest' && distance >= 7) coop.send({ type: 'zodiac-scent', p: human.position.toArray(),
    yaw: Math.atan2(dx, dz), distance: Math.min(distance, 42), color: paintColor.value });
  zodiacAbilities.addInk(0.008);
}

function prepareZodiac(root) {
  const materials = new Set();
  root.traverse((object) => {
    if (object.material) for (const material of [object.material].flat()) materials.add(material);
  });
  // Keep animal silhouettes legible against the white paper city.
  for (const material of materials) material.color?.multiplyScalar(0.58);
  makeMonochrome(root);
  for (const material of materials) addInkOutline(material);
}
function handleZodiacEffect({ id, type, position, direction, scale = 1 }) {
  if (type === 'start') {
    fx.dust(position, 1.4, 1);
    if (id === 'dog') inkScentTime = 0;
    return;
  }
  if (type === 'trail') { fx.dust(position, 0.65, 1); return; }
  if (type === 'ink') {
    paintInkPattern(id, position, direction, scale);
    sprayInk(position, 3, 18);
    fx.dust(position, 0.8, 0.7);
    syncGuestInk(id, position, direction, scale);
    return;
  }
  if (type === 'surge') {
    // The masterstroke is a large, visible signature on the paper city.
    paintInkPattern(id, position, direction, 2.6);
    fx.bigDust(position, 12);
    fx.sparks(position, 14);
    sprayInk(position, 8, 30);
    fx.shake = Math.max(fx.shake, 0.6);
    audio.play('charge');
    launchInkComet(position, direction, paintColor.value, coop.role === 'guest');
    syncGuestBurst('comet', position, direction);
    showInkNotice(`${ZODIAC_INK[id]?.label ?? 'Obra-prima'} · Cometa de tinta!`, 2.4);
    return;
  }
  if (type !== 'impact') return;
  fx.bigDust(position, 8);
  paintInkPattern(id, position, direction, 1.25 * scale);
  sprayInk(position, 6, 26);
  fx.shake = Math.max(fx.shake, 0.3);
  syncGuestInk(id, position, direction, 1.25 * scale);
  const impact = ZODIAC_IMPACTS[id];
  if (!impact) return;
  if (coop.role === 'guest') {
    coop.send({ type: 'zodiac-impact', species: id, p: position.toArray() });
  } else {
    city.destroySphere(position, impact.radius, impact.power, impact.maxChunks, true);
  }
}
function setSpecies(id) {
  if (!Object.hasOwn(ZODIAC_ABILITIES, id)) return false;
  if (zodiacAvatar) { human.root.remove(zodiacAvatar.root); zodiacAvatar.dispose(); zodiacAvatar = null; }
  zodiacInk?.clear();
  animalInkEffects.reset();
  animalFlow.reset();
  inkSurfBoost = 0;
  wallBreachAt = -Infinity;
  guestBurstSentAt.clear();
  activeSpecies = id;
  zodiacAbilities.select(id);
  zodiacAvatar = createZodiacAvatar(id, { height: human.height });
  prepareZodiac(zodiacAvatar.root);
  human.root.add(zodiacAvatar.root);
  return true;
}
function refreshCharacterUI() {
  characterSelect.value = playerMode === 'dragon' ? 'dragon' : activeSpecies;
  $('flightKeys').hidden = playerMode !== 'dragon';
  $('groundKeys').hidden = playerMode === 'dragon';
  $('mobileHelp').textContent = playerMode === 'dragon'
    ? 'Use os direcionais de toque para voar e toque em Tinta para disparar. Toque em pausa para escolher a cor.'
    : 'Use os direcionais para correr e girar a câmera. Toque em Pular para saltar; avance contra uma parede para escalá-la. Toque em Habilidade para usar o poder do animal.';
  $('characterDescription').textContent = playerMode === 'dragon'
    ? 'Voo livre, tinta, tornados e meteoros.'
    : `${ZODIAC_ABILITIES[activeSpecies].description} Tinta: ${ZODIAC_INK[activeSpecies].label}. Feche um laço para ganhar ímpeto; com Shift, abra passagens nas paredes; a Obra-prima chama um cometa de tinta.`;
  const action = $('touchPaint');
  action.textContent = playerMode === 'dragon' ? 'Tinta' : 'Habilidade';
  action.setAttribute('aria-label', playerMode === 'dragon' ? 'Disparar bola de tinta' : 'Usar habilidade');
  $('touchDescend').style.display = playerMode === 'dragon' ? '' : 'none';
  $('touchAscend').setAttribute('aria-label', playerMode === 'dragon' ? 'Subir' : 'Pular');
  $('touchRight').setAttribute('aria-label', playerMode === 'dragon' ? 'Direção do voo: deslize o dedo' : 'Direção da câmera: deslize o dedo');
}
function setPlayerMode(mode) {
  if (mode === playerMode) return;
  if (mode === 'dragon' && coop.role === 'guest') return;
  zodiacInk?.clear();
  animalInkEffects.reset();
  animalFlow.reset();
  inkSurfBoost = 0;
  inkScentTime = 0;
  wallBreachAt = -Infinity;
  guestBurstSentAt.clear();
  if (mode === 'human') {
    zodiacAbilities.select(activeSpecies);
    human.teleport(player.pos, { ground: true, yaw });
    human.root.visible = true; player.setVisible(false);
    tornado.detector.reset();
  } else {
    zodiacAbilities.select(null);
    player.pos.copy(human.position).add(new THREE.Vector3(0, 15, 0));
    player.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    player.resetTrail(); player.update(0, elapsed);
    player.setVisible(true); human.root.visible = false;
    speed = FLIGHT.cruise;
  }
  playerMode = mode;
  flightCircuit.setAvailable(mode === 'dragon');
  destructionChain.reset(city.score);
  switchButton.textContent = mode === 'dragon' ? 'Jogar como personagem' : 'Jogar como dragão';
  $('touchAscend').textContent = mode === 'dragon' ? 'Subir' : 'Pular';
  refreshCharacterUI();
}
switchButton.addEventListener('click', () => setPlayerMode(playerMode === 'dragon' ? 'human' : 'dragon'));
characterSelect.addEventListener('change', () => {
  const selected = characterSelect.value;
  if (selected === 'dragon') setPlayerMode('dragon');
  else if (setSpecies(selected)) setPlayerMode('human');
  refreshCharacterUI();
  if (coop.role === 'guest') sendLocalState();
});
setSpecies(activeSpecies);
refreshCharacterUI();
let state = 'menu', elapsed = 0, stamina = 100;
let yaw = Math.PI, pitch = 0, speed = FLIGHT.cruise;
let actualSpeed = FLIGHT.cruise;
let diveImpact = null;
let collisionTime = 0, wakeTime = 0, fpsTime = 0, frames = 0;
const keys = new Set();
const touch = createTouchControls({ onPause: () => pause(), onPaint: () => firePaint() });
let activeGamepad = null, gamepadStartHeld = false, gamepadPaintHeld = false, draggingMouse = false;
const stick = (value) => Math.abs(value || 0) < 0.14 ? 0 : Math.sign(value) * (Math.abs(value) - 0.14) / 0.86;
function currentGamepad() {
  const pads = navigator.getGamepads?.() || [];
  if (activeGamepad !== null && pads[activeGamepad]?.connected) return pads[activeGamepad];
  activeGamepad = pads.findIndex((pad) => pad?.connected && pad.mapping === 'standard');
  if (activeGamepad < 0) { activeGamepad = null; return null; }
  return pads[activeGamepad];
}
function buttonDown(pad, index) { return !!pad?.buttons[index]?.pressed; }
const tmp = new THREE.Vector3();
const desired = new THREE.Vector3(), side = new THREE.Vector3();
const old = new THREE.Vector3(), motion = new THREE.Vector3();
const impact = new THREE.Vector3();
const ray = {};
const readouts = document.createElement('span');
readouts.setAttribute('aria-live', 'off');
readouts.style.cssText = 'display:block;margin-top:6px;font-size:11px;letter-spacing:.08em;color:#cfe8ff';
$('score').append(readouts);

const flightBoundary = (height) => HALF - 12 + 6000 * clamp((height - 200) / 6000, 0, 1);
const altitudeSpeed = (height) => 1 + 1.5 * clamp((height - 150) / 8000, 0, 1);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderPixelRatio);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fx.setScale(h * renderer.getPixelRatio(), camera.fov);
}
addEventListener('resize', resize);
resize();

function start() {
  audio.start().catch(() => {});
  touch.reset();
  state = 'playing';
  menu.classList.add('off');
  hud.classList.add('on');
  // A controller or mouse drag can still steer when pointer lock is unavailable.
  if (!touchDevice) canvas.requestPointerLock?.()?.catch?.(() => {});
}
function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  audio.setFlight(0, false);
  fx.updateSpeed(0, player.pos, player.fwd, 0, false);
  diveImpact = null;
  keys.clear();
  touch.reset();
  draggingMouse = false;
  document.exitPointerLock?.();
  menu.classList.remove('off');
  hud.classList.remove('on');
  $('sub').textContent = playerMode === 'dragon' ? 'Voo pausado' : 'Jogo pausado';
  $('msg').textContent = playerMode === 'dragon' ? 'Continue quando estiver pronto para explorar o céu e atravessar a cidade.' : 'Continue quando estiver pronto para explorar a cidade.';
  go.textContent = playerMode === 'dragon' ? 'Continuar voo' : 'Continuar jogo';
}
go.disabled = true;
go.textContent = 'Carregando modelo…';
Promise.resolve().then(() => {
  go.disabled = false;
  go.textContent = 'Começar a voar';
}).catch(() => {
  go.textContent = 'Erro ao carregar modelo';
  $('status').textContent = 'Atualize a página para tentar novamente.';
});
go.addEventListener('click', start);
function firePaint() {
  if (state !== 'playing') return;
  if (playerMode === 'dragon') meteor.fire(player.pos, player.fwd, paintColor.value);
  else zodiacAbilities.activate(human, yaw);
}
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('click', () => {
  if (!touchDevice && state === 'playing' && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
});
document.addEventListener('pointerlockchange', () => {
  if (!touchDevice && document.pointerLockElement !== canvas && state === 'playing' && !currentGamepad() && !draggingMouse) pause();
});
document.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') {
    if (state === 'playing') pause();
    else if (state === 'paused') start();
    return;
  }
  if (e.code === 'KeyE' && !e.repeat && playerMode === 'human') firePaint();
  keys.add(e.code);
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
document.addEventListener('mousemove', (e) => {
  if (state !== 'playing' || (document.pointerLockElement !== canvas && !draggingMouse)) return;
  yaw -= e.movementX * 0.0024;
  pitch = clamp(pitch - e.movementY * 0.0021, -1.35, 1.35);
});
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'playing' || e.button !== 0) return;
  draggingMouse = true;
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2) { e.preventDefault(); firePaint(); }
});
canvas.addEventListener('pointerup', () => { draggingMouse = false; });
canvas.addEventListener('pointercancel', () => { draggingMouse = false; });
addEventListener('gamepaddisconnected', (e) => {
  if (e.gamepad.index !== activeGamepad) return;
  activeGamepad = null;
  gamepadStartHeld = false;
  if (state === 'playing') pause();
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('blur', () => { keys.clear(); if (state === 'playing') pause(); });

function updateFlight(dt, pad) {
  yaw -= (stick(pad?.axes[2]) + touch.state.rightX) * dt * 2.4;
  pitch = clamp(pitch - (stick(pad?.axes[3]) + touch.state.rightY) * dt * 2.1, -1.35, 1.35);
  const f = player.fwd;
  desired.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  turnToward(f, desired, dt * FLIGHT.turnRate);
  side.crossVectors(f, THREE.Object3D.DEFAULT_UP).normalize();
  const boosting = (keys.has('ShiftLeft') || keys.has('ShiftRight') || buttonDown(pad, 7) || touch.state.boost) && stamina > 1;
  const throttle = stick(pad?.axes[1]) + touch.state.leftY;
  const ascending = keys.has('Space') || buttonDown(pad, 0) || touch.state.ascend;
  const descending = keys.has('KeyC') || buttonDown(pad, 1) || touch.state.descend;
  let verticalDirection = clamp(f.y + (ascending ? 0.75 : 0) - (descending ? 0.75 : 0), -1, 1);
  if ((player.pos.y <= 7.05 && verticalDirection < 0) || (player.pos.y >= FLIGHT.ceiling && verticalDirection > 0)) verticalDirection = 0;
  const braking = keys.has('KeyS') || throttle > 0.25;
  const baseSpeed = boosting ? FLIGHT.boost : keys.has('KeyW') || throttle < -0.25 ? FLIGHT.accelerate :
    braking ? FLIGHT.brake : FLIGHT.cruise;
  const wanted = baseSpeed * altitudeSpeed(player.pos.y);
  speed = advanceDiveSpeed(speed, dt, { targetSpeed: wanted, verticalDirection, braking, response: boosting ? 3.8 : 2.8 });
  diveImpact = advanceDiveImpact(diveImpact, { speed, verticalDirection, braking });
  if (diveImpact.triggered) {
    fx.flightShockwave(player.pos, f, clamp(speed / 1000, 0.35, 1));
    fx.shake = Math.max(fx.shake, 0.8);
    audio.play('impact');
  }
  stamina = clamp(stamina + (boosting ? -FLIGHT.boostDrain : FLIGHT.recovery) * dt, 0, 100);

  old.copy(player.pos);
  player.pos.addScaledVector(f, speed * dt);
  if (keys.has('KeyA')) player.pos.addScaledVector(side, -speed * dt * 0.58);
  if (keys.has('KeyD')) player.pos.addScaledVector(side, speed * dt * 0.58);
  player.pos.addScaledVector(side, (stick(pad?.axes[0]) + touch.state.leftX) * speed * dt * 0.58);
  if (ascending) player.pos.y += speed * dt * 0.75;
  if (descending) player.pos.y -= speed * dt * 0.75;
  player.pos.y = clamp(player.pos.y, 7, FLIGHT.ceiling);
  const bound = flightBoundary(player.pos.y);
  player.pos.x = clamp(player.pos.x, -bound, bound);
  player.pos.z = clamp(player.pos.z, -bound, bound);

  // Sweep the path, so a fast boost cannot skip straight through a building.
  motion.subVectors(player.pos, old);
  const distance = motion.length();
  actualSpeed = dt > 0 ? distance / dt : 0;
  if (distance > 0) {
    motion.multiplyScalar(1 / distance);
    const wallDistance = city.raycast(old, motion, distance, ray);
    if (wallDistance < distance) {
      impact.copy(old).addScaledVector(motion, Math.max(0, wallDistance));
      const firstHit = city.destroySphere(impact, boosting ? 13 : 8, boosting ? 85 : 40, boosting ? 65 : 22);
      if (firstHit > 0 && collisionTime <= 0) {
        audio.play('impact');
        fx.explosion(impact, boosting ? 7 : 4);
        fx.shake = Math.max(fx.shake, boosting ? 1.1 : 0.4);
        collisionTime = 0.12;
      }
      if (!boosting) speed *= 0.82;
    }
  }
  // The player's body clears remaining geometry along the same frame.
  if (city.chunkAt(player.pos.x, player.pos.y, player.pos.z) >= 0) {
    city.destroySphere(player.pos, boosting ? 12 : 7, boosting ? 70 : 35, boosting ? 55 : 18);
  }
  collisionTime -= dt;
  wakeTime -= dt;
  if (boosting && wakeTime <= 0) {
    wakeTime = 0.035;
    fx.flightWake(tmp.copy(player.pos).addScaledVector(f, -15), f);
  }
  audio.setFlight(actualSpeed);
  fx.updateSpeed(dt, player.pos, f, actualSpeed);
  player.flightSpeed = speed;
  player.boosting = boosting;
  player.update(dt, elapsed);
  inkLeft.update(dt, player.pos, f, speed, boosting);
  inkRight.update(dt, player.pos, f, speed, boosting);
  tornado.update(dt, player.pos, f, actualSpeed, paintColor.value);
  meteor.update(dt, old, player.pos, actualSpeed);
}

function updateHuman(dt, pad) {
  yaw -= (stick(pad?.axes[2]) + touch.state.rightX) * dt * 2.4;
  pitch = clamp(pitch - (stick(pad?.axes[3]) + touch.state.rightY) * dt * 1.6, -0.55, 0.8);
  const forward = clamp((keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) - stick(pad?.axes[1]) - touch.state.leftY, -1, 1);
  const strafe = clamp((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + stick(pad?.axes[0]) + touch.state.leftX, -1, 1);
  old.copy(human.position);
  const input = { forward, strafe, yaw, sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || buttonDown(pad, 7) || touch.state.boost,
    jump: keys.has('Space') || buttonDown(pad, 0) || touch.state.ascend,
    flowBoost: inkSurfBoost > 0 ? 1.35 : 1 };
  const inked = Boolean(ZODIAC_ABILITIES[activeSpecies]);
  zodiacAbilities.update(dt, human, input);
  actualSpeed = dt > 0 ? old.distanceTo(human.position) / dt : 0;
  if (inked && input.sprint && !zodiacAbilities.active && human.climbing) breachWall();
  zodiacAvatar?.animate(dt, { state: human.state, speed: actualSpeed, verticalSpeed: human.velocity.y,
    ability: zodiacAbilities.active ? activeSpecies : '' });
  humanForward.set(Math.sin(yaw), 0, Math.cos(yaw));
  const moving = human.state !== 'idle';
  inkTrailPoint.copy(human.position);
  inkTrailPoint.y += 1.1;
  if (inked) {
    animalFlow.record(human.position, elapsed, (human.grounded || human.climbing) && actualSpeed > 6);
    if (human.grounded && actualSpeed > 12 && animalFlow.surf(human.position, elapsed)) triggerInkSurf();
    zodiacInk.update(dt, inkTrailPoint, humanForward, Math.max(actualSpeed, zodiacAbilities.active ? 20 : 0),
      zodiacAbilities.active || actualSpeed > 26, moving || zodiacAbilities.active);
    if (activeSpecies === 'dog' && zodiacAbilities.active) updateScentPath(dt);
  } else {
    animalFlow.record(human.position, elapsed, false);
    zodiacInk.update(dt, inkTrailPoint, humanForward, 0, false, false);
  }
  audio.setFlight(0, false);
  fx.updateSpeed(dt, human.position, humanForward, 0, false);
  // Existing paint and meteors continue to age, but the character cannot make new ones.
  inkLeft.update(dt, player.pos, player.fwd, 0, false, false);
  inkRight.update(dt, player.pos, player.fwd, 0, false, false);
  tornado.update(dt, human.position, humanForward, 0, paintColor.value);
  meteor.update(dt, null, null, 0);
  inkSurfBoost = Math.max(0, inkSurfBoost - dt);
}
const humanForward = new THREE.Vector3();
const followPlayer = createPlayerCamera(camera, {
  cruiseSpeed: FLIGHT.cruise, accelerateSpeed: FLIGHT.accelerate,
  raycast: (origin, direction, distance) => city.raycast(origin, direction, distance),
});
function activePosition() { return playerMode === 'dragon' ? player.pos : human.position; }
function updateCamera(dt) {
  const position = activePosition();
  followPlayer(dt, {
    walking: playerMode === 'human', position, forward: player.fwd, yaw, pitch, speed, actualSpeed,
    boosting: player.boosting, shake: fx.shake, diorama: dioramaCameraControl.checked,
  });
  fx.setScale(innerHeight * renderer.getPixelRatio(), camera.fov);
  sun.position.set(position.x - 180, position.y + 260, position.z + 130);
  sun.target.position.copy(position);
  sun.target.updateMatrixWorld();
  sky.position.copy(camera.position);
  sky.updateAltitude?.(position.y, elapsed);
}

function updateHud(dt) {
  updateTornadoHud(dt, playerMode === 'dragon');
  const ability = playerMode === 'human' ? ZODIAC_ABILITIES[activeSpecies] : null;
  const inkPercent = Math.round(zodiacAbilities.ink * 100);
  $('inkBar').hidden = !ability;
  $('inkP').firstElementChild.style.width = `${inkPercent}%`;
  $('abilityHud').textContent = ability
    ? `${ability.name} · ${zodiacAbilities.remaining > 0 ? `${Math.ceil(zodiacAbilities.remaining)} s` : 'pronta'} · ${zodiacAbilities.surgeReady ? 'Obra-prima pronta' : `Tinta ${inkPercent}%`}`
    : '';
  if (inkNoticeUntil && elapsed >= inkNoticeUntil) {
    $('inkNotice').textContent = '';
    inkNoticeUntil = 0;
  }
  $('stP').firstElementChild.style.width = `${stamina}%`;
  $('sc').textContent = city.score.toLocaleString('pt-BR');
  destructionChain.update(city.score, elapsed, coop.role !== 'guest');
  const { current, best, seconds } = destructionChain;
  if (current !== shownCombo || seconds !== shownComboSeconds) {
    shownCombo = current;
    shownComboSeconds = seconds;
    comboReadout.hidden = current === 0;
    if (current > 0) {
      comboReadout.textContent = `Combo ${current.toLocaleString('pt-BR')} · ${seconds} s · Recorde ${best.toLocaleString('pt-BR')}`;
    }
  }
  const mach = actualSpeed / 343;
  const machLabel = mach >= 1 ? ` · Mach ${mach.toFixed(1).replace('.', ',')}` : '';
  readouts.textContent = `Velocidade: ${Math.round(actualSpeed * 3.6).toLocaleString('pt-BR')} km/h${machLabel} · Altitude: ${Math.round(activePosition().y).toLocaleString('pt-BR')} m`;
  fpsTime += dt;
  frames++;
  if (fpsTime > 0.5) {
    $('fps').textContent = `${Math.round(frames / fpsTime)} FPS`;
    fpsTime = 0;
    frames = 0;
  }
}

// The host owns the city; guests send movement only and receive city changes.
const remotes = new Map();
const worldHistory = [], worldQueue = [];
const guestImpacts = new Map(), guestPaints = new Map(), guestBursts = new Map(), guestMarks = new Map(), guestScents = new Map();
let applyingWorld = false, networkTime = 0, worldTime = 0;
const coop = createCoop({
  onStatus: (message) => { $('coopStatus').textContent = message; },
  onRooms: (rooms) => {
    const list = $('coopRooms'); list.replaceChildren();
    for (const room of rooms) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = `${room.name} · ${room.count}/${room.max} · ${room.code}`;
      button.addEventListener('click', () => { $('coopCode').value = room.code; joinRoom(); });
      list.append(button);
    }
  },
  onPeer: ({ id, connected }) => {
    if (!connected) {
      guestImpacts.delete(id);
      guestMarks.delete(id);
      guestScents.delete(id);
      guestPaints.delete(id);
      guestBursts.delete(`${id}:breach`); guestBursts.delete(`${id}:comet`);
      removeRemote(id);
      if (coop.role === 'host') coop.broadcast({ type: 'depart', id });
      else if (coop.role === 'guest') { for (const key of [...remotes.keys()]) removeRemote(key); }
      return;
    }
    if (coop.role === 'host') {
      coop.sendTo(id, { type: 'world', events: [{ kind: 'reset' }] });
      const historyEnd = Math.max(0, worldHistory.length - worldQueue.length);
      for (let i = 0; i < historyEnd; i += 30)
        coop.sendTo(id, { type: 'world', events: worldHistory.slice(i, Math.min(i + 30, historyEnd)) });
    } else if (coop.role === 'guest') sendLocalState();
  },
  onMessage: (message, peerId) => {
    if (message.type === 'state') {
      const state = readCoopState(message, { role: coop.role, peerId, selfId: coop.id });
      if (!state) return;
      if (coop.role === 'host') coop.broadcast(state, peerId);
      updateRemote(state);
    } else if (message.type === 'zodiac-scent' && coop.role === 'host') {
      const receivedAt = performance.now() / 1000;
      const request = readCoopZodiacScent(message, { remote: remotes.get(peerId), elapsed: receivedAt, lastScentAt: guestScents.get(peerId) });
      if (!request) return;
      guestScents.set(peerId, receivedAt);
      const direction = new THREE.Vector3(Math.sin(request.yaw), 0, Math.cos(request.yaw));
      for (let step = 7; step <= request.distance; step += 7) {
        const point = new THREE.Vector3(request.p[0] + direction.x * step, 0.7, request.p[2] + direction.z * step);
        paintWorld(point, 1.4, request.color);
      }
    } else if (message.type === 'zodiac-mark' && coop.role === 'host') {
      const receivedAt = performance.now() / 1000;
      const request = readCoopZodiacMark(message, { remote: remotes.get(peerId), elapsed: receivedAt, lastMarkAt: guestMarks.get(peerId) });
      if (!request) return;
      guestMarks.set(peerId, receivedAt);
      paintWorld(new THREE.Vector3().fromArray(request.p), request.radius, request.color);
    } else if (message.type === 'zodiac-paint' && coop.role === 'host') {
      const receivedAt = performance.now() / 1000;
      const request = readCoopZodiacPaint(message, {
        remote: remotes.get(peerId), elapsed: receivedAt, lastPaintAt: guestPaints.get(peerId),
      });
      if (!request) return;
      guestPaints.set(peerId, receivedAt);
      const p = new THREE.Vector3().fromArray(request.p);
      const direction = new THREE.Vector3(Math.sin(request.yaw), 0, Math.cos(request.yaw));
      paintInkPattern(request.species, p, direction, request.scale, request.color, false);
      fx.dust(p, 0.9, 1);
      if (request.scale > 1.8) {
        sprayInk(p, 5, 20, request.color);
        fx.shake = Math.max(fx.shake, 0.3);
      }
    } else if (message.type === 'zodiac-burst' && coop.role === 'host') {
      const receivedAt = performance.now() / 1000;
      const burstKey = `${peerId}:${message.kind}`;
      const request = readCoopZodiacBurst(message, {
        remote: remotes.get(peerId), elapsed: receivedAt, lastBurstAt: guestBursts.get(burstKey),
      });
      if (!request) return;
      guestBursts.set(burstKey, receivedAt);
      applyRemoteBurst(request);
      if (request.kind === 'comet') coop.broadcast({ type: 'zodiac-comet-visual', p: request.p, yaw: request.yaw, color: request.color }, peerId);
    } else if (message.type === 'zodiac-comet-visual' && coop.role === 'guest') {
      if (!Array.isArray(message.p) || message.p.length !== 3 || !message.p.every(v => Number.isFinite(v) && Math.abs(v) < 30000)
          || !Number.isFinite(message.yaw) || typeof message.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(message.color)) return;
      const p = new THREE.Vector3().fromArray(message.p);
      const direction = new THREE.Vector3(Math.sin(message.yaw), 0, Math.cos(message.yaw));
      launchInkComet(p, direction, message.color, true);
    } else if (message.type === 'zodiac-impact' && coop.role === 'host') {
      const receivedAt = performance.now() / 1000;
      const request = readCoopZodiacImpact(message, { remote: remotes.get(peerId), elapsed: receivedAt, lastImpactAt: guestImpacts.get(peerId) });
      if (!request) return;
      guestImpacts.set(peerId, receivedAt);
      const p = new THREE.Vector3().fromArray(request.p), impact = request.impact;
      city.destroySphere(p, impact.radius, impact.power, impact.maxChunks, true);
      fx.bigDust(p, 8);
    } else if (message.type === 'depart' && coop.role === 'guest' && typeof message.id === 'string') {
      removeRemote(message.id);
    } else if (message.type === 'world' && coop.role === 'guest' && Array.isArray(message.events)) {
      applyingWorld = true;
      try { for (const event of message.events.slice(0, 60)) applyWorld(event); }
      finally { applyingWorld = false; }
    }
  },
});
function removeRemote(id) {
  const remote = remotes.get(id); if (!remote) return;
  if (remote.mode === 'human') {
    if (remote.avatar) { remote.actor.root.remove(remote.avatar.root); remote.avatar.dispose(); }
    remote.actor.dispose();
  }
  else {
    const actor = remote.actor;
    for (const object of [actor.body, actor.head, actor.spines, actor.mane, ...actor.legs.map(leg => leg.g)]) scene.remove(object);
    for (const trail of remote.trails) {
      scene.remove(trail.mesh, trail.splashMesh);
      trail.mesh.geometry.dispose(); trail.mesh.material.dispose();
      trail.splashMesh.geometry.dispose(); trail.splashMesh.material.dispose();
    }
  }
  remotes.delete(id);
}
function updateRemote(message) {
  let remote = remotes.get(message.id);
  if (remote && (remote.mode !== message.mode || (message.mode === 'human' && remote.species !== message.species))) { removeRemote(message.id); remote = null; }
  if (!remote) {
    if (remotes.size >= 5) return;
    if (message.mode === 'dragon') {
      const actor = new Dragon(scene, PALETTES.red);
      actor.pos.fromArray(message.p); actor.fwd.set(Math.sin(message.yaw), 0, Math.cos(message.yaw)); actor.resetTrail();
      remote = { mode: 'dragon', actor, target: new THREE.Vector3().fromArray(message.p), yaw: message.yaw, trails: [new InkTrail(scene, camera, -9), new InkTrail(scene, camera, 9)] };
    } else {
      const actor = new GroundCharacter(scene, city);
      const avatar = createZodiacAvatar(message.species, { height: actor.height });
      prepareZodiac(avatar.root);
      actor.root.add(avatar.root);
      remote = { mode: 'human', species: message.species, avatar, actor, target: new THREE.Vector3().fromArray(message.p), yaw: message.yaw };
      actor.position.copy(remote.target);
    }
    remotes.set(message.id, remote);
  }
  remote.target.fromArray(message.p); remote.yaw = message.yaw;
  remote.facingYaw = Number.isFinite(message.facingYaw) ? message.facingYaw : message.yaw;
  remote.verticalSpeed = Number.isFinite(message.verticalSpeed) ? clamp(message.verticalSpeed, -300, 300) : 0;
  remote.ability = message.ability === true;
  remote.pitch = Number.isFinite(message.pitch) ? clamp(message.pitch, -1.35, 1.35) : 0;
  remote.speed = Number.isFinite(message.speed) ? clamp(message.speed, 0, 5000) : 0;
  remote.color = typeof message.color === 'string' && /^#[0-9a-f]{6}$/i.test(message.color) ? message.color : '#ef4444';
  remote.motion = ['idle', 'walk', 'run', 'climb', 'air'].includes(message.motion) ? message.motion : 'idle';
}
function animateRemotes(dt) {
  for (const remote of remotes.values()) {
    const a = remote.actor;
    if (remote.mode === 'dragon') {
      a.pos.lerp(remote.target, damp(10, dt));
      a.fwd.set(Math.sin(remote.yaw) * Math.cos(remote.pitch), Math.sin(remote.pitch), Math.cos(remote.yaw) * Math.cos(remote.pitch));
      a.flightSpeed = remote.speed; a.update(dt, elapsed);
      for (const trail of remote.trails) { trail.setColor(remote.color); trail.update(dt, a.pos, a.fwd, remote.speed, remote.speed > 300); }
    } else {
      a.position.lerp(remote.target, damp(12, dt)); a.root.position.copy(a.position); a.root.rotation.y = remote.facingYaw;
      a.state = remote.motion;
      // Remote characters need smooth position interpolation, but their limb
      // buffers do not need to be rebuilt at the display refresh rate.
      remote.animationElapsed = (remote.animationElapsed || 0) + dt;
      if (remote.animationElapsed >= 1 / 20) {
        remote.avatar.animate(remote.animationElapsed, { state: a.state, speed: remote.speed,
          verticalSpeed: remote.verticalSpeed, ability: remote.ability ? remote.species : '' });
        remote.animationElapsed = 0;
      }
    }
  }
}
function applyWorld(event) {
  if (!event || typeof event.kind !== 'string') return;
  if (event.kind === 'reset') {
    city.reset(); urban.reset(); polyProps.reset(); fx.burning.length = 0; meteor.reset();
    destructionChain.reset();
    zodiacInk?.clear(); animalInkEffects.reset(); animalFlow.reset();
    inkSurfBoost = 0; wallBreachAt = -Infinity; guestBurstSentAt.clear(); zodiacAbilities.ink = 0;
    $('sc').textContent = '0'; $('coopStatus').textContent = 'Cidade reconstruída pelo anfitrião.';
    return;
  }
  if (event.kind === 'clear') {
    city.clearPaint(); zodiacInk?.clear(); animalInkEffects.reset(); animalFlow.reset();
    zodiacAbilities.ink = 0;
    return;
  }
  if (!Array.isArray(event.p) || event.p.length !== 3 || !event.p.every(v => Number.isFinite(v) && Math.abs(v) < 30000)
      || !Number.isFinite(event.r) || event.r <= 0 || event.r > 100) return;
  const p = new THREE.Vector3().fromArray(event.p);
  if (event.kind === 'paint' && Number.isInteger(event.color) && event.color >= 0 && event.color <= 0xffffff)
    city.paintSphere(p, event.r, event.color);
  if (event.kind === 'destroy') destroyWorld(p, event.r, clamp(Number(event.power) || 25, 0, 100), clamp(Number(event.maxN) || 400, 1, 400));
}
recordWorld = (event) => {
  if (applyingWorld || coop.role === 'guest') return;
  if (event.kind === 'reset') { worldHistory.length = 0; worldQueue.length = 0; }
  if (event.kind === 'clear') {
    for (let i = worldHistory.length - 1; i >= 0; i--) if (worldHistory[i].kind === 'paint') worldHistory.splice(i, 1);
    for (let i = worldQueue.length - 1; i >= 0; i--) if (worldQueue[i].kind === 'paint') worldQueue.splice(i, 1);
  }
  worldHistory.push(event);
  if (coop.role === 'host') {
    if (event.kind === 'reset' || event.kind === 'clear') {
      while (worldQueue.length) coop.send({ type: 'world', events: worldQueue.splice(0, 30) });
      coop.send({ type: 'world', events: [event] });
    } else worldQueue.push(event);
  }
  if (worldHistory.length > 5000) worldHistory.shift();
};
function setRoomControls() {
  const inRoom = !!coop.role, guest = coop.role === 'guest';
  $('coopLeave').hidden = !inRoom; $('switchCharacter').disabled = inRoom;
  characterSelect.disabled = coop.role === 'host';
  characterSelect.querySelector('option[value="dragon"]').disabled = guest;
  $('resetCity').disabled = guest; $('clearPaint').disabled = guest;
}
function joinRoom() {
  if (coop.join($('coopCode').value, $('coopName').value)) {
    setPlayerMode('human'); setRoomControls();
  }
}
$('coopHost').addEventListener('click', () => {
  if (coop.host($('coopName').value)) { setPlayerMode('dragon'); setRoomControls(); }
});
$('coopJoin').addEventListener('click', joinRoom);
$('coopBrowse').addEventListener('click', () => { coop.watchRooms(); $('coopStatus').textContent = 'Procurando salas abertas…'; });
$('coopLeave').addEventListener('click', () => {
  coop.leave(); for (const id of [...remotes.keys()]) removeRemote(id);
  worldHistory.length = worldQueue.length = 0; setRoomControls();
});
function updateNetwork(dt) {
  animateRemotes(dt);
  if (!coop.role) return;
  networkTime += dt; worldTime += dt;
  if (networkTime >= 0.08) {
    networkTime = 0;
    sendLocalState();
  }
  if (coop.role === 'host' && worldTime >= 0.15) {
    worldTime = 0;
    while (worldQueue.length) coop.send({ type: 'world', events: worldQueue.splice(0, 30) });
  }
}
function sendLocalState() {
  coop.send({ type: 'state', id: coop.id, mode: playerMode, p: activePosition().toArray(), yaw, pitch,
    speed: actualSpeed, color: paintColor.value, motion: playerMode === 'human' ? human.state : 'air',
    species: playerMode === 'human' ? activeSpecies : undefined,
    facingYaw: playerMode === 'human' ? human.facingYaw : undefined,
    verticalSpeed: playerMode === 'human' ? human.velocity.y : undefined,
    ability: playerMode === 'human' && zodiacAbilities.active });
}

let qualityElapsed = 0, qualityFrames = 0, stableWindows = 0;
let shadowElapsed = 0;
const resolutionOptions = document.querySelectorAll('input[name="resolutionMode"]');
resolutionOptions.forEach((option) => {
  option.checked = option.value === resolutionMode;
  option.addEventListener('change', () => {
    if (!option.checked) return;
    resolutionMode = option.value;
    try { localStorage.setItem('draco-resolution-mode', resolutionMode); } catch { /* Optional preference. */ }
    canvas.style.imageRendering = resolutionMode === 'normal' ? '' : 'pixelated';
    renderPixelRatio = maxPixelRatio * resolutionScales[resolutionMode];
    qualityElapsed = qualityFrames = stableWindows = 0;
    renderer.setPixelRatio(renderPixelRatio);
    resize();
  });
});
function adaptResolution(rawDt) {
  if (document.hidden || state !== 'playing' || rawDt > 0.5) {
    qualityElapsed = 0; qualityFrames = 0; stableWindows = 0;
    return;
  }
  qualityElapsed += rawDt; qualityFrames++;
  if (qualityElapsed < 3) return;
  const fps = qualityFrames / qualityElapsed;
  qualityElapsed = 0; qualityFrames = 0;
  const cap = maxPixelRatio * resolutionScales[resolutionMode];
  const floor = Math.min(cap, 0.65 * resolutionScales[resolutionMode]);
  let next = renderPixelRatio;
  if (fps < 35) { next = Math.max(floor, renderPixelRatio - 0.15 * resolutionScales[resolutionMode]); stableWindows = 0; }
  else if (fps > 55 && ++stableWindows >= 3) { next = Math.min(cap, renderPixelRatio + 0.1 * resolutionScales[resolutionMode]); stableWindows = 0; }
  else if (fps <= 55) stableWindows = 0;
  if (Math.abs(next - renderPixelRatio) > 0.01) {
    renderPixelRatio = next;
    renderer.setPixelRatio(renderPixelRatio);
    resize();
  }
}

let halftoneScanTime = Infinity;
let previous = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - previous) / 1000;
  previous = now;
  const dt = Math.min(0.05, rawDt);
  const pad = currentGamepad();
  const startHeld = buttonDown(pad, 9);
  const paintHeld = buttonDown(pad, 2);
  if (paintHeld && !gamepadPaintHeld) firePaint();
  gamepadPaintHeld = paintHeld;
  if (startHeld && !gamepadStartHeld) {
    if (state === 'playing') pause();
    else if (!go.disabled) start();
  }
  gamepadStartHeld = startHeld;
  adaptResolution(rawDt);
  if (state === 'playing') {
    elapsed += dt;
    U.uTime.value = elapsed;
    if (playerMode === 'dragon') updateFlight(dt, pad);
    else updateHuman(dt, pad);
    let cloudDragonPosition = playerMode === 'dragon' ? player.pos : null;
    if (!cloudDragonPosition && coop.role === 'guest') {
      for (const remote of remotes.values()) {
        if (remote.mode === 'dragon') { cloudDragonPosition = remote.actor.pos; break; }
      }
    }
    clouds.update(dt, cloudDragonPosition, !!cloudDragonPosition);
    city.update(dt, activePosition());
    relics.update(old, activePosition(), yaw, elapsed, playerMode === 'human' ? human.height / 2 : 0,
      playerMode === 'human' ? zodiacAbilities.relicGuideRange : undefined);
    if (playerMode === 'dragon') flightCircuit.update(old, player.pos, yaw, elapsed, dt);
    urban.update(dt);
    polyProps.update(dt);
    fx.update(dt, city);
    updateCamera(dt);
    pedestrians.update(dt, camera, cloudDragonPosition);
    updateHud(dt);
  } else if (state === 'menu') {
    camera.position.set(0, 150, 205);
    camera.lookAt(0, 100, -30);
    sky.position.copy(camera.position);
    sky.updateAltitude?.(150, U.uTime.value);
    U.uTime.value += dt;
  }
  // A paused host still owns the shared world: guests' comets and collapses
  // must keep progressing while the host is in a menu.
  if (state !== 'playing' && coop.role === 'host' && coop.peers.length) {
    meteor.update(dt, null, null, 0);
    city.update(dt, activePosition());
    urban.update(dt);
    polyProps.update(dt);
  }
  updateNetwork(dt);
  animalInkEffects.update(dt);
  // New buildings, ink and remote players can appear while the game runs.
  // Prepare their materials periodically without walking the scene every frame.
  if (halftoneUniform.value > 0) {
    halftoneScanTime += rawDt;
    if (halftoneScanTime >= 0.25) { applyHalftone(scene); halftoneScanTime = 0; }
  } else halftoneScanTime = Infinity;
  shadowElapsed += Math.min(rawDt, 0.25);
  if (shadowElapsed >= 0.08) { renderer.shadowMap.needsUpdate = true; shadowElapsed = 0; }
  city.updatePropVisibility(camera, canvas.height);
  composer.render();
}
requestAnimationFrame(frame);
