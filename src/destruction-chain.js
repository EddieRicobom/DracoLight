const CHAIN_WINDOW = 4;
const BURST_GAP = 0.4;

export class DestructionChain {
  constructor() {
    this.best = 0;
    this.reset();
  }

  reset(score = 0) {
    this.previousScore = score;
    this.lastHit = -Infinity;
    this.total = 0;
    this.current = 0;
    this.seconds = 0;
  }

  update(score, time, enabled) {
    if (!enabled || score < this.previousScore) {
      this.reset(score);
      return;
    }

    const destroyed = score - this.previousScore;
    this.previousScore = score;
    const gap = time - this.lastHit;
    if (gap >= CHAIN_WINDOW) {
      this.current = 0;
      this.total = 0;
    }
    if (destroyed > 0) {
      // A building can keep collapsing over consecutive frames. Treat that as one burst.
      const startsAnotherBurst = this.total > 0 && gap >= BURST_GAP;
      this.total += destroyed;
      if (startsAnotherBurst || this.current > 0) {
        this.current = this.total;
        this.best = Math.max(this.best, this.current);
      }
      this.lastHit = time;
    }

    this.seconds = this.current > 0 ? Math.ceil(CHAIN_WINDOW - (time - this.lastHit)) : 0;
  }
}
