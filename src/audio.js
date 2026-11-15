// Short synthesized sounds keep the game self-contained and start only after a user gesture.
export class GameAudio {
  constructor() {
    this.context = null; this.last = new Map(); this._muted = false;
    this.supersonic = false; this.lastBoom = -Infinity; this.boomGain = null;
  }
  get muted() { return this._muted; }
  set muted(value) {
    this._muted = !!value;
    if (this.masterGain) this.masterGain.gain.setValueAtTime(this._muted ? 0 : 1, this.context.currentTime);
  }
  async start() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      const c = this.context;
      this.masterGain = c.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 1;
      this.masterGain.connect(c.destination);
      const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      this.noiseBuffer = buffer;
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const source = c.createBufferSource(); source.buffer = buffer; source.loop = true;
      this.windFilter = c.createBiquadFilter(); this.windFilter.type = 'lowpass';
      this.windGain = c.createGain(); this.windGain.gain.value = 0;
      source.connect(this.windFilter).connect(this.windGain).connect(this.masterGain);
      source.start();
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }
  setFlight(speed, active = true) {
    const c = this.context;
    const speedMps = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    if (!active) {
      this.supersonic = false;
      if (this.boomGain && c) {
        this.boomGain.gain.cancelScheduledValues(c.currentTime);
        this.boomGain.gain.setValueAtTime(0, c.currentTime);
      }
    }
    if (!c || !this.windGain) return;
    const amount = Math.min(1, speedMps / 500);
    const hypersonic = Math.max(0, Math.min(1, (speedMps / 343 - 3) / 4));
    const volume = active ? 0.006 + amount * 0.045 + hypersonic * 0.012 : 0;
    if (active) this.windGain.gain.setTargetAtTime(volume, c.currentTime, 0.18);
    else {
      this.windGain.gain.cancelScheduledValues(c.currentTime);
      this.windGain.gain.setValueAtTime(0, c.currentTime);
    }
    this.windFilter.frequency.setTargetAtTime(300 + amount * 1700 + hypersonic * 1200, c.currentTime, 0.25);
    if (!active || !Number.isFinite(speed)) return;
    if (speedMps < 310) this.supersonic = false;
    else if (speedMps >= 343 && !this.supersonic) {
      this.supersonic = true;
      if (!this.muted && c.state === 'running' && c.currentTime - this.lastBoom >= 1.5) {
        this.lastBoom = c.currentTime;
        this.playSonicBoom();
      }
    }
  }
  playSonicBoom() {
    const c = this.context, now = c.currentTime;
    const noise = c.createBufferSource(); noise.buffer = this.noiseBuffer;
    const filter = c.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(110, now + 0.55);
    const gain = c.createGain(); this.boomGain = gain;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
    noise.connect(filter).connect(gain).connect(this.masterGain);
    noise.start(now); noise.stop(now + 0.67);
    const bass = c.createOscillator(), bassGain = c.createGain();
    bass.type = 'sine';
    bass.frequency.setValueAtTime(80, now);
    bass.frequency.exponentialRampToValueAtTime(34, now + 0.4);
    bassGain.gain.setValueAtTime(0.0001, now);
    bassGain.gain.exponentialRampToValueAtTime(0.13, now + 0.02);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    bass.connect(bassGain).connect(gain);
    bass.start(now); bass.stop(now + 0.43);
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
    osc.connect(gain).connect(this.masterGain);
    osc.start(now); osc.stop(now + duration + 0.01);
  }
}
