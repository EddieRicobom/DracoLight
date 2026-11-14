import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const draco = new DRACOLoader();
draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const models = {
  rayquaza: { url: `${import.meta.env.BASE_URL}models/rayquaza.glb`, size: 72, radius: 5 },
  deoxys: { url: `${import.meta.env.BASE_URL}models/deoxys.glb`, size: 22, radius: 5 },
};
const loaded = new Map();

function asset(kind) {
  if (!loaded.has(kind)) loaded.set(kind, loader.loadAsync(models[kind].url));
  return loaded.get(kind);
}

const forwardAxis = new THREE.Vector3(0, 0, 1);
const yAxis = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const near = new THREE.Vector3();

// Uses the same movement and collision interface as Dragon in main.js.
export class Pokemon {
  constructor(scene, kind = 'rayquaza') {
    if (!models[kind]) throw new Error(`Unknown model: ${kind}`);
    this.kind = kind;
    this.pos = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.mouth = new THREE.Vector3();
    this.jaw = 0;
    this.hit = 0;
    this.radius = models[kind].radius;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.visible = true;
    this.bones = [];
    this.baseRotations = [];
    this.flashMaterials = [];
    this.ready = asset(kind).then((gltf) => {
      const visual = cloneSkeleton(gltf.scene);
      visual.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(visual);
      const center = bounds.getCenter(new THREE.Vector3());
      const extent = bounds.getSize(new THREE.Vector3());
      const scale = models[kind].size / Math.max(extent.x, extent.y, extent.z, 1);
      // Keep the model's own skeleton and animation coordinates intact.
      const normalized = new THREE.Group();
      normalized.position.copy(center).multiplyScalar(-scale);
      normalized.scale.setScalar(scale);
      normalized.add(visual);
      this.root.add(normalized);
      this.visual = visual;
      this.normalized = normalized;
      visual.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material?.emissive) this.flashMaterials.push({ material, base: material.emissive.clone() });
        }
      });
      this.headBone = visual.getObjectByName('Head');
      this.jawBone = visual.getObjectByName('Jaw');
      if (kind === 'rayquaza') {
        for (const name of ['Tail1', 'Tail2', 'Tail3', 'Tail4', 'Tail5', 'Tail6', 'Tail7', 'Tail8', 'Tail9', 'Tail10', 'Tail11', 'Tail12', 'Tail13', 'Tail14', 'Tail15', 'Tail16', 'Tail17', 'Neck1', 'Neck2']) {
          const bone = visual.getObjectByName(name);
          if (bone) { this.bones.push(bone); this.baseRotations.push(bone.quaternion.clone()); }
        }
        // The downloaded pose has the head above the tail. Rotate that long
        // axis into local +Z so the flying character faces its movement.
        visual.updateMatrixWorld(true);
        const head = this.headBone?.getWorldPosition(new THREE.Vector3());
        const tail = visual.getObjectByName('Tail15')?.getWorldPosition(new THREE.Vector3());
        if (head && tail && head.distanceToSquared(tail) > 1e-4) {
          const axis = head.sub(tail).normalize();
          const correction = new THREE.Quaternion().setFromUnitVectors(axis, forwardAxis);
          const oriented = new THREE.Group();
          this.root.remove(normalized);
          // Correct the model's roll after aligning head-to-tail with flight.
          oriented.quaternion.setFromAxisAngle(forwardAxis, Math.PI).multiply(correction);
          oriented.add(normalized);
          this.root.add(oriented);
          this.oriented = oriented;
        }
      } else if (gltf.animations.length) {
        this.mixer = new THREE.AnimationMixer(visual);
        this.mixer.clipAction(gltf.animations[0]).play();
      }
      this.root.visible = this.visible;
      this.update(0, 0);
      return this;
    }).catch((error) => {
      console.error(`Could not load ${kind} model`, error);
      throw error;
    });
  }

  resetTrail() { /* Movement is driven directly by the game. */ }

  update(dt, time) {
    this.root.position.copy(this.pos);
    const f = tmp.copy(this.fwd).normalize();
    const right = new THREE.Vector3().crossVectors(this.up, f).normalize();
    const up = new THREE.Vector3().crossVectors(f, right).normalize();
    this.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, f));
    if (this.mixer) this.mixer.update(dt);
    if (this.kind === 'rayquaza') {
      this.bones.forEach((bone, i) => {
        bone.quaternion.copy(this.baseRotations[i]);
        bone.rotateY(Math.sin(time * 2.2 - i * 0.45) * (i < 17 ? 0.07 : 0.025));
      });
      if (this.jawBone) this.jawBone.rotation.x = this.jaw * 0.35;
    }
    this.root.updateMatrixWorld(true);
    if (this.headBone) {
      this.headBone.getWorldPosition(this.mouth);
      this.mouth.addScaledVector(this.fwd, this.kind === 'rayquaza' ? 3 : 1.5);
    } else this.mouth.copy(this.pos).addScaledVector(this.fwd, this.kind === 'rayquaza' ? 5 : 2);
    this.hit = Math.max(0, this.hit - dt * 4);
    for (const { material, base } of this.flashMaterials) material.emissive.copy(base).addScalar(this.hit * 0.7);
  }

  _samples() {
    const points = [this.pos];
    if (this.kind === 'rayquaza') {
      for (let i = 0; i < this.bones.length; i += 2) points.push(this.bones[i].getWorldPosition(new THREE.Vector3()));
      if (this.headBone) points.push(this.headBone.getWorldPosition(new THREE.Vector3()));
    } else {
      points.push(this.pos.clone().addScaledVector(this.up, 5));
      points.push(this.pos.clone().addScaledVector(this.up, -5));
    }
    return points;
  }

  hitTest(point, extra = 0) {
    const r2 = (this.radius + extra) ** 2;
    return this._samples().findIndex((sample) => sample.distanceToSquared(point) < r2);
  }

  segDist(a, b) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const length2 = ab.lengthSq();
    let best = Infinity;
    for (const sample of this._samples()) {
      const t = length2 > 0 ? THREE.MathUtils.clamp(new THREE.Vector3().subVectors(sample, a).dot(ab) / length2, 0, 1) : 0;
      best = Math.min(best, near.copy(a).addScaledVector(ab, t).distanceTo(sample) - this.radius);
    }
    return best;
  }

  setVisible(visible) { this.visible = visible; this.root.visible = visible; }
}
