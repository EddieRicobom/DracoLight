// CPU deformation for the baked Boykisser mesh. Angles belong to limbs, not
// vertices, so calculate their trigonometric values once per frame.
export function animateBakedParts(parts, swing, pivots) {
  const armCos = Math.cos(1.1);
  const leftArmSin = Math.sin(-1.1);
  const rightArmSin = -leftArmSin;
  const swingCos = Math.cos(swing);
  const swingSin = Math.sin(swing);

  for (const part of parts) {
    const { base, groups, influence } = part;
    const target = part.mesh.geometry.attributes.position;
    const values = target.array;
    for (let i = 0, j = 0; i < groups.length; i++, j += 3) {
      const group = groups[i];
      const weight = influence[i];
      if (group === 0 || weight < 0.01) continue;

      const x = base[j], y = base[j + 1], z = base[j + 2];
      let px = x, py, pz;
      if (group <= 2) {
        const side = group === 1 ? 1 : -1;
        const pivotX = side * pivots.armPivotX;
        const dx = x - pivotX, dy = y - pivots.armPivotY;
        const armSin = group === 1 ? leftArmSin : rightArmSin;
        px = pivotX + dx * armCos - dy * armSin;
        py = pivots.armPivotY + dx * armSin + dy * armCos;
        const bendY = py - pivots.armPivotY;
        const bendZ = z - pivots.bodyCenterZ;
        const signedSwingSin = group === 1 ? swingSin : -swingSin;
        py = pivots.armPivotY + bendY * swingCos - bendZ * signedSwingSin;
        pz = pivots.bodyCenterZ + bendY * signedSwingSin + bendZ * swingCos;
      } else {
        const pivotX = (group === 3 ? 1 : -1) * pivots.legPivotX;
        const bendY = y - pivots.legPivotY;
        const bendZ = z - pivots.bodyCenterZ;
        const signedSwingSin = group === 3 ? -swingSin : swingSin;
        px = pivotX + (x - pivotX);
        py = pivots.legPivotY + bendY * swingCos - bendZ * signedSwingSin;
        pz = pivots.bodyCenterZ + bendY * signedSwingSin + bendZ * swingCos;
      }
      values[j] = x + (px - x) * weight;
      values[j + 1] = y + (py - y) * weight;
      values[j + 2] = z + (pz - z) * weight;
    }
    target.needsUpdate = true;
  }
}
