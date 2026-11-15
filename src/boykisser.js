import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HALF } from './city.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** A ground based playable character. `position` is the point between the feet. */
export class Boykisser {
  constructor(scene, city, options = {}) {
    this.scene = scene;
    this.city = city;
    this.position = new THREE.Vector3().copy(options.position || new THREE.Vector3(0, 0, 0));
    this.velocity = new THREE.Vector3();
    this.yaw = options.yaw ?? Math.PI;
    this.height = options.height ?? 3.4;
    this.radius = options.radius ?? 0.8;
    this.walkSpeed = options.walkSpeed ?? 18;
    this.runSpeed = options.runSpeed ?? 38;
    this.climbSpeed = options.climbSpeed ?? 13;
    this.jumpSpeed = options.jumpSpeed ?? 12;
    this.gravity = options.gravity ?? 34;
    this.modelUrl = options.modelUrl ?? `${import.meta.env?.BASE_URL ?? '/'}models/boykisser.glb`;
    this.modelLoader = options.modelLoader ?? new GLTFLoader();
    this.modelYawOffset = options.modelYawOffset ?? 0;
    this.root = new THREE.Group();
    this.root.name = 'Boykisser player';
    this.root.position.copy(this.position);
    scene.add(this.root);
    this.model = null;
    this.bakedParts = [];
    this.bones = {};
    this.ready = false;
    this.grounded = false;
    this.climbing = false;
    this.state = 'idle';
    this.phase = 0;
    this._origin = new THREE.Vector3();
    this._move = new THREE.Vector3();
  }

