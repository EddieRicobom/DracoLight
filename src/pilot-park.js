import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENGRAVING_SURFACE_GLSL } from './engraving.js';
import { GLSL_COMMON, U } from './util.js';

const PARK_X = -80, PARK_Z = 100;
const POND_WIDTH = 10, POND_DEPTH = 12, COPING_WIDTH = 0.62;
const WATER_WIDTH = POND_WIDTH - 2 * COPING_WIDTH;
const WATER_DEPTH = POND_DEPTH - 2 * COPING_WIDTH;
const PAVEMENT_Y = 0.3;

const WOOD_GLSL = /* glsl */`
  vec2 plank = vParkPosition.xz + vec2(5.0, 10.0);
  float row = floor(plank.y / 0.33);
  float end = plank.x + mod(row, 2.0) * 1.3;
  float seam = engravingGrid(vec2(end, plank.y), vec2(3.4, 0.33), width, 0.018);
  float grainBend = vnoise(vec2(plank.x * 0.54, row)) - 0.5;
  float grainPhase = plank.y * 96.0 + grainBend * 3.5;
  float grainVisibility = 1.0 - smoothstep(0.6, 2.8, fwidth(grainPhase));
  float grain = sin(grainPhase) * grainVisibility;
  float boardTone = 0.35 + 0.14 * hash12(vec2(floor(end / 3.4), row));
  float boardVisibility = 1.0 - smoothstep(0.06, 0.32, width.y);
  float tone = mix(0.42, boardTone, boardVisibility) + 0.035 * grain - 0.16 * seam;
  tone *= mix(0.59, 1.0, clamp(vParkNormal.y, 0.0, 1.0));
`;

const WATER_GLSL = /* glsl */`
  vec2 surface = vParkPosition.xz;
  float time = uParkTime * 0.8;
  float ripplePhase = dot(surface, vec2(0.38, 5.4)) + sin(surface.x * 0.93 + time * 0.5) - time;
  float crossPhase = dot(surface, vec2(1.3, 2.3)) + time * 0.67;
  float rippleVisibility = 1.0 - smoothstep(0.5, 2.3, fwidth(ripplePhase));
  float crossVisibility = 1.0 - smoothstep(0.5, 2.3, fwidth(crossPhase));
  float ripples = cos(ripplePhase) * rippleVisibility + 0.42 * sin(crossPhase) * crossVisibility;
  vec3 view = normalize(cameraPosition - vParkWorld);
  float reflectedSky = pow(1.0 - clamp(view.y, 0.0, 1.0), 2.0);
  float reflection = sin(surface.y * 1.25 - surface.x * 0.30 + ripples * 0.35);
  float sheen = smoothstep(0.62, 0.95, cos(ripplePhase + 0.43 * sin(crossPhase))) * rippleVisibility;
  vec2 banks = vec2(${(WATER_WIDTH / 2).toFixed(2)}, ${(WATER_DEPTH / 2).toFixed(2)}) - abs(surface - vec2(0.0, 2.0));
  float shore = 1.0 - smoothstep(0.04, 0.6, min(banks.x, banks.y));
  float tone = 0.22 + 0.19 * reflectedSky + 0.05 * reflection + 0.032 * ripples + 0.17 * sheen - 0.10 * shore;
`;

const STONE_GLSL = /* glsl */`
  vec2 surface = abs(vParkPosition.xz - vec2(0.0, 2.0));
  bool runsAlongZ = 6.0 - surface.y > 5.0 - surface.x;
  float along = runsAlongZ ? vParkPosition.z - 2.0 : vParkPosition.x;
  float alongWidth = runsAlongZ ? width.y : width.x;
  float joints = engravingLine(abs(mod(along + 0.7, 1.4) - 0.7), 0.032, alongWidth);
  float tone = 0.66 + 0.12 * vnoise(vParkPosition.xz * 0.92) - 0.22 * joints;
  tone *= mix(0.56, 1.0, clamp(vParkNormal.y, 0.0, 1.0));
`;

function surfaceMaterial(kind, surfaceGLSL, paintTexture, paintHalfExtent) {
  const material = new THREE.MeshBasicMaterial();
  material.userData.cityPaint = true;
  material.userData.cityEngraving = true;
  material.customProgramCacheKey = () => `pilot-park-${kind}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uParkPaint = { value: paintTexture };
    shader.uniforms.uParkTime = U.uTime;
    shader.uniforms.uParkPaintHalfExtent = { value: paintHalfExtent };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vParkWorld;
      varying vec3 vParkPosition;
      varying vec3 vParkNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vParkPosition = position;
      vParkWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      vParkNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uParkPaint;
      uniform float uParkTime;
      uniform float uParkPaintHalfExtent;
      varying vec3 vParkWorld;
      varying vec3 vParkPosition;
      varying vec3 vParkNormal;
      vec4 cityPaint;
      ${GLSL_COMMON}
      ${ENGRAVING_SURFACE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec2 paintUV = (vParkWorld.xz + uParkPaintHalfExtent) / (2.0 * uParkPaintHalfExtent);
      cityPaint = texture2D(uParkPaint, vec2(paintUV.x, 1.0 - paintUV.y));
      vec2 width = fwidth(vParkPosition.xz);
      engravingSample(engravingDistrict(vParkWorld.xz), vParkWorld.xz, width, 0.19);
      ${surfaceGLSL}
      diffuseColor.rgb *= tone;`);
  };
  return material;
}

function box(width, height, depth, x, y, z) {
  return new THREE.BoxGeometry(width, height, depth).translate(x, y, z);
}

export function createPilotPark(scene, city) {
  const park = city.blocks.find((block) => block.park && block.x0 === PARK_X && block.z0 === PARK_Z);
  if (!park) return;

  const group = new THREE.Group();
  group.name = 'Pilot park reflecting pool';
  group.position.set(park.x0 + 23, PAVEMENT_Y, park.z0 + 24);

  // The coping sits on the existing park slab, with the water just below the
  // lip. The low deck and basin remain outside the street and pedestrian routes.
  const rimX = POND_WIDTH / 2 - COPING_WIDTH / 2;
  const rimZ = POND_DEPTH / 2 - COPING_WIDTH / 2;
  const rimHeight = 0.18;
  const rim = [
    box(POND_WIDTH, rimHeight, COPING_WIDTH, 0, rimHeight / 2, 2 - rimZ),
    box(POND_WIDTH, rimHeight, COPING_WIDTH, 0, rimHeight / 2, 2 + rimZ),
    box(COPING_WIDTH, rimHeight, WATER_DEPTH, -rimX, rimHeight / 2, 2),
    box(COPING_WIDTH, rimHeight, WATER_DEPTH, rimX, rimHeight / 2, 2),
  ];
  const stone = mergeGeometries(rim);
  rim.forEach((geometry) => geometry.dispose());
  const water = new THREE.PlaneGeometry(WATER_WIDTH, WATER_DEPTH)
    .rotateX(-Math.PI / 2).translate(0, 0.115, 2);
  const deck = box(POND_WIDTH, 0.075, 4, 0, 0.0375, -6);
  for (const [name, geometry, source] of [
    ['Stone pool coping', stone, STONE_GLSL],
    ['Reflecting water', water, WATER_GLSL],
    ['Wooden pool deck', deck, WOOD_GLSL],
  ]) {
    const mesh = new THREE.Mesh(geometry, surfaceMaterial(name, source, city.paintTexture, city.paintHalfExtent));
    mesh.name = name;
    group.add(mesh);
  }
  scene.add(group);
  return group;
}
