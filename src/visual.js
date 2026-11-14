import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// The sky follows the camera so the horizon remains distant throughout the city.
export function createSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec3 vDirection;
      void main() {
        float h = vDirection.y;
        vec3 zenith = vec3(0.055, 0.075, 0.145);
        vec3 upper = vec3(0.22, 0.19, 0.25);
        vec3 horizon = vec3(0.59, 0.29, 0.19);
        vec3 below = vec3(0.13, 0.105, 0.13);
        vec3 color = mix(horizon, upper, smoothstep(0.0, 0.42, h));
        color = mix(color, zenith, smoothstep(0.38, 0.9, h));
        color = mix(below, color, smoothstep(-0.28, 0.02, h));
        vec3 sunDir = normalize(vec3(-180.0, 260.0, 130.0));
        float facing = max(dot(normalize(vDirection), sunDir), 0.0);
        color += vec3(1.0, 0.37, 0.13) * pow(facing, 12.0) * 0.16;
        color += vec3(1.0, 0.67, 0.37) * pow(facing, 160.0) * 0.65;
        gl_FragColor = vec4(color, 1.0);
      }`,
  }));
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

export function createVisualPipeline(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  // Bloom works in linear HDR, before the final tone and color-space conversion.
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.45, 1.35));
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec3 color = texture2D(tDiffuse, vUv).rgb;
        float light = clamp(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
        color *= mix(vec3(0.91, 1.0, 1.07), vec3(1.06, 1.0, 0.95), smoothstep(0.12, 0.9, light));
        vec2 p = vUv * 2.0 - 1.0;
        color *= 1.0 - 0.14 * smoothstep(0.2, 1.7, dot(p, p));
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  return composer;
}
