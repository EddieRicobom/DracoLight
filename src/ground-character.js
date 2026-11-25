import * as THREE from 'three';
import { CH, HALF } from './city.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const FOOTPRINT_CORNERS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** A ground based playable character. `position` is the point between the feet. */
export class GroundCharacter {
  constructor(scene, city, options = {}) {
    this.scene = scene;
    this.city = city;
    this.position = new THREE.Vector3().copy(options.position || new THREE.Vector3(0, 0, 0));
    this.velocity = new THREE.Vector3();
    this.yaw = Number.isFinite(options.yaw) ? options.yaw : Math.PI;
    this.facingYaw = this.yaw;
    this.height = options.height ?? 3.4;
    this.radius = options.radius ?? 0.8;
    this.walkSpeed = options.walkSpeed ?? 18;
    this.runSpeed = options.runSpeed ?? 38;
    this.climbSpeed = options.climbSpeed ?? 13;
    this.jumpSpeed = options.jumpSpeed ?? 12;
    this.gravity = options.gravity ?? 34;
    this.root = new THREE.Group();
    this.root.name = 'Ground character';
    this.root.position.copy(this.position);
    scene.add(this.root);
    this.grounded = false;
    this.climbing = false;
    this.climbYaw = null;
    this.state = 'idle';
    this._origin = new THREE.Vector3();
    this._move = new THREE.Vector3();
  }

