import { parseSteps, computeStateAfterSteps, NUM_SEGMENTS } from './notation.js';

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Drives a SnakeChain through a notation string, either instruction by
 * instruction (stepForward/stepBackward/jumpToStep) or as a full
 * animated run (play/pause). Emits onFrame(angles, info) every time the
 * pose changes so the caller can push it into the renderer + update UI.
 */
export class NotationAnimator {
  constructor(chain, { onFrame, onStepChange, onPlayStateChange } = {}) {
    this.chain = chain;
    this.onFrame = onFrame || (() => {});
    this.onStepChange = onStepChange || (() => {});
    this.onPlayStateChange = onPlayStateChange || (() => {});

    this.steps = [];
    this.currentStep = 0; // number of steps fully applied (0..steps.length)
    this.stepDurationMs = 650;
    this.isPlaying = false;
    // Worst-case bounding radius the figure will ever need across its
    // whole build, precomputed once per notation - see _computePeakRadius.
    // Camera framing uses this as a stable target instead of continuously
    // re-fitting to the instantaneous shape, which is what made mid-chain
    // joints (a long, still-unfolded tail swinging around its pivot)
    // produce fast, repeated zoom swings.
    this.peakRadius = null;

    this._rafId = null;
    this._animStart = 0;
    this._animFrom = null;
    this._animTo = null;
    this._animJointIndex = -1;
    this._playRequested = false;
  }

  setNotation(humanNotation) {
    this.pause();
    this.steps = parseSteps(humanNotation);
    this.currentStep = 0;
    this.peakRadius = this._computePeakRadius();
    this._renderState(computeStateAfterSteps(this.steps, 0), { jointIndex: -1, sequenceIndex: -1 });
    this.onStepChange(this.currentStep, this.steps.length);
  }

  /**
   * Sample the bounding radius (around the chain's own centroid) at many
   * points across every step's twist - not just its resolved endpoints,
   * since a rigid sub-chain sweeping through an arc can pass through a
   * wider configuration than either end of the sweep - and return the
   * maximum. A rotation around a fixed axis traces at most one local
   * extremum of distance-to-an-off-axis-point per quarter turn, so 24
   * samples per step (each step is at most a 270 degree sweep) comfortably
   * catches the true peak without being expensive (a few hundred cheap FK
   * evaluations, done once when a figure loads).
   */
  _computePeakRadius() {
    const SAMPLES = 24;
    let maxR = 0;

    const start = computeStateAfterSteps(this.steps, 0);
    this.chain.update(start);
    maxR = Math.max(maxR, this.chain.boundingRadius());

    for (let i = 0; i < this.steps.length; i++) {
      const fromAngles = computeStateAfterSteps(this.steps, i);
      const toAngles = computeStateAfterSteps(this.steps, i + 1);
      const idx = this.steps[i].index;
      const fromVal = fromAngles[idx] || 0;
      const toVal = toAngles[idx] || 0;
      const working = Float64Array.from(fromAngles);

      for (let s = 1; s <= SAMPLES; s++) {
        const t = s / SAMPLES;
        working[idx] = fromVal + (toVal - fromVal) * t;
        this.chain.update(working);
        const r = this.chain.boundingRadius();
        if (r > maxR) maxR = r;
      }
    }
    return maxR;
  }

  get totalSteps() {
    return this.steps.length;
  }

  isAtEnd() {
    return this.currentStep >= this.steps.length;
  }

  isAtStart() {
    return this.currentStep <= 0;
  }

  _renderState(angles, info) {
    this.chain.update(angles);
    this.onFrame(angles, info);
  }

  _cancelFrame() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  jumpToStep(n, { silent = false } = {}) {
    this._cancelFrame();
    this.isPlaying = false;
    this._playRequested = false;
    this.currentStep = Math.max(0, Math.min(n, this.steps.length));
    const angles = computeStateAfterSteps(this.steps, this.currentStep);
    this.chain.setHighlight([], 0);
    this._renderState(angles, { jointIndex: -1, sequenceIndex: -1 });
    if (!silent) this.onStepChange(this.currentStep, this.steps.length);
    this.onPlayStateChange(false);
  }

  reset() {
    this.jumpToStep(0);
  }

  jumpToEnd() {
    this.jumpToStep(this.steps.length);
  }

  /** Animate exactly one instruction forward. Returns false if already at end. */
  stepForward(onComplete) {
    if (this.isAtEnd()) return false;
    const sequenceIndex = this.currentStep;
    const targetStep = this.currentStep + 1;
    const from = computeStateAfterSteps(this.steps, this.currentStep);
    const to = computeStateAfterSteps(this.steps, targetStep);
    const step = this.steps[sequenceIndex];
    this._animateJoint(from, to, step.index, sequenceIndex, () => {
      this.currentStep = targetStep;
      this.onStepChange(this.currentStep, this.steps.length);
      if (onComplete) onComplete();
    });
    return true;
  }

  /** Animate exactly one instruction backward. Returns false if already at start. */
  stepBackward(onComplete) {
    if (this.isAtStart()) return false;
    const targetStep = this.currentStep - 1;
    const sequenceIndex = targetStep;
    const from = computeStateAfterSteps(this.steps, this.currentStep);
    const to = computeStateAfterSteps(this.steps, targetStep);
    const step = this.steps[sequenceIndex];
    this._animateJoint(from, to, step.index, sequenceIndex, () => {
      this.currentStep = targetStep;
      this.onStepChange(this.currentStep, this.steps.length);
      if (onComplete) onComplete();
    });
    return true;
  }

  _animateJoint(fromAngles, toAngles, jointIndex, sequenceIndex, onComplete) {
    this._cancelFrame();
    const start = performance.now();
    const duration = this.stepDurationMs;
    const working = Float64Array.from(fromAngles);
    const fromVal = fromAngles[jointIndex] || 0;
    const toVal = toAngles[jointIndex] || 0;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeInOutCubic(t);
      working[jointIndex] = fromVal + (toVal - fromVal) * eased;
      this.chain.setHighlight([jointIndex, jointIndex + 1], 1 - Math.abs(0.5 - t) * 1.4);
      this._renderState(working, { jointIndex, sequenceIndex, t });

      if (t < 1) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._rafId = null;
        this.chain.setHighlight([], 0);
        this._renderState(toAngles, { jointIndex: -1, sequenceIndex: -1 });
        onComplete();
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  play() {
    if (this.isPlaying) return;
    if (this.isAtEnd()) this.reset();
    this.isPlaying = true;
    this._playRequested = true;
    this.onPlayStateChange(true);
    this._advancePlayback();
  }

  _advancePlayback() {
    if (!this._playRequested) return;
    if (this.isAtEnd()) {
      this.isPlaying = false;
      this._playRequested = false;
      this.onPlayStateChange(false);
      return;
    }
    this.stepForward(() => this._advancePlayback());
  }

  pause() {
    this._playRequested = false;
    this.isPlaying = false;
    this._cancelFrame();
    this.onPlayStateChange(false);
  }

  setSpeed(stepDurationMs) {
    this.stepDurationMs = stepDurationMs;
  }
}
