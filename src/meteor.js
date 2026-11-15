import * as THREE from 'three';
import { addInkOutline } from './outline.js';

const BALL_RADIUS = 16;
const SPAWN_DISTANCE = 68;
const PLAYER_RADIUS = 6;
const GRAVITY = 55;
const MAX_OBJECTS = 4;
const MAX_AGE = 45;
const SLICE_COUNT = 9;

function finiteVector(v) {
  return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function paintGeometry() {
  const geometry = new THREE.SphereGeometry(1, 24, 16);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const swell = 1 + 0.065 * Math.sin(x * 13 + y * 7) * Math.sin(z * 11 - y * 5)
      + 0.035 * Math.sin(y * 21 + x * 9);
    positions.setXYZ(i, x * swell, y * swell, z * swell);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function makeBall(color) {
  const group = new THREE.Group();
  const tint = new THREE.Color(color ?? 0x18a35d);
  const main = new THREE.Mesh(paintGeometry(), new THREE.MeshPhysicalMaterial({
    color: tint, roughness: 0.26, metalness: 0, clearcoat: 0.65, clearcoatRoughness: 0.2,
    emissive: tint, emissiveIntensity: 0.12,
  }));
  main.scale.setScalar(BALL_RADIUS);
  addInkOutline(main.material);
  group.add(main);
  // Uneven paint beads make the silhouette read as liquid rather than stone.
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.39996323;
    const y = -0.7 + i * 0.23;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    const bead = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.32, clearcoat: 0.5 }));
    const radius = BALL_RADIUS * (0.14 + (i % 3) * 0.045);
    addInkOutline(bead.material);
    bead.scale.set(radius, radius * (0.7 + (i % 2) * 0.25), radius);
    bead.position.set(Math.cos(angle) * horizontal * BALL_RADIUS * 0.95,
      y * BALL_RADIUS * 0.95, Math.sin(angle) * horizontal * BALL_RADIUS * 0.95);
    group.add(bead);
  }
  return group;
}

function disposeGroup(group) {
  for (const child of group.children) {
    child.geometry?.dispose();
    child.material?.dispose();
  }
}

// A stationary paint sphere becomes a meteor when the player's swept path crosses it.
export class PaintMeteor {
  constructor(scene, city, fx = null, audio = null) {
    this.scene = scene;
    this.city = city;
    this.fx = fx;
    this.audio = audio;
    this.balls = [];
    this.impacts = [];
    this.nextId = 1;
  }

  fire(pos, dir, color) {
    if (!finiteVector(pos) || !finiteVector(dir)) return null;
    const forward = new THREE.Vector3(dir.x, dir.y, dir.z);
    if (forward.lengthSq() < 1e-8) return null;
    forward.normalize();
    while (this.balls.length >= MAX_OBJECTS) this.removeBall(0);
    const group = makeBall(color);
    group.position.set(pos.x, pos.y, pos.z).addScaledVector(forward, SPAWN_DISTANCE);
    this.scene.add(group);
    const ball = { id: this.nextId++, group, position: group.position, forward,
      velocity: new THREE.Vector3(), radius: BALL_RADIUS, state: 'waiting', age: 0 };
    this.balls.push(ball);
    this.audio?.play?.('shot');
    return ball;
  }

  // velocity may be a world-space vector or a speed in metres/second.
  update(dt, oldPos, newPos, velocity) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const playerPath = finiteVector(oldPos) && finiteVector(newPos)
      ? new THREE.Vector3().subVectors(newPos, oldPos) : null;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      ball.age += dt;
      if (ball.age > MAX_AGE) { this.removeBall(i); continue; }
      if (ball.state === 'waiting') {
        if (playerPath && this.crossed(ball, oldPos, playerPath)) {
          if (finiteVector(velocity)) ball.velocity.set(velocity.x, velocity.y, velocity.z);
          else if (typeof velocity === 'number' && Number.isFinite(velocity) && playerPath.lengthSq() > 1e-8)
            ball.velocity.copy(playerPath).normalize().multiplyScalar(Math.max(0, velocity));
          else ball.velocity.copy(playerPath).multiplyScalar(1 / dt);
          if (ball.velocity.lengthSq() < 1e-8) ball.velocity.copy(ball.forward).multiplyScalar(40);
          ball.state = 'meteor';
          ball.age = 0;
          this.fx?.sparks?.(ball.position, 12);
          this.audio?.play?.('charge');
        }
      } else {
        const previousY = ball.position.y;
        ball.position.addScaledVector(ball.velocity, dt);
        ball.position.y -= 0.5 * GRAVITY * dt * dt;
        ball.velocity.y -= GRAVITY * dt;
        ball.group.rotation.z += dt * 2.4;
        ball.group.rotation.x += dt * 1.3;
        if (previousY > ball.radius && ball.position.y <= ball.radius) {
          const fraction = (previousY - ball.radius) / Math.max(previousY - ball.position.y, 1e-8);
          ball.position.x -= ball.velocity.x * dt * (1 - fraction);
          ball.position.z -= ball.velocity.z * dt * (1 - fraction);
          ball.position.y = ball.radius;
          this.startImpact(ball);
          this.removeBall(i);
        } else if (ball.position.y <= ball.radius) {
          ball.position.y = ball.radius;
          this.startImpact(ball);
          this.removeBall(i);
        }
      }
    }
    this.advanceImpacts();
  }

  crossed(ball, oldPos, path) {
    const lengthSq = path.lengthSq();
    if (lengthSq < 1e-8) return false;
    const offset = new THREE.Vector3().subVectors(ball.position, oldPos);
    const t = THREE.MathUtils.clamp(offset.dot(path) / lengthSq, 0, 1);
    const closest = new THREE.Vector3(oldPos.x, oldPos.y, oldPos.z).addScaledVector(path, t);
    const reach = ball.radius + PLAYER_RADIUS;
    return closest.distanceToSquared(ball.position) <= reach * reach;
  }

  startImpact(ball) {
    const center = new THREE.Vector3(ball.position.x, 0, ball.position.z);
    const radius = ball.radius * 2.5;
    this.impacts.push({ center, radius, slice: 0 });
    this.fx?.explosion?.(new THREE.Vector3(center.x, 2, center.z), Math.min(15, radius * 0.3));
    this.fx?.bigDust?.(center, 18);
    if (this.fx && Number.isFinite(this.fx.shake)) this.fx.shake = Math.max(this.fx.shake, 1.4);
    this.audio?.play?.('impact');
  }

  advanceImpacts() {
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const impact = this.impacts[i];
      const y = impact.slice * 8;
      const sliceRadius = Math.sqrt(Math.max(0, impact.radius ** 2 - y ** 2));
      if (sliceRadius > 0) {
        const point = new THREE.Vector3(impact.center.x, y, impact.center.z);
        this.city?.destroySphere?.(point, sliceRadius, 85, 80);
      }
      impact.slice++;
      if (impact.slice >= SLICE_COUNT || impact.slice * 8 >= impact.radius) this.impacts.splice(i, 1);
    }
  }

  removeBall(index) {
    const [ball] = this.balls.splice(index, 1);
    if (!ball) return;
    this.scene.remove(ball.group);
    disposeGroup(ball.group);
  }

  reset() {
    while (this.balls.length) this.removeBall(this.balls.length - 1);
    this.impacts.length = 0;
  }

  dispose() { this.reset(); }
}