  /** Move to a safe starting point. Set ground=true when changing from flight. */
  teleport(position, { ground = false, yaw = this.yaw } = {}) {
    this.position.copy(position);
    this.yaw = Number.isFinite(yaw) ? yaw : this.yaw;
    this.facingYaw = this.yaw;
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.climbing = false;
    this.climbYaw = null;
    if (ground) {
      this.position.y = 0;
      // A flight position may sit over a building. Choose nearby open street.
      for (let radius = 0; radius <= 100; radius += 5) {
        let found = false;
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const x = clamp(position.x + dx * radius, -HALF + this.radius, HALF - this.radius);
          const z = clamp(position.z + dz * radius, -HALF + this.radius, HALF - this.radius);
          if (!this._occupied(x, 0, z)) {
            this.position.x = x;
            this.position.z = z;
            this.grounded = true;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    this.state = this.grounded ? 'idle' : 'air';
    this.root.position.copy(this.position);
    this.root.rotation.y = this.facingYaw;
  }

  /** Highest solid surface below `topY`, including the street at y=0. */
  findGround(x, z, topY = 320) {
    const origin = this._origin.set(x, topY, z);
    const distance = this.city.raycast(origin, DOWN, Math.max(0, topY) + 1);
    return Number.isFinite(distance) ? Math.max(0, topY - distance) : 0;
  }

  _sweptGround(topY, maxDistance) {
    const { x, z } = this.position;
    const radius = this.radius;
    const origin = this._origin.set(x, topY, z);
    const centerDistance = this.city.raycast(origin, DOWN, maxDistance);
    // A ray that starts inside a wall returns zero, which cannot support the feet.
    let ground = centerDistance > 0 && centerDistance <= maxDistance ? topY - centerDistance : 0;
    // Roofs are on voxel boundaries. Probe the corners only if a higher roof can overlap the feet.
    const highestRoof = Math.floor(topY / CH) * CH;
    if (topY - highestRoof > maxDistance) return ground;
    for (const [dx, dz] of FOOTPRINT_CORNERS) {
      if (ground >= highestRoof) break;
      origin.set(x + dx * radius, topY, z + dz * radius);
      const distance = this.city.raycast(origin, DOWN, Math.min(maxDistance, topY - ground));
      if (distance > 0 && distance <= maxDistance) ground = Math.max(ground, topY - distance);
    }
    return ground;
  }

  _occupied(x, y, z) {
    const r = this.radius;
    for (const dx of [-r, r]) for (const dz of [-r, r]) {
      if (this.city.chunkAt(x + dx, y + 0.35, z + dz) >= 0 ||
          this.city.chunkAt(x + dx, y + this.height - 0.25, z + dz) >= 0) return true;
    }
    return false;
  }

  /**
   * Per frame input: forward/strafe in [-1,1], sprint/jump booleans, yaw in radians.
   * +forward follows local +Z; +strafe moves to camera/model right (local -X).
   * Returns the current movement state.
   */
  update(dt, {
    forward = 0, strafe = 0, sprint = false, jump = false, yaw = this.yaw, movementYaw = yaw,
    speedScale = 1, climbScale = 1, gravityScale = 1, lift, fallLimit = Infinity,
    allowClimb = true, slide = false, sweep = false, faceMovement = false,
  } = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    this.yaw = Number.isFinite(yaw) ? yaw : this.yaw;
    movementYaw = Number.isFinite(movementYaw) ? movementYaw : this.yaw;
    const magnitude = Math.hypot(forward, strafe);
    const inputLength = Math.min(1, magnitude);
    const speed = (sprint ? this.runSpeed : this.walkSpeed) * inputLength * speedScale;
    this._move.set(
      Math.sin(movementYaw) * forward - Math.cos(movementYaw) * strafe,
      0,
      Math.cos(movementYaw) * forward + Math.sin(movementYaw) * strafe
    );
    const heading = magnitude > 0 ? Math.atan2(this._move.x, this._move.z) : this.facingYaw;
    if (magnitude > 0) this._move.divideScalar(magnitude);
    this._move.multiplyScalar(speed * dt);
    const { x: previousX, y: previousY, z: previousZ } = this.position;
    const x = clamp(previousX + this._move.x, -HALF + this.radius, HALF - this.radius);
    const z = clamp(previousZ + this._move.z, -HALF + this.radius, HALF - this.radius);
    const blocked = this._blockedPath(x, z, sweep);
    const pushingWall = allowClimb && lift === undefined && blocked && inputLength > 0.15 && forward > 0.1;
    this.climbing = pushingWall;
    this.climbYaw = pushingWall ? Math.atan2(this._move.x, this._move.z) : null;

    if (this.climbing) {
      this.velocity.y = this.climbSpeed * climbScale;
      const nextY = this.position.y + this.velocity.y * dt;
      if (!this._occupied(this.position.x, nextY, this.position.z)) this.position.y = nextY;
    } else {
      if (lift !== undefined) { this.velocity.y = lift; this.grounded = false; }
      else if (this.grounded && jump) { this.velocity.y = this.jumpSpeed; this.grounded = false; }
      this.velocity.y = Math.max(-fallLimit, this.velocity.y - this.gravity * gravityScale * dt);
      const nextY = Math.max(0, previousY + this.velocity.y * dt);
      if (sweep && nextY > previousY && this._occupied(this.position.x, nextY, this.position.z)) this.velocity.y = 0;
      else this.position.y = nextY;
      const blockedAfterLift = sweep && this.position.y > previousY ? this._blockedPath(x, z, true) : blocked;
      if (!blockedAfterLift) { this.position.x = x; this.position.z = z; }
      else if (slide) {
        if (!this._blockedPath(x, this.position.z, sweep)) this.position.x = x;
        else if (!this._blockedPath(this.position.x, z, sweep)) this.position.z = z;
      }
    }

    // Sweep down from just above the feet, so roofs and the road support the player.
    this.grounded = false;
    if (!this.climbing && this.velocity.y <= 0) {
      const snap = Math.max(0.15, -this.velocity.y * dt + 0.15);
      const topY = (sweep ? Math.max(previousY, this.position.y) : this.position.y) + 0.15;
      const ground = sweep ? this._sweptGround(topY, topY - this.position.y + snap)
        : this.findGround(this.position.x, this.position.z, topY);
      if (this.position.y - ground <= snap) {
        this.position.y = ground;
        this.velocity.y = 0;
        this.grounded = true;
      }
    }

    if (this.climbing) this.state = 'climb';
    else if (!this.grounded) this.state = 'air';
    else if (inputLength < 0.08) this.state = 'idle';
    else this.state = sprint ? 'run' : 'walk';
    this.root.position.copy(this.position);
    if (faceMovement) {
      if (inputLength > 0.08) {
        const movedX = this.position.x - previousX;
        const movedZ = this.position.z - previousZ;
        const facingTarget = movedX || movedZ ? Math.atan2(movedX, movedZ) : heading;
        const turn = facingTarget - this.facingYaw;
        this.facingYaw += Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-20 * dt));
      }
    } else this.facingYaw = this.yaw;
    this.root.rotation.y = this.facingYaw;
    return this.state;
  }

  _blockedPath(x, z, sweep) {
    if (!sweep) return this._occupied(x, this.position.y, z);
    const { x: startX, y, z: startZ } = this.position;
    const dx = x - startX, dz = z - startZ;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / Math.max(0.5, this.radius)));
    for (let i = 1; i <= steps; i++) {
      if (this._occupied(startX + dx * i / steps, y, startZ + dz * i / steps)) return true;
    }
    return false;
  }

  dispose() {
    this.scene.remove(this.root);
  }
}
