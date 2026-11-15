import * as THREE from 'three';

// Recognize a sustained, coherent horizontal turn whose path bends back on itself.
export class SpiralDetector {
  constructor() { this.reset(); }
  reset() { this.generation = (this.generation || 0) + 1; this.samples = []; this.lastHeading = null; this.sign = 0; this.turn = 0; this.duration = 0; this.distance = 0; this.emittedAt = 0; this.straightTime = 0; }
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
    this.samples.push({ x: pos.x, z: pos.z });
    if (this.samples.length > 800) this.samples.shift();
    const radius = this.distance / Math.max(this.turn, 0.001);
    const displacement = Math.hypot(pos.x - this.samples[0].x, pos.z - this.samples[0].z);
    if (this.turn < Math.PI * 1.8 || this.duration < 1 || radius < 15 || radius > 500 || (!this.emittedAt && displacement > radius * 1.4) || this.duration - this.emittedAt < 1.5) return null;
    this.emittedAt = this.duration;
    let x = 0, z = 0;
    for (const sample of this.samples) { x += sample.x; z += sample.z; }
    return { x: x / this.samples.length, y: pos.y, z: z / this.samples.length, radius, duration: this.duration, direction: this.sign, generation: this.generation };
  }
}

export class PaintTornado {
  constructor(scene) {
    this.scene = scene;
    this.detector = new SpiralDetector();
    this.vortices = [];
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
      v.points.rotation.y += dt * v.direction * 0.7;
      v.material.uniforms.opacity.value = 0.7 * Math.min(1, v.age * 2, (v.life - v.age) / 2);
    }
  }
  spawn(spiral, color) {
    while (this.vortices.length >= 4) this.remove(0);
    const duration = Math.min(spiral.duration, 60);
    const radius = THREE.MathUtils.clamp(spiral.radius * 0.45 + duration * 2, 25, 180);
    const height = THREE.MathUtils.clamp(radius * 2.5, 80, 400);
    const count = 420;
    const vertices = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const angle = t * Math.PI * 18 + Math.random() * 1.5;
      const r = radius * (0.15 + 0.85 * t) * (0.75 + Math.random() * 0.5);
      vertices[i * 3] = Math.cos(angle) * r;
      vertices[i * 3 + 1] = t * height + (Math.random() - 0.5) * 8;
      vertices[i * 3 + 2] = Math.sin(angle) * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const material = new THREE.ShaderMaterial({
      uniforms: { tint: { value: new THREE.Color(color ?? 0xef4444) }, size: { value: Math.max(5, radius * 0.10) }, opacity: { value: 0 } },
      vertexShader: `uniform float size; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * 300.0 / max(1.0, -mv.z), 2.0, 36.0); }`,
      fragmentShader: `uniform vec3 tint; uniform float opacity; void main() { float r = length(gl_PointCoord - vec2(0.5)); float alpha = (1.0 - smoothstep(0.32, 0.5, r)) * opacity; if (alpha < 0.01) discard; gl_FragColor = vec4(tint, alpha);
#include <colorspace_fragment>
} `,
      transparent: true, depthWrite: false
    });
    const points = new THREE.Points(geometry, material);
    points.position.set(spiral.x, spiral.y - height * 0.5, spiral.z);
    points.frustumCulled = false;
    this.scene.add(points);
    this.vortices.push({ points, material, age: 0, life: Math.min(30, 8 + duration * 1.5), direction: spiral.direction, generation: spiral.generation, baseRadius: radius });
  }
  grow(v, spiral, color) {
    const radius = THREE.MathUtils.clamp(spiral.radius * 0.45 + Math.min(spiral.duration, 60) * 2, 25, 180);
    const scale = radius / v.baseRadius;
    v.points.scale.setScalar(scale);
    v.material.uniforms.size.value = Math.max(5, radius * 0.10);
    if (color != null) v.material.uniforms.tint.value.set(color);
    v.life = v.age + Math.min(30, 8 + spiral.duration * 1.5);
  }
  remove(index) {
    const [v] = this.vortices.splice(index, 1);
    this.scene.remove(v.points);
    v.points.geometry.dispose();
    v.material.dispose();
  }
  clear() { while (this.vortices.length) this.remove(this.vortices.length - 1); this.detector.reset(); }
}
