import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const draw = () => {};
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {} }),
  createElement: () => ({
    getContext: () => new Proxy({}, { get: (context, key) => context[key] ?? draw }),
  }),
};
const { City } = await import('../src/city.js');

test('street prop district batches are culled independently and keep local state', () => {
  const scene = new THREE.Scene();
  const city = new City(scene);
  const [lamp, distantLamp] = city.props.filter(prop => prop.type === 1 && prop.idx === 0);
  assert.notEqual(lamp.group, distantLamp.group);

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 1, 30000);
  camera.position.set(0, 5, 0);
  camera.lookAt(0, 3, -100);
  camera.updateMatrixWorld();
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProjection);
  const meshes = city.propGroups.flatMap(group => group.meshes);
  assert.ok(meshes.some(mesh => frustum.intersectsObject(mesh)));
  assert.ok(meshes.some(mesh => !frustum.intersectsObject(mesh)));

  const center = new THREE.Vector3(lamp.x, lamp.h, lamp.z);
  const matrix = new THREE.Matrix4();
  const initialMatrices = prop => prop.group.meshes.map(mesh => {
    const initial = new THREE.Matrix4();
    mesh.getMatrixAt(prop.idx, initial);
    return initial.elements;
  });
  const original = initialMatrices(lamp);
  const untouched = initialMatrices(distantLamp);
  city.paintSphere(center, 0.25, '#ff0000');
  for (const attr of lamp.group.paintAttrs) assert.deepEqual([...attr.array.slice(0, 4)], [255, 0, 0, 255]);
  for (const attr of distantLamp.group.paintAttrs) assert.deepEqual([...attr.array.slice(0, 4)], [0, 0, 0, 0]);

  city.destroyProps(center.x, center.y, center.z, 0.25);
  assert.equal(lamp.alive, false);
  assert.equal(distantLamp.alive, true);
  for (const mesh of lamp.group.meshes) {
    mesh.getMatrixAt(lamp.idx, matrix);
    assert.equal(matrix.determinant(), 0);
    assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 0, count: 16 }]);
  }
  distantLamp.group.meshes.forEach((mesh, i) => {
    mesh.getMatrixAt(distantLamp.idx, matrix);
    assert.deepEqual(matrix.elements, untouched[i]);
  });

  city.reset();
  assert.equal(lamp.alive, true);
  lamp.group.meshes.forEach((mesh, i) => {
    mesh.getMatrixAt(lamp.idx, matrix);
    assert.deepEqual(matrix.elements, original[i]);
    assert.deepEqual(mesh.instanceMatrix.updateRanges, []);
  });
  for (const attr of lamp.group.paintAttrs) assert.deepEqual([...attr.array.slice(0, 4)], [0, 0, 0, 0]);
});

test('prop visibility preserves nearby details and responds to projection and fog', () => {
  const city = Object.create(City.prototype);
  city.scene = new THREE.Scene();
  city.scene.fog = new THREE.FogExp2(0xffffff, 0.0017);
  const groupAt = z => ({
    bounds: new THREE.Box3(new THREE.Vector3(-2, 0, z - 2), new THREE.Vector3(2, 4, z + 2)),
    diameter: 4,
    meshes: [{ visible: true }],
  });
  const near = groupAt(-200), foggy = groupAt(-1600), far = groupAt(-9000);
  city.propGroups = [near, foggy, far];
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 1, 30000);
  const visibility = () => city.propGroups.map(group => group.meshes[0].visible);

  city.updatePropVisibility(camera, 1080);
  assert.deepEqual(visibility(), [true, false, false]);
  city.scene.fog.density = 0.00008;
  city.updatePropVisibility(camera, 1080);
  assert.deepEqual(visibility(), [true, true, false]);
  city.updatePropVisibility(camera, 0);
  assert.deepEqual(visibility(), [true, true, true]);
  city.updatePropVisibility(camera, 1);
  assert.deepEqual(visibility(), [true, false, false]);

  camera.position.z = -8800;
  city.updatePropVisibility(camera, 1080);
  assert.equal(far.meshes[0].visible, true);
});
