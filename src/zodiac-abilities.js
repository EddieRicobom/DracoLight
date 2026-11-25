import * as THREE from 'three';

export const ZODIAC_ABILITIES = Object.freeze({
  rat: { name: 'Esquiva', description: 'Dispare na direção em que estiver se movendo.', duration: 0.3, cooldown: 2.1 },
  ox: { name: 'Investida', description: 'Avance e abra uma passagem na primeira parede que atingir.', duration: 0.95, cooldown: 4.1 },
  tiger: { name: 'Bote', description: 'Salte à frente e quebre blocos ao aterrissar.', duration: 4.5, cooldown: 5 },
  rabbit: { name: 'Salto Triplo', description: 'Aperte até três vezes em sequência para saltar de novo no ar.', duration: 1.65, cooldown: 3.3 },
  snake: { name: 'Serpenteio', description: 'Ganhe agilidade lateral e deslize pelos cantos das paredes.', duration: 2.2, cooldown: 4 },
  horse: { name: 'Galope', description: 'Ganhe velocidade em terreno livre. Frear ou bater numa parede reduz o embalo.', duration: 2.6, cooldown: 4.5 },
  goat: { name: 'Escalada Alpina', description: 'Corra contra uma parede para subi-la muito mais depressa.', duration: 3, cooldown: 4.6 },
  monkey: { name: 'Salto de Fachada', description: 'Mire uma fachada próxima e, ao alcançá-la, aperte pular para se impulsionar para longe da parede.', duration: 1.45, cooldown: 4 },
  rooster: { name: 'Planeio', description: 'Abra as asas para planar e aperte pular até três vezes para bater asas.', duration: 2.5, cooldown: 4.7 },
  dog: { name: 'Faro', description: 'Ganhe velocidade e siga o rastro da relíquia mais próxima a até 1.100 m.', duration: 7, cooldown: 9 },
  pig: { name: 'Baque', description: 'Role e dê um pulo se estiver no chão, ou mergulhe se estiver no ar. Esmague a área ao aterrissar.', duration: 6, cooldown: 6.5 },
});

export const ZODIAC_IMPACTS = Object.freeze({
  ox: Object.freeze({ radius: 7, power: 44, maxChunks: 18 }),
  tiger: Object.freeze({ radius: 8, power: 40, maxChunks: 24 }),
  pig: Object.freeze({ radius: 13, power: 59, maxChunks: 43 }),
});

const RABBIT_INTERVAL = 0.21;
const RABBIT_INPUT_BUFFER = 0.07;
const RAT_MIN_DIRECTION = 0.12;
const WALL_KICK_PUSH_TIME = 0.16;
const DOG_SCENT_RANGE = 1100;
const PIG_ROLL_TIME = 0.36;
const directionAt = (vector, yaw) => vector.set(Math.sin(yaw), 0, Math.cos(yaw));
const movementYaw = (input, yaw, fallback = yaw) => {
  const { forward = 0, strafe = 0 } = input;
  return Math.hypot(forward, strafe) >= RAT_MIN_DIRECTION ? yaw - Math.atan2(strafe, forward) : fallback;
};
const steer = (heading, target, turnRadius) => {
  const angle = Math.atan2(Math.sin(target - heading), Math.cos(target - heading));
  return heading + Math.max(-turnRadius, Math.min(angle, turnRadius));
};

/**
 * Owns local ability timing and movement. Impact effects are reported to the caller
 * so the same abilities work with either a local or an authoritative network world.
 *
 * Each animal also carries an ink charge (`ink`, 0..1). Fast movement and painted
 * brushwork fill it; the next ability becomes a wider, longer "Obra-prima".
 */
export class ZodiacAbilities {
  constructor({ city, onEffect = () => {} }) {
    this.city = city;
    this.onEffect = onEffect;
    this.time = 0;
    this.jumpHeld = false;
    this.readyAt = new Map();
    this.ink = 0;
    this.surgeActive = false;
    this.effectPosition = new THREE.Vector3();
    this.effectDirection = new THREE.Vector3();
    this.wallProbe = new THREE.Vector3();
    this.chargeHit = new THREE.Vector3();
    this.travelStart = new THREE.Vector3();
    this.select(null);
  }

  select(id) {
    const next = Object.hasOwn(ZODIAC_ABILITIES, id) ? id : null;
    if (next === this.id) return;
    this.id = next;
    this.ink = 0;
    this.surgeActive = false;
    this.pendingYaw = null;
    this.startedAt = 0;
    this.endsAt = 0;
    this.duration = 0;
    this.nextTrail = 0;
    this.nextInk = 0;
    this.hops = 0;
    this.hopAt = 0;
    this.heading = 0;
    this.gallop = 0;
    this.sawAirborne = false;
    this.spentImpact = false;
    this.clawed = false;
    this.endInk = false;
    this.rolling = false;
    this.vaulting = false;
    this.flaps = 0;
    this.nextFlap = 0;
    this.wallKickAt = 0;
    this.wallKickUntil = 0;
    this.wallKickYaw = 0;
    this.stamps = [];
  }

