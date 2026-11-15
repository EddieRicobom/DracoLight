import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PaintMeteor } from '../src/meteor.js';
import { makeMonochrome } from '../src/monochrome.js';
import { addInkOutline } from '../src/outline.js';

test('paint ball captures the velocity of the crossing and impacts the city', () => {
  const hits = [];
  const scene = new THREE.Scene();
  const meteor = new PaintMeteor(scene, { destroySphere: (...args) => hits.push(args) });
  const ball = meteor.fire(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, 0, -1), '#ff0000');
  assert.ok(ball);
  meteor.update(0.1, new THREE.Vector3(0,100,-40), new THREE.Vector3(0,100,-100), 300);
  assert.equal(ball.state, 'meteor');
  assert.equal(ball.radius, 16);
  assert.ok(Math.abs(ball.velocity.length() - 300) < .001);
  for (let i = 0; i < 100 && (meteor.balls.length || meteor.impacts.length); i++) {
    meteor.update(.1, new THREE.Vector3(1000,1000,1000), new THREE.Vector3(1000,1000,1000), 0);
  }
  assert.ok(hits.length > 0);
  meteor.reset();
  assert.equal(scene.children.length, 0);
});

test('monochrome preserves existing material shader hooks and avoids duplicate wrapping', () => {
  const material = new THREE.MeshBasicMaterial();
  material.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('gl_FragColor=vec4(1.);', 'gl_FragColor=vec4(.5);'); };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  makeMonochrome(mesh); makeMonochrome(mesh);
  const shader = { fragmentShader: 'void main() { gl_FragColor=vec4(1.); }' };
  material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /gl_FragColor=vec4\(\.5\)/);
  assert.equal((shader.fragmentShader.match(/void monochromeOriginalMain/g) || []).length, 1);
  assert.match(shader.fragmentShader, /vec3\(bw\)/);
});

test('ink outline preserves a material shader hook and applies only once', () => {
  const material = new THREE.MeshToonMaterial();
  material.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('ORIGINAL', 'changed'); };
  addInkOutline(material); addInkOutline(material);
  const shader = { fragmentShader: 'void main() { ORIGINAL\n#include <opaque_fragment>\n}' };
  material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /changed/);
  assert.equal((shader.fragmentShader.match(/float inkRim/g) || []).length, 1);
});
