// Short synthesized sounds keep the game self-contained and start only after a user gesture.
export class GameAudio {
  constructor() { this.context = null; this.last = new Map(); this.muted = false; }
  async start() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }
  play(kind) {
    const c = this.context;
    if (!c || c.state !== 'running' || this.muted) return;
    const now = c.currentTime;
    const config = {
      fire: [90, 55, 0.11, 0.025, 'sawtooth', 0.09],
      shot: [190, 45, 0.28, 0.065, 'sawtooth', 0.15],
      impact: [75, 28, 0.38, 0.09, 'triangle', 0.12],
      hit: [340, 110, 0.18, 0.045, 'square', 0.15],
      charge: [180, 470, 0.45, 0.035, 'sine', 0.7],
    }[kind];
    if (!config || now - (this.last.get(kind) ?? -Infinity) < config[5]) return;
    this.last.set(kind, now);
    const [from, to, duration, volume, type] = config;
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(now); osc.stop(now + duration + 0.01);
  }
}
