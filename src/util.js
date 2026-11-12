import * as THREE from 'three';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (k, dt) => 1 - Math.exp(-k * dt);

// deterministic RNG so the city is the same every run
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const Y = new THREE.Vector3(0, 1, 0);

// shared shader time + global uniforms
export const U = { uTime: { value: 0 } };

// rotate unit vector `v` toward unit vector `target` by at most `maxAng` radians (in place)
const _q = new THREE.Quaternion(), _a = new THREE.Vector3();
export function turnToward(v, target, maxAng) {
  const d = clamp(v.dot(target), -1, 1), ang = Math.acos(d);
  if (ang < 1e-5) return v.copy(target);
  if (ang <= maxAng) return v.copy(target);
  _a.crossVectors(v, target);
  if (_a.lengthSq() < 1e-10) _a.set(0, 1, 0).cross(v); // opposite: pick any perpendicular
  _a.normalize();
  _q.setFromAxisAngle(_a, maxAng);
  return v.applyQuaternion(_q).normalize();
}

// GLSL snippets shared by custom materials
export const GLSL_COMMON = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
vec3 bumpN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd){
  vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm); vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * fd;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;
