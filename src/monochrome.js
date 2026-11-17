// Desaturate selected world materials after their own shaders, preserving their
// lighting and surface detail. Dragon materials are untouched.
const prepared = new WeakSet();
export function makeMonochrome(root) {
  root.traverse((object) => {
    if (!object.material) return;
    for (const material of [object.material].flat()) {
      if (!material || prepared.has(material)) continue;
      prepared.add(material);
      const previous = material.onBeforeCompile;
      // The default Three.js key reads onBeforeCompile dynamically. Capture it
      // before wrapping or different city shaders can share the same program.
      const priorKey = material.customProgramCacheKey();
      const variantKey = `${Number(!!material.userData.cityGround)}${Number(!!material.userData.cityPaint)}${Number(!!material.userData.cityPaving)}${Number(!!material.userData.skyAtmosphere)}${Number(!!material.userData.cityEngraving)}`;
      material.onBeforeCompile = function(shader, renderer) {
        previous.call(this, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(/void\s+main\s*\(\s*\)/, 'void monochromeOriginalMain()');
        let ground = material.userData.cityGround ? 'tone = mix(0.76, 0.98, tone);' : '';
        if (material.userData.cityGround && material.userData.cityEngraving) {
          const range = material.userData.cityPaving ? '0.53, 0.98' : '0.26, 0.96';
          ground = `tone = mix(mix(0.76, 0.98, tone), mix(${range}, tone), cityEngravingCoverage);`;
        }
        const engraving = material.userData.cityEngraving ? `
          if (cityEngravingDetail > 0.0) {
            float orderedTone = floor(tone * 7.0 + cityEngravingThreshold) / 7.0;
            tone = mix(tone, orderedTone, cityEngravingCoverage * cityEngravingDetail * 0.85);
          }` : '';
        const atmosphere = material.userData.skyAtmosphere ? 'tone *= 0.76;' : '';
        const painted = material.userData.cityPaint
          ? 'vec3 ink = pow(max(cityPaint.rgb, vec3(0.0)), vec3(1.0 / 2.2)); gl_FragColor.rgb = mix(vec3(tone), ink * max(tone, 0.72), cityPaint.a);'
          : 'gl_FragColor.rgb = vec3(tone);';
        shader.fragmentShader += `\nvoid main() { monochromeOriginalMain(); float grey = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)); float tone = clamp(pow(max(grey, 0.0), 0.90), 0.04, 0.98); ${ground} ${atmosphere} ${engraving} ${painted} }\n`;
      };
      material.customProgramCacheKey = () => `${priorKey}|world-grey-v3-${variantKey}`;
      material.needsUpdate = true;
    }
  });
}
