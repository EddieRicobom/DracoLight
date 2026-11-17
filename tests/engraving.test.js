import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyHalftone } from '../src/halftone.js';
import { makeMonochrome } from '../src/monochrome.js';

const noop = () => {};
globalThis.document = {
  createElementNS: () => ({ addEventListener: noop, removeEventListener: noop }),
  createElement: () => ({ getContext: () => ({
    fillRect: noop, beginPath: noop, ellipse: noop, fill: noop,
    strokeRect: noop, moveTo: noop, lineTo: noop, stroke: noop, setLineDash: noop,
  }) }),
};
const { City } = await import('../src/city.js');

test('pilot street, paving and facade shades compose with the original paint and halftone hooks', () => {
  const city = Object.create(City.prototype);
  city.scene = new THREE.Scene();
  city.blocks = [{ x0: 10, z0: 10, park: false }];
  city.lots = [];
  city._buildProps = noop;
  city._buildPaint();
  city._buildGround();
  city._buildChunks();
  city.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), city.buildMat));
  makeMonochrome(city.scene);
  applyHalftone(city.scene);

  const variants = ['engravingRoad(vSW', 'engravingPaving(vSW', 'engravingBuilding(vWP'];
  const materials = city.scene.children.map(({ material }) => material).filter(({ userData }) => userData.cityEngraving);
  assert.equal(materials.length, variants.length);
  assert.equal(new Set(materials.map((material) => material.customProgramCacheKey())).size, variants.length);

  materials.forEach((material, i) => {
    const shader = { ...THREE.ShaderLib.basic, uniforms: {} };
    material.onBeforeCompile(shader, {});
    const source = shader.fragmentShader;
    assert.ok(source.includes(variants[i]));
    assert.match(source, /cityPaint = (texture2D\(uCityPaint, groundUv\)|vPaint)/);
    assert.match(source, /monochromeOriginalMain\(\);.*?float orderedTone.*?cityPaint\.a/s);
    assert.match(source, /halftonePreviousMain\(\);.*?visibility \* \(1\.0 - cityEngravingCoverage \* 0\.85\)/s);
    assert.doesNotMatch(source, /gl_FragCoord/);
  });
});
