export const ENGRAVING_SURFACE_GLSL = /* glsl */`
// World phases are continuous across the static city chunks and road slabs.
float cityEngravingCoverage = 0.0;
float cityEngravingThreshold = 0.5;
float cityEngravingDetail = 0.0;

float engravingDistrict(vec2 position) {
  return 1.0 - smoothstep(132.0, 205.0, length(position));
}

float engravingBayer2(vec2 cell) {
  cell = mod(cell, 2.0);
  return 2.0 * mod(cell.x + cell.y, 2.0) + cell.y;
}

void engravingSample(float coverage, vec2 surface, vec2 width, float spacing) {
  vec2 cell = floor(surface / spacing);
  cityEngravingThreshold = (4.0 * engravingBayer2(cell) + engravingBayer2(floor(cell * 0.5)) + 0.5) / 16.0;
  cityEngravingDetail = 1.0 - smoothstep(0.42, 1.15, max(width.x, width.y) / spacing);
  float dotFade = smoothstep(cityEngravingThreshold - 0.16, cityEngravingThreshold + 0.16, coverage);
  // Keep endpoints exact, including the outer edge and fully patterned center.
  float transition = smoothstep(0.0, 0.14, coverage) * (1.0 - smoothstep(0.86, 1.0, coverage));
  cityEngravingCoverage = mix(coverage, dotFade, cityEngravingDetail * transition * 0.75);
}

float engravingLine(float distanceToLine, float halfWidth, float footprint) {
  return (1.0 - smoothstep(halfWidth, halfWidth + footprint + 0.001, distanceToLine))
    * min(1.0, halfWidth / max(footprint, 0.001));
}

float engravingGrid(vec2 at, vec2 spacing, vec2 width, float thickness) {
  vec2 edge = abs(mod(at + spacing * 0.5, spacing) - spacing * 0.5);
  return max(engravingLine(edge.x, thickness, width.x), engravingLine(edge.y, thickness, width.y));
}
`;

export const ENGRAVING_BUILDING_GLSL = /* glsl */`
float engravingBuilding(vec3 world, vec3 normal, vec2 facade, vec2 width, vec2 windowUV,
                        float style, float windows, float frames, float seed) {
  if (normal.y > 0.7) {
    float seams = engravingGrid(world.xz, vec2(5.0, 2.5), width, 0.055);
    return 0.44 + 0.08 * hash12(floor(world.xz / vec2(5.0, 2.5)) + seed) - 0.16 * seams;
  }
  if (normal.y < -0.7) return 0.20;

  float tone;
  if (style < 0.5) {
    float panels = engravingGrid(facade, vec2(1.666, 3.333), width, 0.042);
    tone = 0.42 - 0.21 * panels;
  } else if (style < 1.5) {
    float course = engravingGrid(facade, vec2(2.5, 3.333), width, 0.065);
    tone = 0.76 - 0.25 * course;
  } else {
    vec2 brick = facade + vec2(mod(floor(facade.y / 0.57), 2.0) * 0.63, 0.0);
    float joints = engravingGrid(brick, vec2(1.26, 0.57), width, 0.039);
    tone = 0.57 - 0.13 * joints;
  }

  // Broad changes in tone and a sill distinguish glass from the masonry.
  float lintel = engravingLine(abs(windowUV.y - 0.89) * 3.333, 0.048, width.y);
  tone *= 1.0 - lintel * 0.16;
  float glass = 0.12 + 0.12 * smoothstep(0.12, 0.91, windowUV.y);
  tone = mix(tone, glass, windows);
  return mix(tone, 0.17, frames * 0.83);
}
`;

export function engravingRoadGLSL(pitch, roadWidth) {
  return /* glsl */`
float engravingRoad(vec2 position, vec2 width) {
  vec2 block = mod(position + ${(pitch / 2).toFixed(1)}, ${pitch.toFixed(1)}) - ${(pitch / 2).toFixed(1)};
  vec2 a = abs(block);
  bool northSouth = a.x < a.y;
  float across = northSouth ? a.x : a.y;
  float along = northSouth ? block.y : block.x;
  float acrossWidth = northSouth ? width.x : width.y;
  float alongWidth = northSouth ? width.y : width.x;
  float beyondJunction = smoothstep(9.0, 10.0, abs(along));
  float lane = engravingLine(abs(across - 0.6), 0.12, acrossWidth) * beyondJunction;
  float parking = engravingLine(abs(across - ${(roadWidth / 2 - 2).toFixed(1)}), 0.07, acrossWidth) * beyondJunction;
  float walkBand = 1.0 - smoothstep(1.0, 1.0 + alongWidth + 0.001, abs(abs(along) - 11.5));
  float crosswalk = walkBand * engravingLine(abs(mod(across + 0.9, 1.8) - 0.9), 0.39, acrossWidth)
    * (1.0 - smoothstep(7.2, 7.9, across));
  float gutter = engravingLine(abs(across - ${(roadWidth / 2 - 0.5).toFixed(1)}), 0.15, acrossWidth) * beyondJunction;
  float coverDistance = length(block - vec2(3.3, 18.0));
  float cover = 1.0 - smoothstep(0.54, 0.54 + max(width.x, width.y) + 0.001, coverDistance);
  float grade = 0.49 + 0.055 * vnoise(position * 0.095) - 0.15 * gutter - 0.22 * cover;
  return mix(grade, 0.90, max(lane * 0.85, max(crosswalk, parking * 0.55)));
}
`;
}

export const ENGRAVING_PAVING_GLSL = /* glsl */`
float engravingPaving(vec2 position, vec2 width, float existingTone) {
  float slabJoints = engravingGrid(position, vec2(2.5), width, 0.055);
  float panel = hash12(floor(position / 2.5));
  float park = 1.0 - smoothstep(0.1, 0.28, existingTone);
  float concrete = 0.86 + 0.10 * panel - 0.20 * slabJoints;
  float garden = 0.57 + 0.12 * vnoise(position * 0.23);
  return mix(concrete, garden, park);
}
`;