  get active() {
    return this.time < this.endsAt;
  }

  get remaining() {
    if (this.id === 'rabbit' && this.active && this.hops < 3) {
      return Math.max(0, this.hopAt + RABBIT_INTERVAL - this.time);
    }
    return Math.max(0, Math.max(this.endsAt, this.readyAt.get(this.id) ?? 0) - this.time);
  }

  get relicGuideRange() {
    return this.id === 'dog' && this.active ? DOG_SCENT_RANGE * (this.surgeActive ? 1.25 : 1) : undefined;
  }

  get surgeReady() {
    return this.ink >= 1;
  }

  addInk(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.ink = Math.min(1, this.ink + amount);
  }

  /** A closed ink loop shortens the current animal's cooldown a little. */
  refund(seconds) {
    if (!this.id || !Number.isFinite(seconds) || seconds <= 0) return;
    const ready = this.readyAt.get(this.id);
    if (ready !== undefined) this.readyAt.set(this.id, Math.max(this.time, ready - seconds));
  }

  activate(actor, yaw = actor.yaw) {
    if (!this.id || this.pendingYaw !== null) return false;
    const buffer = this.id === 'rabbit' && this.active && this.hops < 3 ? RABBIT_INPUT_BUFFER : 0;
    if (this.remaining > buffer) return false;
    this.pendingYaw = yaw;
    return true;
  }

  _emit(type, position, yaw, scale = 1) {
    this.onEffect({
      id: this.id,
      type,
      position: this.effectPosition.copy(position),
      direction: directionAt(this.effectDirection, yaw),
      scale,
    });
  }

  _begin(human, input, motion, wasActive) {
    const yaw = this.pendingYaw;
    const { duration, cooldown } = ZODIAC_ABILITIES[this.id];
    const fresh = this.id !== 'rabbit' || !wasActive;
    const surged = fresh ? this.ink >= 1 : this.surgeActive;
    if (fresh) {
      this.surgeActive = surged;
      if (surged) this.ink = 0;
    }
    const scale = this.surgeActive ? 1.22 : 1;
    const span = duration * (this.surgeActive ? 1.3 : 1);
    this.pendingYaw = null;
    this.readyAt.set(this.id, this.time + cooldown * (this.surgeActive ? 0.8 : 1));
    this.duration = span;
    if (fresh) {
      this.startedAt = this.time;
      this.endsAt = this.time + span;
      this.nextTrail = this.time + 0.16;
      this.nextInk = this.time + 0.2;
      this.hops = 0;
      this.heading = yaw;
      this.gallop = 0;
      this.sawAirborne = false;
      this.spentImpact = false;
      this.clawed = false;
      this.endInk = false;
      this.rolling = false;
      this.vaulting = false;
      this.flaps = 0;
      this.nextFlap = 0;
      this.wallKickUntil = 0;
      this.stamps = [];
    }
    switch (this.id) {
      case 'rat':
        this.heading = movementYaw(input, yaw);
        break;
      case 'tiger':
        this.heading = movementYaw(input, yaw);
        motion.lift = 18 * scale;
        break;
      case 'rabbit': {
        // Ink left by an earlier hop acts as a springboard for the next one.
        let spring = 0;
        for (const stamp of this.stamps) {
          if (stamp.distanceToSquared(human.position) < 9) { spring = 4; break; }
        }
        this.stamps.push(human.position.clone());
        this.hopAt = this.time;
        this.hops++;
        this.heading = movementYaw(input, yaw);
        motion.lift = Math.max(human.velocity.y, (14 + spring) * scale);
        this._emit('ink', human.position, this.heading, this.hops >= 3 ? 1.35 : 0.8);
        break;
      }
      case 'monkey': {
        const direction = directionAt(this.effectDirection, yaw);
        this.wallProbe.copy(human.position).y += human.height * 0.5;
        const distance = this.city.raycast(this.wallProbe, direction, 22);
        this.vaulting = distance <= 22;
        motion.lift = (this.vaulting ? 42 : 24) * scale;
        break;
      }
      case 'rooster':
        motion.lift = Math.max(human.velocity.y, (human.grounded ? 15 : 8) * scale);
        break;
      case 'pig':
        this.rolling = human.grounded;
        this.heading = movementYaw(input, yaw);
        motion.lift = human.grounded ? 12 * scale : Math.min(human.velocity.y, -54 * scale);
        this.sawAirborne = !human.grounded;
        break;
    }
    this._emit('start', human.position, this.heading);
    this._emit('ink', human.position, this.heading, fresh ? 0.72 : 0.55);
    if (fresh && this.surgeActive) this._emit('surge', human.position, this.heading);
  }

