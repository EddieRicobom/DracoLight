// Render selected world materials in pure black and white after their own shaders,
// preserving facade, fog and texture detail as shapes. Dragon materials are untouched.
const prepared = new WeakSet();
export function makeMonochrome(root) {
  root.traverse((object) => {
    if (!object.material) return;
    for (const material of [object.material].flat()) {
      if (!material || prepared.has(material)) continue;
      prepared.add(material);
      const previous = material.onBeforeCompile;
      const priorKey = material.customProgramCacheKey.bind(material);
      material.onBeforeCompile = function(shader, renderer) {
        previous.call(this, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(/void\s+main\s*\(\s*\)/, 'void monochromeOriginalMain()');
        const painted = material.userData.cityPaint
          ? 'vec3 ink = pow(max(cityPaint.rgb, vec3(0.0)), vec3(1.0 / 2.2)); gl_FragColor.rgb = mix(vec3(bw), ink * max(grey, 0.5), cityPaint.a);'
          : 'gl_FragColor.rgb = vec3(bw);';
        shader.fragmentShader += `\nvoid main() { monochromeOriginalMain(); float grey = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)); float bw = step(0.32, grey); ${painted} }\n`;
      };
      material.customProgramCacheKey = () => `${priorKey()}|world-binary-v1`;
      material.needsUpdate = true;
    }
  });
}
