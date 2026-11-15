import * as THREE from 'three';
import { GameAudio } from './audio.js';
import { Dragon, PALETTES } from './dragon.js';
import { City, HALF } from './city.js';
import { createUrbanDetails } from './urban.js';
import { createPolyProps } from './polyprops.js';
import { FX } from './fx.js';
import { InkTrail } from './ink.js';
import { clamp, damp, turnToward, U } from './util.js';
import { createSky, createVisualPipeline } from './visual.js';

const $ = (id) => document.getElementById(id);
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
const maxPixelRatio = Math.min(devicePixelRatio || 1, 1.25);
let renderPixelRatio = maxPixelRatio;
renderer.setPixelRatio(renderPixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
scene.add(new THREE.HemisphereLight(0x8da9d2, 0x48302e, 1.55));
const sun = new THREE.DirectionalLight(0xffb88a, 3.2);
sun.position.set(-180, 260, 130);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
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
sky.scale.setScalar(25);
const composer = createVisualPipeline(renderer, scene, camera);

// The flight, world and presentation systems share only the local player state.
// This leaves room for other pilots later without adding a network dependency now.
const fx = new FX(scene, camera);
const inkLeft = new InkTrail(scene, camera, -9);
const inkRight = new InkTrail(scene, camera, 9);
const city = new City(scene, fx);
const urban = createUrbanDetails(scene, city);
const polyProps = createPolyProps(scene, city);
const player = new Dragon(scene, PALETTES.red);
player.pos.set(0, 115, 115);
player.fwd.set(0, 0, -1);
player.resetTrail();
player.update(0, 0);

const FLIGHT = Object.freeze({
  ceiling: 20000,
  cruise: 95,
  accelerate: 160,
  brake: 42,
  boost: 320,
  turnRate: 5.8,
  boostDrain: 20,
  recovery: 18,
});
let state = 'menu', elapsed = 0, stamina = 100;
let yaw = Math.PI, pitch = 0, speed = FLIGHT.cruise;
let collisionTime = 0, wakeTime = 0, fpsTime = 0, frames = 0;
const keys = new Set();
let activeGamepad = null, gamepadStartHeld = false, draggingMouse = false;
const stick = (value) => Math.abs(value || 0) < 0.14 ? 0 : Math.sign(value) * (Math.abs(value) - 0.14) / 0.86;
function currentGamepad() {
  const pads = navigator.getGamepads?.() || [];
  if (activeGamepad !== null && pads[activeGamepad]?.connected) return pads[activeGamepad];
  activeGamepad = pads.findIndex((pad) => pad?.connected && pad.mapping === 'standard');
  if (activeGamepad < 0) { activeGamepad = null; return null; }
  return pads[activeGamepad];
}
function buttonDown(pad, index) { return !!pad?.buttons[index]?.pressed; }
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const desired = new THREE.Vector3(), side = new THREE.Vector3();
const target = new THREE.Vector3(), old = new THREE.Vector3(), motion = new THREE.Vector3();
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
  state = 'playing';
  menu.classList.add('off');
  hud.classList.add('on');
  // A controller or mouse drag can still steer when pointer lock is unavailable.
  canvas.requestPointerLock?.()?.catch?.(() => {});
}
function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  audio.setFlight(0, false);
  keys.clear();
  draggingMouse = false;
  document.exitPointerLock?.();
  menu.classList.remove('off');
  hud.classList.remove('on');
  $('sub').textContent = 'Voo pausado';
  $('msg').textContent = 'Continue quando estiver pronto para explorar o céu e atravessar a cidade.';
  go.textContent = 'Continuar voo';
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
canvas.addEventListener('click', () => {
  if (state === 'playing' && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && state === 'playing' && !currentGamepad() && !draggingMouse) pause();
});
document.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') {
    if (state === 'playing') pause();
    else if (state === 'paused') start();
    return;
  }
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
  yaw -= stick(pad?.axes[2]) * dt * 2.4;
  pitch = clamp(pitch - stick(pad?.axes[3]) * dt * 2.1, -1.35, 1.35);
  const f = player.fwd;
  desired.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  turnToward(f, desired, dt * FLIGHT.turnRate);
  side.crossVectors(f, THREE.Object3D.DEFAULT_UP).normalize();
  const boosting = (keys.has('ShiftLeft') || keys.has('ShiftRight') || buttonDown(pad, 7)) && stamina > 1;
  const throttle = stick(pad?.axes[1]);
  const baseSpeed = boosting ? FLIGHT.boost : keys.has('KeyW') || throttle < -0.25 ? FLIGHT.accelerate :
    keys.has('KeyS') || throttle > 0.25 ? FLIGHT.brake : FLIGHT.cruise;
  const wanted = baseSpeed * altitudeSpeed(player.pos.y);
  speed += (wanted - speed) * damp(boosting ? 3.8 : 2.8, dt);
  stamina = clamp(stamina + (boosting ? -FLIGHT.boostDrain : FLIGHT.recovery) * dt, 0, 100);

  old.copy(player.pos);
  player.pos.addScaledVector(f, speed * dt);
  if (keys.has('KeyA')) player.pos.addScaledVector(side, -speed * dt * 0.58);
  if (keys.has('KeyD')) player.pos.addScaledVector(side, speed * dt * 0.58);
  player.pos.addScaledVector(side, stick(pad?.axes[0]) * speed * dt * 0.58);
  if (keys.has('Space') || buttonDown(pad, 0)) player.pos.y += speed * dt * 0.75;
  if (keys.has('KeyC') || buttonDown(pad, 1)) player.pos.y -= speed * dt * 0.75;
  player.pos.y = clamp(player.pos.y, 7, FLIGHT.ceiling);
  const bound = flightBoundary(player.pos.y);
  player.pos.x = clamp(player.pos.x, -bound, bound);
  player.pos.z = clamp(player.pos.z, -bound, bound);

  // Sweep the path, so a fast boost cannot skip straight through a building.
  motion.subVectors(player.pos, old);
  const distance = motion.length();
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
  audio.setFlight(speed);
  player.flightSpeed = speed;
  player.boosting = boosting;
  player.update(dt, elapsed);
  inkLeft.update(dt, player.pos, f, speed, boosting);
  inkRight.update(dt, player.pos, f, speed, boosting);
}

