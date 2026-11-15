import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// City rooftops are around 200 m; the upper atmosphere reaches its full
// appearance at the game's 12 km flight ceiling.
export const SKY_CITY_TOP = 220;
export const SKY_STRATOSPHERE = 12000;

const smooth = (x) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };

// The sky follows the camera so the horizon remains distant at every height.
// updateAltitude is attached to the mesh to preserve the createSky(scene) API.
export function createSky(scene) {
  const uniforms = { uAltitude: { value: 0 }, uTime: { value: 0 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform float uAltitude;
      uniform float uTime;
      varying vec3 vDirection;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise2(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec3 dir = normalize(vDirection);
        float h = dir.y;
        float a = uAltitude;
        vec3 sunDir = normalize(vec3(-180.0, 260.0, 130.0));
        float sun = max(dot(dir, sunDir), 0.0);

        vec3 city = mix(vec3(0.76, 0.49, 0.39), vec3(0.35, 0.56, 0.62), smoothstep(-0.02, 0.42, h));
        city = mix(city, vec3(0.13, 0.31, 0.43), smoothstep(0.36, 0.94, h));
        city = mix(vec3(0.25, 0.30, 0.33), city, smoothstep(-0.28, 0.015, h));
        float haze = exp(-pow(max(h, 0.0) / 0.16, 2.0));
        city += vec3(0.18, 0.11, 0.07) * haze * pow(sun, 3.0);

        float horizon = mix(0.0, -0.14, a);
        float rim = exp(-pow((h - horizon) / mix(0.25, 0.075, a), 2.0));
        vec3 upper = mix(vec3(0.007, 0.022, 0.075), vec3(0.002, 0.006, 0.019), smoothstep(0.0, 0.85, h));
        upper += vec3(0.11, 0.25, 0.43) * rim * (0.65 + 0.35 * sun);
        upper += vec3(0.23, 0.46, 0.66) * exp(-max(h - horizon, 0.0) * 11.0) * 0.18;
        vec3 color = mix(city, upper, a);

        // A distant cloud ocean appears below the high-altitude horizon.
        vec2 cloudUv = dir.xz / max(0.09, -h + 0.22);
        float cloud = noise2(cloudUv * 13.0 + vec2(uTime * 0.003, 0.0)) * 0.62
                    + noise2(cloudUv * 27.0 - vec2(uTime * 0.006, 0.0)) * 0.38;
        float cloudMask = smoothstep(0.44, 0.67, cloud) * (1.0 - smoothstep(-0.25, -0.04, h));
        color += vec3(0.18, 0.21, 0.23) * cloudMask * smoothstep(0.13, 0.7, a);

        // Sparse fixed stars become visible above the light-scattering layer.
        vec2 starUv = vec2(atan(dir.z, dir.x), asin(h)) * vec2(95.0, 190.0);
        vec2 cell = floor(starUv);
        float star = step(0.9977, hash21(cell));
        vec2 centre = fract(starUv) - 0.5;
        star *= exp(-dot(centre, centre) * 95.0);
        star *= smoothstep(0.05, 0.3, h) * smoothstep(0.38, 0.9, a);
        color += vec3(0.58, 0.72, 1.0) * star;

        color += mix(vec3(1.0, 0.48, 0.25), vec3(0.52, 0.68, 0.92), a)
                 * pow(sun, 12.0) * mix(0.13, 0.055, a);
        color += vec3(1.0, 0.7, 0.43) * pow(sun, 160.0) * 0.42;
        color += vec3(1.0, 0.91, 0.76) * smoothstep(0.99985, 0.99994, sun) * 0.75;
        gl_FragColor = vec4(color, 1.0);
      }`,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  const fog = scene.fog instanceof THREE.FogExp2 ? scene.fog : null;
  const baseFogDensity = fog?.density ?? 0;
  const baseFogColor = fog?.color.clone();
  const highFogColor = new THREE.Color(0x264d65);
  const sunlight = scene.children.find((child) => child.isDirectionalLight && child.castShadow);
  const ambient = scene.children.find((child) => child.isHemisphereLight);
  const sunColor = sunlight?.color.clone();
  const sunIntensity = sunlight?.intensity;
  const ambientSkyColor = ambient?.color.clone();
  const ambientGroundColor = ambient?.groundColor.clone();
  const ambientIntensity = ambient?.intensity;
  const highSunColor = new THREE.Color(0xffe2c5);
  const highAmbientSky = new THREE.Color(0x8caed7);
  const highAmbientGround = new THREE.Color(0x303f5b);
  sky.updateAltitude = (height, timeSeconds = 0) => {
    const altitude = smooth((Math.max(0, height) - SKY_CITY_TOP) / (SKY_STRATOSPHERE - SKY_CITY_TOP));
    uniforms.uAltitude.value = altitude;
    uniforms.uTime.value = timeSeconds;
    if (fog) {
      fog.density = THREE.MathUtils.lerp(baseFogDensity, 0.00008, altitude);
      fog.color.copy(baseFogColor).lerp(highFogColor, altitude);
    }
    if (sunlight) {
      sunlight.color.copy(sunColor).lerp(highSunColor, altitude);
      sunlight.intensity = THREE.MathUtils.lerp(sunIntensity, 2.8, altitude);
    }
    if (ambient) {
      ambient.color.copy(ambientSkyColor).lerp(highAmbientSky, altitude);
      ambient.groundColor.copy(ambientGroundColor).lerp(highAmbientGround, altitude);
      ambient.intensity = THREE.MathUtils.lerp(ambientIntensity, 1.2, altitude);
    }
    sky.refreshEnvironment?.(altitude);
    return altitude;
  };
  return sky;
}

export function createVisualPipeline(renderer, scene, camera) {
  // Capture only the procedural sky. A small prefiltered map gives the city's
  // glass and metal coherent outdoor reflections without screen-space passes.
  const sky = scene.children.find((child) => child.updateAltitude);
  if (sky) {
    const environmentScene = new THREE.Scene();
    const environmentSky = new THREE.Mesh(sky.geometry, sky.material);
    environmentSky.frustumCulled = false;
    environmentScene.add(environmentSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    let environmentTarget;
    let environmentStep = -1;
    sky.refreshEnvironment = (altitude) => {
      // Altitude changes continuously; rebuilding a cubemap every frame would
      // be prohibitively expensive. Five atmosphere bands suffice for highlights.
      const step = Math.min(4, Math.floor(altitude * 4));
      if (step === environmentStep) return;
      environmentStep = step;
      const nextTarget = pmrem.fromScene(environmentScene, 0, 0.1, 1500, { size: 64 });
      scene.environment = nextTarget.texture;
      scene.environmentIntensity = 0.72;
      environmentTarget?.dispose();
      environmentTarget = nextTarget;
    };
    sky.refreshEnvironment(0);
  }
  const composer = new EffectComposer(renderer);
  // Bloom works in linear HDR, before the final tone and color-space conversion.
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.3, 1.35));
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uHalftone: { value: 0 } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse;
      uniform float uHalftone;
      varying vec2 vUv;
      void main() {
        vec3 color = texture2D(tDiffuse, vUv).rgb;
        color = max(vec3(0.0), (color - 0.018) * 1.025 + 0.018);
        vec2 p = vUv * 2.0 - 1.0;
        color *= 1.0 - 0.09 * smoothstep(0.2, 1.7, dot(p, p));
        if (uHalftone > 0.5) {
          // One luminance-based screen modulates every channel equally, so
          // neutral scenery remains neutral and colored paint keeps its hue.
          vec2 fromCentre = fract(gl_FragCoord.xy / 8.0) - 0.5;
          float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
          float radiusSquared = (1.0 - clamp(luminance, 0.0, 1.0)) * 0.31831;
          float mark = 1.0 - smoothstep(radiusSquared - 0.035,
                                      radiusSquared + 0.035, dot(fromCentre, fromCentre));
          float modulation = mix(1.12, 0.72, mark);
          color = mix(color, min(color * modulation, vec3(1.0)), 0.6);
        }
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
  composer.addPass(new OutputPass());
  composer.addPass(grade);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  const shadingControls = typeof document !== 'undefined'
    ? document.querySelectorAll('input[name="shadingMode"]') : [];
  const storageKey = 'dracoLight.shadingMode';
  composer.setHalftone = (enabled) => {
    const mode = enabled ? 'halftone' : 'normal';
    grade.uniforms.uHalftone.value = enabled ? 1 : 0;
    shadingControls.forEach((input) => { input.checked = input.value === mode; });
    try { window.localStorage.setItem(storageKey, mode); } catch { /* Private browsing can disable storage. */ }
  };
  composer.isHalftoneEnabled = () => grade.uniforms.uHalftone.value > 0.5;
  let savedMode;
  try { savedMode = window.localStorage.getItem(storageKey); } catch { /* Use the normal mode. */ }
  if (savedMode === 'halftone') composer.setHalftone(true);
  shadingControls.forEach((input) => input.addEventListener('change', () => {
    if (input.checked) composer.setHalftone(input.value === 'halftone');
  }));
  return composer;
}
