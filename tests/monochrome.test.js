import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeMonochrome } from '../src/monochrome.js';

function compiledFragment(material) {
  const shader = { fragmentShader: 'void main() { gl_FragColor = vec4(0.3, 0.6, 0.9, 1.0); }' };
  material.onBeforeCompile(shader, {});
  return shader.fragmentShader;
}

test('world surfaces retain continuous greys after their original shader', () => {
  const material = new THREE.MeshStandardMaterial();
  let previousRan = false;
  material.onBeforeCompile = (shader) => {
    previousRan = true;
    shader.fragmentShader = shader.fragmentShader.replace('0.3', '0.4');
  };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  makeMonochrome(mesh);
  const source = compiledFragment(material);
  assert.equal(previousRan, true);
  assert.match(source, /void monochromeOriginalMain\(\) \{ gl_FragColor = vec4\(0\.4/);
  assert.match(source, /float tone = clamp\(pow\(max\(grey, 0\.0\), 0\.90\)/);
  assert.match(source, /gl_FragColor\.rgb = vec3\(tone\)/);
  assert.doesNotMatch(source, /step\(0\.32, grey\)/);
  assert.match(material.customProgramCacheKey(), /world-grey-v3-0000/);
  const firstHook = material.onBeforeCompile;
  makeMonochrome(mesh);
  assert.equal(material.onBeforeCompile, firstHook);
});

test('paintable surfaces keep colored ink over a grey base', () => {
  const material = new THREE.MeshStandardMaterial();
  material.userData.cityPaint = true;
  makeMonochrome(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const source = compiledFragment(material);
  assert.match(source, /float tone = clamp\(pow\(max\(grey, 0\.0\), 0\.90\)/);
  assert.match(source, /vec3 ink = pow\(max\(cityPaint\.rgb, vec3\(0\.0\)\)/);
  assert.match(source, /mix\(vec3\(tone\), ink \* max\(tone, 0\.72\), cityPaint\.a\)/);
});

test('marked ground surfaces stay white while retaining subtle shading', () => {
  const material = new THREE.MeshStandardMaterial();
  material.userData.cityGround = true;
  material.userData.cityPaint = true;
  makeMonochrome(new THREE.Mesh(new THREE.PlaneGeometry(), material));
  const source = compiledFragment(material);
  assert.match(source, /tone = mix\(0\.76, 0\.98, tone\)/);
  assert.match(source, /mix\(vec3\(tone\), ink \* max\(tone, 0\.72\), cityPaint\.a\)/);
});

test('different original shaders and ground variants use different program keys', () => {
  const building = new THREE.MeshStandardMaterial();
  const paving = new THREE.MeshStandardMaterial();
  const road = new THREE.MeshStandardMaterial();
  building.onBeforeCompile = shader => { shader.fragmentShader += '\n// building'; };
  const groundHook = shader => { shader.fragmentShader += '\n// paving'; };
  paving.onBeforeCompile = road.onBeforeCompile = groundHook;
  paving.userData.cityGround = true;
  paving.userData.cityPaint = true;
  paving.userData.cityPaving = true;
  road.userData.cityGround = true;
  road.userData.cityPaint = true;
  makeMonochrome(new THREE.Group().add(
    new THREE.Mesh(new THREE.BoxGeometry(), building),
    new THREE.Mesh(new THREE.BoxGeometry(), paving),
    new THREE.Mesh(new THREE.BoxGeometry(), road),
  ));
  assert.notEqual(building.customProgramCacheKey(), paving.customProgramCacheKey());
  assert.notEqual(road.customProgramCacheKey(), paving.customProgramCacheKey());
  assert.match(compiledFragment(paving), /\/\/ paving/);
  assert.match(compiledFragment(paving), /tone = mix\(0\.76, 0\.98, tone\)/);
});
