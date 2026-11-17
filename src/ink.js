import * as THREE from 'three';

function updatePrefix(attribute, count) {
  // Every update rewrites the active prefix, so superseded ranges can be discarded.
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count * attribute.itemSize);
  attribute.needsUpdate = true;
}

// Fixed-size meshes keep suspended ink cheap even after a long flight.
export class InkTrail {
  constructor(scene, camera, lateralOffset = 0) {
    this.camera = camera;
    this.lateralOffset = lateralOffset;
    this.clock = 0;
    this.color = new THREE.Color(0x092d1c);
    this.points = [];
    this.splashes = [];
    this.onPaint = null;
    this.maxPoints = 2048;
    this.maxSplashes = 512;
    this.lifetime = 15;
    this.offset = new THREE.Vector3();
    this.side = new THREE.Vector3();
    this.previousSide = new THREE.Vector3();
    this.tangent = new THREE.Vector3();
    this.view = new THREE.Vector3();
    this.tail = new THREE.Vector3();

    this.positions = new Float32Array(this.maxPoints * 6);
    this.alpha = new Float32Array(this.maxPoints * 2);
    this.colors = new Float32Array(this.maxPoints * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.uv = new Float32Array(this.maxPoints * 4);
    this.indices = new Uint16Array((this.maxPoints - 1) * 6);
    for (let i = 0; i < this.maxPoints; i++) {
      this.uv[i * 4 + 2] = 1;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(new THREE.BufferAttribute(this.indices, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: `attribute float aAlpha; attribute vec3 aColor;
        varying float vAlpha; varying vec2 vUv; varying vec3 vColor;
        void main(){ vAlpha=aAlpha; vUv=uv; vColor=aColor;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying float vAlpha; varying vec2 vUv; varying vec3 vColor;
        void main(){
          float flow = vUv.y;
          float fold = sin(flow * 1.73);
          float wave = sin(flow * 3.91 + fold);
          float center = .10 * fold + .035 * wave;
          float halfWidth = .67 + .085 * wave + .04 * sin(flow * 8.71);
          float across = (vUv.x * 2. - 1. - center) / halfWidth;
          float edge = abs(across);
          float aa = clamp(fwidth(edge), .025, .28);
          float ink = 1. - smoothstep(1. - aa, 1. + aa, edge);
          float rim = smoothstep(.71, .97, edge);
          float bodyLight = max(0., 1. - abs(across + .24) * 1.7);
          float glint = max(0., 1. - abs(across + .37 - fold * .16) * 8.);
          glint *= (.35 + .65 * wave * wave) * bodyLight;
          vec3 body = vColor * (.74 + .26 * bodyLight) + vec3(.045 * glint);
          vec3 color = mix(body, vColor * .23 + vec3(.004), rim);
          gl_FragColor = vec4(color, ink * vAlpha * mix(1., 1.37, rim));
          #include <colorspace_fragment>
        }`,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.splashPositions = new Float32Array(this.maxSplashes * 3);
    this.splashAlpha = new Float32Array(this.maxSplashes);
    this.splashColors = new Float32Array(this.maxSplashes * 3);
    this.splashSizes = new Float32Array(this.maxSplashes);
    this.splashShapes = new Float32Array(this.maxSplashes);
    const splashGeometry = new THREE.BufferGeometry();
    splashGeometry.setAttribute('position', new THREE.BufferAttribute(this.splashPositions, 3).setUsage(THREE.DynamicDrawUsage));
    splashGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.splashAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    splashGeometry.setAttribute('aColor', new THREE.BufferAttribute(this.splashColors, 3).setUsage(THREE.DynamicDrawUsage));
    splashGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.splashSizes, 1).setUsage(THREE.DynamicDrawUsage));
    splashGeometry.setAttribute('aShape', new THREE.BufferAttribute(this.splashShapes, 1).setUsage(THREE.DynamicDrawUsage));
    splashGeometry.setDrawRange(0, 0);
    this.splashMesh = new THREE.Points(splashGeometry, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: `attribute float aAlpha; attribute vec3 aColor; attribute float aSize; attribute float aShape;
        varying float vAlpha; varying vec3 vColor; varying vec3 vAxisShape;
        void main(){ vAlpha=aAlpha; vColor=aColor;
          float angle = aShape * 6.28318;
          vAxisShape = vec3(cos(angle), sin(angle), aShape);
          vec4 viewPos=modelViewMatrix*vec4(position,1.);
          gl_Position=projectionMatrix*viewPos;
          gl_PointSize=clamp(aSize*260./max(1.,-viewPos.z),1.,22.); }`,
      fragmentShader: `varying float vAlpha; varying vec3 vColor; varying vec3 vAxisShape;
        void main(){
          vec2 p = gl_PointCoord * 2. - 1.;
          vec2 axis = vAxisShape.xy;
          vec2 q = vec2(dot(p, axis), dot(p, vec2(-axis.y, axis.x)));
          // The wide end holds the pigment, narrowing to a rounded point.
          q.x = (q.x + .05) * mix(1.13, 1.45, vAxisShape.z);
          q.y *= 1.45 + .55 * q.x;
          float edge = length(q);
          float aa = clamp(fwidth(edge), .035, .48);
          float ink = 1. - smoothstep(1. - aa, 1. + aa, edge);
          float rim = smoothstep(.63, .99, edge);
          float glint = max(0., 1. - length((q + vec2(.32, .28)) * vec2(2., 3.5)));
          vec3 body = vColor * (1. - .77 * rim) + vec3(.095 * glint + .004 * rim);
          gl_FragColor = vec4(body, ink * vAlpha);
          #include <colorspace_fragment>
        }`,
    }));
    this.splashMesh.frustumCulled = false;
    this.splashMesh.visible = false;
    scene.add(this.splashMesh);
  }

