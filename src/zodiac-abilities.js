import * as THREE from 'three';

export const ZODIAC_ABILITIES = Object.freeze({
  rat: { name: 'Esquiva', description: 'Dispare na direção em que estiver se movendo.', duration: 0.3, cooldown: 2.1 },
  ox: { name: 'Investida', description: 'Avance e abra uma passagem na primeira parede que atingir.', duration: 0.95, cooldown: 4.1 },
  tiger: { name: 'Bote', description: 'Salte à frente e quebre blocos ao aterrissar.', duration: 4.5, cooldown: 5 },
  rabbit: { name: 'Salto Triplo', description: 'Aperte até três vezes em sequência para saltar de novo no ar.', duration: 1.65, cooldown: 3.3 },
  snake: { name: 'Serpenteio', description: 'Ganhe agilidade lateral e deslize pelos cantos das paredes.', duration: 2.2, cooldown: 4 },
  horse: { name: 'Galope', description: 'Continue em movimento para embalar até a velocidade máxima.', duration: 2.6, cooldown: 4.5 },
  goat: { name: 'Escalada Alpina', description: 'Corra contra uma parede para subi-la muito mais depressa.', duration: 3, cooldown: 4.6 },
  monkey: { name: 'Salto de Fachada', description: 'Mire uma fachada próxima para ganhar altura e se lançar na direção dela.', duration: 1.45, cooldown: 4 },
  rooster: { name: 'Planeio', description: 'Abra as asas no chão ou no ar e prolongue a descida.', duration: 2.5, cooldown: 4.7 },
  dog: { name: 'Faro', description: 'Rastreie a relíquia mais próxima a até 1.100 m.', duration: 7, cooldown: 9 },
  pig: { name: 'Baque', description: 'Despenque com força e esmague a área ao aterrissar.', duration: 6, cooldown: 6.5 },
});

export const ZODIAC_IMPACTS = Object.freeze({
  ox: Object.freeze({ radius: 7, power: 44, maxChunks: 18 }),
  tiger: Object.freeze({ radius: 8, power: 40, maxChunks: 24 }),
  pig: Object.freeze({ radius: 13, power: 59, maxChunks: 43 }),
});

const RABBIT_INTERVAL = 0.21;
const RAT_MIN_DIRECTION = 0.12;
const directionAt = (vector, yaw) => vector.set(Math.sin(yaw), 0, Math.cos(yaw));

/**
 * Owns local ability timing and movement. Impact effects are reported to the caller
 * so the same abilities work with either a local or an authoritative network world.
 */
export class ZodiacAbilities {
  constructor({ city, onEffect = () => {} }) {
    this.city = city;
    this.onEffect = onEffect;
    this.time = 0;
    this.readyAt = new Map();
    this.effectPosition = new THREE.Vector3();
    this.effectDirection = new THREE.Vector3();
    this.wallProbe = new THREE.Vector3();
    this.select(null);
  }

  select(id) {
    const next = Object.hasOwn(ZODIAC_ABILITIES, id) ? id : null;
    if (next === this.id) return;
    this.id = next;
    this.pendingYaw = null;
    this.startedAt = 0;
    this.endsAt = 0;
    this.nextTrail = 0;
    this.hops = 0;
    this.hopAt = 0;
    this.heading = 0;
    this.gallop = 0;
    this.sawAirborne = false;
    this.spentImpact = false;
  }

  get active() {
    return this.time < this.endsAt;
  }

  get remaining() {
    if (this.id === 'rabbit' && this.active && this.hops < 3) {
      return Math.max(0, this.hopAt + RABBIT_INTERVAL - this.time);
    }
    return Math.max(0, (this.readyAt.get(this.id) ?? 0) - this.time);
  }

  get relicGuideRange() {
    return this.id === 'dog' && this.active ? 1100 : undefined;
  }

  activate(actor, yaw = actor.yaw) {
    if (!this.id || this.pendingYaw !== null || this.remaining > 0) return false;
    this.pendingYaw = yaw;
    return true;
  }

  _emit(type, position, yaw) {
    this.onEffect({
      id: this.id,
      type,
      position: this.effectPosition.copy(position),
      direction: directionAt(this.effectDirection, yaw),
    });
  }

