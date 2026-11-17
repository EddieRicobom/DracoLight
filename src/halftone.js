import * as THREE from 'three';

// A shared switch avoids recompiling prepared materials when changing modes.
export const halftoneUniform = { value: 0 };

const prepared = new WeakSet();
const mainOpening = /void\s+main\s*\(\s*\)\s*\{/;

// Apply after other onBeforeCompile effects. Object-space positions make the
// marks follow moving meshes and instances; scale factors keep them a similar
// physical size even when the geometry is a unit sphere or cube.
export function applyHalftone(root) {
  root.traverse((object) => {
    if ((!object.isMesh && !object.isPoints) || !object.geometry?.attributes?.position || !object.material) return;
    for (const material of [object.material].flat()) {
      if (!material || material.isRawShaderMaterial || prepared.has(material)) continue;
      prepared.add(material);
      const previous = material.onBeforeCompile;
      const priorKey = material.customProgramCacheKey();
      const isPointSprite = !!object.isPoints;
      const engraving = material.userData.cityEngraving ? ' * (1.0 - cityEngravingCoverage * 0.85)' : '';
      const paper = material.userData.scenePaper
        ? ` * (1.0 - scenePaperCoverage${material.userData.cityPaint ? ' * (1.0 - cityPaint.a)' : ''})` : '';
      // Animated tubes and ribbons rewrite position in world coordinates. Their
      // fixed UVs describe the surface and keep the marks attached to it.
      const useUV = !isPointSprite && !!object.geometry.attributes.uv &&
        object.geometry.attributes.position.usage === THREE.DynamicDrawUsage;
      material.onBeforeCompile = function(shader, renderer) {
        previous.call(this, shader, renderer);
        if (!mainOpening.test(shader.vertexShader) || !mainOpening.test(shader.fragmentShader)) return;
        shader.uniforms.uHalftoneEnabled = halftoneUniform;
        shader.vertexShader = `varying vec3 vHalftonePosition;
          ${useUV ? 'varying vec2 vHalftoneUv;' : ''}\n${shader.vertexShader}`
          .replace(mainOpening, `void main() {
            vec3 halftoneScale = vec3(length(modelMatrix[0].xyz),
                                      length(modelMatrix[1].xyz),
                                      length(modelMatrix[2].xyz));
            #ifdef USE_INSTANCING
              halftoneScale *= vec3(length(instanceMatrix[0].xyz),
                                    length(instanceMatrix[1].xyz),
                                    length(instanceMatrix[2].xyz));
            #endif
            vHalftonePosition = position * halftoneScale;
            ${useUV ? 'vHalftoneUv = uv;' : ''}`);
        shader.fragmentShader = `uniform float uHalftoneEnabled;
          varying vec3 vHalftonePosition;
          ${useUV ? 'varying vec2 vHalftoneUv;' : ''}\n${shader.fragmentShader}`
          .replace(mainOpening, 'void halftonePreviousMain() {');
        shader.fragmentShader += `
          void main() {
            halftonePreviousMain();
            if (uHalftoneEnabled < 0.5) return;
            vec2 surfaceCoord;
            ${isPointSprite ? `surfaceCoord = (gl_PointCoord - 0.5) * 2.0 + vHalftonePosition.xy;` : useUV ? `
              surfaceCoord = vHalftoneUv * vec2(5.0, 1.0);` : `
              vec3 face = abs(cross(dFdx(vHalftonePosition), dFdy(vHalftonePosition)));
              surfaceCoord = face.x > face.y && face.x > face.z
                ? vHalftonePosition.zy : face.y > face.z
                ? vHalftonePosition.xz : vHalftonePosition.xy;`}
            vec2 grid = surfaceCoord / 1.15;
            float footprint = max(length(dFdx(grid)), length(dFdy(grid)));
            float visibility = 1.0 - smoothstep(0.45, 1.15, footprint);
            vec2 cell = floor(grid);
            vec2 randomPair = fract(vec2(dot(cell, vec2(0.06711, 0.00584)),
                                         dot(cell, vec2(0.03697, 0.05377))) * 52.9829189);
            vec2 offset = fract(grid) - 0.5 - (randomPair - 0.5) * 0.10;
            offset *= vec2(mix(0.94, 1.06, randomPair.y),
                           mix(1.06, 0.94, randomPair.x));
            // The material has already resolved its lighting. Compress HDR
            // highlights so dot size changes smoothly across lit surfaces.
            float luminance = max(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0);
            float illumination = luminance / (luminance + 0.35);
            float area = mix(0.29, 0.015, illumination);
            area += (randomPair.x - 0.5) * 0.018;
            float distanceSquared = dot(offset, offset);
            float feather = max(fwidth(distanceSquared), 0.018);
            float mark = 1.0 - smoothstep(area - feather, area + feather, distanceSquared);
            float contrast = mix(0.26, 0.44, smoothstep(0.12, 0.8, illumination));
            gl_FragColor.rgb *= 1.0 - mark * contrast * visibility${engraving}${paper};
          }
        `;
      };
      material.customProgramCacheKey = () => `${priorKey}|surface-halftone-v4-${Number(isPointSprite)}${Number(useUV)}`;
      material.needsUpdate = true;
    }
  });
}
