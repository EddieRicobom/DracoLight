import * as THREE from 'three';
import { PaintBallEffects } from './paint-ball-effects.js';

const BALL_RADIUS = 16;
const SPAWN_DISTANCE = 68;
const PLAYER_RADIUS = 6;
const GRAVITY = 55;
const MAX_OBJECTS = 4;
const MAX_AGE = 45;
const SLICE_COUNT = 9;
const SHOT_SPEED = 180;
const SHOT_TIME = 4;

function finiteVector(v) {
  return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

// A paint shot becomes a meteor when the player's swept path crosses it.
export class PaintMeteor {
  constructor(scene, city, fx = null, audio = null) {
    this.scene = scene;
    this.city = city;
    this.fx = fx;
    this.audio = audio;
    this.balls = [];
    this.impacts = [];
    this.nextId = 1;
    this.onPaint = null;
    this.tornado = null;
    this.effects = new PaintBallEffects(scene);
  }

  fire(pos, dir, color) {
    if (!finiteVector(pos) || !finiteVector(dir)) return null;
    const forward = new THREE.Vector3(dir.x, dir.y, dir.z);
    if (forward.lengthSq() < 1e-8) return null;
    forward.normalize();
    while (this.balls.length >= MAX_OBJECTS) this.removeBall(0);
    const tint = new THREE.Color(color ?? 0x18a35d);
    const body = this.effects.makeBody(tint, BALL_RADIUS, forward);
    body.position.set(pos.x, pos.y, pos.z).addScaledVector(forward, SPAWN_DISTANCE);
    this.scene.add(body);
    const ball = { id: this.nextId++, body, position: body.position, forward,
      velocity: new THREE.Vector3(), radius: BALL_RADIUS, state: 'waiting', age: 0,
      color: tint, paintTime: 0, trailDistance: 0,
      shotTime: 0, hitVortices: new Set() };
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
      ball.paintTime += dt;
      if (this.onPaint && ball.paintTime >= 0.15) {
        ball.paintTime = 0;
        this.onPaint(ball.position, ball.radius, ball.color);
      }
      if (ball.age > MAX_AGE) { this.removeBall(i); continue; }
      const previous = ball.position.clone();
      if (ball.state === 'waiting') {
        const travel = Math.min(dt, Math.max(0, SHOT_TIME - ball.shotTime));
        ball.position.addScaledVector(ball.forward, SHOT_SPEED * travel);
        ball.shotTime += dt;
        this.tornado?.hitByPaintBall?.(ball, previous, ball.position);
        if (playerPath && this.crossed(ball, oldPos, playerPath, previous)) {
          if (finiteVector(velocity)) ball.velocity.set(velocity.x, velocity.y, velocity.z);
          else if (typeof velocity === 'number' && Number.isFinite(velocity) && playerPath.lengthSq() > 1e-8)
            ball.velocity.copy(playerPath).normalize().multiplyScalar(Math.max(0, velocity));
          else ball.velocity.copy(playerPath).multiplyScalar(1 / dt);
          if (ball.velocity.lengthSq() < 1e-8) ball.velocity.copy(ball.forward).multiplyScalar(40);
          ball.state = 'meteor';
          ball.age = 0;
          this.effects.ignite(ball);
          this.fx?.sparks?.(ball.position, 12);
          this.audio?.play?.('charge');
        }
      } else {
        const previousY = ball.position.y;
        ball.position.addScaledVector(ball.velocity, dt);
        ball.position.y -= 0.5 * GRAVITY * dt * dt;
        ball.velocity.y -= GRAVITY * dt;
        this.tornado?.hitByPaintBall?.(ball, previous, ball.position);
        if (previousY > ball.radius && ball.position.y <= ball.radius) {
          const fraction = (previousY - ball.radius) / Math.max(previousY - ball.position.y, 1e-8);
          ball.position.x -= ball.velocity.x * dt * (1 - fraction);
          ball.position.z -= ball.velocity.z * dt * (1 - fraction);
          ball.position.y = ball.radius;
          this.startImpact(ball);
          this.removeBall(i);
          continue;
        } else if (ball.position.y <= ball.radius) {
          ball.position.y = ball.radius;
          this.startImpact(ball);
          this.removeBall(i);
          continue;
        }
      }
      this.effects.flight(ball, previous, dt);
    }
    this.advanceImpacts();
    this.effects.update(dt);
  }

  crossed(ball, oldPos, path, ballStart = ball.position) {
    // Sweep the player's path relative to a moving shot, including fast boosts.
    const relative = path.clone().sub(ball.position).add(ballStart);
    const lengthSq = relative.lengthSq();
    if (lengthSq < 1e-8) {
      const reach = ball.radius + PLAYER_RADIUS;
      const dx = oldPos.x - ballStart.x, dy = oldPos.y - ballStart.y, dz = oldPos.z - ballStart.z;
      return dx * dx + dy * dy + dz * dz <= reach * reach;
    }
    const offset = new THREE.Vector3().subVectors(ballStart, oldPos);
    const t = THREE.MathUtils.clamp(offset.dot(relative) / lengthSq, 0, 1);
    const closest = new THREE.Vector3(oldPos.x, oldPos.y, oldPos.z).addScaledVector(relative, t);
    const reach = ball.radius + PLAYER_RADIUS;
    return closest.distanceToSquared(ballStart) <= reach * reach;
  }

  startImpact(ball) {
    const center = new THREE.Vector3(ball.position.x, 0, ball.position.z);
    const radius = ball.radius * 2.5;
    this.onPaint?.(center, radius, ball.color);
    this.impacts.push({ center, radius, slice: 0 });
    this.effects.burst(center, radius, ball.color, ball.velocity);
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
    this.scene.remove(ball.body);
    ball.body.material.dispose();
  }

  reset() {
    while (this.balls.length) this.removeBall(this.balls.length - 1);
    this.impacts.length = 0;
    this.effects.reset();
  }

  dispose() {
    this.reset();
    this.effects.dispose();
  }
}
