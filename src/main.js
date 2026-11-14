import * as THREE from 'three';
import { GameAudio } from './audio.js';
import { Pokemon } from './pokemon.js';
import { City, HALF } from './city.js';
import { FX, Beam, Projectiles } from './fx.js';
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
  if (!audio.muted) audio.start().catch(() => {});
});
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x34202a);
scene.fog = new THREE.FogExp2(0x8d554b, 0.0017);
const camera = new THREE.PerspectiveCamera(70, 1, 1, 26000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
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
// Keep the camera inside the sky dome even at the top of the flight envelope.
sky.scale.setScalar(18);
const composer = createVisualPipeline(renderer, scene, camera);

const fx = new FX(scene, camera);
const city = new City(scene, fx);
const player = new Pokemon(scene, 'rayquaza');
const hunter = new Pokemon(scene, 'deoxys');
const beam = new Beam(scene);
const projectiles = new Projectiles(scene);
player.pos.set(0, 115, 115);
player.fwd.set(0, 0, -1);
hunter.pos.set(0, 125, -170);
hunter.fwd.set(0, 0, 1);
player.resetTrail(); hunter.resetTrail();
player.update(0, 0); hunter.update(0, 0);

let state = 'menu', elapsed = 0, hp = 100, enemyHp = 240, stamina = 100;
let yaw = Math.PI, pitch = 0, speed = 45, breathTime = 0, fireballTime = 0;
let enemyShot = 1.2, charge = 0, beamTime = 0, beamHitTime = 0, beamCooldown = 5;
let playerInvuln = 0, enemyInvuln = 0, collisionTime = 0, fpsTime = 0, frames = 0, wakeTime = 0;
const keys = new Set(), mouse = { left: false };
const altitudeReadout = document.createElement('span');
altitudeReadout.setAttribute('aria-live', 'off');
altitudeReadout.style.cssText = 'display:block;margin-top:6px;font-size:11px;letter-spacing:.08em;color:#cfe8ff';
$('score').append(altitudeReadout);
const v = () => new THREE.Vector3();
const tmp = v(), tmp2 = v(), desired = v(), side = v(), target = v(), old = v();
const aim = v(), beamDirection = v(), ray = {};
const MAX_ALTITUDE = 12000;
const flightBoundary = (height) => HALF - 12 + 1550 * clamp((height - 200) / 1800, 0, 1);
const altitudeSpeed = (height) => 1 + 2.2 * clamp((height - 150) / 1850, 0, 1);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  fx.setScale(h * renderer.getPixelRatio(), camera.fov);
}
addEventListener('resize', resize);
resize();

function end(win) {
  if (state !== 'playing') return;
  state = 'ended';
  mouse.left = false; beam.hide(); beam.charge(hunter.mouth, 0);
  document.exitPointerLock?.();
  menu.classList.remove('off'); hud.classList.remove('on');
  $('sub').textContent = win ? 'Vitória · Deoxys caiu' : 'Derrota · Rayquaza caiu';
  $('msg').textContent = win
    ? `Deoxys foi derrotado. Você destruiu ${city.score} blocos da cidade.`
    : `Rayquaza caiu durante a perseguição. Você destruiu ${city.score} blocos da cidade. Tente outra vez.`;
  go.textContent = 'Jogar novamente';
}

