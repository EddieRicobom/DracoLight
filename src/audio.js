// Short synthesized sounds keep the game self-contained and start only after a user gesture.
export class GameAudio {
  constructor() { this.context = null; this.last = new Map(); this.muted = false; }
  async start() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      const c = this.context;
      const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const source = c.createBufferSource(); source.buffer = buffer; source.loop = true;
      this.windFilter = c.createBiquadFilter(); this.windFilter.type = 'lowpass';
      this.windGain = c.createGain(); this.windGain.gain.value = 0;
      source.connect(this.windFilter).connect(this.windGain).connect(c.destination);
      source.start();
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }
  setFlight(speed, active = true) {
    const c = this.context;
    if (!c || !this.windGain) return;
    const amount = Math.min(1, Math.max(0, speed / 500));
    const volume = active && !this.muted ? 0.008 + amount * 0.035 : 0;
    this.windGain.gain.setTargetAtTime(volume, c.currentTime, 0.25);
    this.windFilter.frequency.setTargetAtTime(350 + amount * 1300, c.currentTime, 0.3);
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
