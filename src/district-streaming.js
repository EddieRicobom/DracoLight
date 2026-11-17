// Hold the current district past its nominal edge so a small turn near a
// boundary doesn't unload and immediately rebuild the same neighbouring meshes.
export function streamingDistrictIndex(position, previousIndex, { origin, width, count, margin }) {
  const offset = position - origin;
  if (previousIndex !== undefined) {
    const start = previousIndex * width;
    if (offset >= start - margin && offset < start + width + margin) return previousIndex;
  }
  return Math.min(count - 1, Math.max(0, Math.floor(offset / width)));
}
