// Irregular dark edge along the silhouette of a lit 3D material.
export function addInkOutline(material) {
  if (!material || material.userData.inkOutlined) return;
  material.userData.inkOutlined = true;
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
      float inkRim = abs(dot(normalize(normal), normalize(vViewPosition)));
      float inkJitter = 0.035 * sin(gl_FragCoord.x * .43) * sin(gl_FragCoord.y * .37);
      float inkEdge = 1.0 - smoothstep(.13, .22, inkRim + inkJitter);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(.012), inkEdge * .92);`);
  };
  material.customProgramCacheKey = () => `${key()}|ink-outline-v1`;
  material.needsUpdate = true;
}