  setColor(hex) { this.color.set(hex); }

  clear() {
    this.points.length = 0;
    this.splashes.length = 0;
    this.mesh.geometry.setDrawRange(0, 0);
    this.splashMesh.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
    this.splashMesh.visible = false;
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
      this.onPaint?.(origin, 2, this.color);
      this.splashes.push({
        origin,
        velocity: new THREE.Vector3(
          (Math.random() - .5) * 5 - direction.x * speed * .025,
          (Math.random() - .5) * 5 - direction.y * speed * .025,
          (Math.random() - .5) * 5 - direction.z * speed * .025,
        ),
        born: this.clock,
        size: 1.5 + Math.random() * (boosting ? 3.5 : 2.5),
        shape: Math.random(),
        color: this.color.clone(),
        lastPaint: this.onPaint ? origin.clone() : null,
      });
    }
  }

  update(dt, position, direction, speed, boosting, emit = true) {
    this.clock += dt;
    const oldCount = this.points.length;
    const oldFirst = this.points[0];
    if (emit) {
      this.offset.crossVectors(direction, THREE.Object3D.DEFAULT_UP).normalize().multiplyScalar(this.lateralOffset);
      this.tail.copy(position).addScaledVector(direction, -8).add(this.offset);
    }
    const tail = this.tail;
    if (emit && (!this.points.length || tail.distanceToSquared(this.points[this.points.length - 1].position) > 100)) {
      const previous = this.points[this.points.length - 1];
      const distance = previous ? previous.position.distanceTo(tail) : 0;
      const continuous = Boolean(previous && distance <= 80);
      const point = tail.clone();
      if (this.onPaint) {
        // Match the ribbon's gap handling: a teleport must not paint a long streak.
        const steps = continuous ? Math.min(24, Math.max(1, Math.ceil(distance / 6))) : 1;
        for (let i = 1; i <= steps; i++) {
          const sample = continuous ? previous.position.clone().lerp(point, i / steps) : point;
          this.onPaint(sample, boosting ? 5 : 3.5, this.color);
        }
      }
      this.points.push({
        position: point,
        born: this.clock,
        continuous,
        flow: continuous ? previous.flow + distance * .045 : 0,
        width: (boosting ? 4.5 : 2.5) * (.78 + Math.random() * .44),
        color: this.color.clone(),
      });
      this.addSplashes(position, direction, speed, boosting);
    }
    while (this.points.length && (this.points.length > this.maxPoints || this.clock - this.points[0].born >= this.lifetime)) this.points.shift();
    const n = this.points.length;
    const pointsChanged = oldCount !== n || oldFirst !== this.points[0];
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const previous = i > 0 && p.continuous ? this.points[i - 1] : p;
      const next = this.points[i + 1]?.continuous ? this.points[i + 1] : p;
      this.tangent.subVectors(next.position, previous.position).normalize();
      this.view.subVectors(this.camera.position, p.position);
      this.side.crossVectors(this.tangent, this.view);
      if (this.side.lengthSq() < .0001) {
        this.side.setFromMatrixColumn(this.camera.matrixWorld, 0);
      }
      this.side.normalize();
      if (previous !== p && this.side.dot(this.previousSide) < 0) this.side.negate();
      this.previousSide.copy(this.side);
      const width = p.width * (previous === p || next === p ? .14 : 1);
      const fade = THREE.MathUtils.clamp((this.lifetime - (this.clock - p.born)) / 3, 0, 1);
      if (pointsChanged) {
        this.uv[i * 4 + 1] = p.flow;
        this.uv[i * 4 + 3] = p.flow;
      }
      for (let j = 0; j < 2; j++) {
        const k = (i * 2 + j) * 3, sign = j ? 1 : -1;
        this.positions[k] = p.position.x + this.side.x * width * sign;
        this.positions[k + 1] = p.position.y + this.side.y * width * sign;
        this.positions[k + 2] = p.position.z + this.side.z * width * sign;
        if (pointsChanged) {
          this.colors[k] = p.color.r;
          this.colors[k + 1] = p.color.g;
          this.colors[k + 2] = p.color.b;
        }
        this.alpha[i * 2 + j] = .68 * fade;
      }
    }
    const geometry = this.mesh.geometry;
    let indexCount = geometry.drawRange.count;
    if (pointsChanged) {
      indexCount = 0;
      for (let i = 0; i < n - 1; i++) {
        // A teleport, sharp frame skip or reset must not stretch ink into a sheet.
        if (!this.points[i + 1].continuous) continue;
        const j = i * 2;
        this.indices[indexCount++] = j;
        this.indices[indexCount++] = j + 1;
        this.indices[indexCount++] = j + 2;
        this.indices[indexCount++] = j + 2;
        this.indices[indexCount++] = j + 1;
        this.indices[indexCount++] = j + 3;
      }
      geometry.setDrawRange(0, indexCount);
      this.mesh.visible = indexCount > 0;
    }
    if (this.mesh.visible) {
      const vertexCount = this.indices[indexCount - 1] + 1;
      if (pointsChanged) {
        updatePrefix(geometry.index, indexCount);
        updatePrefix(geometry.attributes.aColor, vertexCount);
        updatePrefix(geometry.attributes.uv, vertexCount);
      }
      updatePrefix(geometry.attributes.position, vertexCount);
      updatePrefix(geometry.attributes.aAlpha, vertexCount);
    }

    let active = 0;
    for (const splash of this.splashes) {
      const age = this.clock - splash.born;
      if (age >= this.lifetime) continue;
      const drift = Math.min(age, 1.5);
      const k = active * 3;
      this.splashPositions[k] = splash.origin.x + splash.velocity.x * drift;
      this.splashPositions[k + 1] = splash.origin.y + splash.velocity.y * drift;
      this.splashPositions[k + 2] = splash.origin.z + splash.velocity.z * drift;
      this.splashColors[k] = splash.color.r;
      this.splashColors[k + 1] = splash.color.g;
      this.splashColors[k + 2] = splash.color.b;
      this.splashAlpha[active] = .75 * THREE.MathUtils.clamp((this.lifetime - age) / 3, 0, 1);
      this.splashSizes[active] = splash.size;
      this.splashShapes[active] = splash.shape;
      this.splashes[active] = splash;
      active++;
    }
    this.splashes.length = active;
    if (this.onPaint && active) {
      this.splashPaintCursor = this.splashPaintCursor || 0;
      for (let i = 0; i < Math.min(4, active); i++) {
        const index = (this.splashPaintCursor + i) % active;
        const at = index * 3;
        const splash = this.splashes[index];
        const x = this.splashPositions[at], y = this.splashPositions[at + 1], z = this.splashPositions[at + 2];
        const last = splash.lastPaint;
        // A settled splash remains visible but no longer needs to repaint the same surface.
        if (!last || (x - last.x) ** 2 + (y - last.y) ** 2 + (z - last.z) ** 2 >= .25) {
          const sample = new THREE.Vector3(x, y, z);
          this.onPaint(sample, 2, splash.color);
          if (last) last.copy(sample); else splash.lastPaint = sample.clone();
        }
      }
      this.splashPaintCursor = (this.splashPaintCursor + 4) % active;
    }
    const splashGeometry = this.splashMesh.geometry;
    splashGeometry.setDrawRange(0, active);
    this.splashMesh.visible = active > 0;
    if (active) {
      for (const attribute of Object.values(splashGeometry.attributes)) updatePrefix(attribute, active);
    }
  }
}
