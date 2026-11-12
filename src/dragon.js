import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, GLSL_COMMON, smooth, Y } from './util.js';

// ---------------------------------------------------------------------------------------------
// A loong: serpentine body that follows the head's flight path, scaled hide with belly plates,
// dorsal spines, flowing mane, antlers, whiskers, four tucked legs and a tail tuft.
// ---------------------------------------------------------------------------------------------
const N = 86, SP = 0.95, RAD = 18, NECK = 1.6;

export const PALETTES = {
  red: { back: [0.62, 0.05, 0.035], back2: [0.85, 0.16, 0.06], belly: [0.93, 0.66, 0.3], mane: [0.95, 0.62, 0.2], horn: [0.92, 0.7, 0.42], eye: [6, 3.2, 0.5], claw: [0.95, 0.85, 0.6] },
  white: { back: [0.82, 0.85, 0.9], back2: [0.95, 0.97, 1.0], belly: [0.72, 0.8, 0.9], mane: [0.72, 0.85, 1.0], horn: [0.86, 0.9, 0.96], eye: [1.2, 3.5, 7], claw: [0.9, 0.95, 1.0] },
};
const col = (a) => new THREE.Color().setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace);

function bodyMaterial(P) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.08 });
  m.userData.hit = { value: 0 };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uBack: { value: col(P.back) }, uBack2: { value: col(P.back2) }, uBelly: { value: col(P.belly) }, uMane: { value: col(P.mane) }, uHit: m.userData.hit, uTime: U.uTime });
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vB;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvB = uv;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec3 uBack, uBack2, uBelly, uMane; uniform float uHit, uTime; varying vec2 vB; float hS; float bellyK;
      ${GLSL_COMMON}
      // scallop scales: rows offset by half a scale, each scale a rounded shield
      float scaleH(vec2 b, out float edge){
        vec2 g = vec2(b.x * 30., b.y * 1.9);
        float row = floor(g.y); g.x += mod(row, 2.) * .5;
        vec2 f = fract(g) - vec2(.5, 0.);
        float d = length(f * vec2(1., 1.05));
        edge = smoothstep(.36, .52, d);
        return (1. - edge) * (0.6 + 0.4 * f.y);
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float a = min(vB.x, 1. - vB.x);              // 0 = belly line
        bellyK = smoothstep(.2, .14, a);
        float e; float h = scaleH(vB, e);
        float plate = fract(vB.y * 0.85); float pe = smoothstep(.82, 1., plate) + smoothstep(.06, 0., plate);
        float flank = smoothstep(.16, .32, a);
        vec3 back = mix(uBack2, uBack, smoothstep(.25, .5, a));
        vec3 sc = back * (0.55 + 0.6 * h) + uMane * 0.25 * e * flank;
        vec3 bl = uBelly * (1. - 0.45 * pe);
        diffuseColor.rgb = mix(sc, bl, bellyK);
        hS = mix(h * 0.7, 1. - pe, bellyK);
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.55, 0.28, hS);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bumpN(-vViewPosition, normal, vec2(dFdx(hS), dFdy(hS)) * 0.9, faceDirection);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1., .9, .8) * uHit * 2.;
        { float fr = pow(1. - abs(dot(normal, normalize(vViewPosition))), 3.); totalEmissiveRadiance += uMane * fr * 0.18; }`);
  };
  return m;
}

// tapered tube along a curve
function taperTube(pts, r0, r1, seg = 24, rad = 7) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const frames = curve.computeFrenetFrames(seg, false);
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, p = curve.getPointAt(u), r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j, b = a + rad + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals(); return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ell = (sx, sy, sz, x, y, z, ws = 24, hs = 16) => new THREE.SphereGeometry(1, ws, hs).scale(sx, sy, sz).translate(x, y, z);
const cone = (r, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 6) => new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0).rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);
const strip = (g) => { const o = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(o.attributes)) if (k !== 'position' && k !== 'normal') o.deleteAttribute(k); return o; };
const merge = (list) => mergeGeometries(list.map(strip));

function buildHead(P, mats) {
  const head = new THREE.Group();
  // skull + snout (local +Z forward, +Y up)
  const skull = merge([
    ell(1.45, 1.15, 1.9, 0, 0.35, 0),
    ell(1.05, 0.62, 2.3, 0, 0.12, 2.25),
    ell(0.62, 0.45, 0.62, 0, 0.42, 4.05),
    ell(0.55, 0.38, 1.25, 0.72, 1.0, 1.05).rotateY(0), ell(0.55, 0.38, 1.25, -0.72, 1.0, 1.05),
    ell(0.5, 0.55, 0.9, 1.05, 0.15, 0.7), ell(0.5, 0.55, 0.9, -1.05, 0.15, 0.7),
    ell(0.28, 0.2, 0.5, 0, 0.62, 3.0),
  ]);
  head.add(new THREE.Mesh(skull, mats.head));
  // nostrils & eyes
  const dark = new THREE.MeshStandardMaterial({ color: 0x120404, roughness: 0.6 });
  head.add(new THREE.Mesh(merge([ell(0.14, 0.12, 0.12, 0.38, 0.6, 4.45), ell(0.14, 0.12, 0.12, -0.38, 0.6, 4.45)]), dark));
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: col(P.eye), emissiveIntensity: 1, roughness: 0.15 });
  head.add(new THREE.Mesh(merge([ell(0.3, 0.26, 0.36, 0.98, 0.72, 1.45), ell(0.3, 0.26, 0.36, -0.98, 0.72, 1.45)]), eyeM));
  head.add(new THREE.Mesh(merge([ell(0.06, 0.22, 0.12, 1.24, 0.72, 1.55), ell(0.06, 0.22, 0.12, -1.24, 0.72, 1.55)]), dark));
  // mouth interior + upper teeth
  head.add(new THREE.Mesh(ell(0.85, 0.3, 1.9, 0, -0.22, 2.0), new THREE.MeshStandardMaterial({ color: 0x4a0808, emissive: 0x200000, roughness: 0.5 })));
  const teeth = [];
  for (let k = 0; k < 7; k++) { const z = 1.2 + k * 0.42; for (const sx of [-1, 1]) teeth.push(cone(0.09, 0.42 - k * 0.02, sx * (0.78 - k * 0.04), -0.2, z, Math.PI, 0, 0, 4)); }
  teeth.push(cone(0.12, 0.7, 0.42, -0.15, 3.85, Math.PI, 0, 0, 5), cone(0.12, 0.7, -0.42, -0.15, 3.85, Math.PI, 0, 0, 5));
  const toothM = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.3 });
  head.add(new THREE.Mesh(merge(teeth), toothM));
  // lower jaw on a hinge
  const jaw = new THREE.Group(); jaw.position.set(0, -0.3, 0.4); head.add(jaw);
  const lt = [ell(0.88, 0.32, 2.05, 0, -0.25, 1.75)];
  const jt = [];
  for (let k = 0; k < 6; k++) for (const sx of [-1, 1]) jt.push(cone(0.08, 0.36, sx * (0.68 - k * 0.04), -0.05, 1.0 + k * 0.45, 0, 0, 0, 4));
  jaw.add(new THREE.Mesh(merge(lt), mats.head));
  jaw.add(new THREE.Mesh(merge(jt), toothM));
  // beard
  const beard = [];
  for (let k = 0; k < 14; k++) { const x = (k / 13 - 0.5) * 1.4, z = 0.6 + Math.random() * 1.6; beard.push(cone(0.16, 1.6 + Math.random() * 1.4, x, -0.5, z, Math.PI * 0.82, 0, x * 0.3, 4)); }
  jaw.add(new THREE.Mesh(merge(beard), mats.mane));
  // antlers
  const horns = [];
  for (const sx of [-1, 1]) {
    horns.push(taperTube([V(sx * 0.55, 1.2, -0.2), V(sx * 0.9, 2.5, -1.1), V(sx * 1.25, 3.7, -2.5), V(sx * 1.05, 4.7, -4.1)], 0.3, 0.05, 20, 8));
    horns.push(taperTube([V(sx * 0.92, 2.7, -1.35), V(sx * 1.45, 3.4, -0.9), V(sx * 1.75, 4.3, -0.8)], 0.15, 0.03, 10, 6));
    horns.push(taperTube([V(sx * 1.2, 3.6, -2.35), V(sx * 1.85, 4.3, -2.6), V(sx * 2.2, 5.0, -2.2)], 0.12, 0.03, 10, 6));
  }
  head.add(new THREE.Mesh(merge(horns), mats.horn));
  // whiskers (flowing, animated by bending the head group's children a little)
  const wh = [];
  for (const sx of [-1, 1]) wh.push(taperTube([V(sx * 0.55, 0.35, 4.2), V(sx * 1.9, 0.2, 4.6), V(sx * 3.6, -0.5, 3.0), V(sx * 4.6, -1.6, -0.5), V(sx * 5.0, -2.9, -4.5)], 0.11, 0.025, 36, 6));
  const whisk = new THREE.Mesh(merge(wh), mats.horn); head.add(whisk);
  // head mane + cheek fins
  const mane = [];
  for (let k = 0; k < 34; k++) {
    const a = -1.9 + (k / 33) * 3.8, len = 2.4 + Math.random() * 2.4;
    const x = Math.sin(a) * 1.3, y = 0.4 + Math.cos(a) * 1.1;
    mane.push(cone(0.22, len, x, y, -0.8 - Math.random() * 0.6, -Math.PI * 0.62 + Math.cos(a) * 0.25, 0, -a * 0.6, 4));
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 6; k++) mane.push(cone(0.12, 1.5 + k * 0.15, sx * 1.35, 0.2 + k * 0.1, 0.4 - k * 0.12, -Math.PI * 0.45, 0, -sx * (1.2 + k * 0.08), 4));
  head.add(new THREE.Mesh(merge(mane), mats.mane));
  head.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return { head, jaw, eyeM };
}

function buildLeg(P, mats, b) {
  // local: x outward, y up, z toward tail when b=+1
  const pts = [V(0, 0, 0), V(1.5, -1.1, b * 1.5), V(1.9, -2.6, b * 2.6), V(2.0, -3.2, b * 2.2)];
  const g = new THREE.Group();
  g.add(new THREE.Mesh(merge([
    taperTube([pts[0], pts[0].clone().lerp(pts[1], 0.5).add(V(0, 0.2, 0)), pts[1]], 0.75, 0.45, 8, 10),
    taperTube([pts[1], pts[1].clone().lerp(pts[2], 0.5).add(V(0.2, 0, 0)), pts[2]], 0.45, 0.32, 8, 8),
    ell(0.45, 0.32, 0.55, pts[3].x, pts[3].y + 0.25, pts[3].z),
  ]), mats.limb));
  const claws = [];
  for (let k = 0; k < 4; k++) {
    const a = (k - 1.5) * 0.45;
    claws.push(taperTube([V(pts[3].x + Math.sin(a) * 0.3, pts[3].y + 0.1, pts[3].z - b * 0.3), V(pts[3].x + Math.sin(a) * 0.7, pts[3].y - 0.25, pts[3].z - b * 0.9), V(pts[3].x + Math.sin(a) * 0.8, pts[3].y - 0.65, pts[3].z - b * 1.0)], 0.1, 0.02, 6, 5));
  }
  g.add(new THREE.Mesh(merge(claws), mats.claw));
  // elbow tufts
  const tufts = [];
  for (let k = 0; k < 5; k++) tufts.push(cone(0.13, 1.4 + Math.random(), pts[1].x, pts[1].y, pts[1].z, b * (Math.PI * 0.5 + k * 0.12), 0, 0.3 - k * 0.15, 4));
  g.add(new THREE.Mesh(merge(tufts), mats.mane));
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.matrixAutoUpdate = false;
  return g;
}

export class Dragon {
  constructor(scene, P) {
    this.P = P;
    this.pos = new THREE.Vector3(); this.fwd = new THREE.Vector3(0, 0, -1); this.up = new THREE.Vector3(0, 1, 0);
    this.jaw = 0; this.hit = 0;
    const bodyM = bodyMaterial(P);
    const plain = (c, r = 0.45, m = 0.1) => new THREE.MeshStandardMaterial({ color: col(c), roughness: r, metalness: m });
    const mats = { body: bodyM, head: plain(P.back2, 0.38), mane: plain(P.mane, 0.55, 0.25), horn: plain(P.horn, 0.3, 0.15), limb: plain(P.back, 0.45), claw: plain(P.claw, 0.25, 0.2) };
    mats.head.emissive = new THREE.Color(0, 0, 0); mats.limb.emissive = new THREE.Color(0, 0, 0);
    this.mats = mats;

    // ---- body tube (vertices rewritten every frame)
    const rings = N + 1, vpr = RAD + 1;
    this.pos3 = new Float32Array(rings * vpr * 3); this.nor3 = new Float32Array(rings * vpr * 3);
    const uv = new Float32Array(rings * vpr * 2), idx = [];
    for (let i = 0; i < rings; i++) for (let j = 0; j < vpr; j++) { uv[(i * vpr + j) * 2] = j / RAD; uv[(i * vpr + j) * 2 + 1] = i * SP; }
    for (let i = 0; i < N; i++) for (let j = 0; j < RAD; j++) { const a = i * vpr + j, b = a + vpr; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos3, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor3, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    this.body = new THREE.Mesh(g, bodyM); this.body.castShadow = this.body.receiveShadow = true; this.body.frustumCulled = false;
    scene.add(this.body);

    // radius profile
    this.rad = new Float32Array(rings);
    for (let i = 0; i < rings; i++) {
      const t = i / N;
      const a = 1.15 + (2.35 - 1.15) * smooth(0, 0.16, t);
      this.rad[i] = Math.max(0.12, a * (1 - smooth(0.42, 1.0, t) * 0.93));
    }
    this.rad[N] = 0.05;

    // ---- head
    const H = buildHead(P, mats); this.head = H.head; this.jawG = H.jaw; this.eyeM = H.eyeM;
    this.head.matrixAutoUpdate = false; scene.add(this.head);

    // ---- spines + mane strands (instanced)
    this.spines = new THREE.InstancedMesh(new THREE.ConeGeometry(0.32, 1.7, 5).translate(0, 0.85, 0), mats.mane, N);
    this.spines.castShadow = true; this.spines.frustumCulled = false; scene.add(this.spines);
    this.strands = [];
    for (let k = 0; k < 70; k++) this.strands.push({ ring: Math.floor(Math.random() * 14), a: (Math.random() - 0.5) * 2.4, len: 2 + Math.random() * 3.2, ph: Math.random() * 6 });
    for (let k = 0; k < 22; k++) this.strands.push({ ring: N - 1 - Math.floor(Math.random() * 2), a: (Math.random() - 0.5) * 6.28, len: 2.5 + Math.random() * 3, ph: Math.random() * 6, tail: true });
    for (const ri of [16, 48]) for (let k = 0; k < 8; k++) this.strands.push({ ring: ri + Math.floor(Math.random() * 4), a: (Math.random() < 0.5 ? -1 : 1) * (1.3 + Math.random() * 0.4), len: 1.4 + Math.random(), ph: Math.random() * 6 });
    this.mane = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 1, 4).translate(0, 0.5, 0), mats.mane, this.strands.length);
    this.mane.castShadow = true; this.mane.frustumCulled = false; scene.add(this.mane);

    // ---- legs at rings 16 (front) and 48 (back)
    this.legs = [];
    for (const ri of [16, 48]) for (const s of [1, -1]) { const L = buildLeg(P, mats, s); scene.add(L); this.legs.push({ g: L, ri, s }); }

    // trail of the head path
    this.TC = 4096;
    this.tx = new Float32Array(this.TC); this.ty = new Float32Array(this.TC); this.tz = new Float32Array(this.TC); this.td = new Float64Array(this.TC);
    this.th = 0; this.tn = 0;
    this.pts = Array.from({ length: rings }, () => new THREE.Vector3());
    this.T = Array.from({ length: rings }, () => new THREE.Vector3());
    this.Up = Array.from({ length: rings }, () => new THREE.Vector3());
    this.Rt = Array.from({ length: rings }, () => new THREE.Vector3());
    this.raw = Array.from({ length: rings }, () => new THREE.Vector3());
    this.sw = new Float64Array(rings);
  }

  resetTrail() {
    // straight body behind the head
    this.tn = 0; this.th = 0;
    const n = 220;
    for (let k = n; k >= 0; k--) this._push(this.pos.x - this.fwd.x * k * 0.5, this.pos.y - this.fwd.y * k * 0.5, this.pos.z - this.fwd.z * k * 0.5);
  }
  _push(x, y, z) {
    const prev = (this.th - 1 + this.TC) % this.TC;
    const d = this.tn ? this.td[prev] + Math.hypot(x - this.tx[prev], y - this.ty[prev], z - this.tz[prev]) : 0;
    const i = this.th; this.tx[i] = x; this.ty[i] = y; this.tz[i] = z; this.td[i] = d;
    this.th = (this.th + 1) % this.TC; this.tn = Math.min(this.TC, this.tn + 1);
  }

  get mouth() { return this._mouth || (this._mouth = new THREE.Vector3()); }

  update(dt, t) {
    const last = (this.th - 1 + this.TC) % this.TC;
    if (Math.hypot(this.pos.x - this.tx[last], this.pos.y - this.ty[last], this.pos.z - this.tz[last]) > 0.08) this._push(this.pos.x, this.pos.y, this.pos.z);
    const head = (this.th - 1 + this.TC) % this.TC, headD = this.td[head];

    // ---- sample trail at arc-length steps
    let k = head, steps = 0;
    for (let i = 0; i <= N; i++) {
      const want = headD - NECK - i * SP;
      while (steps < this.tn - 2) {
        const pk = (k - 1 + this.TC) % this.TC;
        if (this.td[pk] <= want) break;
        k = pk; steps++;
      }
      const pk = (k - 1 + this.TC) % this.TC;
      const d0 = this.td[pk], d1 = this.td[k], f = d1 > d0 ? Math.min(1, Math.max(0, (want - d0) / (d1 - d0))) : 0;
      this.raw[i].set(this.tx[pk] + (this.tx[k] - this.tx[pk]) * f, this.ty[pk] + (this.ty[k] - this.ty[pk]) * f, this.tz[pk] + (this.tz[k] - this.tz[pk]) * f);
      this.sw[i] = want;
    }
    // ---- frames on the raw path, then swim undulation, then final frames
    this._frames(this.raw);
    for (let i = 0; i <= N; i++) {
      const u = i / N, amp = 2.1 * smooth(0.02, 0.22, u) * (1 - 0.4 * u);
      const s = this.sw[i];
      this.pts[i].copy(this.raw[i]).addScaledVector(this.Rt[i], Math.sin(s * 0.105 - t * 0.6) * amp).addScaledVector(this.Up[i], Math.cos(s * 0.07) * amp * 0.45);
    }
    this._frames(this.pts);

    // ---- write tube
    const P = this.pos3, Nn = this.nor3, vpr = RAD + 1;
    for (let i = 0; i <= N; i++) {
      const p = this.pts[i], up = this.Up[i], rt = this.Rt[i];
      let r = this.rad[i];
      // breathing swell
      r *= 1 + 0.03 * Math.sin(t * 2.2 - i * 0.2);
      for (let j = 0; j <= RAD; j++) {
        const a = (j / RAD) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        // angle 0 = belly (-up); body slightly flattened on the belly
        const nx = rt.x * sa - up.x * ca, ny = rt.y * sa - up.y * ca, nz = rt.z * sa - up.z * ca;
        const flat = ca > 0 ? 1 - 0.18 * ca : 1;
        const o = (i * vpr + j) * 3;
        P[o] = p.x + nx * r * flat; P[o + 1] = p.y + ny * r * flat; P[o + 2] = p.z + nz * r * flat;
        Nn[o] = nx; Nn[o + 1] = ny; Nn[o + 2] = nz;
      }
    }
    this.body.geometry.attributes.position.needsUpdate = true; this.body.geometry.attributes.normal.needsUpdate = true;

    // ---- head
    const X = _a.crossVectors(this.up, this.fwd).normalize(), Yu = _b.crossVectors(this.fwd, X).normalize();
    this.head.matrix.makeBasis(X, Yu, this.fwd).setPosition(this.pos);
    this.head.matrixWorldNeedsUpdate = true;
    this.jawG.rotation.x = 0.08 + this.jaw * 0.62 + Math.sin(t * 1.3) * 0.03;
    this.mouth.set(0, -0.15, 4.4).applyMatrix4(this.head.matrix);

    // ---- spines
    const m = _m, q = _q, sc = _s;
    for (let i = 0; i < N; i++) {
      const r = this.rad[i];
      if (i < 3 || i > N - 3) { this.spines.setMatrixAt(i, ZERO); continue; }
      const dir = _c.copy(this.Up[i]).multiplyScalar(0.55).addScaledVector(this.T[i], -0.85).normalize();
      q.setFromUnitVectors(Y, dir);
      const h = (r / 2.35) * (i < 20 ? 1.35 : 1) * (0.85 + 0.15 * Math.sin(i * 1.7));
      m.compose(_d.copy(this.pts[i]).addScaledVector(this.Up[i], r * 0.86), q, sc.set(h, h, h));
      this.spines.setMatrixAt(i, m);
    }
    this.spines.instanceMatrix.needsUpdate = true;

    // ---- mane strands flow back and ripple
    this.strands.forEach((S, k) => {
      const i = Math.min(N, S.ring), r = this.rad[i];
      const ca = Math.cos(S.a), sa = Math.sin(S.a);
      const out = _c.copy(this.Up[i]).multiplyScalar(ca).addScaledVector(this.Rt[i], sa);
      let dir;
      if (S.tail) dir = _d.copy(this.T[i]).multiplyScalar(-1).addScaledVector(out, 0.55 + 0.2 * Math.sin(t * 3 + S.ph)).normalize();
      else dir = _d.copy(this.T[i]).multiplyScalar(-1.1).addScaledVector(out, 0.55 + 0.2 * Math.sin(t * 4 + S.ph + i * 0.3)).normalize();
      q.setFromUnitVectors(Y, dir);
      m.compose(_e.copy(this.pts[i]).addScaledVector(out, r * 0.8), q, sc.set(1, S.len, 1));
      this.mane.setMatrixAt(k, m);
    });
    this.mane.instanceMatrix.needsUpdate = true;

    // ---- legs (tucked, paddling slowly)
    for (const L of this.legs) {
      const i = L.ri, r = this.rad[i];
      const xA = _c.copy(this.Rt[i]).multiplyScalar(L.s);
      const zA = _d.copy(this.T[i]).multiplyScalar(-L.s);
      const yA = _e.crossVectors(zA, xA).normalize();
      L.g.matrix.makeBasis(xA, yA, zA);
      const sw = Math.sin(t * 2.4 + i * 0.1 + (L.s > 0 ? 0 : Math.PI)) * 0.18;
      _m2.makeRotationX(sw * L.s); L.g.matrix.multiply(_m2);
      L.g.matrix.setPosition(_f.copy(this.pts[i]).addScaledVector(this.Rt[i], L.s * r * 0.7).addScaledVector(this.Up[i], -r * 0.35));
      L.g.matrixWorldNeedsUpdate = true;
    }

    // hit flash
    this.hit = Math.max(0, this.hit - dt * 4);
    this.mats.body.userData.hit.value = this.hit;
    this.mats.head.emissive.setScalar(this.hit * 0.8); this.mats.limb.emissive.setScalar(this.hit * 0.8);
  }

  _frames(pts) {
    // tangent toward the head; up parallel-transported from the head and eased toward world up
    for (let i = 0; i <= N; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)];
      this.T[i].subVectors(a, b); if (this.T[i].lengthSq() < 1e-8) this.T[i].copy(this.fwd); this.T[i].normalize();
    }
    let prev = this.up;
    for (let i = 0; i <= N; i++) {
      const T = this.T[i], Upi = this.Up[i];
      Upi.copy(prev).addScaledVector(T, -prev.dot(T));
      _c.copy(Y).addScaledVector(T, -Y.dot(T));
      if (_c.lengthSq() > 1e-4) Upi.lerp(_c.normalize(), 0.035);
      if (Upi.lengthSq() < 1e-6) Upi.copy(Y);
      Upi.normalize();
      this.Rt[i].crossVectors(T, Upi).normalize();
      prev = Upi;
    }
  }

  // nearest body sample to point p: distance minus radius (negative = inside)
  hitTest(p, extra = 0) {
    if (p.distanceToSquared(this.pos) < (3.5 + extra) ** 2) return 0;
    for (let i = 0; i <= N; i += 2) {
      const r = this.rad[i] + extra;
      if (this.pts[i].distanceToSquared(p) < r * r) return i;
    }
    return -1;
  }
  // distance from segment a->b to the dragon (cheap: sampled points)
  segDist(a, b) {
    let best = Infinity;
    const ab = _c.subVectors(b, a), L2 = ab.lengthSq();
    const test = (p, r) => {
      const t = Math.max(0, Math.min(1, _d.subVectors(p, a).dot(ab) / L2));
      const d = _e.copy(a).addScaledVector(ab, t).distanceTo(p) - r;
      if (d < best) best = d;
    };
    test(this.pos, 3);
    for (let i = 0; i <= N; i += 3) test(this.pts[i], this.rad[i]);
    return best;
  }

  setVisible(v) { this.body.visible = this.head.visible = this.spines.visible = this.mane.visible = v; for (const L of this.legs) L.g.visible = v; }
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
export const DRAGON_N = N;
