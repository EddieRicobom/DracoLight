import * as THREE from 'three';

// Camera-facing, tapering ribbons follow the flight path and fade like wet ink.
export class InkTrail {
  constructor(scene, camera, lateralOffset = 0) {
    this.camera = camera;
    this.lateralOffset = lateralOffset;
    this.offset = new THREE.Vector3();
    this.points = [];
    this.maxPoints = 96;
    this.clock = 0;
    this.positions = new Float32Array(this.maxPoints * 2 * 3);
    this.alpha = new Float32Array(this.maxPoints * 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const indices = [];
    for (let i = 0; i < this.maxPoints - 1; i++) {
      const j = i * 2; indices.push(j, j + 1, j + 2, j + 2, j + 1, j + 3);
    }
    geometry.setIndex(indices);
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute float aAlpha; varying float vAlpha; varying vec2 vUv;
        void main(){ vAlpha = aAlpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `varying float vAlpha; varying vec2 vUv;
        void main(){ float edge = abs(vUv.x * 2. - 1.); float fleck = sin(vUv.y * 121.) * sin(vUv.y * 37. + vUv.x * 7.);
          float ink = 1. - smoothstep(.65, 1., edge + .12 * fleck);
          gl_FragColor = vec4(.035, .095, .065, ink * vAlpha); }`,
    });
    const uv = new Float32Array(this.maxPoints * 4);
    for (let i = 0; i < this.maxPoints; i++) { uv[i*4] = 0; uv[i*4+1] = i / 4; uv[i*4+2] = 1; uv[i*4+3] = i / 4; }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.side = new THREE.Vector3(); this.tangent = new THREE.Vector3(); this.view = new THREE.Vector3();
  }
  update(dt, position, direction, speed, boosting) {
    this.clock += dt;
    this.offset.crossVectors(direction, THREE.Object3D.DEFAULT_UP).normalize().multiplyScalar(this.lateralOffset);
    const tail = position.clone().addScaledVector(direction, -8).add(this.offset);
    if (!this.points.length || tail.distanceToSquared(this.points[this.points.length - 1].position) > 9) {
      this.points.push({ position: tail, born: this.clock, width: boosting ? 4.5 : 2.5 });
    }
    while (this.points.length > this.maxPoints || (this.points.length && this.clock - this.points[0].born > 2.2)) this.points.shift();
    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const before = this.points[Math.max(0, i - 1)].position;
      const after = this.points[Math.min(n - 1, i + 1)].position;
      this.tangent.subVectors(after, before).normalize();
      this.view.subVectors(this.camera.position, p.position).normalize();
      this.side.crossVectors(this.tangent, this.view).normalize();
      const fade = Math.max(0, 1 - (this.clock - p.born) / 2.2);
      const width = p.width * Math.sqrt(fade) * (0.8 + Math.min(speed / 500, 0.7));
      for (let j = 0; j < 2; j++) {
        const k = (i * 2 + j) * 3, sign = j ? 1 : -1;
        this.positions[k] = p.position.x + this.side.x * width * sign;
        this.positions[k+1] = p.position.y + this.side.y * width * sign;
        this.positions[k+2] = p.position.z + this.side.z * width * sign;
        this.alpha[i * 2 + j] = fade * 0.48;
      }
    }
    this.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