function start() {
  audio.start().catch(() => {});
  if (state === 'ended') { location.reload(); return; }
  state = 'playing'; menu.classList.add('off'); hud.classList.add('on');
  canvas.requestPointerLock?.();
}
go.disabled = true;
go.textContent = 'Carregando modelos…';
Promise.all([player.ready, hunter.ready]).then(() => {
  go.disabled = false;
  go.textContent = 'Iniciar caçada';
}).catch(() => {
  go.textContent = 'Erro ao carregar modelos';
  $('status').textContent = 'Atualize a página para tentar novamente.';
});
go.addEventListener('click', start);
canvas.addEventListener('click', () => { if (state === 'playing' && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && state === 'playing') pause();
});
function pause() {
  if (state !== 'playing') return;
  state = 'paused'; mouse.left = false; keys.clear();
  beam.hide(); beam.charge(hunter.mouth, 0);
  document.exitPointerLock?.();
  menu.classList.remove('off'); hud.classList.remove('on');
  $('sub').textContent = 'Caçada pausada';
  $('msg').textContent = 'Retome a caçada quando estiver pronto.';
  go.textContent = 'Continuar';
}
document.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') { if (state === 'playing') pause(); else if (state === 'paused') start(); return; }
  keys.add(e.code);
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
document.addEventListener('mousemove', (e) => {
  if (state !== 'playing' || document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.0022;
  pitch = clamp(pitch - e.movementY * 0.0018, -1.15, 1.15);
});
canvas.addEventListener('mousedown', (e) => {
  if (state !== 'playing') return;
  if (e.button === 0) mouse.left = true;
  if (e.button === 2) shootFireball();
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('blur', () => { keys.clear(); mouse.left = false; if (state === 'playing') pause(); });

function damagePlayer(amount) {
  if (state !== 'playing' || playerInvuln > 0) return;
  hp = Math.max(0, hp - amount); audio.play('hit');
  playerInvuln = 0.32; player.hit = 1; fx.shake = Math.max(fx.shake, 1.6);
  $('dmg').style.boxShadow = 'inset 0 0 160px rgba(140,200,255,.7)';
  if (hp <= 0) end(false);
}
function damageHunter(amount) {
  if (state !== 'playing' || enemyInvuln > 0) return;
  enemyHp = Math.max(0, enemyHp - amount);
  enemyInvuln = 0.06; hunter.hit = 1;
  $('cross').classList.add('hit');
  if (enemyHp <= 0) { fx.explosion(hunter.pos, 22); hunter.setVisible(false); end(true); }
}
function shootFireball() {
  if (state !== 'playing' || fireballTime > 0 || stamina < 22) return;
  fireballTime = 0.65; stamina -= 22; audio.play('shot');
  player.jaw = 1;
  projectiles.fire('fireball', player.mouth, tmp.copy(player.fwd).multiplyScalar(155).addScaledVector(player.fwd, speed * 0.3), 1);
  fx.light(player.mouth, 0xff7636, 13000, 0.3);
}
function blast(p, kind, owner) {
  audio.play('impact');
  const frost = kind !== 'fireball';
  fx.explosion(p, frost ? 9 : 14, frost ? 'frost' : 'fire');
  city.destroySphere(p, frost ? 6 : 15, 35, 90);
  if (owner === 1 && hunter.hitTest(p, 14) >= 0) damageHunter(34);
  if (owner === 2 && player.hitTest(p, 11) >= 0) damagePlayer(18);
  if (owner === 1 && p.distanceTo(player.pos) < 9) damagePlayer(7);
  fx.shake = Math.max(fx.shake, 0.8);
}

function updateProjectiles(dt) {
  for (let i = projectiles.list.length - 1; i >= 0; i--) {
    const p = projectiles.list[i];
    old.copy(p.m.position);
    p.m.position.addScaledVector(p.vel, dt);
    p.life += dt;
    fx.trail(p.m.position, p.owner === 2);
    tmp.subVectors(p.m.position, old);
    const dist = tmp.length();
    if (dist > 0) tmp.multiplyScalar(1 / dist);
    const wall = city.raycast(old, tmp, dist, ray);
    const victim = p.owner === 1 ? hunter : player;
    const hitEnd = target.copy(old).addScaledVector(tmp, Math.min(wall, dist));
    const dragonHit = victim.segDist(old, hitEnd) < 2.5;
    const limit = flightBoundary(p.m.position.y) + 100;
    if (wall < dist || dragonHit || p.life > 4 || p.m.position.y < 0 || p.m.position.y > MAX_ALTITUDE + 100 ||
        Math.abs(p.m.position.x) > limit || Math.abs(p.m.position.z) > limit) {
      if (p.life <= 4) {
        if (wall < dist) p.m.position.copy(hitEnd);
        blast(p.m.position, p.kind, p.owner);
      }
      p.m.visible = false;
      projectiles.list.splice(i, 1);
    }
  }
}

function updatePlayer(dt) {
  const f = player.fwd;
  desired.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  turnToward(f, desired, dt * 2.8);
  side.crossVectors(f, THREE.Object3D.DEFAULT_UP).normalize();
  const boosting = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && stamina > 2;
  const wanted = (boosting ? 110 : keys.has('KeyW') ? 75 : keys.has('KeyS') ? 24 : 48) * altitudeSpeed(player.pos.y);
  speed += (wanted - speed) * damp(2.3, dt);
  if (boosting) stamina = Math.max(0, stamina - 21 * dt);
  else stamina = Math.min(100, stamina + 14 * dt);
  old.copy(player.pos);
  player.pos.addScaledVector(f, speed * dt);
  if (keys.has('KeyA')) player.pos.addScaledVector(side, -speed * dt * 0.65);
  if (keys.has('KeyD')) player.pos.addScaledVector(side, speed * dt * 0.65);
  if (keys.has('Space')) player.pos.y += speed * dt * 0.8;
  if (keys.has('KeyC')) player.pos.y -= speed * dt * 0.8;
  player.pos.y = clamp(player.pos.y, 7, MAX_ALTITUDE);
  const bound = flightBoundary(player.pos.y);
  player.pos.x = clamp(player.pos.x, -bound, bound);
  player.pos.z = clamp(player.pos.z, -bound, bound);
  collisionTime -= dt;
  if (city.chunkAt(player.pos.x, player.pos.y, player.pos.z) >= 0 && collisionTime <= 0) {
    collisionTime = 0.22;
    if (boosting) { city.destroySphere(player.pos, 7, 45, 16); fx.shake = 0.6; }
    else { city.destroySphere(player.pos, 5, 22, 8); damagePlayer(1.6); speed *= 0.55; }
  }
  if (player.pos.y <= 7.1 && f.y < -0.2 && collisionTime <= 0) { collisionTime = 0.5; damagePlayer(10); }
  breathTime -= dt; fireballTime -= dt;
  if (mouse.left && stamina > 0.5) {
    stamina = Math.max(0, stamina - 18 * dt);
    player.jaw = Math.min(1, player.jaw + dt * 7);
    while (breathTime <= 0) {
      breathTime += 0.035;
      audio.play('fire');
      fx.breath(player.mouth, f, tmp.copy(f).multiplyScalar(speed), 8);
      const breathRange = Math.min(65, city.raycast(player.mouth, f, 65, ray));
      for (let d = 4; d <= breathRange; d += 8) {
        target.copy(player.mouth).addScaledVector(f, d);
        city.damageSphere(target, 4 + d * 0.045, 5);
        if (hunter.hitTest(target, 4 + d * 0.05) >= 0) { damageHunter(2.2); break; }
      }
      if (breathRange < 65) city.damageSphere(target.copy(player.mouth).addScaledVector(f, breathRange), 5, 5);
    }
  } else { breathTime = 0; player.jaw = Math.max(0, player.jaw - dt * 5); }
  player.update(dt, elapsed);
  wakeTime -= dt;
  if (boosting && wakeTime <= 0) {
    wakeTime = 0.05;
    fx.flightWake(tmp.copy(player.pos).addScaledVector(f, -15), f);
  }
}

function updateHunter(dt) {
  if (enemyHp <= 0) return;
  // Flee the player, with a gentle sideways weave and a turn away from the arena edge.
  const away = tmp.subVectors(hunter.pos, player.pos);
  if (away.lengthSq() < 0.001) away.copy(hunter.fwd);
  away.normalize();
  const lateral = tmp2.crossVectors(away, THREE.Object3D.DEFAULT_UP).normalize();
  desired.copy(away).addScaledVector(lateral, Math.sin(elapsed * 0.7) * 0.35);
  const bound = flightBoundary(hunter.pos.y);
  const edge = bound * 0.75;
  if (Math.abs(hunter.pos.x) > edge) desired.x -= Math.sign(hunter.pos.x) * (Math.abs(hunter.pos.x) - edge) / (bound - edge) * 3;
  if (Math.abs(hunter.pos.z) > edge) desired.z -= Math.sign(hunter.pos.z) * (Math.abs(hunter.pos.z) - edge) / (bound - edge) * 3;
  if (hunter.pos.y < 50) desired.y += 0.6;
  if (hunter.pos.y > MAX_ALTITUDE - 150) desired.y -= 0.6;
  desired.normalize();
  turnToward(hunter.fwd, desired, dt * 1.3);
  hunter.pos.addScaledVector(hunter.fwd, dt * 55 * altitudeSpeed(hunter.pos.y));
  hunter.pos.y = clamp(hunter.pos.y, 18, MAX_ALTITUDE);
  hunter.pos.x = clamp(hunter.pos.x, -bound, bound);
  hunter.pos.z = clamp(hunter.pos.z, -bound, bound);
  if (city.chunkAt(hunter.pos.x, hunter.pos.y, hunter.pos.z) >= 0) city.destroySphere(hunter.pos, 6, 25, 15);
  hunter.update(dt, elapsed);
}

function updateCamera(dt) {
  const back = tmp.copy(player.fwd).multiplyScalar(-22);
  const elevated = target.copy(player.pos).add(back).addScaledVector(THREE.Object3D.DEFAULT_UP, 8);
  camera.position.lerp(elevated, damp(5, dt));
  if (fx.shake > 0.02) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake, 0));
  camera.lookAt(tmp2.copy(player.pos).addScaledVector(player.fwd, 50));
  sun.position.set(player.pos.x - 180, player.pos.y + 260, player.pos.z + 130);
  sun.target.position.copy(player.pos); sun.target.updateMatrixWorld();
  sky.position.copy(camera.position);
  sky.updateAltitude?.(player.pos.y, elapsed);
}

function updateHud(dt) {
  $('hpP').firstElementChild.style.width = `${hp}%`;
  $('hpE').firstElementChild.style.width = `${enemyHp / 240 * 100}%`;
  $('stP').firstElementChild.style.width = `${stamina}%`;
  $('sc').textContent = city.score.toLocaleString('pt-BR');
  if (altitudeReadout) altitudeReadout.textContent = `Altitude: ${Math.round(player.pos.y).toLocaleString('pt-BR')} m`;
  $('dmg').style.boxShadow = `inset 0 0 160px rgba(140,200,255,${Math.min(0.65, playerInvuln * 1.5)})`;
  if (enemyInvuln <= 0) $('cross').classList.remove('hit');
  const marker = $('arrow');
  target.copy(hunter.pos).project(camera);
  if (target.z < 1 && Math.abs(target.x) < 0.8 && Math.abs(target.y) < 0.8) marker.style.display = 'none';
  else {
    marker.style.display = 'block';
    marker.style.left = `${clamp(target.x * 0.5 + 0.5, 0.06, 0.94) * innerWidth}px`;
    marker.style.top = `${clamp(-target.y * 0.5 + 0.5, 0.08, 0.88) * innerHeight}px`;
    marker.style.transform = `rotate(${Math.atan2(target.x, target.y) * 180 / Math.PI}deg)`;
  }
  fpsTime += dt; frames++;
  if (fpsTime > 0.5) { $('fps').textContent = `${Math.round(frames / fpsTime)} FPS`; fpsTime = 0; frames = 0; }
}

let previous = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - previous) / 1000); previous = now;
  if (state === 'playing') {
    elapsed += dt; U.uTime.value = elapsed;
    playerInvuln = Math.max(0, playerInvuln - dt);
    enemyInvuln = Math.max(0, enemyInvuln - dt);
    updatePlayer(dt);
    if (state === 'playing') updateHunter(dt);
    if (state === 'playing') updateProjectiles(dt);
    city.update(dt); fx.update(dt, city); updateCamera(dt); updateHud(dt);
  } else if (state === 'menu') {
    camera.position.set(0, 150, 205); camera.lookAt(0, 100, -30);
    sky.position.copy(camera.position);
    sky.updateAltitude?.(150, U.uTime.value);
    U.uTime.value += dt;
  }
  composer.render();
}
requestAnimationFrame(frame);
