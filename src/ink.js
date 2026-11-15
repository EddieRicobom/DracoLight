import * as THREE from 'three';

// Fixed-size meshes keep suspended ink cheap even after a long flight.
export class InkTrail {
  constructor(scene, camera, lateralOffset = 0) {
    this.camera = camera;
    this.lateralOffset = lateralOffset;
    this.clock = 0;
    this.color = new THREE.Color(0x092d1c);
    this.points = [];
    this.splashes = [];
    this.maxPoints = 2048;
    this.maxSplashes = 512;
    this.offset = new THREE.Vector3();
    this.side = new THREE.Vector3();
    this.tangent = new THREE.Vector3();
    this.view = new THREE.Vector3();

    this.positions = new Float32Array(this.maxPoints * 6);
    this.alpha = new Float32Array(this.maxPoints * 2);
    this.colors = new Float32Array(this.maxPoints * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(this.maxPoints * 4);
    const indices = [];
    for (let i = 0; i < this.maxPoints; i++) {
      uv[i * 4] = 0; uv[i * 4 + 1] = i / 4;
      uv[i * 4 + 2] = 1; uv[i * 4 + 3] = i / 4;
      if (i < this.maxPoints - 1) {
        const j = i * 2;
        indices.push(j, j + 1, j + 2, j + 2, j + 1, j + 3);
      }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute float aAlpha; attribute vec3 aColor;
        varying float vAlpha; varying vec2 vUv; varying vec3 vColor;
        void main(){ vAlpha=aAlpha; vUv=uv; vColor=aColor;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying float vAlpha; varying vec2 vUv; varying vec3 vColor;
        void main(){ float edge=abs(vUv.x*2.-1.);
          float fleck=sin(vUv.y*121.)*sin(vUv.y*37.+vUv.x*7.);
          float ink=1.-smoothstep(.65,1.,edge+.12*fleck);
          gl_FragColor=vec4(vColor,ink*vAlpha); }`,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.splashPositions = new Float32Array(this.maxSplashes * 3);
    this.splashAlpha = new Float32Array(this.maxSplashes);
    this.splashColors = new Float32Array(this.maxSplashes * 3);
    this.splashSizes = new Float32Array(this.maxSplashes);
    const splashGeometry = new THREE.BufferGeometry();
    splashGeometry.setAttribute('position', new THREE.BufferAttribute(this.splashPositions, 3).setUsage(THREE.DynamicDrawUsage));
    splashGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.splashAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    splashGeometry.setAttribute('aColor', new THREE.BufferAttribute(this.splashColors, 3).setUsage(THREE.DynamicDrawUsage));
    splashGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.splashSizes, 1).setUsage(THREE.DynamicDrawUsage));
    splashGeometry.setDrawRange(0, 0);
    this.splashMesh = new THREE.Points(splashGeometry, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float aAlpha; attribute vec3 aColor; attribute float aSize;
        varying float vAlpha; varying vec3 vColor;
        void main(){ vAlpha=aAlpha; vColor=aColor;
          vec4 viewPos=modelViewMatrix*vec4(position,1.);
          gl_Position=projectionMatrix*viewPos;
          gl_PointSize=clamp(aSize*260./max(1.,-viewPos.z),1.,22.); }`,
      fragmentShader: `varying float vAlpha; varying vec3 vColor;
        void main(){ float radius=length(gl_PointCoord-vec2(.5))*2.;
          gl_FragColor=vec4(vColor,(1.-smoothstep(.62,1.,radius))*vAlpha); }`,
    }));
    this.splashMesh.frustumCulled = false;
    scene.add(this.splashMesh);
  }

  setColor(hex) { this.color.set(hex); }

  clear() {
    this.points.length = 0;
    this.splashes.length = 0;
    this.mesh.geometry.setDrawRange(0, 0);
    this.splashMesh.geometry.setDrawRange(0, 0);
  }

  addSplashes(position, direction, speed, boosting) {
    const count = boosting ? 4 : 2;
    for (let i = 0; i < count; i++) {
      if (this.splashes.length >= this.maxSplashes) this.splashes.shift();
      const spread = boosting ? 10 : 6;
      const origin = position.clone().addScaledVector(direction, -3 - Math.random() * 5);
      origin.x += (Math.random() - .5) * spread;
      origin.y += (Math.random() - .5) * spread;
      origin.z += (Math.random() - .5) * spread;
      this.splashes.push({
        origin,
        velocity: new THREE.Vector3(
          (Math.random() - .5) * 5 - direction.x * speed * .025,
          (Math.random() - .5) * 5 - direction.y * speed * .025,
          (Math.random() - .5) * 5 - direction.z * speed * .025,
        ),
        born: this.clock,
        lifetime: 7 + Math.random() * 6,
        size: 1.5 + Math.random() * (boosting ? 3.5 : 2.5),
        color: this.color.clone(),
      });
    }
  }

  update(dt, position, direction, speed, boosting) {
    this.clock += dt;
    this.offset.crossVectors(direction, THREE.Object3D.DEFAULT_UP).normalize().multiplyScalar(this.lateralOffset);
    const tail = position.clone().addScaledVector(direction, -8).add(this.offset);
    if (!this.points.length || tail.distanceToSquared(this.points[this.points.length - 1].position) > 100) {
      this.points.push({ position: tail, born: this.clock, width: boosting ? 4.5 : 2.5, color: this.color.clone() });
      this.addSplashes(position, direction, speed, boosting);
    }
    while (this.points.length > this.maxPoints) this.points.shift();
    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const before = this.points[Math.max(0, i - 1)].position;
      const after = this.points[Math.min(n - 1, i + 1)].position;
      this.tangent.subVectors(after, before).normalize();
      this.view.subVectors(this.camera.position, p.position).normalize();
      this.side.crossVectors(this.tangent, this.view).normalize();
      const fade = 1;
      const width = p.width;
      for (let j = 0; j < 2; j++) {
        const k = (i * 2 + j) * 3, sign = j ? 1 : -1;
        this.positions[k] = p.position.x + this.side.x * width * sign;
        this.positions[k + 1] = p.position.y + this.side.y * width * sign;
        this.positions[k + 2] = p.position.z + this.side.z * width * sign;
        this.colors[k] = p.color.r;
        this.colors[k + 1] = p.color.g;
        this.colors[k + 2] = p.color.b;
        this.alpha[i * 2 + j] = fade * .58;
      }
    }
    this.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
    this.mesh.geometry.attributes.aColor.needsUpdate = true;

    let active = 0;
    for (const splash of this.splashes) {
      const age = this.clock - splash.born;
      const drift = Math.min(age, 1.5);
      const k = active * 3;
      this.splashPositions[k] = splash.origin.x + splash.velocity.x * drift;
      this.splashPositions[k + 1] = splash.origin.y + splash.velocity.y * drift;
      this.splashPositions[k + 2] = splash.origin.z + splash.velocity.z * drift;
      this.splashColors[k] = splash.color.r;
      this.splashColors[k + 1] = splash.color.g;
      this.splashColors[k + 2] = splash.color.b;
      this.splashAlpha[active] = .75;
      this.splashSizes[active] = splash.size;
      this.splashes[active] = splash;
      active++;
    }
    this.splashes.length = active;
    this.splashMesh.geometry.setDrawRange(0, active);
    for (const attribute of Object.values(this.splashMesh.geometry.attributes)) attribute.needsUpdate = true;
  }
}