function updateCamera(dt) {
  const back = tmp.copy(player.fwd).multiplyScalar(-48 - clamp(speed / 90, 0, 12));
  const elevated = target.copy(player.pos).add(back).addScaledVector(THREE.Object3D.DEFAULT_UP, 22);
  camera.position.lerp(elevated, damp(5.5, dt));
  if (fx.shake > 0.02) camera.position.add(tmp2.set((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake, 0));
  camera.lookAt(tmp2.copy(player.pos).addScaledVector(player.fwd, 60));
  camera.fov += ((70 + clamp(speed / 55, 0, 14)) - camera.fov) * damp(2.5, dt);
  camera.updateProjectionMatrix();
  fx.setScale(innerHeight * renderer.getPixelRatio(), camera.fov);
  sun.position.set(player.pos.x - 180, player.pos.y + 260, player.pos.z + 130);
  sun.target.position.copy(player.pos);
  sun.target.updateMatrixWorld();
  sky.position.copy(camera.position);
  sky.updateAltitude?.(player.pos.y, elapsed);
}

function updateHud(dt) {
  $('stP').firstElementChild.style.width = `${stamina}%`;
  $('sc').textContent = city.score.toLocaleString('pt-BR');
  readouts.textContent = `Velocidade: ${Math.round(speed * 3.6).toLocaleString('pt-BR')} km/h · Altitude: ${Math.round(player.pos.y).toLocaleString('pt-BR')} m`;
  fpsTime += dt;
  frames++;
  if (fpsTime > 0.5) {
    $('fps').textContent = `${Math.round(frames / fpsTime)} FPS`;
    fpsTime = 0;
    frames = 0;
  }
}

let qualityElapsed = 0, qualityFrames = 0, stableWindows = 0;
function adaptResolution(rawDt) {
  if (document.hidden || state !== 'playing' || rawDt > 0.5) {
    qualityElapsed = 0; qualityFrames = 0; stableWindows = 0;
    return;
  }
  qualityElapsed += rawDt; qualityFrames++;
  if (qualityElapsed < 3) return;
  const fps = qualityFrames / qualityElapsed;
  qualityElapsed = 0; qualityFrames = 0;
  let next = renderPixelRatio;
  if (fps < 35) { next = Math.max(0.65, renderPixelRatio - 0.15); stableWindows = 0; }
  else if (fps > 55 && ++stableWindows >= 3) { next = Math.min(maxPixelRatio, renderPixelRatio + 0.1); stableWindows = 0; }
  else if (fps <= 55) stableWindows = 0;
  if (Math.abs(next - renderPixelRatio) > 0.01) {
    renderPixelRatio = next;
    renderer.setPixelRatio(renderPixelRatio);
    resize();
  }
}

let previous = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - previous) / 1000;
  previous = now;
  const dt = Math.min(0.05, rawDt);
  const pad = currentGamepad();
  const startHeld = buttonDown(pad, 9);
  if (startHeld && !gamepadStartHeld) {
    if (state === 'playing') pause();
    else if (!go.disabled) start();
  }
  gamepadStartHeld = startHeld;
  adaptResolution(rawDt);
  if (state === 'playing') {
    elapsed += dt;
    U.uTime.value = elapsed;
    updateFlight(dt, pad);
    city.update(dt, player.pos);
    urban.update(dt);
    polyProps.update(dt);
    fx.update(dt, city);
    updateCamera(dt);
    updateHud(dt);
  } else if (state === 'menu') {
    camera.position.set(0, 150, 205);
    camera.lookAt(0, 100, -30);
    sky.position.copy(camera.position);
    sky.updateAltitude?.(150, U.uTime.value);
    U.uTime.value += dt;
  }
  composer.render();
}
requestAnimationFrame(frame);
