import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeMonochrome } from '../src/monochrome.js';

function compiledFragment(material) {
  const shader = { fragmentShader: 'void main() { gl_FragColor = vec4(0.3, 0.6, 0.9, 1.0); }' };
  material.onBeforeCompile(shader, {});
  return shader.fragmentShader;
}

test('world surfaces use a binary luminance threshold after their original shader', () => {
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
  assert.match(source, /float bw = step\(0\.32, grey\)/);
  assert.match(source, /gl_FragColor\.rgb = vec3\(bw\)/);
  assert.match(material.customProgramCacheKey(), /world-binary-v1/);
  const firstHook = material.onBeforeCompile;
  makeMonochrome(mesh);
  assert.equal(material.onBeforeCompile, firstHook);
});

test('paintable surfaces keep colored ink over a binary base', () => {
  const material = new THREE.MeshStandardMaterial();
  material.userData.cityPaint = true;
  makeMonochrome(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const source = compiledFragment(material);
  assert.match(source, /float bw = step\(0\.32, grey\)/);
  assert.match(source, /vec3 ink = pow\(max\(cityPaint\.rgb, vec3\(0\.0\)\)/);
  assert.match(source, /mix\(vec3\(bw\), ink \* max\(grey, 0\.5\), cityPaint\.a\)/);
});
