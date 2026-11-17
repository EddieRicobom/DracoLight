import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPilotPark } from '../src/pilot-park.js';
import { makeMonochrome } from '../src/monochrome.js';
import { applyHalftone } from '../src/halftone.js';

test('park surfaces share the city paint map and retain shading hooks', () => {
  const scene = new THREE.Scene();
  const texture = new THREE.Texture();
  const city = { blocks: [{ x0: -80, z0: 100, park: true }], paintTexture: texture, paintHalfExtent: 3130 };
  const park = createPilotPark(scene, city);
  assert.deepEqual(park.children.map((mesh) => mesh.name), ['Stone pool coping', 'Reflecting water', 'Wooden pool deck']);
  makeMonochrome(scene);
  applyHalftone(scene);
  for (const mesh of park.children) {
    const shader = { ...THREE.ShaderLib.basic, uniforms: {} };
    mesh.material.onBeforeCompile(shader, {});
    assert.equal(shader.uniforms.uParkPaint.value, texture);
    assert.equal(shader.uniforms.uParkPaintHalfExtent.value, city.paintHalfExtent);
    assert.match(shader.fragmentShader, /cityPaint = texture2D\(uParkPaint/);
    assert.match(shader.fragmentShader, /halftonePreviousMain/);
  }
});
