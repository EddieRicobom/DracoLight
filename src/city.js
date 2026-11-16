import * as THREE from 'three';
import { rng, clamp, smooth, U, GLSL_COMMON } from './util.js';

// ---------------------------------------------------------------------------------------------
// The city is a voxel grid of 5 m chunks. Every building is a hollow shell of chunks drawn by one
// InstancedMesh; a chunk lives in `grid` so destruction, ray casts and collapse are lookups.
// ---------------------------------------------------------------------------------------------
export const CH = 5;
const NB = 60, ROAD = 20, BLOCK = 70, PITCH = ROAD + BLOCK;
const CORE_HALF = 450, DISTRICT_BLOCKS = 10;
export const HALF = (NB * PITCH) / 2;            // 2700
const OX = -HALF, OZ = -HALF;
const GX = (NB * PITCH) / CH, GZ = GX, GY = 64; // 1080 x 64 x 1080
// Same fixed direction as the sunlight in main.js. Visibility is traced once per
// streamed chunk face, not in the fragment shader or on every frame.
const SUN_DIR = new THREE.Vector3(-180, 260, 130).normalize();
const SUN_RAY_LENGTH = GY * CH / SUN_DIR.y + CH;

// Shared diffuse maps use world-space coordinates across instance boundaries.
const textureLoader = new THREE.TextureLoader();
function surfaceMaps(name) {
  const diff = textureLoader.load(`${import.meta.env?.BASE_URL ?? '/'}textures/${name}_diff.jpg`);
  diff.wrapS = diff.wrapT = THREE.RepeatWrapping;
  diff.anisotropy = 4;
  diff.colorSpace = THREE.SRGBColorSpace;
  return { diff };
}
const asphalt = surfaceMaps('asphalt_02');
const concrete = surfaceMaps('rough_concrete');

