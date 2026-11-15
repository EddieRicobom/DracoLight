import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyHalftone, halftoneUniform } from '../src/halftone.js';

test('halftone wraps existing material effects and keeps instance-local coordinates', () => {
  const material = new THREE.MeshStandardMaterial();
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader += '\n// original ink effect';
  };
  const originalKey = material.customProgramCacheKey();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(5, 5, 5), material, 2);
  applyHalftone(mesh);
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\nvoid main() { #include <begin_vertex> }',
    fragmentShader: '#include <common>\nvoid main() { gl_FragColor = vec4(0.5); }',
  };
  material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /original ink effect/);
  assert.match(shader.fragmentShader, /halftonePreviousMain\(\)/);
  assert.match(shader.vertexShader, /vHalftonePosition = position \* halftoneScale/);
  assert.match(shader.vertexShader, /length\(instanceMatrix\[0\]\.xyz\)/);
  assert.equal(shader.uniforms.uHalftoneEnabled, halftoneUniform);
  assert.match(material.customProgramCacheKey(), /surface-halftone-v3-00/);
  assert.notEqual(material.customProgramCacheKey(), originalKey);

  halftoneUniform.value = 1;
  assert.equal(shader.uniforms.uHalftoneEnabled.value, 1);
  halftoneUniform.value = 0;
  const hook = material.onBeforeCompile;
  applyHalftone(mesh);
  assert.equal(material.onBeforeCompile, hook);
});

test('custom and transparent materials keep their alpha and shader code', () => {
  const custom = new THREE.ShaderMaterial({
    transparent: true,
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'void main() { gl_FragColor = vec4(0.2, 0.7, 0.9, 0.4); }',
  });
  const transparent = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.66 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), custom));
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), transparent));
  applyHalftone(group);
  const shader = { uniforms: {}, vertexShader: custom.vertexShader, fragmentShader: custom.fragmentShader };
  custom.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /gl_FragColor = vec4\(0\.2, 0\.7, 0\.9, 0\.4\)/);
  assert.match(shader.fragmentShader, /gl_FragColor\.rgb \*=/);
  assert.doesNotMatch(shader.fragmentShader, /gl_FragColor\.a\s*=/);
  assert.equal(shader.uniforms.uHalftoneEnabled, halftoneUniform);
  const standardShader = {
    uniforms: {},
    vertexShader: '#include <common>\nvoid main() { #include <begin_vertex> }',
    fragmentShader: '#include <common>\nvoid main() { gl_FragColor = vec4(1.0, 1.0, 1.0, 0.66); }',
  };
  transparent.onBeforeCompile(standardShader, {});
  assert.match(standardShader.fragmentShader, /gl_FragColor\.rgb \*=/);
  assert.doesNotMatch(standardShader.fragmentShader, /gl_FragColor\.a\s*=/);
});

test('point sprites use their own sprite coordinates', () => {
  const material = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
  });
  const points = new THREE.Points(new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute([0, 0, 0], 3)), material);
  applyHalftone(points);
  const shader = { uniforms: {}, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader };
  material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /gl_PointCoord/);
  assert.match(material.customProgramCacheKey(), /surface-halftone-v3-10/);
});

test('animated geometry uses stable UVs instead of rewritten world positions', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
    .setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const material = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
  });
  const mesh = new THREE.Mesh(geometry, material);
  applyHalftone(mesh);
  const shader = { uniforms: {}, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader };
  material.onBeforeCompile(shader, {});
  assert.match(shader.vertexShader, /vHalftoneUv = uv/);
  assert.match(shader.fragmentShader, /surfaceCoord = vHalftoneUv \* vec2\(5\.0, 1\.0\)/);
  assert.doesNotMatch(shader.fragmentShader, /cross\(dFdx\(vHalftonePosition\)/);
  assert.match(material.customProgramCacheKey(), /surface-halftone-v3-01/);
});
