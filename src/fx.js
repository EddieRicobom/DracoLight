import * as THREE from 'three';
import { U } from './util.js';

// ---------------------------------------------------------------------------------------------
// CPU particle pools drawn as soft point sprites. Fire/sparks are additive HDR (they feed bloom),
// smoke/dust are alpha blended. Everything here is a pool: nothing allocates per frame.
// ---------------------------------------------------------------------------------------------
const VS = /* glsl */`
attribute float aSize; attribute vec4 aCol; attribute float aSeed;
varying vec4 vCol; varying float vSeed;
uniform float uScale;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.5, -mv.z);
  vCol = aCol; vSeed = aSeed;
}`;
const FS_ADD = /* glsl */`
varying vec4 vCol; varying float vSeed;
void main(){
  vec2 p = gl_PointCoord * 2. - 1.;
  float r = length(p); if (r > 1.) discard;
  float a = pow(1. - r, 1.6);
  gl_FragColor = vec4(vCol.rgb * a * vCol.a * 0.1, 1.0);
}`;
const FS_SMOKE = /* glsl */`
varying vec4 vCol; varying float vSeed;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
void main(){
  vec2 p = gl_PointCoord * 2. - 1.;
  float r = length(p); if (r > 1.) discard;
  float c = cos(vSeed*6.28), s = sin(vSeed*6.28); p = mat2(c,-s,s,c)*p;
  float nn = n(p * 2.6 + vSeed * 31.) * 0.6 + n(p * 5.3 - vSeed * 17.) * 0.4;
  float a = smoothstep(1., 0.25, r + (nn - 0.5) * 0.7);
  vec3 col = vCol.rgb * (0.7 + 0.5 * nn) * (0.8 + 0.3 * (1. - p.y) * 0.5);
  gl_FragColor = vec4(col, a * vCol.a);
}`;

class Pool {
  constructor(scene, n, additive) {
    this.n = n;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.type = new Uint8Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.owner = new Uint8Array(n); this.dmg = new Float32Array(n);
    this.size = new Float32Array(n); this.col = new Float32Array(n * 4); this.seed = new Float32Array(n);
    for (let i = 0; i < n; i++) this.seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage);
    this.sa = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('aSize', this.sa); g.setAttribute('aCol', this.ca);
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: additive ? FS_ADD : FS_SMOKE, uniforms: { uScale: { value: 600 } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false;
    this.pts.renderOrder = additive ? 3 : 2;
    scene.add(this.pts);
    this.next = 0; this.high = 0;
  }
  spawn(type, x, y, z, vx, vy, vz, life, s0, s1) {
    const i = this.next; this.next = (this.next + 1) % this.n; if (i + 1 > this.high) this.high = i + 1;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = 0; this.max[i] = life; this.type[i] = type; this.s0[i] = s0; this.s1[i] = s1; this.owner[i] = 0; this.dmg[i] = 0;
    return i;
  }
}

// type ids
const FIRE = 1, SPARK = 2, FLASH = 3, FROST = 4, EMBER = 5, SPEED = 6;
const SMOKE = 1, DUST = 2, STEAM = 3;

