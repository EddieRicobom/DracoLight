import * as THREE from 'three';

// Recognize a sustained, coherent horizontal turn whose path bends back on itself.
export class SpiralDetector {
  constructor() { this.reset(); }
  reset() { this.generation = (this.generation || 0) + 1; this.samples = []; this.lastHeading = null; this.sign = 0; this.turn = 0; this.duration = 0; this.distance = 0; this.speedTime = 0; this.emittedAt = 0; this.straightTime = 0; }
  update(dt, pos, forward, speed) {
    if (!(dt > 0 && dt <= 0.25) || !pos || !forward || speed < 5) { this.reset(); return null; }
    const heading = Math.atan2(forward.x, forward.z);
    if (!Number.isFinite(heading) || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) { this.reset(); return null; }
    if (this.lastHeading === null) { this.lastHeading = heading; this.samples.push({ x: pos.x, z: pos.z }); return null; }
    const delta = Math.atan2(Math.sin(heading - this.lastHeading), Math.cos(heading - this.lastHeading));
    this.lastHeading = heading;
    this.straightTime = Math.abs(delta) / dt < 0.04 ? this.straightTime + dt : 0;
    if (this.straightTime > 1.5) { this.reset(); return null; }
    const previous = this.samples[this.samples.length - 1];
    const step = Math.hypot(pos.x - previous.x, pos.z - previous.z);
    if (step > 200 || Math.abs(delta) > 0.8) { this.reset(); return null; }
    // Small instantaneous changes are allowed; a reversal ends the current spiral.
    if (Math.abs(delta) > 0.002) {
      const direction = Math.sign(delta);
      if (this.sign && direction !== this.sign && Math.abs(delta) > 0.015) {
        this.reset(); this.lastHeading = heading; this.samples.push({ x: pos.x, z: pos.z }); return null;
      }
      if (!this.sign) this.sign = direction;
      this.turn += delta * this.sign;
    }
    this.duration += dt;
    this.distance += step;
    this.speedTime += speed * dt;
    this.samples.push({ x: pos.x, z: pos.z });
    if (this.samples.length > 800) this.samples.shift();
    const radius = this.distance / Math.max(this.turn, 0.001);
    const displacement = Math.hypot(pos.x - this.samples[0].x, pos.z - this.samples[0].z);
    if (this.turn < Math.PI * 1.8 || this.duration < 1 || radius < 15 || radius > 500 || (!this.emittedAt && displacement > radius * 1.4) || this.duration - this.emittedAt < 1.5) return null;
    this.emittedAt = this.duration;
    let x = 0, z = 0;
    for (const sample of this.samples) { x += sample.x; z += sample.z; }
    return { x: x / this.samples.length, y: pos.y, z: z / this.samples.length, radius, duration: this.duration, direction: this.sign, generation: this.generation, flightSpeed: this.speedTime / this.duration };
  }
}

const RIBBONS = 4;
const RIBBON_STEPS = 96;
const DROPS = 160;
const PUSH_SPEED = 85;
const MAX_DRIFT_SPEED = 150;
const DRIFT_DAMPING = 0.65;
const WORLD_LIMIT = 2700;

function sweptCylinderHit(start, end, center, bottom, top, radius) {
  // Clip the shot to the tornado's height, then find the closest horizontal approach.
  const dy = end.y - start.y;
  let first = 0, last = 1;
  if (Math.abs(dy) < 1e-8) {
    if (start.y < bottom || start.y > top) return false;
  } else {
    first = Math.max(0, Math.min((bottom - start.y) / dy, (top - start.y) / dy));
    last = Math.min(1, Math.max((bottom - start.y) / dy, (top - start.y) / dy));
    if (first > last) return false;
  }
  const dx = end.x - start.x, dz = end.z - start.z;
  const horizontalLengthSq = dx * dx + dz * dz;
  const closest = horizontalLengthSq < 1e-8 ? first
    : THREE.MathUtils.clamp(((center.x - start.x) * dx + (center.z - start.z) * dz) / horizontalLengthSq, first, last);
  const x = start.x + dx * closest - center.x;
  const z = start.z + dz * closest - center.z;
  return x * x + z * z <= radius * radius;
}