  _begin(human, input, motion, wasActive) {
    const yaw = this.pendingYaw;
    const { duration, cooldown } = ZODIAC_ABILITIES[this.id];
    this.pendingYaw = null;
    this.readyAt.set(this.id, this.time + cooldown);
    if (this.id !== 'rabbit' || !wasActive) {
      this.startedAt = this.time;
      this.endsAt = this.time + duration;
      this.nextTrail = this.time + 0.16;
      this.hops = 0;
      this.heading = yaw;
      this.gallop = 0;
      this.sawAirborne = false;
      this.spentImpact = false;
    }
    switch (this.id) {
      case 'rat': {
        const { forward = 0, strafe = 0 } = input;
        if (Math.hypot(forward, strafe) >= RAT_MIN_DIRECTION) this.heading = yaw - Math.atan2(strafe, forward);
        break;
      }
      case 'tiger':
        motion.lift = 18;
        break;
      case 'rabbit':
        this.hopAt = this.time;
        this.hops++;
        motion.lift = 14;
        break;
      case 'monkey': {
        const direction = directionAt(this.effectDirection, yaw);
        this.wallProbe.copy(human.position).y += human.height * 0.5;
        const distance = this.city.raycast(this.wallProbe, direction, 22);
        this.vaulting = distance <= 22;
        motion.lift = this.vaulting ? 42 : 24;
        break;
      }
      case 'rooster':
        motion.lift = human.grounded ? 15 : 8;
        break;
      case 'pig':
        motion.lift = human.grounded ? 8 : -54;
        this.sawAirborne = !human.grounded;
        break;
    }
    this._emit('start', human.position, this.heading);
  }

  _dash(motion, speedScale, movementYaw = this.heading) {
    Object.assign(motion, { forward: 1, strafe: 0, sprint: true, jump: false, speedScale, movementYaw, allowClimb: false });
  }

  _charge(dt, human, motion) {
    this._dash(motion, Math.max(1, 65 / human.runSpeed));
    if (this.spentImpact) return;
    const direction = directionAt(this.effectDirection, this.heading);
    const reach = human.radius + Math.max(human.runSpeed, 65) * dt + 0.3;
    this.wallProbe.copy(human.position).y += human.height * 0.5;
    const hit = this.city.raycast(this.wallProbe, direction, reach);
    if (hit > reach) return;
    this.spentImpact = true;
    this.wallProbe.addScaledVector(direction, hit);
    this._emit('impact', this.wallProbe, this.heading);
  }

  update(dt, human, input = {}) {
    const wasActive = this.active;
    this.time += dt;
    if (!this.id) return human.update(dt, input);
    if (!this.active && this.pendingYaw === null) return human.update(dt, input);
    const motion = { ...input, sweep: true };
    if (this.pendingYaw !== null) this._begin(human, input, motion, wasActive);
    const progress = this.time - this.startedAt;
    switch (this.id) {
      case 'rat':
        this._dash(motion, 1.8 - progress * 1.35);
        motion.slide = true;
        break;
      case 'ox':
        this._charge(dt, human, motion);
        break;
      case 'tiger':
        if (progress < 0.75) this._dash(motion, 1.35);
        motion.allowClimb = false;
        motion.jump = false;
        break;
      case 'snake':
        motion.speedScale = 1.05 + Math.abs(input.strafe ?? 0) * 0.65;
        motion.sprint = true;
        motion.slide = true;
        motion.allowClimb = false;
        break;
      case 'horse':
        this.gallop = Math.hypot(input.forward ?? 0, input.strafe ?? 0) > 0.3
          ? Math.min(1, this.gallop + dt * 1.25)
          : Math.max(0, this.gallop - dt * 4);
        motion.sprint = true;
        motion.speedScale = 1 + this.gallop * 0.95;
        break;
      case 'goat':
        motion.climbScale = 2.8;
        break;
      case 'monkey':
        if (this.vaulting && progress < 1.2) this._dash(motion, 1.15);
        motion.gravityScale = this.vaulting ? 0.83 : 1;
        motion.allowClimb = false;
        break;
      case 'rooster':
        motion.gravityScale = 0.48;
        motion.fallLimit = 5;
        motion.speedScale = 1.15;
        motion.allowClimb = false;
        break;
      case 'pig':
        motion.jump = false;
        motion.allowClimb = false;
        motion.speedScale = 0.75;
        if (this.sawAirborne && progress >= 0.18) motion.lift = -54;
        break;
    }
    const result = human.update(dt, motion);
    if (this.id === 'tiger' || this.id === 'pig') {
      if (this.sawAirborne && human.grounded) {
        this.endsAt = this.time;
        this._emit('impact', human.position, input.yaw ?? human.yaw);
      } else if (!human.grounded) this.sawAirborne = true;
      else if (progress > 0.1) this.endsAt = this.time;
    }
    if (this.active && this.time >= this.nextTrail && !['rabbit', 'dog'].includes(this.id)) {
      this.nextTrail = this.time + 0.16;
      this._emit('trail', human.position, input.yaw ?? human.yaw);
    }
    return result;
  }
}