// ------------------------------------- building material -------------------------------------
function buildingMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
  m.userData.cityPaint = true;
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.uTime;
    s.uniforms.uSurfaceColor = { value: concrete.diff };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aInfo; attribute float aBurn; attribute vec4 aPaint; attribute vec3 aSun;
        varying vec3 vWP; varying vec3 vWN; varying vec2 vInfo; varying float vBurn; varying vec4 vPaint; varying vec3 vSun;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { mat4 im = modelMatrix;
          #ifdef USE_INSTANCING
            im = modelMatrix * instanceMatrix;
          #endif
          vWP = (im * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(im) * normal); }
        vInfo = aInfo; vBurn = aBurn; vPaint = aPaint; vSun = aSun;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform sampler2D uSurfaceColor;
        varying vec3 vWP; varying vec3 vWN; varying vec2 vInfo; varying float vBurn; varying vec4 vPaint; varying vec3 vSun;
        vec4 cityPaint;
        ${GLSL_COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        cityPaint = vPaint;
        {
          vec3 N = normalize(vWN);
          float roof = step(0.7, N.y), bot = step(N.y, -0.7);
          vec2 fc = abs(N.x) > 0.5 ? vWP.zy : vWP.xy;
          float st = vInfo.x, seed = vInfo.y;
          float glassT = step(st, 0.5), office = step(0.5, st) * step(st, 1.5), brick = step(1.5, st);
          vec2 sp = mix(mix(vec2(2.5, 3.333), vec2(2.5, 3.333), office), vec2(1.666, 3.333), glassT);
          bool shop = vWP.y < 4.8;
          if (shop) sp = vec2(5.0, 5.0);
          vec2 g = fc / sp, id = floor(g), f = fract(g);
          vec2 lo = glassT > .5 ? vec2(.04, .07) : office > .5 ? vec2(.1, .3) : vec2(.24, .22);
          vec2 hi = glassT > .5 ? vec2(.96, .93) : office > .5 ? vec2(.9, .88) : vec2(.76, .82);
          if (shop) { lo = vec2(.06, .08); hi = vec2(.94, .72); }
          float wx = smoothstep(lo.x, lo.x + .02, f.x) * smoothstep(hi.x, hi.x - .02, f.x);
          float wy = smoothstep(lo.y, lo.y + .02, f.y) * smoothstep(hi.y, hi.y - .02, f.y);
          float win = wx * wy * (1. - roof) * (1. - bot);
          float h = hash12(id + seed * 37.1 + N.xz * 13.7);
          float lit = step(shop ? 0.25 : 0.6, h) * win;
          // World-space pattern stays aligned when individual facade chunks are removed.
          float grime = 0.83 + 0.19 * vnoise(fc * vec2(0.31, 0.11) + seed * 9.)
            + 0.06 * vnoise(fc * vec2(1.7, 0.27) + seed * 23.);
          grime -= 0.11 * (1. - smoothstep(0., 12., vWP.y));
          vec3 base = diffuseColor.rgb * grime;
          vec3 concreteColor = texture2D(uSurfaceColor, fc / 4.0).rgb;
          float concreteGrain = dot(concreteColor, vec3(.2126, .7152, .0722));
          base *= mix(1.0, .55 + concreteGrain, mix(.65, .9, office));
          float joint = 1. - smoothstep(.012, .025, min(f.x, 1. - f.x));
          joint = max(joint, 1. - smoothstep(.012, .025, min(f.y, 1. - f.y)));
          float brickCourse = 1. - smoothstep(.015, .045, fract(fc.y / .38));
          float brickBond = 1. - smoothstep(.012, .035, fract(fc.x / .82 + mod(floor(fc.y / .38), 2.) * .5));
          base *= 1. - brick * (0.2 * brickCourse + 0.12 * brickBond);
          base *= 1. - office * joint * .17;
          float reflected = .55 + .35 * vnoise(fc * vec2(.09, .22) + seed * 17.)
            + .13 * hash12(id + seed * 4.);
          vec3 glass = mix(vec3(.035, .052, .073), vec3(.12, .19, .25), glassT) * reflected;
          glass += vec3(.055, .075, .09) * pow(1. - abs(dot(N, normalize(vWP - vec3(0., 120., 0.)))), 2.);
          base = mix(base, glass, win);
          // Narrow dark mullions and horizontal floor bands define the window scale.
          float mullion = win * (1. - smoothstep(.018, .045, abs(fract(f.x * 2.) - .5)));
          float sill = (1. - roof) * (1. - bot) * (1. - smoothstep(.015, .055, abs(f.y - hi.y)));
          float frame = max(mullion, sill * .8);
          base = mix(base, glassT > .5 ? vec3(.085, .1, .115) : vec3(.18, .19, .2), frame * .82);
          float roofGrain = .75 + .35 * vnoise(vWP.xz * .28);
          float roofSeam = 1. - smoothstep(.012, .045, fract(vWP.x / 5.));
          vec3 roofC = vec3(.19, .195, .2) * roofGrain * (1. - .12 * roofSeam);
          base = mix(base, roofC, roof);
          float burn = vBurn;
          base *= 1. - 0.88 * smoothstep(0., 1., burn) * (0.75 + 0.25 * vnoise(vWP.xy * 0.9 + vWP.zz));
          // Static solar occlusion feeds the halftone pass; the three channels
          // belong to roof, -X and +Z.
          float sunVisibility = roof * vSun.x
            + step(N.x, -0.7) * vSun.y + step(0.7, N.z) * vSun.z;
          diffuseColor.rgb = base * mix(0.68, 1.0, clamp(sunVisibility, 0.0, 1.0));
          float hh = hash12(floor(vWP.xy * 0.3) + floor(vWP.zz * 0.3));
          vec3 warm = mix(vec3(1.0, 0.62, 0.32), vec3(0.75, 0.86, 1.0), step(0.82, hh));
          diffuseColor.rgb += lit * (1. - step(0.25, burn)) * warm * (shop ? 1.5 : 0.8);
          float ember = smoothstep(0.35, 1.0, burn);
          float fl = 0.55 + 0.45 * sin(uTime * 6.0 + vWP.y * 1.7 + vWP.x * 0.9) * vnoise(vWP.xy * 0.7 + uTime);
          diffuseColor.rgb += vec3(1.0, 0.32, 0.05) * ember * fl * 1.2 * vnoise(vWP.xz * 0.8 + vWP.yy * 0.5);
        }`);
  };
  return m;
}

function propPaintMaterial(material) {
  material.userData.cityPaint = true;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPaint; varying vec4 vPaint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = aPaint;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vPaint; vec4 cityPaint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ncityPaint = vPaint;');
  };
  return material;
}

// scorch decals painted on the ground in a 1024² canvas covering the whole city
const scorch = { canvas: null, ctx: null, tex: null, dirty: false, t: 0 };
const paint = { canvas: null, ctx: null, tex: null, dirty: false, t: 0.15 };
const groundSun = { canvas: null, tex: null };
function scorchPatch(m, paving = false, maps = asphalt) {
  m.userData.cityPaint = true;
  m.userData.cityGround = true;
  m.userData.cityPaving = paving;
  m.onBeforeCompile = (s) => {
    s.uniforms.uScorch = { value: scorch.tex };
    s.uniforms.uCityPaint = { value: paint.tex };
    s.uniforms.uCitySun = { value: groundSun.tex };
    s.uniforms.uSurfaceColor = { value: maps.diff };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vSW;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 w = modelMatrix * vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            w = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #endif
          vSW = w.xz; }`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nuniform sampler2D uScorch; uniform sampler2D uCityPaint; uniform sampler2D uCitySun; uniform sampler2D uSurfaceColor; varying vec2 vSW; vec4 cityPaint;\n${GLSL_COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec2 su = (vSW + ${HALF.toFixed(1)}) / ${(2 * HALF).toFixed(1)};
          cityPaint = (su.x >= 0. && su.x <= 1. && su.y >= 0. && su.y <= 1.) ? texture2D(uCityPaint, vec2(su.x, 1. - su.y)) : vec4(0.);
          float sc = (su.x > 0. && su.x < 1. && su.y > 0. && su.y < 1.) ? texture2D(uScorch, vec2(su.x, 1. - su.y)).r : 0.;
          float grain = .91 + .13 * vnoise(vSW * 1.2) + .06 * vnoise(vSW * 4.);
          ${paving ? `vec2 tile = fract(vSW / 2.5);
          float mortar = 1. - smoothstep(.025, .07, min(min(tile.x, tile.y), min(1. - tile.x, 1. - tile.y)));
          grain *= 1. - .15 * mortar;
          grain *= .94 + .12 * hash12(floor(vSW / 2.5));` : ''}
          vec2 surfaceUV = vSW / ${paving ? '4.0' : '12.0'};
          vec3 surfaceColor = texture2D(uSurfaceColor, surfaceUV).rgb;
          float amount = ${paving ? '.55' : 'clamp((.52 - dot(diffuseColor.rgb, vec3(.333))) * 3.0, .12, .8)'};
          diffuseColor.rgb *= mix(vec3(1.0), surfaceColor * ${paving ? '1.6' : '2.0'}, amount);
          float bakedGroundSun = (su.x >= 0. && su.x <= 1. && su.y >= 0. && su.y <= 1.)
            ? texture2D(uCitySun, vec2(su.x, 1. - su.y)).r : 1.;
          diffuseColor.rgb *= (1. - 0.85 * sc) * grain * bakedGroundSun; }`);
  };
  return m;
}

export class City {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    // Only occupied voxels need an entry. A dense 5.4 km grid would reserve 224 MB.
    this.grid = new Map();
    this.score = 0;
    this.buildings = [];
    this._dirtyB = new Set(); this._collapseT = 0;
    this.sunPending = new Set();
    this.sunShadowPending = new Set();
    this.groundSunDirty = false; this.groundSunTimer = 0;
    this._buildScorch();
    this._buildPaint();
    this._buildGround();
    this._layout();
    this._bakeGroundSun();
    this._buildChunks();
    this._buildDebris();
    this._buildSkyline();
    this._buildDistrictProxies();
    for (let i = 0; i < 9; i++) this._streamDistricts({ x: 0, z: 0 });
  }

  // ---------------------------------------------------------------- ground, roads, blocks
  _buildScorch() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1024, 1024);
    scorch.canvas = c; scorch.ctx = ctx; scorch.tex = new THREE.CanvasTexture(c);
    scorch.tex.colorSpace = THREE.NoColorSpace;
  }
  _buildPaint() {
    const c = document.createElement('canvas'); c.width = c.height = 2048;
    paint.canvas = c; paint.ctx = c.getContext('2d'); paint.tex = new THREE.CanvasTexture(c);
    paint.tex.colorSpace = THREE.SRGBColorSpace;
    paint.t = 0.15;
    this.paintTexture = paint.tex;
  }
  _bakeGroundSun() {
    const size = 1024, canvas = groundSun.canvas ?? document.createElement('canvas');
    if (!groundSun.canvas) canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d'), scale = size / (2 * HALF);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'darken';
    ctx.fillStyle = '#adadad';
    for (let index = 0; index < this.lots.length; index++) {
      const lot = this.lots[index], building = this.buildings[index];
      const height = building ? lot.h * building.alive / building.cells.length : lot.h;
      if (height <= 0) continue;
      const x0 = (lot.x + HALF) * scale, z0 = (lot.z + HALF) * scale;
      const x1 = x0 + lot.w * scale, z1 = z0 + lot.d * scale;
      const dx = -SUN_DIR.x / SUN_DIR.y * height * CH * scale;
      const dz = -SUN_DIR.z / SUN_DIR.y * height * CH * scale;
      ctx.beginPath(); ctx.moveTo(x0, z0); ctx.lineTo(x0, z1);
      ctx.lineTo(x1, z1); ctx.lineTo(x1 + dx, z1 + dz);
      ctx.lineTo(x1 + dx, z0 + dz); ctx.lineTo(x0 + dx, z0 + dz);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (!groundSun.tex) {
      groundSun.canvas = canvas;
      groundSun.tex = new THREE.CanvasTexture(canvas);
      groundSun.tex.colorSpace = THREE.NoColorSpace;
    } else groundSun.tex.needsUpdate = true;
  }
  // Paint survives district streaming. Color is any value accepted by THREE.Color.
  paintSphere(position, radius, color) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) ||
        !Number.isFinite(position.z) || !Number.isFinite(radius) || radius <= 0) return 0;
    // The paintable road, props and voxel buildings all lie inside this volume.
    const edge = HALF + ROAD / 2;
    if (position.y - radius > GY * CH || position.y + radius < 0 ||
        position.x - radius > edge || position.x + radius < -edge ||
        position.z - radius > edge || position.z + radius < -edge) return 0;
    const ink = _paintColor.set(color);
    const rgba = [ink.r, ink.g, ink.b].map(v => Math.round(clamp(v, 0, 1) * 255));
    const x0 = Math.max(0, Math.floor((position.x - radius - OX) / CH));
    const x1 = Math.min(GX - 1, Math.floor((position.x + radius - OX) / CH));
    const y0 = Math.max(0, Math.floor((position.y - radius) / CH));
    const y1 = Math.min(GY - 1, Math.floor((position.y + radius) / CH));
    const z0 = Math.max(0, Math.floor((position.z - radius - OZ) / CH));
    const z1 = Math.min(GZ - 1, Math.floor((position.z + radius - OZ) / CH));
    let count = 0;
    const rr = radius * radius;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = this.grid.get(this.gi(x, y, z));
      if (i === undefined) continue;
      const dx = Math.max(OX + x * CH - position.x, 0, position.x - OX - (x + 1) * CH);
      const dy = Math.max(y * CH - position.y, 0, position.y - (y + 1) * CH);
      const dz = Math.max(OZ + z * CH - position.z, 0, position.z - OZ - (z + 1) * CH);
      if (dx * dx + dy * dy + dz * dz > rr) continue;
      const o = i * 4;
      if (this.paintData[o] === rgba[0] && this.paintData[o + 1] === rgba[1] &&
          this.paintData[o + 2] === rgba[2] && this.paintData[o + 3] === 255) continue;
      this.paintData[o] = rgba[0]; this.paintData[o + 1] = rgba[1];
      this.paintData[o + 2] = rgba[2]; this.paintData[o + 3] = 255;
      const part = this.meshes[this.chunkPart[i]];
      if (part.paintAttribute) {
        const local = this.chunkLocal[i], target = part.paintAttribute.array, p = local * 4;
        target[p] = rgba[0]; target[p + 1] = rgba[1]; target[p + 2] = rgba[2]; target[p + 3] = 255;
        const d = part.paintDirty;
        if (local < d[0]) d[0] = local; if (local > d[1]) d[1] = local;
      }
      count++;
    }
    // Props are not streamed; each mesh has one compact paint attribute per instance.
    if (position.y - radius <= 11 && position.y + radius >= 0) {
      const reach = radius + 4;
      for (let gx = Math.floor((position.x - reach) / 10); gx <= Math.floor((position.x + reach) / 10); gx++)
        for (let gz = Math.floor((position.z - reach) / 10); gz <= Math.floor((position.z + reach) / 10); gz++) {
          const ids = this.propHash.get(`${gx},${gz}`);
          if (!ids) continue;
          for (const id of ids) {
            const prop = this.props[id]; if (!prop.alive) continue;
            const width = prop.type === 0 ? 3.5 : prop.type === 2 ? 2.5 : 0.8;
            const bottom = prop.type === 0 ? 0 : 0.3, top = prop.type === 0 ? 10 : prop.type === 1 ? 8.5 : 2;
            const dx = Math.max(0, Math.abs(prop.x - position.x) - width);
            const dz = Math.max(0, Math.abs(prop.z - position.z) - width);
            const dy = Math.max(bottom - position.y, 0, position.y - top);
            if (dx * dx + dy * dy + dz * dz > rr) continue;
            let changed = false;
            for (let part = 0; part < this.propPaintAttrs[prop.type].length; part++) {
              if (prop.type === 0 && ((part === 0 && position.y - radius > 5) || (part === 1 && position.y + radius < 3))) continue;
              const attr = this.propPaintAttrs[prop.type][part], o = prop.idx * 4;
              if (attr.array[o] === rgba[0] && attr.array[o + 1] === rgba[1] &&
                  attr.array[o + 2] === rgba[2] && attr.array[o + 3] === 255) continue;
              attr.array[o] = rgba[0]; attr.array[o + 1] = rgba[1];
              attr.array[o + 2] = rgba[2]; attr.array[o + 3] = 255;
              attr.addUpdateRange(o, 4);
              attr.needsUpdate = true;
              changed = true;
            }
            if (changed) count++;
          }
        }
    }
    if (position.y - radius <= 0 && position.y + radius >= 0) {
      const groundRadius = Math.sqrt(Math.max(0, rr - position.y * position.y));
      const scale = paint.canvas.width / (2 * HALF);
      const px = (position.x + HALF) * scale, pz = (position.z + HALF) * scale;
      if (groundRadius > 0 && px + groundRadius * scale >= 0 && px - groundRadius * scale <= paint.canvas.width &&
          pz + groundRadius * scale >= 0 && pz - groundRadius * scale <= paint.canvas.height) {
        paint.ctx.fillStyle = `#${ink.getHexString(THREE.SRGBColorSpace)}`;
        paint.ctx.beginPath(); paint.ctx.arc(px, pz, groundRadius * scale, 0, Math.PI * 2); paint.ctx.fill();
        paint.dirty = true;
        count++;
      }
    }
    return count;
  }
  clearPaint() {
    this.paintData.fill(0);
    for (const part of this.meshes) if (part.paintAttribute) {
      part.paintAttribute.array.fill(0);
      part.paintDirty = [0, part.ids.length - 1];
    }
    for (const group of this.propPaintAttrs) for (const attr of group) {
      attr.array.fill(0); attr.clearUpdateRanges(); attr.needsUpdate = true;
    }
    paint.ctx.clearRect(0, 0, paint.canvas.width, paint.canvas.height);
    paint.tex.needsUpdate = true; paint.dirty = false; paint.t = 0.15;
  }
  paintScorch(x, z, r, a = 0.7) {
    const px = ((x + HALF) / (2 * HALF)) * 1024, pz = ((z + HALF) / (2 * HALF)) * 1024, pr = (r / (2 * HALF)) * 1024;
    if (px < -pr || px > 1024 + pr || pz < -pr || pz > 1024 + pr) return;
    const g = scorch.ctx.createRadialGradient(px, pz, 0, px, pz, pr);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.6, `rgba(255,255,255,${a * 0.5})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    scorch.ctx.fillStyle = g; scorch.ctx.beginPath(); scorch.ctx.arc(px, pz, pr, 0, Math.PI * 2); scorch.ctx.fill();
    scorch.dirty = true;
  }

  _buildGround() {
    // far ground
    const farMaterial = new THREE.MeshBasicMaterial({ color: 0xf1f1f1 });
    farMaterial.userData.cityGround = true;
    const far = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2), farMaterial);
    far.position.y = -0.05; this.scene.add(far);

    // road surface with markings (canvas)
    const S = 2048, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), k = S / (2 * HALF), R = rng(7);
    g.fillStyle = '#dadada'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 26000; i++) { const v = 150 + R() * 45 | 0; g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.fillRect(R() * S, R() * S, 2 + R() * 3, 2 + R() * 3); }
    for (let i = 0; i < 260; i++) { g.fillStyle = 'rgba(20,20,22,0.25)'; g.beginPath(); g.ellipse(R() * S, R() * S, 4 + R() * 14, 3 + R() * 8, R() * 3, 0, 7); g.fill(); }
    // Asphalt repair patches and fine transverse seams break up the flat road plane.
    for (let i = 0; i < 410; i++) {
      const x = R() * S, y = R() * S, w = (2 + R() * 11) * k, h = (1 + R() * 4) * k;
      g.fillStyle = R() < .5 ? 'rgba(19,22,24,0.14)' : 'rgba(105,104,100,0.11)';
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(14,15,16,0.12)'; g.lineWidth = .6; g.strokeRect(x, y, w, h);
    }
    g.strokeStyle = 'rgba(17,19,20,0.16)'; g.lineWidth = .7;
    for (let i = 0; i < 460; i++) {
      const x = R() * S, y = R() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - .5) * 9 * k, y + (R() - .5) * 9 * k); g.stroke();
    }
    g.lineWidth = 1.3; g.strokeStyle = 'rgba(235,225,200,0.75)'; g.setLineDash([3 * k, 3 * k]);
    for (let i = 0; i <= NB; i++) {
      const p = (i * PITCH) * k;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
    g.setLineDash([]); g.strokeStyle = 'rgba(230,180,60,0.7)'; g.lineWidth = 1;
    for (let i = 0; i <= NB; i++) {
      const p = (i * PITCH) * k;
      for (const o of [-0.35, 0.35]) {
        g.beginPath(); g.moveTo(p + o * k, 0); g.lineTo(p + o * k, S); g.stroke();
        g.beginPath(); g.moveTo(0, p + o * k); g.lineTo(S, p + o * k); g.stroke();
      }
    }
    // crosswalks
    g.fillStyle = 'rgba(240,235,220,0.8)';
    for (let i = 0; i <= NB; i++) for (let j = 0; j <= NB; j++) {
      const cx = i * PITCH * k, cz = j * PITCH * k, w = ROAD / 2 * k;
      for (let s = -w + 2; s < w - 2; s += 2.4 * k / 1.6) {
        for (const off of [-w - 3 * k, w + 1 * k]) {
          g.fillRect(cx + s, cz + off, 1.2 * k / 1.6 * 1.3, 2 * k);
          g.fillRect(cx + off, cz + s, 2 * k, 1.2 * k / 1.6 * 1.3);
        }
      }
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    // roads are centred on multiples of PITCH from -HALF: shift texture by half a road
    const road = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF + ROAD, 2 * HALF + ROAD).rotateX(-Math.PI / 2),
      scorchPatch(new THREE.MeshBasicMaterial({ map: tex })));
    this.scene.add(road);
    // texture offset so road lines sit on x = -HALF + i*PITCH
    tex.repeat.set((2 * HALF) / (2 * HALF + ROAD), (2 * HALF) / (2 * HALF + ROAD));
    tex.offset.set(-(ROAD / 2) / (2 * HALF + ROAD) * 0, 0);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // simpler: remap plane UVs to world directly
    const uv = road.geometry.attributes.uv, pos = road.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + HALF) / (2 * HALF), 1 - (pos.getZ(i) + HALF) / (2 * HALF));
    tex.repeat.set(1, 1); tex.offset.set(0, 0); tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    // shift so that line i sits at road centre (road centre = -HALF + i*PITCH, blocks start +ROAD/2)
    this.roadTex = tex;
  }

  // -------------------------------------------------------------------- city layout
  _layout() {
    const R = rng(1337);
    // Separate business districts put tall buildings across the whole map.
    // Their compact radii limit the added voxel and active-district cost.
    const towerSites = [
      [-1530, -990], [1350, -1260], [-1080, 1440],
      [1530, 1170], [-1980, 360], [450, 1980], [810, -2070],
    ];
    this.lots = []; this.blocks = [];
    for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) {
      const x0 = OX + i * PITCH + ROAD / 2, z0 = OZ + j * PITCH + ROAD / 2;
      const cx = x0 + BLOCK / 2, cz = z0 + BLOCK / 2, d = Math.hypot(cx, cz);
      const park = (R() < 0.09 && d > 120) || (i === NB / 2 - 1 && j === NB / 2 + 1);
      this.blocks.push({ x0, z0, park });
      if (park) continue;
      const bx = x0 + 5, bz = z0 + 5, bw = BLOCK - 10; // 60 x 60 buildable
      const centre = 1 - smooth(60, 430, d);
      let tower = 0;
      for (const [tx, tz] of towerSites) {
        tower = Math.max(tower, 1 - smooth(80, 400, Math.hypot(cx - tx, cz - tz)));
      }
      const hmax = 25 + 190 * centre * centre + 245 * tower * tower;
      const r = R();
      let rects;
      // Sparse outskirts remain cheap; tower clusters use one varied footprint
      // per block and still respect the road and sidewalk setback.
      if (Math.max(Math.abs(cx), Math.abs(cz)) > CORE_HALF) {
        if (R() > 0.68 + 0.18 * tower) continue;
        const clustered = tower > 0.4 && r < 0.68;
        const w = clustered ? 30 + 5 * ((R() * 3) | 0) : 25 + 5 * ((R() * 2) | 0);
        const dd = clustered ? 30 + 5 * ((R() * 3) | 0) : 25 + 5 * ((R() * 2) | 0);
        const xInset = 5 * ((R() * ((60 - w) / 5 + 1)) | 0);
        const zInset = 5 * ((R() * ((60 - dd) / 5 + 1)) | 0);
        rects = [[bx + xInset, bz + zInset, w, dd]];
      } else if (centre > 0.55 && r < 0.6) rects = [[bx + 5 * ((R() * 2) | 0), bz + 5 * ((R() * 2) | 0), 50 - 5 * ((R() * 3) | 0), 50 - 5 * ((R() * 3) | 0)]];
      else if (r < 0.45) rects = [[bx, bz, 30 - 5 * (R() < .4), 60], [bx + 35, bz, 25, 25 + 5 * ((R() * 2) | 0)], [bx + 35, bz + 35, 25, 25]];
      else rects = [[bx, bz, 25, 25], [bx + 30, bz, 30, 25], [bx, bz + 30, 25, 30], [bx + 30, bz + 30, 30, 30]];
      for (const [x, z, w, dd] of rects) {
        if (R() < 0.08 && rects.length > 1) continue; // plazas
        let h = Math.max(3, Math.round((hmax * (0.35 + 0.65 * R())) / CH));
        if (i === NB / 2 && j === NB / 2 - 1 && w >= 40) h = 44; // landmark tower
        h = Math.min(h, GY - 2);
        const style = h > 16 ? (R() < 0.7 ? 0 : 1) : h > 7 ? (R() < 0.6 ? 1 : 0) : (R() < 0.7 ? 2 : 1);
        this.lots.push({ x, z, w, d: dd, h, style, seed: R() });
      }
    }
  }

  _buildChunks() {
    const cells = []; // [cx,cy,cz,b]
    const palettes = [
      [[0.43, 0.62, 0.65], [0.32, 0.51, 0.57], [0.53, 0.67, 0.67], [0.3, 0.43, 0.5]], // glass towers (mullions)
      [[0.79, 0.73, 0.62], [0.67, 0.68, 0.62], [0.86, 0.79, 0.67], [0.61, 0.63, 0.6]], // office stone
      [[0.72, 0.39, 0.31], [0.78, 0.49, 0.37], [0.62, 0.35, 0.31], [0.77, 0.62, 0.48]],  // brick
    ];
    const R = rng(99);
    this.lots.forEach((L, b) => {
      const cx0 = Math.round((L.x - OX) / CH), cz0 = Math.round((L.z - OZ) / CH);
      const W = L.w / CH, D = L.d / CH;
      const tall = L.h > 18;
      const rectAt = (y) => {
        let s = 0;
        if (tall && W >= 6 && D >= 6) { if (y >= Math.floor(L.h * 0.62)) s = 1; if (y >= Math.floor(L.h * 0.84)) s = 2; }
        else if (L.h > 10 && W >= 5 && D >= 5 && y >= Math.floor(L.h * 0.75)) s = 1;
        return [cx0 + s, cz0 + s, cx0 + W - 1 - s, cz0 + D - 1 - s];
      };
      const col = palettes[L.style][(R() * 4) | 0];
      const bld = { lot: L, cells: [], alive: 0, color: col, top: L.h };
      for (let y = 0; y < L.h; y++) {
        const [ax, az, bx, bz] = rectAt(y);
        const up = y + 1 < L.h ? rectAt(y + 1) : null;
        for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) {
          const edge = x === ax || x === bx || z === az || z === bz;
          const exposed = !up || x < up[0] || x > up[2] || z < up[1] || z > up[3];
          // floor slabs every 6 levels hold the shell together and give the inside a floor
          if (edge || exposed || (y % 6 === 5)) cells.push(x, y, z, b);
        }
      }
      this.buildings.push(bld);
    });

    const n = cells.length / 4; this.nChunks = n;
    const mat = buildingMaterial();
    this.cx = new Int16Array(n); this.cy = new Int16Array(n); this.cz = new Int16Array(n);
    this.cb = new Int32Array(n); this.hp = new Float32Array(n); this.alive = new Uint8Array(n);
    this.paintData = new Uint8Array(n * 4);
    this.sunData = new Uint8Array(n * 3);
    this.sunBaked = new Uint8Array(n);
    const districtCount = NB / DISTRICT_BLOCKS;
    const districtCells = Array.from({ length: districtCount * districtCount }, () => []);
    for (let i = 0; i < n; i++) {
      const x = cells[i * 4], z = cells[i * 4 + 2];
      const district = Math.floor(z * CH / (DISTRICT_BLOCKS * PITCH)) * districtCount +
        Math.floor(x * CH / (DISTRICT_BLOCKS * PITCH));
      districtCells[district].push(i);
    }
    this.meshes = []; this.chunkPart = new Uint8Array(n); this.chunkLocal = new Uint32Array(n);
    this.burnAttr = { array: new Float32Array(n) };
    const m = new THREE.Matrix4(), c = new THREE.Color();
    for (let part = 0; part < districtCells.length; part++) {
      const ids = districtCells[part];
      this.meshes.push({ ids, mesh: null, burnAttribute: null, paintAttribute: null,
        matrixDirty: [Infinity, -1], burnDirty: [Infinity, -1], paintDirty: [Infinity, -1] });
      for (let local = 0; local < ids.length; local++) {
        const i = ids[local]; this.chunkPart[i] = part; this.chunkLocal[i] = local;
        const x = cells[i * 4], y = cells[i * 4 + 1], z = cells[i * 4 + 2], b = cells[i * 4 + 3];
        this.cx[i] = x; this.cy[i] = y; this.cz[i] = z; this.cb[i] = b; this.alive[i] = 1;
        const L = this.lots[b], bld = this.buildings[b];
        this.hp[i] = L.style === 0 ? 70 : 110;
        this.grid.set(this.gi(x, y, z), i);
        bld.cells.push(i); bld.alive++;
      }
    }
    // Reused flood-fill storage keeps repeated collapses allocation-free.
    this._collapseMarks = new Uint32Array(n);
    this._collapseStack = new Int32Array(n);
    this._collapseStamp = 0;

    // block slabs (sidewalks / parks)
    const slab = new THREE.InstancedMesh(new THREE.BoxGeometry(BLOCK, 0.3, BLOCK),
      scorchPatch(new THREE.MeshBasicMaterial({ color: 0xffffff }), true, concrete), this.blocks.length);
    this.blocks.forEach((B, i) => {
      m.makeTranslation(B.x0 + BLOCK / 2, 0.15, B.z0 + BLOCK / 2); slab.setMatrixAt(i, m);
      slab.setColorAt(i, B.park ? c.setRGB(0.30, 0.43, 0.32, THREE.SRGBColorSpace) : c.setRGB(0.64, 0.65, 0.60, THREE.SRGBColorSpace));
    });
    this.scene.add(slab);

    this._buildProps();
    this.buildMat = mat;
  }

  gi(x, y, z) { return (y * GZ + z) * GX + x; }
  _bakeSun(i) {
    if (this.sunBaked[i]) return;
    const x = this.cx[i], y = this.cy[i], z = this.cz[i], o = i * 3;
    this.sunData[o] = this.sunData[o + 1] = this.sunData[o + 2] = 0;
    const wx = OX + (x + 0.5) * CH, wy = (y + 0.5) * CH, wz = OZ + (z + 0.5) * CH;
    const samples = [
      [x, y + 1, z, wx, (y + 1) * CH + 0.02, wz],
      [x - 1, y, z, OX + x * CH - 0.02, wy, wz],
      [x, y, z + 1, wx, wy, OZ + (z + 1) * CH + 0.02],
    ];
    for (let face = 0; face < 3; face++) {
      const [nx, ny, nz, px, py, pz] = samples[face];
      if (nx >= 0 && nx < GX && ny < GY && nz >= 0 && nz < GZ &&
          this.grid.has(this.gi(nx, ny, nz))) continue;
      const origin = _sunOrigin.set(px, py, pz);
      this.sunData[o + face] = this.raycast(origin, SUN_DIR, SUN_RAY_LENGTH) === Infinity ? 255 : 0;
    }
    this.sunBaked[i] = 1;
  }
  _invalidateSunShadow(i) {
    this.sunShadowPending?.add(i);
  }
  _traceSunShadow(i) {
    // Follow the removed block's former shadow. Only nearby surviving cells
    // need their static visibility checked again; unloaded cells bake on load.
    if (!this.sunPending) return;
    const x = OX + (this.cx[i] + 0.5) * CH;
    const y = (this.cy[i] + 0.5) * CH;
    const z = OZ + (this.cz[i] + 0.5) * CH;
    for (let distance = CH * 0.5; distance < SUN_RAY_LENGTH; distance += CH * 0.5) {
      const py = y - SUN_DIR.y * distance;
      if (py < 0) break;
      const gx = Math.floor((x - SUN_DIR.x * distance - OX) / CH);
      const gy = Math.floor(py / CH);
      const gz = Math.floor((z - SUN_DIR.z * distance - OZ) / CH);
      if (gx < 1 || gx >= GX - 1 || gz < 1 || gz >= GZ - 1) break;
      for (const [dx, dy, dz] of SUN_NEIGHBOURS) {
        const j = this.grid.get(this.gi(gx + dx, gy + dy, gz + dz));
        if (j === undefined) continue;
        this.sunBaked[j] = 0;
        if (this.meshes[this.chunkPart[j]].mesh) this.sunPending.add(j);
      }
    }
  }
  _loadDistrict(part) {
    const P = this.meshes[part], ids = P.ids;
    if (P.mesh || !ids.length) return;
    const geo = new THREE.BoxGeometry(CH, CH, CH);
    const info = new Float32Array(ids.length * 2), burn = new Float32Array(ids.length);
    const color = new Uint8Array(ids.length * 4);
    const mesh = new THREE.InstancedMesh(geo, this.buildMat, ids.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const burnAttribute = new THREE.InstancedBufferAttribute(burn, 1);
    const paintAttribute = new THREE.InstancedBufferAttribute(color, 4, true);
    const sun = new Uint8Array(ids.length * 3);
    burnAttribute.setUsage(THREE.DynamicDrawUsage);
    paintAttribute.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 2));
    geo.setAttribute('aBurn', burnAttribute);
    geo.setAttribute('aPaint', paintAttribute);
    geo.setAttribute('aSun', new THREE.InstancedBufferAttribute(sun, 3, true));
    const m = new THREE.Matrix4(), c = new THREE.Color();
    for (let local = 0; local < ids.length; local++) {
      const i = ids[local], x = this.cx[i], y = this.cy[i], z = this.cz[i], b = this.cb[i];
      const L = this.lots[b], B = this.buildings[b];
      if (this.alive[i]) m.makeTranslation(OX + (x + 0.5) * CH, (y + 0.5) * CH, OZ + (z + 0.5) * CH);
      else m.copy(ZERO);
      mesh.setMatrixAt(local, m);
      const k = 0.93 + 0.1 * ((x * 7 + z * 13 + b) % 5) / 5;
      c.setRGB(B.color[0] * k, B.color[1] * k, B.color[2] * k, THREE.SRGBColorSpace);
      mesh.setColorAt(local, c);
      info[local * 2] = L.style; info[local * 2 + 1] = L.seed;
      burn[local] = this.burnAttr.array[i];
      const source = i * 4, target = local * 4;
      color[target] = this.paintData[source]; color[target + 1] = this.paintData[source + 1];
      color[target + 2] = this.paintData[source + 2]; color[target + 3] = this.paintData[source + 3];
      const sunSource = i * 3, sunTarget = local * 3;
      if (this.sunBaked[i]) {
        sun[sunTarget] = this.sunData[sunSource]; sun[sunTarget + 1] = this.sunData[sunSource + 1];
        sun[sunTarget + 2] = this.sunData[sunSource + 2];
      } else if (this.alive[i]) {
        sun[sunTarget] = sun[sunTarget + 1] = sun[sunTarget + 2] = 255;
        this.sunPending.add(i);
      }
    }
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    P.mesh = mesh; P.burnAttribute = burnAttribute; P.paintAttribute = paintAttribute;
    P.matrixDirty = [Infinity, -1]; P.burnDirty = [Infinity, -1]; P.paintDirty = [Infinity, -1];
    if (P.proxy) P.proxy.visible = false;
  }
  _unloadDistrict(part) {
    const P = this.meshes[part]; if (!P.mesh) return;
    this.scene.remove(P.mesh);
    P.mesh.geometry.dispose(); P.mesh.dispose();
    P.mesh = null; P.burnAttribute = null; P.paintAttribute = null;
    if (P.proxy) { P.proxy.visible = true; P.proxyDirty = true; }
  }
  _refreshProxy(P) {
    if (!P.proxy || !P.proxyDirty) return;
    const m = new THREE.Matrix4();
    P.proxyIds.forEach((b, local) => {
      const L = this.lots[b], B = this.buildings[b];
      const h = L.h * CH * (B.alive / B.cells.length);
      if (h > 0) m.makeScale(L.w, h, L.d).setPosition(L.x + L.w / 2, h / 2, L.z + L.d / 2);
      else m.copy(ZERO);
      P.proxy.setMatrixAt(local, m);
    });
    P.proxy.instanceMatrix.needsUpdate = true;
    P.proxyDirty = false;
  }
  _buildDistrictProxies() {
    const groups = this.meshes.map(() => []), count = NB / DISTRICT_BLOCKS;
    this.lots.forEach((L, b) => {
      const col = Math.floor((L.x - OX) / (DISTRICT_BLOCKS * PITCH));
      const row = Math.floor((L.z - OZ) / (DISTRICT_BLOCKS * PITCH));
      groups[row * count + col].push(b);
    });
    const proxyMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const m = new THREE.Matrix4(), c = new THREE.Color();
    groups.forEach((ids, part) => {
      if (!ids.length) return;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), proxyMat, ids.length);
      ids.forEach((b, local) => {
        const L = this.lots[b], B = this.buildings[b], h = L.h * CH;
        m.makeScale(L.w, h, L.d).setPosition(L.x + L.w / 2, h / 2, L.z + L.d / 2);
        mesh.setMatrixAt(local, m);
        c.setRGB(B.color[0], B.color[1], B.color[2], THREE.SRGBColorSpace); mesh.setColorAt(local, c);
      });
      this.scene.add(mesh); this.meshes[part].proxy = mesh; this.meshes[part].proxyIds = ids;
    });
  }
  _streamDistricts(focus) {
    if (!focus) return;
    const count = NB / DISTRICT_BLOCKS, width = DISTRICT_BLOCKS * PITCH;
    const col = clamp(Math.floor((focus.x - OX) / width), 0, count - 1);
    const row = clamp(Math.floor((focus.z - OZ) / width), 0, count - 1);
    let next = -1, nearest = Infinity;
    for (let p = 0; p < this.meshes.length; p++) {
      const dx = Math.abs(p % count - col), dz = Math.abs(Math.floor(p / count) - row);
      if (dx > 1 || dz > 1) { this._unloadDistrict(p); this._refreshProxy(this.meshes[p]); continue; }
      if (!this.meshes[p].mesh && this.meshes[p].ids.length && dx + dz < nearest) {
        nearest = dx + dz; next = p;
      }
    }
    if (next >= 0) this._loadDistrict(next);
  }
  chunkAt(px, py, pz) {
    const x = Math.floor((px - OX) / CH), y = Math.floor(py / CH), z = Math.floor((pz - OZ) / CH);
    if (x < 0 || y < 0 || z < 0 || x >= GX || y >= GY || z >= GZ) return -1;
    return this.grid.get(this.gi(x, y, z)) ?? -1;
  }
  chunkCenter(i, out) { return out.set(OX + (this.cx[i] + 0.5) * CH, (this.cy[i] + 0.5) * CH, OZ + (this.cz[i] + 0.5) * CH); }

  // ----------------------------------------------------------------------- props
  _buildProps() {
    const R = rng(4242);
    this.props = []; this.propHash = new Map();
    const trees = [], lamps = [], cars = [];
    for (const B of this.blocks) {
      const outer = Math.max(Math.abs(B.x0 + BLOCK / 2), Math.abs(B.z0 + BLOCK / 2)) > CORE_HALF;
      if (outer && (Math.floor((B.x0 - OX) / PITCH) + Math.floor((B.z0 - OZ) / PITCH)) % 4 !== 0) continue;
      if (B.park) {
        for (let k = 0; k < (outer ? 8 : 26); k++) trees.push([B.x0 + 6 + R() * (BLOCK - 12), B.z0 + 6 + R() * (BLOCK - 12), 0.8 + R() * 0.6]);
      }
      // sidewalk trees and lamps on the perimeter
      for (let s = 6; s < BLOCK - 4; s += outer ? 35 : 14) {
        for (const [x, z] of [[B.x0 + s, B.z0 + 2], [B.x0 + s, B.z0 + BLOCK - 2], [B.x0 + 2, B.z0 + s], [B.x0 + BLOCK - 2, B.z0 + s]]) {
          if (R() < 0.55) trees.push([x, z, 0.6 + R() * 0.3]); else if (R() < 0.6) lamps.push([x, z]);
        }
      }
    }
    // parked cars along the kerbs
    for (let i = 0; i <= NB; i++) for (let j = 0; j < NB; j++) {
      const p = OX + i * PITCH, q0 = OZ + j * PITCH + ROAD / 2 + 4;
      const outer = Math.max(Math.abs(p), Math.abs(q0 + BLOCK / 2)) > CORE_HALF;
      for (let q = q0; q < q0 + BLOCK - 8; q += 6.5) {
        if (R() < (outer ? 0.025 : 0.45)) cars.push([p - 7.2, q, 0, R()]);
        if (R() < (outer ? 0.025 : 0.45)) cars.push([p + 7.2, q, Math.PI, R()]);
        if (R() < (outer ? 0.02 : 0.35)) cars.push([q, p - 7.2, Math.PI / 2, R()]);
        if (R() < (outer ? 0.02 : 0.35)) cars.push([q, p + 7.2, -Math.PI / 2, R()]);
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();

    // maple trees: trunk + three-lobed crown
    const trunkG = new THREE.CylinderGeometry(0.22, 0.35, 4, 6).translate(0, 2, 0);
    const crownG = (() => {
      const g = new THREE.IcosahedronGeometry(2.6, 2); const a = g.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i); const n = 1 + 0.22 * Math.sin(v.x * 2.1 + v.y * 1.3) * Math.cos(v.z * 1.7 - v.y); v.multiplyScalar(n); v.y *= 0.8; a.setXYZ(i, v.x, v.y + 5.4, v.z); }
      g.computeVertexNormals(); return g;
    })();
    const trunk = new THREE.InstancedMesh(trunkG, propPaintMaterial(new THREE.MeshBasicMaterial({ color: 0x3b2a20 })), trees.length);
    const crown = new THREE.InstancedMesh(crownG, propPaintMaterial(new THREE.MeshBasicMaterial({ color: 0xffffff })), trees.length);
    const leaf = [[0.78, 0.28, 0.22], [0.87, 0.42, 0.25], [0.92, 0.62, 0.32], [0.68, 0.30, 0.30], [0.88, 0.51, 0.30]];
    trees.forEach(([x, z, sc], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28); s.setScalar(sc * 1.2);
      m.compose(p.set(x, 0.3, z), q, s); trunk.setMatrixAt(i, m); crown.setMatrixAt(i, m);
      const L = leaf[(R() * leaf.length) | 0]; crown.setColorAt(i, c.setRGB(L[0], L[1], L[2], THREE.SRGBColorSpace));
      this._addProp(0, i, x, z, 0.3 + 2.5 * sc);
    });
    this.scene.add(trunk, crown);

    // street lamps
    const poleG = new THREE.CylinderGeometry(0.1, 0.14, 8, 6).translate(0, 4, 0);
    const headG = new THREE.BoxGeometry(0.5, 0.25, 1.4).translate(0, 8, 0.5);
    const pole = new THREE.InstancedMesh(poleG, propPaintMaterial(new THREE.MeshBasicMaterial({ color: 0x222428 })), lamps.length);
    const head = new THREE.InstancedMesh(headG, propPaintMaterial(new THREE.MeshBasicMaterial({ color: 0xffc27a })), lamps.length);
    lamps.forEach(([x, z], i) => {
      // point the lamp head at the road
      const bx = ((x - OX) % PITCH + PITCH) % PITCH, bz = ((z - OZ) % PITCH + PITCH) % PITCH;
      const ang = bx < ROAD / 2 + 4 ? -Math.PI / 2 : bx > PITCH - ROAD / 2 - 4 ? Math.PI / 2 : bz < ROAD / 2 + 4 ? Math.PI : 0;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang); m.compose(p.set(x, 0.3, z), q, s.setScalar(1));
      pole.setMatrixAt(i, m); head.setMatrixAt(i, m);
      this._addProp(1, i, x, z, 1);
    });
    this.scene.add(pole, head);

    // cars
    const carG = (() => {
      const a = new THREE.BoxGeometry(1.9, 0.75, 4.4).translate(0, 0.75, 0);
      const b = new THREE.BoxGeometry(1.7, 0.6, 2.3).translate(0, 1.42, -0.2);
      const parts = [a, b].map(g => g.toNonIndexed());
      const pos = [], nor = [];
      for (const g of parts) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      return g;
    })();
    const car = new THREE.InstancedMesh(carG, propPaintMaterial(new THREE.MeshBasicMaterial({ color: 0xffffff })), cars.length);
    const carCols = [[0.75, 0.26, 0.23], [0.88, 0.85, 0.76], [0.18, 0.27, 0.3], [0.25, 0.49, 0.55], [0.58, 0.65, 0.63], [0.91, 0.68, 0.31]];
    cars.forEach(([x, z, a, r], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a); m.compose(p.set(x, 0, z), q, s.setScalar(1)); car.setMatrixAt(i, m);
      const C = carCols[(r * carCols.length) | 0]; car.setColorAt(i, c.setRGB(C[0], C[1], C[2], THREE.SRGBColorSpace));
      this._addProp(2, i, x, z, 1);
    });
    this.scene.add(car);
    this.propMeshes = [[trunk, crown], [pole, head], [car]];
    this.propPaintAttrs = this.propMeshes.map(group => group.map(mesh => {
      const attr = new THREE.InstancedBufferAttribute(new Uint8Array(mesh.count * 4), 4, true);
      attr.setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.setAttribute('aPaint', attr);
      return attr;
    }));
    this.propInitialMatrices = this.propMeshes.map(group => group.map(mesh => new Float32Array(mesh.instanceMatrix.array)));
    this.carCols = cars.map(([, , , r]) => carCols[(r * carCols.length) | 0]);
  }
  _addProp(type, idx, x, z, h) {
    const id = this.props.length; this.props.push({ type, idx, x, z, h, alive: true });
    const k = `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
    (this.propHash.get(k) || this.propHash.set(k, []).get(k)).push(id);
  }
  destroyProps(px, py, pz, r) {
    if (py - r > 12) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), v = new THREE.Vector3();
    for (let gx = Math.floor((px - r) / 10); gx <= Math.floor((px + r) / 10); gx++)
      for (let gz = Math.floor((pz - r) / 10); gz <= Math.floor((pz + r) / 10); gz++) {
        const L = this.propHash.get(`${gx},${gz}`); if (!L) continue;
        for (const id of L) {
          const P = this.props[id]; if (!P.alive) continue;
          if ((P.x - px) ** 2 + (P.h - py) ** 2 + (P.z - pz) ** 2 > r * r) continue;
          P.alive = false;
          for (const mesh of this.propMeshes[P.type]) { mesh.setMatrixAt(P.idx, zero); mesh.instanceMatrix.needsUpdate = true; }
          v.set(P.x - px, 2, P.z - pz).normalize();
          if (P.type === 2) { // car: burst into burning wreckage
            const C = this.carCols[P.idx];
            for (let k = 0; k < 4; k++) this.spawnDebris(P.x, 1, P.z, v.x * 18 + (Math.random() - .5) * 10, 10 + Math.random() * 14, v.z * 18 + (Math.random() - .5) * 10, 0.7 + Math.random() * 0.7, C[0] * 0.6, C[1] * 0.6, C[2] * 0.6);
            this.fx && this.fx.burnAt(new THREE.Vector3(P.x, 1, P.z), 6);
          } else if (P.type === 0) {
            for (let k = 0; k < 3; k++) this.spawnDebris(P.x, 3, P.z, v.x * 12 + (Math.random() - .5) * 8, 6 + Math.random() * 8, v.z * 12, 0.5 + Math.random() * 0.6, 0.6, 0.15, 0.05);
          }
        }
      }
  }

  // ----------------------------------------------------------------------- destruction
  _markM(i) {
    const part = this.meshes[this.chunkPart[i]]; part.proxyDirty = true;
    if (!part.mesh) return;
    const d = part.matrixDirty, local = this.chunkLocal[i];
    if (local < d[0]) d[0] = local; if (local > d[1]) d[1] = local;
  }
  _markB(i) {
    const part = this.meshes[this.chunkPart[i]]; if (!part.mesh) return;
    const local = this.chunkLocal[i], d = part.burnDirty;
    part.burnAttribute.array[local] = this.burnAttr.array[i];
    if (local < d[0]) d[0] = local; if (local > d[1]) d[1] = local;
  }

  removeChunk(i, ix = 0, iy = 0, iz = 0, debris = 2) {
    if (!this.alive[i]) return false;
    this.alive[i] = 0; this.grid.delete(this.gi(this.cx[i], this.cy[i], this.cz[i]));
    this._invalidateSunShadow(i);
    const part = this.meshes[this.chunkPart[i]];
    if (part.mesh) part.mesh.setMatrixAt(this.chunkLocal[i], ZERO);
    this._markM(i);
    const b = this.cb[i]; this.buildings[b].alive--; this._dirtyB.add(b);
    this.groundSunDirty = true;
    this.score++;
    if (debris) {
      const x = OX + (this.cx[i] + 0.5) * CH, y = (this.cy[i] + 0.5) * CH, z = OZ + (this.cz[i] + 0.5) * CH;
      const col = this.buildings[b].color, burnt = 1 - 0.8 * this.burnAttr.array[i];
      const big = debris >= 2;
      if (big) this.spawnDebris(x, y, z, ix + rnd(4), iy + rnd(4), iz + rnd(4), CH * (0.55 + Math.random() * 0.25), col[0] * burnt, col[1] * burnt, col[2] * burnt);
      for (let k = 0; k < (big ? 3 : 2); k++)
        this.spawnDebris(x + rnd(2), y + rnd(2), z + rnd(2), ix * 1.3 + rnd(12), iy + rnd(10) + 4, iz * 1.3 + rnd(12), 0.6 + Math.random() * 1.4,
          (k ? 0.18 : col[0]) * burnt, (k ? 0.2 : col[1]) * burnt, (k ? 0.24 : col[2]) * burnt);
      if (Math.random() < 0.5) this.fx && this.fx.dust(_v.set(x, y, z), 1, 0.4);
    }
    return true;
  }

  // break everything inside a sphere; impulse pushes debris outward
  destroySphere(c, r, power = 25, maxN = 400) {
    const x0 = Math.max(0, Math.floor((c.x - r - OX) / CH)), x1 = Math.min(GX - 1, Math.floor((c.x + r - OX) / CH));
    const y0 = Math.max(0, Math.floor((c.y - r) / CH)), y1 = Math.min(GY - 1, Math.floor((c.y + r) / CH));
    const z0 = Math.max(0, Math.floor((c.z - r - OZ) / CH)), z1 = Math.min(GZ - 1, Math.floor((c.z + r - OZ) / CH));
    let n = 0; const rr = (r + CH * 0.5) ** 2;
    outer: for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = this.grid.get(this.gi(x, y, z)) ?? -1; if (i < 0) continue;
      const dx = OX + (x + 0.5) * CH - c.x, dy = (y + 0.5) * CH - c.y, dz = OZ + (z + 0.5) * CH - c.z;
      const d2 = dx * dx + dy * dy + dz * dz; if (d2 > rr) continue;
      const d = Math.sqrt(d2) + 0.01, k = power * (1.2 - Math.min(1, d / (r + CH)));
      this.removeChunk(i, dx / d * k, dy / d * k + k * 0.4, dz / d * k, n < 60 ? 2 : n < 160 ? 1 : 0);
      if (++n >= maxN) break outer;
    }
    this.destroyProps(c.x, c.y, c.z, r);
    if (c.y - r < CH * 2) this.paintScorch(c.x, c.z, Math.max(2, r * 0.8), 0.55);
    return n;
  }

  // heat/flame damage: burns facades and eventually knocks chunks out
  damageSphere(c, r, dmg) {
    const x0 = Math.max(0, Math.floor((c.x - r - OX) / CH)), x1 = Math.min(GX - 1, Math.floor((c.x + r - OX) / CH));
    const y0 = Math.max(0, Math.floor((c.y - r) / CH)), y1 = Math.min(GY - 1, Math.floor((c.y + r) / CH));
    const z0 = Math.max(0, Math.floor((c.z - r - OZ) / CH)), z1 = Math.min(GZ - 1, Math.floor((c.z + r - OZ) / CH));
    let hit = 0, broken = 0;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = this.grid.get(this.gi(x, y, z)) ?? -1; if (i < 0) continue;
      hit++;
      this.hp[i] -= dmg;
      const b = this.burnAttr.array;
      if (b[i] < 1) { b[i] = Math.min(1, b[i] + dmg * 0.012); this._markB(i); }
      if (this.hp[i] <= 0 && this.removeChunk(i, rnd(6), 4, rnd(6), 1)) broken++;
    }
    if (broken && c.y - r < 12) {
      this.destroyProps(c.x, c.y, c.z, r);
      this.paintScorch(c.x, c.z, Math.max(2, r * 0.65), 0.22);
    }
    return hit;
  }

  // voxel DDA through the grid; returns distance to the first chunk or ground (Infinity if none)
  raycast(o, d, maxT, out) {
    let x = Math.floor((o.x - OX) / CH), y = Math.floor(o.y / CH), z = Math.floor((o.z - OZ) / CH);
    const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const tdx = d.x !== 0 ? CH / Math.abs(d.x) : Infinity, tdy = d.y !== 0 ? CH / Math.abs(d.y) : Infinity, tdz = d.z !== 0 ? CH / Math.abs(d.z) : Infinity;
    let tx = d.x !== 0 ? ((x + (sx > 0 ? 1 : 0)) * CH + OX - o.x) / d.x : Infinity;
    let ty = d.y !== 0 ? ((y + (sy > 0 ? 1 : 0)) * CH - o.y) / d.y : Infinity;
    let tz = d.z !== 0 ? ((z + (sz > 0 ? 1 : 0)) * CH + OZ - o.z) / d.z : Infinity;
    const tg = d.y < 0 ? -o.y / d.y : Infinity;
    let t = 0;
    const lim = Math.min(maxT, tg);
    for (let k = 0; k < 600 && t <= lim; k++) {
      if (x >= 0 && y >= 0 && z >= 0 && x < GX && y < GY && z < GZ) {
        const i = this.grid.get(this.gi(x, y, z)) ?? -1;
        if (i >= 0) { if (out) { out.index = i; out.t = t; } return t; }
      }
      if (tx < ty && tx < tz) { t = tx; tx += tdx; x += sx; }
      else if (ty < tz) { t = ty; ty += tdy; y += sy; }
      else { t = tz; tz += tdz; z += sz; }
    }
    if (tg <= maxT) { if (out) { out.index = -1; out.t = tg; } return tg; }
    if (out) { out.index = -1; out.t = Infinity; }
    return Infinity;
  }

  // Ground-connected chunks support a building; each disconnected island falls together.
  _collapse() {
    const marks = this._collapseMarks, stack = this._collapseStack;
    const neighbours = [1, -1, GX, -GX, GX * GZ, -GX * GZ];
    for (const b of this._dirtyB) {
      const B = this.buildings[b]; if (B.alive <= 0) continue;
      if (++this._collapseStamp === 0xffffffff) { marks.fill(0); this._collapseStamp = 1; }
      const grounded = this._collapseStamp;
      let head = 0, tail = 0;
      for (const i of B.cells) if (this.alive[i] && this.cy[i] === 0) { marks[i] = grounded; stack[tail++] = i; }
      while (head < tail) {
        const i = stack[head++], x = this.cx[i], y = this.cy[i], z = this.cz[i];
        const base = this.gi(x, y, z);
        for (let k = 0; k < 6; k++) {
          if ((k === 0 && x === GX - 1) || (k === 1 && x === 0) ||
              (k === 2 && z === GZ - 1) || (k === 3 && z === 0) ||
              (k === 4 && y === GY - 1) || (k === 5 && y === 0)) continue;
          const j = this.grid.get(base + neighbours[k]) ?? -1;
          if (j >= 0 && this.cb[j] === b && marks[j] !== grounded) { marks[j] = grounded; stack[tail++] = j; }
        }
      }
      let falling = 0;
      for (const i of B.cells) {
        if (!this.alive[i] || marks[i] === grounded) continue;
        // Collect a whole island before removing it, so neighbouring pieces share momentum.
        if (++this._collapseStamp === 0xffffffff) { marks.fill(0); this._collapseStamp = 1; }
        const island = this._collapseStamp;
        head = 0; tail = 1; stack[0] = i; marks[i] = island;
        let sumX = 0, sumZ = 0, minY = GY;
        while (head < tail) {
          const q = stack[head++], x = this.cx[q], y = this.cy[q], z = this.cz[q];
          sumX += x; sumZ += z; if (y < minY) minY = y;
          const base = this.gi(x, y, z);
          for (let k = 0; k < 6; k++) {
            if ((k === 0 && x === GX - 1) || (k === 1 && x === 0) ||
                (k === 2 && z === GZ - 1) || (k === 3 && z === 0) ||
                (k === 4 && y === GY - 1) || (k === 5 && y === 0)) continue;
            const j = this.grid.get(base + neighbours[k]) ?? -1;
            if (j >= 0 && this.cb[j] === b && marks[j] !== island && marks[j] !== grounded) { marks[j] = island; stack[tail++] = j; }
          }
        }
        const midX = sumX / tail, midZ = sumZ / tail;
        const driftX = rnd(1.2), driftZ = rnd(1.2), tiltX = rnd(0.018), tiltZ = rnd(0.018), spin = rnd(0.025);
        const debrisStep = Math.max(1, Math.ceil(tail / 1800));
        for (let q = 0; q < tail; q++) {
          const j = stack[q], x = OX + (this.cx[j] + 0.5) * CH, y = (this.cy[j] + 0.5) * CH, z = OZ + (this.cz[j] + 0.5) * CH;
          this.alive[j] = 0; this.grid.delete(this.gi(this.cx[j], this.cy[j], this.cz[j]));
          this._invalidateSunShadow(j);
          const part = this.meshes[this.chunkPart[j]];
          if (part.mesh) part.mesh.setMatrixAt(this.chunkLocal[j], ZERO);
          this._markM(j); B.alive--; this.score++;
          this.groundSunDirty = true;
          if (q % debrisStep === 0) {
            const col = B.color, burnt = 1 - 0.8 * this.burnAttr.array[j];
            this.spawnDebris(x, y, z, driftX + ((this.cy[j] - minY) * tiltX - (this.cz[j] - midZ) * spin) * CH, -2,
              driftZ + ((this.cy[j] - minY) * tiltZ + (this.cx[j] - midX) * spin) * CH, CH * 0.97,
              col[0] * burnt, col[1] * burnt, col[2] * burnt, true);
          }
        }
        falling += tail;
      }
      if (falling > 6) {
        const L = B.lot, x = L.x + L.w * 0.5, z = L.z + L.d * 0.5;
        this.destroyProps(x, 2, z, Math.max(L.w, L.d) * 0.55);
        this.paintScorch(x, z, Math.max(L.w, L.d) * 0.45, 0.35);
        this.fx && this.fx.dust(_v.set(x, Math.max(3, B.top * CH * 0.3), z), Math.min(8, falling / 30), 1);
        this.onCollapse && this.onCollapse(falling, B);
      }
    }
    this._dirtyB.clear();
  }

  // ----------------------------------------------------------------------- debris
  _buildDebris() {
    const N = 9000; this.dN = N;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    const c = new THREE.Color(1, 1, 1); for (let i = 0; i < N; i++) mesh.setColorAt(i, c);
    this.dMesh = mesh; this.scene.add(mesh);
    this.dP = new Float32Array(N * 3); this.dV = new Float32Array(N * 3); this.dQ = new Float32Array(N * 4); this.dW = new Float32Array(N * 3);
    this.dS = new Float32Array(N); this.dL = new Float32Array(N); this.dState = new Uint8Array(N); this.dHeavy = new Uint8Array(N);
    this.dRest = new Int32Array(N); // supporting chunk index + 1, or zero for the ground
    this.dNext = 0; this.dHigh = 0; this.dLive = 0;
  }
  // Restore the original city in place, including districts currently represented by proxies.
  reset() {
    this.clearPaint();
    this.grid.clear();
    const burn = this.burnAttr.array;
    burn.fill(0);
    for (let i = 0; i < this.alive.length; i++) {
      this.alive[i] = 1;
      this.hp[i] = this.lots[this.cb[i]].style === 0 ? 70 : 110;
      this.grid.set(this.gi(this.cx[i], this.cy[i], this.cz[i]), i);
    }
    for (const building of this.buildings) building.alive = building.cells.length;
    this.sunBaked.fill(0); this.sunData.fill(0);
    this.sunPending.clear(); this.sunShadowPending.clear();
    this.groundSunDirty = false; this.groundSunTimer = 0;
    this._bakeGroundSun();
    this.score = 0;
    this._dirtyB.clear(); this._collapseT = 0;

    const matrix = new THREE.Matrix4();
    for (const part of this.meshes) {
      part.proxyDirty = true;
      if (part.mesh) {
        part.ids.forEach((i, local) => {
          matrix.makeTranslation(OX + (this.cx[i] + 0.5) * CH, (this.cy[i] + 0.5) * CH, OZ + (this.cz[i] + 0.5) * CH);
          part.mesh.setMatrixAt(local, matrix);
        });
        part.mesh.instanceMatrix.clearUpdateRanges();
        part.mesh.instanceMatrix.needsUpdate = true;
        part.burnAttribute.array.fill(0);
        part.burnAttribute.clearUpdateRanges();
        part.burnAttribute.needsUpdate = true;
        const sun = part.mesh.geometry.getAttribute('aSun');
        sun.array.fill(255); sun.clearUpdateRanges(); sun.needsUpdate = true;
        for (const i of part.ids) this.sunPending.add(i);
      }
      part.matrixDirty = [Infinity, -1]; part.burnDirty = [Infinity, -1];
      this._refreshProxy(part);
    }
    this.props.forEach(prop => { prop.alive = true; });
    this.propMeshes.forEach((group, type) => group.forEach((mesh, index) => {
      mesh.instanceMatrix.array.set(this.propInitialMatrices[type][index]);
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }));
    this.dState.fill(0);
    this.dRest.fill(0);
    this.dNext = this.dHigh = this.dLive = 0;
    this.dMesh.count = 0;
    scorch.ctx.fillStyle = '#000';
    scorch.ctx.fillRect(0, 0, scorch.canvas.width, scorch.canvas.height);
    scorch.tex.needsUpdate = true;
    scorch.dirty = false; scorch.t = 0;
  }
  spawnDebris(x, y, z, vx, vy, vz, s, r, g, b, heavy = false) {
    // ring allocation: overwrite the oldest slot
    const i = this.dNext; this.dNext = (this.dNext + 1) % this.dN;
    if (i + 1 > this.dHigh) this.dHigh = i + 1;
    this.dP[i * 3] = x; this.dP[i * 3 + 1] = y; this.dP[i * 3 + 2] = z;
    this.dV[i * 3] = vx; this.dV[i * 3 + 1] = vy; this.dV[i * 3 + 2] = vz;
    const q = _q.setFromEuler(_e.set(heavy ? rnd(0.04) : Math.random() * 6, heavy ? rnd(0.04) : Math.random() * 6, heavy ? rnd(0.04) : Math.random() * 6));
    this.dQ[i * 4] = q.x; this.dQ[i * 4 + 1] = q.y; this.dQ[i * 4 + 2] = q.z; this.dQ[i * 4 + 3] = q.w;
    const w = heavy ? 0.08 : 8;
    this.dW[i * 3] = rnd(w); this.dW[i * 3 + 1] = rnd(w); this.dW[i * 3 + 2] = rnd(w);
    this.dS[i] = s; this.dL[i] = 0; this.dState[i] = 1; this.dHeavy[i] = heavy ? 1 : 0; this.dRest[i] = 0;
    this.dMesh.setColorAt(i, _c.setRGB(r, g, b, THREE.SRGBColorSpace)); this.dMesh.instanceColor.needsUpdate = true;
  }
  _updateDebris(dt) {
    const P = this.dP, V = this.dV, Q = this.dQ, W = this.dW, S = this.dS, L = this.dL, st = this.dState, mesh = this.dMesh;
    const arr = mesh.instanceMatrix.array;
    let landedHeavy = 0, impacts = 0, firstDirty = Infinity, lastDirty = -1;
    for (let i = 0; i < this.dHigh; i++) {
      if (!st[i]) continue;
      L[i] += dt;
      // Rubble resting on a destroyed roof resumes falling on the next frame.
      if (st[i] === 2 && this.dRest[i] && !this.alive[this.dRest[i] - 1]) {
        st[i] = 1; L[i] = 0; V[i * 3 + 1] = 0; this.dRest[i] = 0;
      }
      if (st[i] === 2 && L[i] <= 40) continue; // settled rubble needs no matrix upload
      let s = S[i];
      if (st[i] === 1) {
        const p = i * 3;
        const wx = W[p], wy = W[p + 1], wz = W[p + 2];
        _q.set(Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]);
        _q2.set(wx * dt * 0.5, wy * dt * 0.5, wz * dt * 0.5, 1).multiply(_q).normalize();
        Q[i * 4] = _q2.x; Q[i * 4 + 1] = _q2.y; Q[i * 4 + 2] = _q2.z; Q[i * 4 + 3] = _q2.w;
        const qx = _q2.x, qy = _q2.y, qz = _q2.z, qw = _q2.w;
        const halfY = s * 0.5 * (Math.abs(2 * (qx * qy + qz * qw)) +
          Math.abs(1 - 2 * (qx * qx + qz * qz)) + Math.abs(2 * (qy * qz - qx * qw)));
        const oldBottom = P[p + 1] - halfY;
        V[i * 3 + 1] -= 24 * dt;
        const dr = Math.max(0, 1 - 0.15 * dt); V[p] *= dr; V[p + 2] *= dr;
        P[p] += V[p] * dt; P[p + 1] += V[p + 1] * dt; P[p + 2] += V[p + 2] * dt;
        // Sweep the bottom through occupied voxel levels so a fast fragment cannot skip a roof.
        // Only the centre column is sampled; this keeps thousands of fragments inexpensive.
        let support = 0, supportId = 0, bottom = P[p + 1] - halfY;
        if (V[p + 1] < 0 && oldBottom >= 0) {
          const x = Math.floor((P[p] - OX) / CH), z = Math.floor((P[p + 2] - OZ) / CH);
          if (x >= 0 && x < GX && z >= 0 && z < GZ) {
            for (let y = Math.min(GY - 1, Math.floor(oldBottom / CH)); y >= Math.max(0, Math.floor(bottom / CH)); y--) {
              const top = (y + 1) * CH;
              if (oldBottom < top || bottom > top) continue;
              const j = this.grid.get(this.gi(x, y, z)) ?? -1;
              if (j < 0) continue;
              if (this.dHeavy[i] && V[p + 1] < -14 && impacts < 32 &&
                  this.removeChunk(j, V[p] * 0.3, -4, V[p + 2] * 0.3, 1)) {
                impacts++; V[p + 1] *= 0.55;
                continue;
              }
              support = top;
              supportId = j + 1;
              break;
            }
          }
        }
        const floor = support + halfY;
        if (P[p + 1] < floor) {
          P[p + 1] = floor;
          if (V[i * 3 + 1] < -6) {
            if (support === 0 && this.dHeavy[i] && V[i * 3 + 1] < -20) landedHeavy++;
            V[i * 3 + 1] *= -0.25; V[i * 3] *= 0.6; V[i * 3 + 2] *= 0.6; W[i * 3] *= 0.5; W[i * 3 + 1] *= 0.5; W[i * 3 + 2] *= 0.5;
          } else { st[i] = 2; L[i] = 0; this.dRest[i] = supportId; }
        }
        if (L[i] > 20) { st[i] = 2; L[i] = 0; }
      } else if (st[i] === 2) {
        // rubble rests, then sinks away
        if (L[i] > 40) { P[i * 3 + 1] -= dt * 0.6; if (P[i * 3 + 1] < -s) { st[i] = 0; s = 0; } }
      }
      // write matrix (compose from quaternion)
      const x = Q[i * 4], y = Q[i * 4 + 1], z = Q[i * 4 + 2], w = Q[i * 4 + 3];
      const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
      const o = i * 16;
      if (i < firstDirty) firstDirty = i;
      if (i > lastDirty) lastDirty = i;
      if (!st[i]) { for (let k = 0; k < 16; k++) arr[o + k] = 0; continue; }
      arr[o] = (1 - (yy + zz)) * s; arr[o + 1] = (xy + wz) * s; arr[o + 2] = (xz - wy) * s; arr[o + 3] = 0;
      arr[o + 4] = (xy - wz) * s; arr[o + 5] = (1 - (xx + zz)) * s; arr[o + 6] = (yz + wx) * s; arr[o + 7] = 0;
      arr[o + 8] = (xz + wy) * s; arr[o + 9] = (yz - wx) * s; arr[o + 10] = (1 - (xx + yy)) * s; arr[o + 11] = 0;
      arr[o + 12] = P[i * 3]; arr[o + 13] = P[i * 3 + 1]; arr[o + 14] = P[i * 3 + 2]; arr[o + 15] = 1;
    }
    mesh.count = this.dHigh;
    if (lastDirty >= 0) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(firstDirty * 16, (lastDirty - firstDirty + 1) * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (landedHeavy > 0) this.onHeavyLand && this.onHeavyLand(landedHeavy);
  }

  // ----------------------------------------------------------------------- distant skyline
  _buildSkyline() {
    const R = rng(55), n = 420;
    const skylineStart = HALF * Math.SQRT2 + 100;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const info = new Float32Array(n * 2), burn = new Float32Array(n);
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 2));
    geo.setAttribute('aBurn', new THREE.InstancedBufferAttribute(burn, 1));
    geo.setAttribute('aPaint', new THREE.InstancedBufferAttribute(new Uint8Array(n * 4), 4, true));
    geo.setAttribute('aSun', new THREE.InstancedBufferAttribute(new Uint8Array(n * 3).fill(255), 3, true));
    const mesh = new THREE.InstancedMesh(geo, this.buildMat, n);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = skylineStart + R() * 900;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = (20 + R() * 120) * (1 - (d - skylineStart) / 1400 * 0.5), w = 20 + R() * 40;
      m.makeScale(w, h, 20 + R() * 40).setPosition(x, 0, z); mesh.setMatrixAt(i, m);
      const st = h > 70 ? 0 : 1; info[i * 2] = st; info[i * 2 + 1] = R();
      const v = st ? 0.55 : 0.4; c.setRGB(v, v * 1.02, v * 1.08, THREE.SRGBColorSpace); mesh.setColorAt(i, c);
    }
    this.scene.add(mesh);
  }

  // ----------------------------------------------------------------------- per frame
  update(dt, focus) {
    this._streamDistricts(focus);
    this.groundSunTimer += dt;
    if (this.groundSunDirty && this.groundSunTimer >= 0.5) {
      this._bakeGroundSun(); this.groundSunDirty = false; this.groundSunTimer = 0;
    }
    if (this.sunShadowPending?.size) {
      const deadline = performance.now() + 1;
      for (const i of this.sunShadowPending) {
        this.sunShadowPending.delete(i);
        this._traceSunShadow(i);
        if (performance.now() >= deadline) break;
      }
    }
    if (this.sunPending?.size) {
      let baked = 0;
      const deadline = performance.now() + 2;
      for (const i of this.sunPending) {
        this.sunPending.delete(i);
        if (!this.alive[i]) continue;
        const part = this.meshes[this.chunkPart[i]];
        if (!part.mesh) continue;
        this._bakeSun(i);
        const local = this.chunkLocal[i], target = local * 3, source = i * 3;
        const attr = part.mesh.geometry.getAttribute('aSun');
        attr.array[target] = this.sunData[source];
        attr.array[target + 1] = this.sunData[source + 1];
        attr.array[target + 2] = this.sunData[source + 2];
        attr.addUpdateRange(target, 3); attr.needsUpdate = true;
        if (++baked >= 96 || performance.now() >= deadline) break;
      }
    }
    this._collapseT += dt;
    if (this._dirtyB.size && this._collapseT > 0.12) { this._collapseT = 0; this._collapse(); }
    this._updateDebris(dt);
    for (const part of this.meshes) {
      const m = part.matrixDirty, b = part.burnDirty, p = part.paintDirty;
      if (part.mesh && m[1] >= 0) {
        const a = part.mesh.instanceMatrix; a.clearUpdateRanges();
        a.addUpdateRange(m[0] * 16, (m[1] - m[0] + 1) * 16); a.needsUpdate = true;
        m[0] = Infinity; m[1] = -1;
      }
      if (part.mesh && b[1] >= 0) {
        const a = part.burnAttribute; a.clearUpdateRanges();
        a.addUpdateRange(b[0], b[1] - b[0] + 1); a.needsUpdate = true;
        b[0] = Infinity; b[1] = -1;
      }
      if (part.mesh && p[1] >= 0) {
        const a = part.paintAttribute; a.clearUpdateRanges();
        a.addUpdateRange(p[0] * 4, (p[1] - p[0] + 1) * 4); a.needsUpdate = true;
        p[0] = Infinity; p[1] = -1;
      }
    }
    scorch.t += dt;
    if (scorch.dirty && scorch.t > 0.3) { scorch.tex.needsUpdate = true; scorch.dirty = false; scorch.t = 0; }
    paint.t += dt;
    if (paint.dirty && paint.t >= 0.15) { paint.tex.needsUpdate = true; paint.dirty = false; paint.t = 0; }
  }
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const SUN_NEIGHBOURS = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color(), _v = new THREE.Vector3(), _paintColor = new THREE.Color(), _sunOrigin = new THREE.Vector3();
const rnd = (a) => (Math.random() - 0.5) * 2 * a;
export const CITY = { HALF, CH, GY };
