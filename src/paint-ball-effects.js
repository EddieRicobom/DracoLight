import * as THREE from 'three';
import { addInkOutline } from './outline.js';

const MAX_DROPS = 128;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const WHITE = new THREE.Color(0xffffff);

function paintGeometry() {
  const geometry = new THREE.SphereGeometry(1, 24, 16);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const swell = 1 + 0.085 * Math.sin(x * 6 + y * 5) * Math.sin(z * 7 - y * 4)
      + 0.04 * Math.sin(y * 10 + x * 7);
    positions.setXYZ(i, x * swell, y * swell, z * swell);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export class PaintBallEffects {
  constructor(scene) {
    this.scene = scene;
    this.geometry = paintGeometry();
    const dropMaterial = new THREE.MeshPhongMaterial({ specular: 0x999999, shininess: 48 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), dropMaterial, MAX_DROPS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Initialize the color buffer before the first render so it can use dynamic updates.
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.drops = Array.from({ length: MAX_DROPS }, () => ({
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), color: new THREE.Color(),
      age: 0, duration: 0, size: 0, splash: false,
    }));
    this.nextDrop = 0;
    this.hasDrops = false;
    this.transform = new THREE.Object3D();
    this.heading = new THREE.Vector3();
    this.lateral = new THREE.Vector3();
  }

  makeBody(color, radius, direction) {
    const material = new THREE.MeshPhongMaterial({
      color, emissive: color, emissiveIntensity: 0.32, specular: 0xbcbcbc, shininess: 55,
    });
    addInkOutline(material);
    const body = new THREE.Mesh(this.geometry, material);
    body.scale.set(radius * 0.89, radius * 0.89, radius * 1.25);
    body.quaternion.setFromUnitVectors(Z_AXIS, direction);
    return body;
  }

  flight(ball, previous, dt) {
    const { body, position, radius, color } = ball;
    this.heading.subVectors(position, previous);
    const distance = this.heading.length();
    const speed = distance / dt;
    const stretch = Math.min(speed / 400, 1);
    const charged = ball.state === 'meteor';
    const flash = charged ? Math.max(0, 1 - ball.age / 0.23) : 0;
    const pulse = 1 + 0.05 * Math.sin(ball.age * 11 + ball.id) + flash * 0.26;
    const width = radius * pulse * (1 - 0.23 * stretch);
    body.scale.set(width, width, radius * (1 + 0.72 * stretch + 0.2 * flash));
    body.material.emissiveIntensity = (charged ? 0.52 : 0.32) + flash * 0.85;
    if (distance > 0.01) {
      this.heading.multiplyScalar(1 / distance);
      body.quaternion.setFromUnitVectors(Z_AXIS, this.heading);
    } else {
      body.quaternion.setFromUnitVectors(Z_AXIS, ball.forward);
    }
    body.rotateZ(ball.age * 2.7);
    if (speed < 35) {
      ball.trailDistance = 0;
      return;
    }
    const spacing = radius * 0.85;
    const traveled = ball.trailDistance + distance;
    ball.trailDistance = traveled % spacing;
    const count = Math.min(2, Math.floor(traveled / spacing));
    for (let i = 0; i < count; i++) {
      const drop = this.spawnDrop(color, 0.32 + Math.random() * 0.22, radius * (0.13 + Math.random() * 0.14));
      const back = Math.min(distance, ball.trailDistance + i * spacing);
      this.lateral.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      this.lateral.addScaledVector(this.heading, -this.lateral.dot(this.heading));
      drop.position.copy(position).addScaledVector(this.heading, -back - radius * 0.92);
      drop.position.addScaledVector(this.lateral, radius);
      drop.velocity.copy(this.heading).multiplyScalar(Math.min(speed * 0.22, 130));
      drop.velocity.addScaledVector(this.lateral, 28);
    }
  }

  ignite(ball) {
    for (let i = 0; i < 10; i++) {
      const angle = i * GOLDEN_ANGLE;
      const y = 1 - (i + 0.5) / 5;
      const horizontal = Math.sqrt(1 - y * y);
      this.lateral.set(Math.cos(angle) * horizontal, y, Math.sin(angle) * horizontal);
      const drop = this.spawnDrop(ball.color, 0.24 + i * 0.021, 2.1 + (i % 3) * 0.82);
      drop.color.lerp(WHITE, 0.24);
      drop.position.copy(ball.position).addScaledVector(this.lateral, ball.radius * 0.86);
      drop.velocity.copy(this.lateral).multiplyScalar(46).addScaledVector(ball.velocity, 0.14);
    }
  }

  burst(center, radius, color, velocity) {
    for (let i = 0; i < 25; i++) {
      const angle = i * GOLDEN_ANGLE;
      const fast = i % 3 === 0;
      const speed = (fast ? 54 : 26) + Math.random() * 33;
      const x = Math.cos(angle), z = Math.sin(angle);
      const drop = this.spawnDrop(color, 0.42 + Math.random() * 0.47, 1.4 + Math.random() * 3.1, true);
      drop.position.set(center.x + x * radius * 0.14, 3 + i % 4, center.z + z * radius * 0.14);
      drop.velocity.set(x * speed, (fast ? 13 : 27) + Math.random() * 20, z * speed);
      drop.velocity.x += THREE.MathUtils.clamp(velocity.x * 0.12, -34, 34);
      drop.velocity.z += THREE.MathUtils.clamp(velocity.z * 0.12, -34, 34);
    }
  }

  spawnDrop(color, duration, size, splash = false) {
    this.hasDrops = true;
    const drop = this.drops[this.nextDrop];
    this.nextDrop = (this.nextDrop + 1) % this.drops.length;
    drop.age = 0;
    drop.duration = duration;
    drop.size = size;
    drop.splash = splash;
    drop.color.copy(color).lerp(WHITE, Math.random() * 0.13);
    return drop;
  }

  update(dt) {
    if (!this.hasDrops) return;
    const object = this.transform;
    let count = 0;
    for (const drop of this.drops) {
      if (drop.age >= drop.duration) continue;
      drop.age += dt;
      if (drop.age >= drop.duration) continue;
      drop.velocity.y -= (drop.splash ? 126 : 24) * dt;
      drop.position.addScaledVector(drop.velocity, dt);
      if (drop.position.y <= 0.4) {
        drop.duration = 0;
        continue;
      }
      const life = 1 - drop.age / drop.duration;
      const scale = drop.size * Math.min(1, life * 2.2);
      this.heading.copy(drop.velocity).normalize();
      object.position.copy(drop.position);
      object.quaternion.setFromUnitVectors(Z_AXIS, this.heading);
      object.scale.set(scale, scale, scale * (drop.splash ? 1.65 : 1.85));
      object.updateMatrix();
      this.mesh.setMatrixAt(count, object.matrix);
      this.mesh.setColorAt(count++, drop.color);
    }
    this.mesh.count = count;
    this.hasDrops = count > 0;
    if (count) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
      if (!this.mesh.parent) this.scene.add(this.mesh);
    } else if (this.mesh.parent) {
      this.scene.remove(this.mesh);
    }
  }

  reset() {
    this.scene.remove(this.mesh);
    this.mesh.count = 0;
    this.nextDrop = 0;
    this.hasDrops = false;
    for (const drop of this.drops) drop.duration = 0;
  }

  dispose() {
    this.reset();
    this.geometry.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
