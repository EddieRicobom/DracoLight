import { Object3D, Vector3 } from 'three';
import { clamp, damp, lerp, smooth } from './util.js';

const MIN_FLIGHT_CLEARANCE = 55;
const CHASE_RECOVERY_STEPS = [0.25, 0.5, 0.75, 1];

export function createPlayerCamera(camera, { cruiseSpeed, accelerateSpeed, raycast }) {
  const destination = new Vector3(), focus = new Vector3(), anchor = new Vector3();
  const heading = new Vector3(), offset = new Vector3(), side = new Vector3();
  const chase = new Vector3(), dioramaPosition = new Vector3(), sightline = new Vector3();
  const up = Object3D.DEFAULT_UP;
  let dioramaBlend = 0;

  function unobstructedDistance(point, distance = point.distanceTo(anchor)) {
    if (distance <= 2) return distance;
    sightline.subVectors(point, anchor).multiplyScalar(1 / distance);
    const hit = raycast(anchor, sightline, distance);
    return hit > 0 && hit < distance ? hit - Math.min(1.5, hit * 0.5) : distance;
  }

  return function update(dt, { walking, position, forward, yaw, pitch, speed, actualSpeed, boosting, shake, diorama }) {
    let fov = 70;
    if (walking) {
      heading.set(Math.sin(yaw), 0, Math.cos(yaw));
      anchor.copy(position).addScaledVector(up, 2.5);
      destination.copy(anchor).addScaledVector(heading, -12).addScaledVector(up, 5 - pitch * 5);
      focus.copy(anchor).addScaledVector(heading, 5);
    } else {
      anchor.copy(position);
      destination.copy(position).addScaledVector(forward, -64 - clamp(speed / 110, 0, 10)).addScaledVector(up, 27);
      focus.copy(position).addScaledVector(forward, 38);
      fov += clamp(speed / 55, 0, 14);
    }
    const chaseFov = fov;

    const slowFlight = 1 - smooth(cruiseSpeed, accelerateSpeed, Math.max(speed, actualSpeed));
    let wantedBlend = diorama ? (walking ? 1 : boosting ? 0 : slowFlight) : 0;
    const constrainFlight = !walking && (wantedBlend > 0 || dioramaBlend > 0);
    if (wantedBlend > 0 || dioramaBlend > 0) {
      // A distant, narrow perspective gives the elevated view nearly parallel lines.
      // Follow the walking heading so forward and strafe remain screen-relative.
      heading.set(Math.sin(yaw), 0, Math.cos(yaw));
      dioramaPosition.copy(anchor)
        .addScaledVector(heading, walking ? -35 : -118)
        .addScaledVector(up, walking ? 45 - pitch * 8 : 145);
      if (!walking) {
        chase.copy(destination);
        dioramaPosition.addScaledVector(side.crossVectors(heading, up), 65);
        // Give the view back to the chase camera before the long oblique sightline
        // would have to shorten to a close-up.
        if (wantedBlend > 0) wantedBlend *= smooth(85, 145, unobstructedDistance(dioramaPosition));
      }
    }

    dioramaBlend = lerp(dioramaBlend, wantedBlend, damp(6, dt));
    if (Math.abs(dioramaBlend - wantedBlend) < 0.001) dioramaBlend = wantedBlend;
    if (dioramaBlend > 0) {
      destination.lerp(dioramaPosition, dioramaBlend);
      focus.lerp(offset.copy(anchor).addScaledVector(heading, walking ? 3 : -10), dioramaBlend);
      fov = lerp(fov, walking ? 26 : 33, dioramaBlend);
    }

    camera.position.lerp(destination, damp(walking ? 7 : 5.5, dt));
    if (!walking && shake > 0.02) {
      const strength = shake * (1 - dioramaBlend);
      camera.position.add(offset.set((Math.random() - 0.5) * strength, (Math.random() - 0.5) * strength, 0));
    }
    if (dioramaBlend > 0 || constrainFlight) {
      let distance = camera.position.distanceTo(anchor);
      let clearance = unobstructedDistance(camera.position, distance);
      if (constrainFlight && clearance < distance && clearance < MIN_FLIGHT_CLEARANCE) {
        // An abrupt occluder can block the interpolated position before the blend
        // settles. Prefer the nearest intermediate direction with room to frame.
        const chaseClearance = unobstructedDistance(chase);
        if (chaseClearance >= MIN_FLIGHT_CLEARANCE) {
          for (const amount of CHASE_RECOVERY_STEPS) {
            offset.copy(camera.position).lerp(chase, amount);
            const candidateDistance = offset.distanceTo(anchor);
            const candidateClearance = unobstructedDistance(offset, candidateDistance);
            if (candidateClearance < MIN_FLIGHT_CLEARANCE) continue;
            camera.position.copy(offset);
            distance = candidateDistance;
            clearance = candidateClearance;
            focus.lerp(offset.copy(position).addScaledVector(forward, 38), amount);
            fov = lerp(fov, chaseFov, amount);
            dioramaBlend *= 1 - amount;
            break;
          }
        }
      }
      if (clearance < distance) {
        camera.position.sub(anchor).multiplyScalar(clearance / distance).add(anchor);
        fov = lerp(fov, 70, 1 - smooth(2, walking ? 26 : 70, clearance));
      }
    }
    camera.lookAt(focus);
    camera.fov = lerp(camera.fov, fov, damp(dioramaBlend > 0 ? 5 : 2.5, dt));
    camera.updateProjectionMatrix();
  };
}