  _dash(motion, speedScale, movementYaw = this.heading) {
    Object.assign(motion, { forward: 1, strafe: 0, sprint: true, jump: false, speedScale, movementYaw, allowClimb: false });
  }

  _charge(dt, human, motion, flow) {
    const speed = Math.max(human.runSpeed, 65) * (this.surgeActive ? 1.15 : 1);
    const braking = this.spentImpact ? 0.68 : 1;
    this._dash(motion, speed / human.runSpeed * braking);
    if (this.spentImpact) return;
    const direction = directionAt(this.effectDirection, this.heading);
    const stride = speed * flow * dt + 0.3;
    let nearest = Infinity;
    // Trace from the centre and each side of the body so a corner hit also opens a passage.
    for (const side of [0, -1, 1]) {
      this.wallProbe.copy(human.position).y += human.height * 0.5;
      this.wallProbe.x -= direction.z * side * human.radius;
      this.wallProbe.z += direction.x * side * human.radius;
      const hit = this.city.raycast(this.wallProbe, direction, stride + human.radius);
      if (hit < nearest) {
        nearest = hit;
        this.chargeHit.copy(this.wallProbe).addScaledVector(direction, hit);
      }
    }
    if (!Number.isFinite(nearest)) return;
    this.spentImpact = true;
    this._emit('impact', this.chargeHit, this.heading);
    this._emit('ink', this.chargeHit, this.heading, 1.2);
  }

  _wallKick(human, motion, jumpPressed, powered = false) {
    let lift;
    if (jumpPressed && human.climbing && this.time >= this.wallKickAt) {
      this.wallKickAt = this.time + (powered ? 0.55 : 0.42);
      this.wallKickUntil = this.time + WALL_KICK_PUSH_TIME;
      this.wallKickYaw = (human.climbYaw ?? human.yaw) + Math.PI;
      lift = powered ? 27 * (this.surgeActive ? 1.22 : 1) : 22;
      this._emit('ink', human.position, this.wallKickYaw, powered ? 1.1 : 0.85);
    }
    if (this.time >= this.wallKickUntil) return motion;
    // Push off in the opposite direction of the climb, even if the camera turned.
    // Briefly keep forward input from grabbing the wall again.
    return { ...motion, forward: 1, strafe: 0, movementYaw: this.wallKickYaw,
      sweep: true, allowClimb: false, jump: false, lift };
  }