  async load() {
    const gltf = await this.modelLoader.loadAsync(this.modelUrl);
    const model = gltf.scene;
    // This GLB exports the bow about 1.3 m above a body only 0.065 m tall.
    // Including that detached bow in the bounds shrinks the character to a head.
    const bounds = new THREE.Box3();
    model.updateMatrixWorld(true);
    model.traverse((object) => {
      if (!object.isMesh) return;
      if (object.name === 'Object_140' || object.name === 'Object_141') {
        object.visible = false;
        return;
      }
      bounds.union(new THREE.Box3().setFromObject(object));
    });
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('Boykisser model has no usable height');
    const center = bounds.getCenter(new THREE.Vector3());
    this._bakeBody(model, bounds);
    const visual = new THREE.Group();
    visual.scale.setScalar(this.height / size.y);
    model.position.set(-center.x, -bounds.min.y, -center.z);
    visual.rotation.y = this.modelYawOffset;
    visual.add(model);
    model.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
      if (object.isBone) {
        const key = object.name.replace(/_\d+$/, '');
        if (!this.bones[key]) this.bones[key] = { bone: object, rest: object.quaternion.clone() };
      }
    });
    this.root.add(visual);
    this.model = visual;
    this.ready = true;
    return this;
  }

  _bakeBody(model, bounds) {
    const sourceMeshes = [];
    model.traverse((object) => {
      if (object.isSkinnedMesh && object.visible) sourceMeshes.push(object);
    });
    const modelInverse = model.matrixWorld.clone().invert();
    const point = new THREE.Vector3();
    this.bodyCenterZ = bounds.getCenter(new THREE.Vector3()).z;
    this.armPivotY = bounds.min.y + bounds.getSize(new THREE.Vector3()).y * 0.72;
    this.legPivotY = bounds.min.y + bounds.getSize(new THREE.Vector3()).y * 0.44;
    this.armPivotX = bounds.getSize(new THREE.Vector3()).x * 0.17;
    this.legPivotX = bounds.getSize(new THREE.Vector3()).x * 0.12;
    for (const source of sourceMeshes) {
      const geometry = source.geometry.clone();
      const original = source.geometry.attributes.position;
      const positions = new Float32Array(original.count * 3);
      const groups = new Uint8Array(original.count);
      const influence = new Float32Array(original.count);
      const boneNames = source.skeleton.bones.map((bone) => bone.name);
      const indices = source.geometry.attributes.skinIndex;
      const weights = source.geometry.attributes.skinWeight;
      for (let i = 0; i < original.count; i++) {
        point.fromBufferAttribute(original, i);
        source.applyBoneTransform(i, point);
        point.applyMatrix4(source.matrixWorld).applyMatrix4(modelInverse);
        positions.set(point.toArray(), i * 3);
        const score = [0, 0, 0, 0, 0];
        for (let k = 0; k < 4; k++) {
          const name = boneNames[indices.getComponent(i, k)] || '';
          const weight = weights.getComponent(i, k);
          if (/^(Shoulder|Arm|Elbow|Wrist|Thumb|Index|Middle|Ring|Little)_L/.test(name)) score[1] += weight;
          else if (/^(Shoulder|Arm|Elbow|Wrist|Thumb|Index|Middle|Ring|Little)_R/.test(name)) score[2] += weight;
          else if (/^(Leg|Knee|Foot)_L/.test(name)) score[3] += weight;
          else if (/^(Leg|Knee|Foot)_R/.test(name)) score[4] += weight;
        }
        for (let group = 1; group <= 4; group++) if (score[group] > influence[i]) {
          influence[i] = score[group];
          groups[i] = group;
        }
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.deleteAttribute('skinIndex');
      geometry.deleteAttribute('skinWeight');
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, source.material);
      mesh.name = `${source.name} animated`;
      mesh.castShadow = source.castShadow;
      mesh.receiveShadow = source.receiveShadow;
      mesh.frustumCulled = false;
      model.add(mesh);
      source.visible = false;
      this.bakedParts.push({ mesh, base: positions, groups, influence });
    }
  }

  _animateLimbs(speed) {
    const stride = this.state === 'climb' ? 0.45 : this.state === 'run' ? 0.55 : this.state === 'walk' ? 0.38 : 0;
    const swing = Math.sin(this.phase) * stride;
    const leftArm = -1.1, rightArm = 1.1;
    for (const part of this.bakedParts) {
      const { base, groups, influence } = part;
      const target = part.mesh.geometry.attributes.position;
      const values = target.array;
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i], weight = influence[i];
        const j = i * 3, x = base[j], y = base[j + 1], z = base[j + 2];
        if (group === 0 || weight < 0.01) continue;
        let px = x, py = y, pz = z;
        if (group <= 2) {
          const side = group === 1 ? 1 : -1;
          const pivotX = side * this.armPivotX;
          const dx = x - pivotX, dy = y - this.armPivotY;
          const angle = group === 1 ? leftArm : rightArm;
          px = pivotX + dx * Math.cos(angle) - dy * Math.sin(angle);
          py = this.armPivotY + dx * Math.sin(angle) + dy * Math.cos(angle);
          const bendY = py - this.armPivotY, bendZ = z - this.bodyCenterZ;
          const armSwing = (group === 1 ? 1 : -1) * swing;
          py = this.armPivotY + bendY * Math.cos(armSwing) - bendZ * Math.sin(armSwing);
          pz = this.bodyCenterZ + bendY * Math.sin(armSwing) + bendZ * Math.cos(armSwing);
        } else {
          const side = group === 3 ? 1 : -1;
          const pivotX = side * this.legPivotX;
          const bendY = y - this.legPivotY, bendZ = z - this.bodyCenterZ;
          const legSwing = (group === 3 ? -1 : 1) * swing;
          px = pivotX + (x - pivotX);
          py = this.legPivotY + bendY * Math.cos(legSwing) - bendZ * Math.sin(legSwing);
          pz = this.bodyCenterZ + bendY * Math.sin(legSwing) + bendZ * Math.cos(legSwing);
        }
        values[j] = x + (px - x) * weight;
        values[j + 1] = y + (py - y) * weight;
        values[j + 2] = z + (pz - z) * weight;
      }
      target.needsUpdate = true;
    }
  }

  /** Move to a safe starting point. Set ground=true when changing from flight. */
  teleport(position, { ground = false, yaw = this.yaw } = {}) {
    this.position.copy(position);
    this.yaw = yaw;
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.climbing = false;
    if (ground) {
      this.position.y = 0;
      // A flight position may sit over a building. Choose nearby open street.
      for (let radius = 0; radius <= 100; radius += 5) {
        let found = false;
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const x = clamp(position.x + dx * radius, -HALF + this.radius, HALF - this.radius);
          const z = clamp(position.z + dz * radius, -HALF + this.radius, HALF - this.radius);
          if (!this._occupied(x, 0, z)) {
            this.position.x = x;
            this.position.z = z;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
  }

  /** Highest solid surface below `topY`, including the street at y=0. */
  findGround(x, z, topY = 320) {
    const origin = this._origin.set(x, topY, z);
    const distance = this.city.raycast(origin, DOWN, Math.max(0, topY) + 1);
    return Number.isFinite(distance) ? Math.max(0, topY - distance) : 0;
  }

  _occupied(x, y, z) {
    const r = this.radius;
    for (const dx of [-r, r]) for (const dz of [-r, r]) {
      if (this.city.chunkAt(x + dx, y + 0.35, z + dz) >= 0 ||
          this.city.chunkAt(x + dx, y + this.height - 0.25, z + dz) >= 0) return true;
    }
    return false;
  }

  _pose(name, angle, weight = 1) {
    const entry = this.bones[name];
    if (!entry) return;
    entry.bone.quaternion.copy(entry.rest).multiply(new THREE.Quaternion().setFromEuler(
      new THREE.Euler(angle.x * weight, angle.y * weight, angle.z * weight)
    ));
  }

  _animate(dt, speed) {
    const active = this.state === 'run' || this.state === 'walk' || this.state === 'climb';
    this.phase += dt * (this.state === 'climb' ? 9 : 5 + speed * 0.45);
    const bob = active ? Math.abs(Math.sin(this.phase)) * 0.08 : Math.sin(this.phase * 0.3) * 0.025;
    // The supplied inverse bind matrices stretch joint rotations. The original
    // skin weights instead drive the baked, correctly scaled surface.
    if (this.model) {
      this.model.position.y = bob;
      this.model.rotation.x = this.state === 'run' ? -0.07 : this.state === 'climb' ? 0.08 : 0;
      this.model.rotation.z = active ? Math.sin(this.phase) * 0.018 : 0;
    }
    this._animateLimbs(speed);
  }

  /**
   * Per frame input: forward/strafe in [-1,1], sprint/jump booleans, yaw in radians.
   * +forward follows local +Z; +strafe moves right. Returns the current movement state.
   */
  update(dt, { forward = 0, strafe = 0, sprint = false, jump = false, yaw = this.yaw } = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    this.yaw = yaw;
    const magnitude = Math.hypot(forward, strafe);
    const inputLength = Math.min(1, magnitude);
    const speed = (sprint ? this.runSpeed : this.walkSpeed) * inputLength;
    this._move.set(
      Math.sin(yaw) * forward + Math.cos(yaw) * strafe,
      0,
      Math.cos(yaw) * forward - Math.sin(yaw) * strafe
    );
    if (magnitude > 1) this._move.divideScalar(magnitude);
    this._move.multiplyScalar(speed * dt);
    const x = clamp(this.position.x + this._move.x, -HALF + this.radius, HALF - this.radius);
    const z = clamp(this.position.z + this._move.z, -HALF + this.radius, HALF - this.radius);
    const blocked = this._occupied(x, this.position.y, z);
    const pushingWall = blocked && inputLength > 0.15 && forward > 0.1;
    this.climbing = pushingWall;

    if (this.climbing) {
      this.velocity.y = this.climbSpeed;
      const nextY = this.position.y + this.climbSpeed * dt;
      if (!this._occupied(this.position.x, nextY, this.position.z)) this.position.y = nextY;
    } else {
      if (this.grounded && jump) { this.velocity.y = this.jumpSpeed; this.grounded = false; }
      this.velocity.y -= this.gravity * dt;
      this.position.y = Math.max(0, this.position.y + this.velocity.y * dt);
      if (!blocked) { this.position.x = x; this.position.z = z; }
    }

    // Sweep down from just above the feet, so roofs and the road support the player.
    const snap = this.climbing ? 0.1 : Math.max(0.15, -this.velocity.y * dt + 0.15);
    const ground = this.findGround(this.position.x, this.position.z, this.position.y + 0.15);
    if (!this.climbing && this.velocity.y <= 0 && this.position.y - ground <= snap) {
      this.position.y = ground;
      this.velocity.y = 0;
      this.grounded = true;
    } else this.grounded = false;

    if (this.climbing) this.state = 'climb';
    else if (!this.grounded) this.state = 'air';
    else if (inputLength < 0.08) this.state = 'idle';
    else this.state = sprint ? 'run' : 'walk';
    this.root.position.copy(this.position);
    this.root.rotation.y = yaw;
    this._animate(dt, speed);
    return this.state;
  }

  dispose() {
    this.scene.remove(this.root);
    this.model?.traverse((object) => {
      if (object.isMesh) {
        object.geometry?.dispose();
        for (const material of [object.material].flat()) material?.dispose();
      }
    });
  }
}
