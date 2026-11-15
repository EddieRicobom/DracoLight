// Desaturate selected world materials at the end of their own shaders, preserving
// existing facade, fog and texture code. Dragon and paint materials are untouched.
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
          ? 'vec3 ink = pow(max(cityPaint.rgb, vec3(0.0)), vec3(1.0 / 2.2)); gl_FragColor.rgb = mix(vec3(grey), ink * max(grey, 0.5), cityPaint.a);'
          : 'gl_FragColor.rgb = vec3(grey);';
        shader.fragmentShader += `\nvoid main() { monochromeOriginalMain(); float grey = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)); ${painted} }\n`;
      };
      material.customProgramCacheKey = () => `${priorKey()}|world-greyscale-v1`;
      material.needsUpdate = true;
    }
  });
}
