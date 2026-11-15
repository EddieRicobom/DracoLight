// Advance forward speed from propulsion, gravity along the flight path, and
// light aerodynamic drag. verticalDirection is the normalized forward Y:
// -1 points straight down; +1 points straight up.
export function advanceDiveSpeed(speed, dt, {
  targetSpeed = 95,
  verticalDirection = 0,
  gravity = 65,
  response = 2.8,
  drag = 0.035,
  braking = false,
} = {}) {
  const current = Math.max(0, speed);
  if (dt <= 0) return current;

  const climb = Math.max(-1, Math.min(1, verticalDirection));
  const target = Math.max(0, targetSpeed);
  // Propulsion fills a speed deficit; it never erases momentum gained in a dive.
  const propulsion = Math.max(0, target - current) * (1 - Math.exp(-response * dt));
  // Climbing already spends kinetic energy against gravity, so extra drag is
  // reduced there. There is no hard speed ceiling.
  const excess = Math.max(0, current - target);
  const effectiveDrag = braking ? 1.1 : climb < 0 ? 0 : drag;
  const dragLoss = excess * (1 - Math.exp(-effectiveDrag * dt));
  return Math.max(0, current + propulsion - gravity * climb * dt - dragLoss);
}

// Pure one-frame impact detector. Keep its returned state for the next frame.
// A fast dive arms one wave, emitted when the dive ends or braking begins.
export function advanceDiveImpact(previous, {
  speed,
  verticalDirection,
  braking = false,
}, {
  triggerSpeed = 500,
  resetSpeed = 400,
  diveEnter = -0.35,
  diveExit = -0.15,
} = {}) {
  const wasDiving = previous?.diving ?? false;
  const wasBraking = previous?.braking ?? false;
  const diving = wasDiving ? verticalDirection < diveExit : verticalDirection <= diveEnter;
  let armed = previous?.armed ?? false;
  const wasArmed = armed;
  if (speed < resetSpeed) armed = false;
  else if (!braking && speed >= triggerSpeed) armed = true;

  const releasedDive = wasDiving && !diving;
  const startedBraking = braking && !wasBraking;
  const triggered = wasArmed && speed >= triggerSpeed && (releasedDive || startedBraking);
  if (triggered) armed = false;
  return { diving, braking, armed, triggered };
}