function ribbonGeometry(radius, height, phase) {
  const vertices = new Float32Array((RIBBON_STEPS + 1) * 6);
  const indices = [];
  for (let i = 0; i <= RIBBON_STEPS; i++) {
    const t = i / RIBBON_STEPS;
    const r = radius * (0.10 + 0.90 * t ** 1.35);
    const angle = phase + t * Math.PI * 11;
    const spread = (0.17 + 0.06 * Math.sin(t * Math.PI * 7 + phase)) * Math.sin(Math.PI * (0.03 + 0.94 * t));
    for (let side = 0; side < 2; side++) {
      const a = angle + (side ? spread : -spread);
      const at = (i * 2 + side) * 3;
      vertices[at] = Math.cos(a) * r;
      vertices[at + 1] = t * height;
      vertices[at + 2] = Math.sin(a) * r;
    }
    if (i < RIBBON_STEPS) {
      const n = i * 2;
      indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function dropGeometry(radius, height) {
  const vertices = new Float32Array(DROPS * 3);
  for (let i = 0; i < DROPS; i++) {
    const t = (i + 0.5) / DROPS;
    const angle = i * 2.399963229728653 + t * Math.PI * 11;
    const r = radius * (0.12 + 0.9 * t ** 1.35) * (0.85 + 0.3 * ((i * 37 % 101) / 101));
    vertices[i * 3] = Math.cos(angle) * r;
    vertices[i * 3 + 1] = t * height;
    vertices[i * 3 + 2] = Math.sin(angle) * r;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  return geometry;
}

export class PaintTornado {
  constructor(scene) {
    this.scene = scene;
    this.detector = new SpiralDetector();
    this.vortices = [];
    this.onPaint = null;
  }
  update(dt, pos, forward, speed, color) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const spiral = this.detector.update(dt, pos, forward, speed);
    if (spiral) {
      const existing = this.vortices.find((v) => v.generation === spiral.generation);
      if (existing) this.grow(existing, spiral, color);
      else this.spawn(spiral, color);
    }
    for (let i = this.vortices.length - 1; i >= 0; i--) {
      const v = this.vortices[i];
      v.age += dt;
      if (v.age >= v.life) { this.remove(i); continue; }
      // A shot changes the vortex's momentum; drag keeps the motion visible for seconds.
      v.previousPosition.copy(v.group.position);
      v.group.position.x = THREE.MathUtils.clamp(v.group.position.x + v.drift.x * dt, -WORLD_LIMIT, WORLD_LIMIT);
      v.group.position.z = THREE.MathUtils.clamp(v.group.position.z + v.drift.y * dt, -WORLD_LIMIT, WORLD_LIMIT);
      v.drift.multiplyScalar(Math.exp(-DRIFT_DAMPING * dt));
      v.group.rotation.y += dt * v.direction * v.rotationSpeed;
      v.group.position.y = v.baseY + Math.sin(v.age * 2) * 2;
      const fade = Math.min(1, v.age * 2, (v.life - v.age) / 2);
      for (const material of v.ribbonMaterials) material.opacity = 0.78 * fade;
      v.dropMaterial.uniforms.opacity.value = 0.85 * fade;
      v.paintTime = (v.paintTime || 0) + dt;
      if (this.onPaint && v.paintTime >= 0.2) {
        v.paintTime = 0;
        const tint = v.dropMaterial.uniforms.tint.value;
        for (let sample = 0; sample < 8; sample++) {
          const t = ((v.paintCursor || 0) + sample * 11) % RIBBON_STEPS / RIBBON_STEPS;
          const r = v.baseRadius * (0.10 + 0.90 * t ** 1.35) * v.group.scale.x;
          const a = v.group.rotation.y + t * Math.PI * 11 + (sample % RIBBONS) * Math.PI * 2 / RIBBONS;
          const position = new THREE.Vector3(v.group.position.x + Math.cos(a) * r,
            v.group.position.y + t * v.baseHeight * v.group.scale.y,
            v.group.position.z + Math.sin(a) * r);
          this.onPaint(position, 9, tint);
        }
        v.paintCursor = ((v.paintCursor || 0) + 17) % RIBBON_STEPS;
      }
    }
  }
  spawn(spiral, color) {
    while (this.vortices.length >= 4) this.remove(0);
    const duration = Math.min(spiral.duration, 60);
    const radius = THREE.MathUtils.clamp(spiral.radius * 0.45 + duration * 2, 25, 180);
    const height = THREE.MathUtils.clamp(radius * 2.5, 80, 400);
    const group = new THREE.Group();
    const tint = new THREE.Color(color ?? 0xef4444);
    const ribbonMaterials = [];
    for (let i = 0; i < RIBBONS; i++) {
      const material = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const ribbon = new THREE.Mesh(ribbonGeometry(radius, height, i * Math.PI * 2 / RIBBONS), material);
      ribbonMaterials.push(material);
      group.add(ribbon);
    }
    const dropMaterial = new THREE.ShaderMaterial({
      uniforms: { tint: { value: new THREE.Color(color ?? 0xef4444) }, size: { value: Math.max(5, radius * 0.10) }, opacity: { value: 0 } },
      vertexShader: `uniform float size; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * 300.0 / max(1.0, -mv.z), 2.0, 36.0); }`,
      fragmentShader: `uniform vec3 tint; uniform float opacity; void main() { vec2 p = gl_PointCoord - vec2(0.5); float r = length(p * vec2(1.0, 0.82)); float alpha = (1.0 - smoothstep(0.3, 0.5, r)) * opacity; if (alpha < 0.01) discard; gl_FragColor = vec4(tint, alpha);
#include <colorspace_fragment>
} `,
      transparent: true, depthWrite: false
    });
    const drops = new THREE.Points(dropGeometry(radius, height), dropMaterial);
    group.add(drops);
    const baseY = spiral.y - height * 0.5;
    group.position.set(spiral.x, baseY, spiral.z);
    this.scene.add(group);
    this.vortices.push({ group, ribbonMaterials, dropMaterial, age: 0, life: Math.min(30, 8 + duration * 1.5), direction: spiral.direction, generation: spiral.generation, baseRadius: radius, baseHeight: height, baseY, drift: new THREE.Vector2(), previousPosition: group.position.clone(), rotationSpeed: this.rotationSpeed(spiral.flightSpeed) });
  }
  rotationSpeed(flightSpeed) { return THREE.MathUtils.clamp(flightSpeed * 0.012, 0.2, 4); }
  grow(v, spiral, color) {
    const radius = THREE.MathUtils.clamp(spiral.radius * 0.45 + Math.min(spiral.duration, 60) * 2, 25, 180);
    const scale = radius / v.baseRadius;
    v.group.scale.setScalar(scale);
    v.dropMaterial.uniforms.size.value = Math.max(5, radius * 0.10);
    if (color != null) {
      for (const material of v.ribbonMaterials) material.color.set(color);
      v.dropMaterial.uniforms.tint.value.set(color);
    }
    v.rotationSpeed = this.rotationSpeed(spiral.flightSpeed);
    v.life = v.age + Math.min(30, 8 + spiral.duration * 1.5);
  }
  // Called once per paint ball update with its swept world-space path.
  hitByPaintBall(ball, start, end) {
    if (!ball || !start || !end) return false;
    const direction = ball.state === 'meteor' && ball.velocity.lengthSq() > 1e-8
      ? ball.velocity : ball.forward;
    const horizontal = new THREE.Vector2(direction.x, direction.z);
    if (horizontal.lengthSq() < 1e-8) return false;
    horizontal.normalize();
    let hit = false;
    for (const vortex of this.vortices) {
      if (ball.hitVortices?.has(vortex)) continue;
      const height = vortex.baseHeight * vortex.group.scale.y;
      const radius = vortex.baseRadius * vortex.group.scale.x + ball.radius;
      const previous = vortex.previousPosition;
      const relativeStart = new THREE.Vector3(start.x - previous.x, start.y - previous.y, start.z - previous.z);
      const relativeEnd = new THREE.Vector3(end.x - vortex.group.position.x,
        end.y - vortex.group.position.y, end.z - vortex.group.position.z);
      if (!sweptCylinderHit(relativeStart, relativeEnd, { x: 0, z: 0 },
        -ball.radius, height + ball.radius, radius)) continue;
      vortex.drift.addScaledVector(horizontal, PUSH_SPEED);
      if (vortex.drift.length() > MAX_DRIFT_SPEED) vortex.drift.setLength(MAX_DRIFT_SPEED);
      ball.hitVortices?.add(vortex);
      hit = true;
    }
    return hit;
  }
  remove(index) {
    const [v] = this.vortices.splice(index, 1);
    this.scene.remove(v.group);
    for (const child of v.group.children) {
      child.geometry.dispose();
      child.material.dispose();
    }
  }
  clear() { while (this.vortices.length) this.remove(this.vortices.length - 1); this.detector.reset(); }
}