  update(dt, human, input = {}) {
    const frameTime = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    dt = Math.min(0.05, frameTime);
    const wasActive = this.active;
    this.time += frameTime;
    const jumpPressed = Boolean(input.jump) && !this.jumpHeld;
    this.jumpHeld = Boolean(input.jump);
    const flow = Number.isFinite(input.flowBoost) && input.flowBoost > 1 ? input.flowBoost : 1;
    const passive = flow > 1 ? { ...input, speedScale: (input.speedScale ?? 1) * flow } : input;
    if (!this.id) return human.update(dt, passive);
    const travel = { ...passive, faceMovement: true, sweep: true };
    if (!this.active && this.pendingYaw === null) {
      return human.update(dt, this._wallKick(human, travel, jumpPressed));
    }
    const motion = { ...input, faceMovement: true, sweep: true };
    const waitingForHop = this.id === 'rabbit' && wasActive && this.time < this.hopAt + RABBIT_INTERVAL;
    if (this.pendingYaw !== null && !waitingForHop) this._begin(human, input, motion, wasActive);
    const progress = this.time - this.startedAt;
    const moveHeading = movementYaw(input, input.yaw ?? human.yaw, this.heading);
    switch (this.id) {
      case 'rat':
        this._dash(motion, (1.8 - progress * 1.35) * (this.surgeActive ? 1.12 : 1));
        motion.slide = true;
        break;
      case 'ox':
        this._charge(dt, human, motion, flow);
        break;
      case 'tiger':
        if (progress < 0.75) {
          this.heading = steer(this.heading, moveHeading, 2.7 * dt);
          this._dash(motion, this.surgeActive ? 1.5 : 1.35);
          motion.slide = true;
        }
        if (!this.clawed && progress >= 0.5) {
          this.clawed = true;
          this._emit('ink', human.position, this.heading, 1.15);
        }
        motion.allowClimb = false;
        motion.jump = false;
        break;
      case 'snake':
        this.heading = moveHeading;
        motion.speedScale = (1.08 + Math.abs(input.strafe ?? 0) * 0.7) * (this.surgeActive ? 1.15 : 1);
        motion.sprint = true;
        motion.slide = true;
        motion.allowClimb = false;
        if (!this.endInk && progress >= this.duration - 0.12) {
          this.endInk = true;
          this._emit('ink', human.position, this.heading, 1.2);
        }
        break;
      case 'horse':
        this.travelStart.copy(human.position);
        this.gallop *= Math.max(0, Math.cos(moveHeading - this.heading));
        this.heading = moveHeading;
        motion.sprint = true;
        motion.speedScale = 1 + this.gallop * (this.surgeActive ? 1.35 : 1.15);
        motion.allowClimb = false;
        break;
      case 'goat':
        motion.climbScale = this.surgeActive ? 3.4 : 2.8;
        break;
      case 'monkey':
        if (this.vaulting && progress < 0.72) this._dash(motion, this.surgeActive ? 1.25 : 1.15);
        motion.gravityScale = this.vaulting ? 0.83 : 1;
        motion.allowClimb = false;
        if (this.vaulting && jumpPressed && progress > 0.1) {
          this.wallProbe.copy(human.position).y += human.height * 0.5;
          const direction = directionAt(this.effectDirection, this.heading);
          if (this.city.raycast(this.wallProbe, direction, 3.2) <= 3.2) {
            this.vaulting = false;
            this.wallKickYaw = this.heading + Math.PI;
            this.wallKickUntil = this.time + WALL_KICK_PUSH_TIME * 1.5;
            motion.lift = Math.max(human.velocity.y + 8, 29 * (this.surgeActive ? 1.2 : 1));
            this._emit('ink', human.position, this.wallKickYaw, 1.1);
          }
        }
        if (this.time < this.wallKickUntil) this._dash(motion, 1.05, this.wallKickYaw);
        break;
      case 'rooster':
        if (jumpPressed && this.time >= this.nextFlap && this.flaps < 3) {
          this.flaps++;
          this.nextFlap = this.time + 0.32;
          motion.lift = Math.max(motion.lift ?? human.velocity.y, 11 * (this.surgeActive ? 1.22 : 1));
          this._emit('ink', human.position, moveHeading, 0.95);
        }
        motion.jump = false;
        motion.gravityScale = human.velocity.y > 0 ? 0.75 : 0.48;
        motion.fallLimit = 5;
        motion.speedScale = this.surgeActive ? 1.35 : 1.2;
        motion.allowClimb = false;
        motion.slide = true;
        break;
      case 'dog':
        motion.speedScale = (input.speedScale ?? 1) * (this.surgeActive ? 1.33 : input.sprint ? 1.23 : 1.12);
        motion.slide = true;
        break;
      case 'pig':
        if (this.rolling && progress >= PIG_ROLL_TIME) {
          this.rolling = false;
          this._emit('ink', human.position, this.heading, 1.05);
        }
        if (this.rolling) {
          this.heading = steer(this.heading, moveHeading, 2.2 * dt);
          this._dash(motion, this.surgeActive ? 1.65 : 1.5);
          motion.slide = true;
        } else {
          motion.jump = false;
          motion.allowClimb = false;
          motion.speedScale = 0.75;
          motion.lift = Math.min(human.velocity.y, -54 * (this.surgeActive ? 1.25 : 1));
        }
        break;
    }
    if (flow > 1) motion.speedScale = (motion.speedScale ?? 1) * flow;
    const finalMotion = this.id === 'goat' || this.id === 'dog'
      ? this._wallKick(human, motion, jumpPressed, this.id === 'goat') : motion;
    const result = human.update(dt, finalMotion);
    if (this.id === 'horse') {
      const travel = Math.hypot(human.position.x - this.travelStart.x, human.position.z - this.travelStart.z);
      this.gallop = travel > human.runSpeed * dt * 0.3
        ? Math.min(1, this.gallop + dt * 1.25) : Math.max(0, this.gallop - dt * 4);
      if (this.gallop > 0.6 && this.time >= this.nextInk) {
        this.nextInk = this.time + 0.55;
        this._emit('ink', human.position, this.heading, 0.85);
      }
    }
    if (this.id === 'tiger' || this.id === 'pig') {
      if (!human.grounded) this.sawAirborne = true;
      else if (!this.rolling && (this.sawAirborne || this.id === 'pig')) {
        this.endsAt = this.time;
        this._emit('impact', human.position, human.facingYaw ?? human.yaw);
      } else if (!this.rolling && progress > 0.1) this.endsAt = this.time;
    }
    if (this.active && this.time >= this.nextTrail && !['rabbit', 'dog'].includes(this.id)) {
      this.nextTrail = this.time + 0.16;
      this._emit('trail', human.position, human.facingYaw ?? human.yaw);
    }
    return result;
  }
}