export class FX {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.add = new Pool(scene, 9000, true);
    this.smk = new Pool(scene, 5000, false);
    this.shake = 0;
    this.burning = []; // {pos, t, r}
    // dynamic lights (fixed count so shaders never recompile)
    this.lights = [];
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xff8833, 0, 120, 2); scene.add(l); this.lights.push({ l, t: 0, dur: 1, i0: 0 }); }
    // shockwave shells
    const swMat = () => new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uC: { value: new THREE.Color(1, 0.6, 0.3) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uA; uniform vec3 uC; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.-abs(dot(vN,vV)), 3.); gl_FragColor = vec4(uC*f*uA*3., 1.); }`,
    });
    this.waves = [];
    const sg = new THREE.SphereGeometry(1, 32, 16);
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(sg, swMat()); m.visible = false; m.frustumCulled = false; scene.add(m); this.waves.push({ m, t: 0, dur: 1, r: 10 }); }
    this.tmp = new THREE.Vector3();
    // A small, fixed set of rings marks the moment the player crosses Mach 1.
    // They are intentionally translucent so the view ahead stays readable.
    this.speedRings = [];
    const ringGeometry = new THREE.TorusGeometry(1, 0.025, 5, 48);
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
        color: i ? 0xb8b8b8 : 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.speedRings.push({ mesh, age: 0, delay: i * 0.08 });
    }
    this.speedDirection = new THREE.Vector3(0, 0, 1);
    this.shockDirection = new THREE.Vector3(0, 0, 1);
    this.ringNormal = new THREE.Vector3(0, 0, 1);
    this.speedOrigin = new THREE.Vector3();
    this.speedSupersonic = false;
    this.speedWakeTime = 0;
    // A single screen-space draw call gives a sense of speed without covering the aim point.
    const streakGeometry = new THREE.BufferGeometry();
    const baseStreaks = 28, tierStreaks = 10, streakCount = baseStreaks + tierStreaks * 5;
    const streakData = new Float32Array(streakCount * 6 * 4);
    const streakTiers = new Float32Array(streakCount * 6);
    const streakIndices = new Uint16Array(streakCount * 12);
    for (let i = 0; i < streakCount; i++) {
      const tier = i < baseStreaks ? 0 : 1 + Math.floor((i - baseStreaks) / tierStreaks);
      const withinTier = i < baseStreaks ? i : (i - baseStreaks) % tierStreaks;
      const count = tier ? tierStreaks : baseStreaks;
      const angle = (withinTier + tier * .37 + (i % 3) * .29) * Math.PI * 2 / count;
      const phase = (i * .61803398875) % 1;
      for (let row = 0; row < 3; row++) for (let side = 0; side < 2; side++) {
        const vertex = i * 6 + row * 2 + side;
        const k = vertex * 4;
        streakData[k] = angle;
        streakData[k + 1] = phase;
        streakData[k + 2] = row * .5;
        streakData[k + 3] = side ? 1 : -1;
        streakTiers[vertex] = tier;
      }
      const v = i * 6, q = i * 12;
      streakIndices.set([v,v+1,v+2,v+2,v+1,v+3,v+2,v+3,v+4,v+4,v+3,v+5],q);
    }
    streakGeometry.setAttribute('aStreak', new THREE.BufferAttribute(streakData, 4));
    streakGeometry.setAttribute('aTier', new THREE.BufferAttribute(streakTiers, 1));
    streakGeometry.setIndex(new THREE.BufferAttribute(streakIndices, 1));
    this.speedStreaks = new THREE.Mesh(streakGeometry, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uDive: { value: 0 }, uMach: { value: 0 } },
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: `attribute vec4 aStreak; attribute float aTier;
        uniform float uTime; uniform float uPower; uniform float uDive; uniform float uMach;
        varying float vAlpha; varying float vDive; varying float vTier;
        void main(){
          float tier=aTier;
          float unlocked=tier<.5 ? 1. : smoothstep(tier+1.85,tier+2.12,uMach);
          float flow=fract(aStreak.y+uTime*(.55+uPower*1.5+tier*.3));
          vec2 radial=vec2(cos(aStreak.x),sin(aStreak.x));
          vec2 across=vec2(-radial.y,radial.x);
          float base=.57+flow*.62;
          float length=(.045+uPower*.20+uDive*.055)*(.5+flow*.5);
          float bend=0.;
          if(tier>.5){
            base=.53+flow*(.54+tier*.025);
            length=(.08+tier*.035)*(.55+flow*.45);
            // Higher tiers bend and pulse their filaments without filling the aim point.
            bend=sin(flow*12.+uTime*(2.+tier)+aStreak.x*3.)*tier*.003;
          }
          vec2 xy=radial*(base+aStreak.z*length)
            +across*(aStreak.w*(.0025+uPower*.0025+tier*.0009)+bend);
          gl_Position=vec4(xy,0.,1.);
          vAlpha=uPower*unlocked*(1.-abs(aStreak.z*2.-1.))*(.24+flow*.18);
          if(tier>.5){
            float rhythm=1.;
            if(tier>1.5 && tier<2.5) rhythm=.7+.3*sin(uTime*3.+aStreak.x*2.);
            else if(tier>2.5 && tier<3.5) rhythm=.55+.45*sin(uTime*4.+aStreak.y*18.);
            else if(tier>3.5 && tier<4.5) rhythm=.6+.4*sin(uTime*5.+aStreak.x*4.);
            else if(tier>4.5) rhythm=.8+.2*sin(uTime*6.+aStreak.y*12.);
            vAlpha*= (.4+.11*tier)*rhythm;
          }
          vDive=uDive; vTier=tier;
        }`,
      fragmentShader: `varying float vAlpha; varying float vDive; varying float vTier;
        void main(){
          float brightness=vTier<.5 ? .64 : .48+.105*vTier;
          vec3 color=vec3(brightness);
          gl_FragColor=vec4(color,vAlpha);
        }`,
    }));
    this.speedStreaks.visible = false;
    this.speedStreaks.frustumCulled = false;
    this.speedStreaks.renderOrder = 50;
    scene.add(this.speedStreaks);
    this.speedShockwaves = [];
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
        color: 0xe4e4e4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.speedShockwaves.push({ mesh, age: 0, strength: 0 });
    }
  }

  // speedMps is the actual displacement per second, including strafing and climbing.
  // Call once per active flight frame; passing active=false clears the crossing state.
  updateSpeed(dt, position, direction, speedMps, active = true) {
    if (!active || !Number.isFinite(speedMps) || dt <= 0) {
      this.speedSupersonic = false;
      this.speedWakeTime = 0;
      this.speedStreaks.visible = false;
      this.speedStreaks.material.uniforms.uPower.value = 0;
      this.speedStreaks.material.uniforms.uMach.value = 0;
      for (const ring of this.speedRings) ring.mesh.visible = false;
      return;
    }
    const uniforms = this.speedStreaks.material.uniforms;
    const target = Math.max(0, Math.min(1, (speedMps - 145) / 260));
    const dive = Math.max(0, Math.min(1, -direction.y * 1.5));
    const follow = 1 - Math.exp(-Math.min(dt, .05) * 5);
    uniforms.uPower.value += (target - uniforms.uPower.value) * follow;
    uniforms.uDive.value += (dive - uniforms.uDive.value) * follow;
    uniforms.uMach.value += (Math.min(speedMps / 343, 7.3) - uniforms.uMach.value) * follow;
    uniforms.uTime.value += Math.min(dt, .05);
    this.speedStreaks.visible = uniforms.uPower.value > .025;
    if (!this.speedSupersonic && speedMps >= 343) {
      this.speedSupersonic = true;
      this.speedDirection.copy(direction).normalize();
      this.speedOrigin.copy(position);
      for (const ring of this.speedRings) { ring.age = -ring.delay; ring.mesh.visible = true; }
    } else if (speedMps < 310) {
      this.speedSupersonic = false;
    }

    // Bounded emission: at most three particles per 45 ms, even after a long frame.
    this.speedWakeTime -= dt;
    if (speedMps > 190 && this.speedWakeTime <= 0) {
      this.speedWakeTime = 0.045;
      const strength = Math.min(1, (speedMps - 190) / 250);
      const count = speedMps >= 343 ? 3 : 1;
      const A = this.add;
      for (let i = 0; i < count; i++) {
        const back = 10 + Math.random() * 12;
        const spread = (2 + strength * 4) * (Math.random() - 0.5);
        A.spawn(SPEED, position.x - direction.x * back + spread,
          position.y - direction.y * back + (Math.random() - 0.5) * 4,
          position.z - direction.z * back + (Math.random() - 0.5) * 4,
          -direction.x * 12, -direction.y * 12, -direction.z * 12,
          0.28 + strength * 0.2, 0.4, 1.6 + strength * 1.4);
      }
    }
    for (const ring of this.speedRings) {
      if (!ring.mesh.visible) continue;
      ring.age += dt;
      if (ring.age < 0) continue;
      if (ring.age >= 0.55) { ring.mesh.visible = false; continue; }
      const t = ring.age / 0.55;
      ring.mesh.position.copy(this.speedOrigin).addScaledVector(this.speedDirection, -t * 38);
      ring.mesh.quaternion.setFromUnitVectors(this.ringNormal, this.speedDirection);
      ring.mesh.scale.setScalar(5 + t * 20);
      ring.mesh.material.opacity = 0.34 * (1 - t) * (1 - t);
    }
  }

  // Visual only. Call when braking sharply or pulling out of a dive; strength is 0..1.
  flightShockwave(position, direction, strength = 1) {
    const power = Math.max(0, Math.min(1, strength));
    if (power <= 0) return;
    const wave = this.speedShockwaves.find(item => !item.mesh.visible) || this.speedShockwaves[0];
    wave.age = 0;
    wave.strength = power;
    wave.mesh.position.copy(position);
    this.shockDirection.copy(direction).normalize();
    wave.mesh.quaternion.setFromUnitVectors(this.ringNormal, this.shockDirection);
    wave.mesh.scale.setScalar(4);
    wave.mesh.material.opacity = .26 * power;
    wave.mesh.visible = true;
  }

  light(pos, color, intensity, dur, dist = 140) {
    let best = this.lights[0];
    for (const L of this.lights) if (L.l.intensity < best.l.intensity) best = L;
    best.l.position.copy(pos); best.l.color.set(color); best.l.distance = dist; best.i0 = intensity * 0.008; best.t = 0; best.dur = dur; best.l.intensity = best.i0;
    return best;
  }

  // ---- emitters ---------------------------------------------------------------------------
  // dragon breath: a cone of fire from `o` along `d` (unit), `n` particles
  breath(o, d, base, n, owner = 1) {
    const A = this.add;
    for (let k = 0; k < n; k++) {
      const sp = 0.09, sx = (Math.random() - .5) * 2 * sp, sy = (Math.random() - .5) * 2 * sp, sz = (Math.random() - .5) * 2 * sp;
      const spd = 95 + Math.random() * 35;
      const t = Math.random() * 0.016;
      const i = A.spawn(FIRE, o.x + d.x * spd * t, o.y + d.y * spd * t, o.z + d.z * spd * t,
        (d.x + sx) * spd + base.x, (d.y + sy) * spd + base.y, (d.z + sz) * spd + base.z, 0.55 + Math.random() * 0.35, 1.2, 9 + Math.random() * 6);
      A.owner[i] = owner; A.dmg[i] = 1;
    }
    if (Math.random() < 0.5) { const i = A.spawn(EMBER, o.x, o.y, o.z, d.x * 60 + (Math.random() - .5) * 30, d.y * 60 + Math.random() * 20, d.z * 60 + (Math.random() - .5) * 30, 1.2, 0.5, 0.2); }
  }
  explosion(p, r = 12, kind = 'fire') {
    const A = this.add, S = this.smk, blue = kind === 'frost';
    A.spawn(FLASH, p.x, p.y, p.z, 0, 0, 0, 0.35, r * 1.2, r * 3.2);
    for (let k = 0; k < 70; k++) {
      const v = this.tmp.randomDirection().multiplyScalar((0.4 + Math.random()) * r * 3);
      A.spawn(blue ? FROST : FIRE, p.x, p.y, p.z, v.x, v.y + r, v.z, 0.6 + Math.random() * 0.6, r * 0.6, r * 1.3);
    }
    for (let k = 0; k < 50; k++) {
      const v = this.tmp.randomDirection().multiplyScalar((0.6 + Math.random()) * r * 5);
      A.spawn(blue ? FROST : SPARK, p.x, p.y, p.z, v.x, v.y + r * 2, v.z, 1 + Math.random() * 1.4, 0.7, 0.3);
    }
    for (let k = 0; k < 26; k++) {
      const v = this.tmp.randomDirection().multiplyScalar(Math.random() * r * 1.5);
      S.spawn(blue ? STEAM : SMOKE, p.x + v.x, p.y + v.y, p.z + v.z, v.x * 0.8, v.y * 0.5 + 4, v.z * 0.8, 3 + Math.random() * 4, r * 0.8, r * 2.6);
    }
    this.light(p, blue ? 0x88c4ff : 0xff7a2a, blue ? 1.5e4 : 3e4, 0.7, r * 14);
    const w = this.waves.find(w => !w.m.visible) || this.waves[0];
    w.m.visible = true; w.t = 0; w.dur = 0.55; w.r = r * 2.6; w.m.position.copy(p);
    w.m.material.uniforms.uC.value.set(blue ? 0x8fcaff : 0xff8040);
  }
  dust(p, scale = 1, chance = 1) {
    if (Math.random() > chance) return;
    const S = this.smk;
    for (let k = 0; k < 3 * scale; k++)
      S.spawn(DUST, p.x + (Math.random() - .5) * 6, p.y + (Math.random() - .5) * 4, p.z + (Math.random() - .5) * 6,
        (Math.random() - .5) * 6, Math.random() * 3, (Math.random() - .5) * 6, 3 + Math.random() * 4, 4 * scale, 12 * scale);
  }
  bigDust(p, n) {
    const S = this.smk;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.28, d = Math.random() * 25;
      S.spawn(DUST, p.x + Math.cos(a) * d, 2 + Math.random() * 8, p.z + Math.sin(a) * d, Math.cos(a) * (10 + Math.random() * 18), Math.random() * 6, Math.sin(a) * (10 + Math.random() * 18), 6 + Math.random() * 6, 10, 34);
    }
  }
  burnAt(p, t = 6, r = 3) { if (this.burning.length < 160) this.burning.push({ x: p.x, y: p.y, z: p.z, t, r }); }
  sparks(p, n, blue = false) {
    for (let k = 0; k < n; k++) { const v = this.tmp.randomDirection().multiplyScalar(10 + Math.random() * 30); this.add.spawn(blue ? FROST : SPARK, p.x, p.y, p.z, v.x, v.y + 8, v.z, 0.5 + Math.random() * 0.6, 0.6, 0.25); }
  }
  trail(p, blue) {
    const A = this.add;
    A.spawn(blue ? FROST : FIRE, p.x + (Math.random() - .5), p.y + (Math.random() - .5), p.z + (Math.random() - .5), (Math.random() - .5) * 4, (Math.random() - .5) * 4 + 2, (Math.random() - .5) * 4, 0.35, 2.5, 5);
    if (Math.random() < 0.3) this.smk.spawn(blue ? STEAM : SMOKE, p.x, p.y, p.z, 0, 2, 0, 1.5, 2, 6);
  }

  // Short luminous wake behind a fast-flying Rayquaza.
  flightWake(pos, direction) {
    const A = this.add;
    for (let k = 0; k < 3; k++) {
      const spread = 2.5;
      const i = A.spawn(EMBER, pos.x + (Math.random() - .5) * spread, pos.y + (Math.random() - .5) * spread,
        pos.z + (Math.random() - .5) * spread, -direction.x * 24 + (Math.random() - .5) * 5,
        -direction.y * 24 + (Math.random() - .5) * 5, -direction.z * 24 + (Math.random() - .5) * 5,
        0.45 + Math.random() * 0.3, 0.55, 0.1);
      A.owner[i] = 0;
    }
  }

  // ---- update --------------------------------------------------------------------------------
  update(dt, city) {
    // burning spots on buildings/wrecks
    for (let i = this.burning.length - 1; i >= 0; i--) {
      const b = this.burning[i]; b.t -= dt;
      if (b.t <= 0) { this.burning.splice(i, 1); continue; }
      if (Math.random() < 0.6) this.add.spawn(FIRE, b.x + (Math.random() - .5) * b.r * 2, b.y + (Math.random() - .5) * b.r, b.z + (Math.random() - .5) * b.r * 2, 0, 4 + Math.random() * 5, 0, 0.7 + Math.random() * 0.5, 2, 4.5);
      if (Math.random() < 0.18) this.smk.spawn(SMOKE, b.x, b.y + 3, b.z, (Math.random() - .5) * 2, 6 + Math.random() * 3, (Math.random() - .5) * 2, 6 + Math.random() * 4, 4, 18);
    }

    const A = this.add, S = this.smk;
    for (let i = 0; i < A.high; i++) {
      if (A.life[i] >= A.max[i]) { A.size[i] = 0; continue; }
      A.life[i] += dt; const t = Math.min(1, A.life[i] / A.max[i]), ty = A.type[i];
      let vx = A.v[i * 3], vy = A.v[i * 3 + 1], vz = A.v[i * 3 + 2];
      let r = 1, g = 1, b = 1, a = 1;
      if (ty === FIRE) {
        const dr = Math.exp(-2.6 * dt); vx *= dr; vy = vy * dr + 9 * dt; vz *= dr;
        if (t < 0.12) { r = 7; g = 5.2; b = 2.6; } else if (t < 0.45) { const k = (t - 0.12) / 0.33; r = 7 - 3.5 * k; g = 5.2 - 4 * k; b = 2.6 - 2.45 * k; }
        else { const k = (t - 0.45) / 0.55; r = 3.5 * (1 - k) + 0.25 * k; g = 1.2 * (1 - k) + 0.05; b = 0.15 * (1 - k) + 0.02; }
        a = (1 - t) * (1 - t) * 1.1;
        // fire turns to smoke at the end of its life
        if (t > 0.6 && A.owner[i] && Math.random() < 0.04) S.spawn(SMOKE, A.p[i * 3], A.p[i * 3 + 1], A.p[i * 3 + 2], vx * 0.3, vy * 0.3 + 3, vz * 0.3, 3 + Math.random() * 3, 5, 16);
      } else if (ty === SPARK || ty === EMBER) {
        vy -= 22 * dt; const dr = Math.exp(-0.6 * dt); vx *= dr; vz *= dr;
        r = 8; g = 3.4; b = 0.8; a = 1 - t;
        if (A.p[i * 3 + 1] < 0.3 && vy < 0) { vy *= -0.3; A.p[i * 3 + 1] = 0.3; }
      } else if (ty === FLASH) { r = 14; g = 10; b = 6; a = (1 - t) * (1 - t); }
      else if (ty === FROST) {
        const dr = Math.exp(-2 * dt); vx *= dr; vy = vy * dr - 4 * dt; vz *= dr;
        r = 2.2; g = 4.5; b = 9; a = (1 - t) * (1 - t);
      } else if (ty === SPEED) {
        const dr = Math.exp(-2 * dt); vx *= dr; vy = vy * dr - 4 * dt; vz *= dr;
        r = g = b = 3.2; a = (1 - t) * (1 - t);
      }
      A.v[i * 3] = vx; A.v[i * 3 + 1] = vy; A.v[i * 3 + 2] = vz;
      A.p[i * 3] += vx * dt; A.p[i * 3 + 1] += vy * dt; A.p[i * 3 + 2] += vz * dt;
      A.size[i] = A.s0[i] + (A.s1[i] - A.s0[i]) * Math.sqrt(t);
      A.col[i * 4] = r; A.col[i * 4 + 1] = g; A.col[i * 4 + 2] = b; A.col[i * 4 + 3] = a;
      if (ty === FIRE && A.p[i * 3 + 1] < 0.5) { A.p[i * 3 + 1] = 0.5; A.v[i * 3 + 1] = Math.abs(vy) * 0.2; }
    }
    for (let i = 0; i < S.high; i++) {
      if (S.life[i] >= S.max[i]) { S.size[i] = 0; continue; }
      S.life[i] += dt; const t = Math.min(1, S.life[i] / S.max[i]), ty = S.type[i];
      const dr = Math.exp(-0.9 * dt);
      S.v[i * 3] = S.v[i * 3] * dr + 1.2 * dt; S.v[i * 3 + 1] = S.v[i * 3 + 1] * dr + (ty === DUST ? 0.4 : 2.2) * dt; S.v[i * 3 + 2] *= dr;
      S.p[i * 3] += S.v[i * 3] * dt; S.p[i * 3 + 1] += S.v[i * 3 + 1] * dt; S.p[i * 3 + 2] += S.v[i * 3 + 2] * dt;
      S.size[i] = S.s0[i] + (S.s1[i] - S.s0[i]) * Math.sqrt(t);
      let r, g, b, a;
      if (ty === SMOKE) { r = 0.07; g = 0.065; b = 0.06; a = Math.min(1, t * 6) * (1 - t) * 0.75; }
      else if (ty === DUST) { r = 0.42; g = 0.37; b = 0.32; a = Math.min(1, t * 5) * (1 - t) * 0.6; }
      else { r = 0.75; g = 0.82; b = 0.9; a = Math.min(1, t * 6) * (1 - t) * 0.5; }
      S.col[i * 4] = r; S.col[i * 4 + 1] = g; S.col[i * 4 + 2] = b; S.col[i * 4 + 3] = a;
    }
    for (const P of [A, S]) {
      P.pa.needsUpdate = P.sa.needsUpdate = P.ca.needsUpdate = true;
      P.pts.geometry.setDrawRange(0, P.high);
    }
    for (const L of this.lights) {
      if (L.l.intensity <= 0) continue;
      L.t += dt; const k = 1 - L.t / L.dur; L.l.intensity = k > 0 ? L.i0 * k * k : 0;
    }
    for (const w of this.waves) {
      if (!w.m.visible) continue;
      w.t += dt; const k = w.t / w.dur;
      if (k >= 1) { w.m.visible = false; continue; }
      w.m.scale.setScalar(w.r * (0.2 + Math.sqrt(k))); w.m.material.uniforms.uA.value = (1 - k) * (1 - k);
    }
    for (const wave of this.speedShockwaves) {
      if (!wave.mesh.visible) continue;
      wave.age += dt;
      const t = wave.age / .65;
      if (t >= 1) { wave.mesh.visible = false; continue; }
      wave.mesh.scale.setScalar(4 + 38 * Math.sqrt(t));
      wave.mesh.material.opacity = .26 * wave.strength * (1 - t) * (1 - t);
    }
    this.shake *= Math.exp(-4 * dt);
  }
  setScale(h, fov) { const s = h / (2 * Math.tan((fov * Math.PI / 180) / 2)); this.add.mat.uniforms.uScale.value = s; this.smk.mat.uniforms.uScale.value = s; }
}

// ---------------------------------------------------------------------------------------------
// Lightning beam (white loong): a hot core, a soft sheath and crawling bolts built as
// camera-facing ribbons, all additive.
// ---------------------------------------------------------------------------------------------
export class Beam {
  constructor(scene) {
    const mk = (r, c, op) => {
      const g = new THREE.CylinderGeometry(r, r, 1, 16, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
      return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    };
    this.core = mk(0.7, new THREE.Color(6, 8, 12), 1);
    this.sheath = mk(2.6, new THREE.Color(0.6, 1.2, 2.6), 0.35);
    this.outer = mk(5.5, new THREE.Color(0.2, 0.45, 1.0), 0.15);
    this.group = new THREE.Group(); this.group.add(this.core, this.sheath, this.outer);
    this.group.visible = false; scene.add(this.group);
    for (const m of [this.core, this.sheath, this.outer]) m.frustumCulled = false;
    // bolts
    this.NB = 4; this.NS = 28;
    const nq = this.NB * this.NS;
    const g = new THREE.BufferGeometry();
    this.bp = new Float32Array(nq * 4 * 3);
    const idx = []; for (let q = 0; q < nq; q++) idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3);
    g.setIndex(idx); g.setAttribute('position', new THREE.BufferAttribute(this.bp, 3).setUsage(THREE.DynamicDrawUsage));
    this.bolts = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 5, 10), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.bolts.frustumCulled = false; this.bolts.visible = false; scene.add(this.bolts);
    // charging orb
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 5, 10), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.orb.visible = false; scene.add(this.orb);
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._s = new THREE.Vector3();
  }
  charge(p, k) { this.orb.visible = k > 0; this.orb.position.copy(p); this.orb.scale.setScalar(0.5 + k * 2.4 + Math.random() * 0.3); }
  show(a, b, cam, t) {
    const len = a.distanceTo(b);
    this.group.visible = this.bolts.visible = true;
    this.group.position.copy(a); this.group.lookAt(b);
    const fl = 0.85 + Math.random() * 0.3;
    this.core.scale.set(fl, fl, len); this.sheath.scale.set(fl, fl, len); this.outer.scale.set(1 + 0.2 * Math.sin(t * 40), 1 + 0.2 * Math.sin(t * 40), len);
    // bolts: jittered polylines around the axis
    const dir = this._s.subVectors(b, a).normalize();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir);
    const view = new THREE.Vector3(); let q = 0;
    for (let k = 0; k < this.NB; k++) {
      let prev = null;
      const amp = 2 + k * 1.2;
      for (let s = 0; s <= this.NS; s++) {
        const u = s / this.NS, env = Math.sin(Math.PI * Math.min(1, u * 1.05)) * (s === 0 ? 0 : 1);
        const p = this._a.copy(a).addScaledVector(dir, len * u)
          .addScaledVector(side, (Math.random() - .5) * amp * 2 * env).addScaledVector(up, (Math.random() - .5) * amp * 2 * env).clone();
        if (prev) {
          view.subVectors(cam, p).normalize();
          const seg = this._b.subVectors(p, prev);
          const w = new THREE.Vector3().crossVectors(seg, view).normalize().multiplyScalar(0.18 + 0.12 * (k === 0));
          const o = q * 12;
          this.bp[o] = prev.x - w.x; this.bp[o + 1] = prev.y - w.y; this.bp[o + 2] = prev.z - w.z;
          this.bp[o + 3] = prev.x + w.x; this.bp[o + 4] = prev.y + w.y; this.bp[o + 5] = prev.z + w.z;
          this.bp[o + 6] = p.x - w.x; this.bp[o + 7] = p.y - w.y; this.bp[o + 8] = p.z - w.z;
          this.bp[o + 9] = p.x + w.x; this.bp[o + 10] = p.y + w.y; this.bp[o + 11] = p.z + w.z;
          q++;
        }
        prev = p;
      }
    }
    this.bolts.geometry.attributes.position.needsUpdate = true;
  }
  hide() { this.group.visible = this.bolts.visible = false; }
}

// ---------------------------------------------------------------------------------------------
// Projectiles: fireballs (player) and frost orbs (hunter)
// ---------------------------------------------------------------------------------------------
export class Projectiles {
  constructor(scene) {
    this.list = [];
    this.pool = [];
    const g = new THREE.SphereGeometry(1, 16, 10);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; scene.add(m); this.pool.push(m);
    }
  }
  fire(kind, pos, vel, owner) {
    const m = this.pool.find(m => !m.visible); if (!m) return;
    m.visible = true; m.position.copy(pos);
    m.material.color.set(kind === 'fireball' ? new THREE.Color(9, 4, 1) : new THREE.Color(2, 5, 10));
    m.scale.setScalar(kind === 'fireball' ? 1.8 : 1.6);
    this.list.push({ kind, m, vel: vel.clone(), owner, life: 0 });
  }
}
