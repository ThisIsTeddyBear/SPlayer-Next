/**
 *
 *
 *
 */

/**
 *
 */
export interface SpringParams {
  /**
   *
   *
   * @default 1
   */
  mass: number;
  /**
   *
   *
   * @default 10
   */
  damping: number;
  /**
   *
   *
   * @default 100
   */
  stiffness: number;
  /**
   *
   *
   * @default false
   */
  soft: boolean;
}

type Seconds = number;

/**
 */
const derivative = (fn: (x: number) => number) => (x: number) =>
  (fn(x + 0.001) - fn(x - 0.001)) * 500;

/**
 *
 *
 */
const solveSpring = (
  fromPos: number,
  velocity: number,
  toPos: number,
  delay: Seconds = 0,
  params?: Partial<SpringParams>,
): ((t: Seconds) => number) => {
  const soft = params?.soft ?? false;
  const stiffness = params?.stiffness ?? 90;
  const damping = params?.damping ?? 15;
  const mass = params?.mass ?? 0.9;
  const displacement = toPos - fromPos;

  if (soft || damping >= 2.0 * Math.sqrt(stiffness * mass)) {
    const angularFreq = -Math.sqrt(stiffness / mass);
    const residual = -angularFreq * displacement - velocity;
    return (t: Seconds) => {
      const elapsed = t - delay;
      return elapsed < 0
        ? fromPos
        : toPos - (displacement + elapsed * residual) * Math.exp(elapsed * angularFreq);
    };
  }

  const dampedFreq = Math.sqrt(4.0 * mass * stiffness - damping ** 2);
  const residual = (damping * displacement - 2.0 * mass * velocity) / dampedFreq;
  const halfDampedFreqPerMass = (0.5 * dampedFreq) / mass;
  const halfDampingPerMass = (-0.5 * damping) / mass;
  return (t: Seconds) => {
    const elapsed = t - delay;
    return elapsed < 0
      ? fromPos
      : toPos -
          (Math.cos(elapsed * halfDampedFreqPerMass) * displacement +
            Math.sin(elapsed * halfDampedFreqPerMass) * residual) *
            Math.exp(elapsed * halfDampingPerMass);
  };
};

/**
 *
 */
export class Spring {
  private position = 0;
  private targetPosition = 0;
  private elapsedTime = 0;
  private params: Partial<SpringParams> = {};
  private positionSolver: (t: Seconds) => number;
  private velocitySolver: (t: Seconds) => number;
  private accelerationSolver: (t: Seconds) => number;
  private pendingParams: (Partial<SpringParams> & { time: number }) | undefined;
  private pendingPosition: { time: number; position: number } | undefined;
  private settled = false;

  constructor(initialPosition = 0) {
    this.targetPosition = initialPosition;
    this.position = initialPosition;
    this.positionSolver = () => this.targetPosition;
    this.velocitySolver = () => 0;
    this.accelerationSolver = () => 0;
    this.settled = true;
  }

  /**
   *
   */
  private rebuildSolver = () => {
    const currentVelocity = this.velocitySolver(this.elapsedTime);
    this.elapsedTime = 0;
    this.positionSolver = solveSpring(
      this.position,
      currentVelocity,
      this.targetPosition,
      0,
      this.params,
    );
    this.velocitySolver = derivative(this.positionSolver);
    this.accelerationSolver = derivative(this.velocitySolver);
    this.settled = false;
  };

  /**
   *
   *
   */
  arrived = (): boolean => {
    if (this.settled) return true;
    if (this.pendingParams !== undefined || this.pendingPosition !== undefined) return false;
    const isSettled =
      Math.abs(this.targetPosition - this.position) < 0.01 &&
      Math.abs(this.velocitySolver(this.elapsedTime)) < 0.01 &&
      Math.abs(this.accelerationSolver(this.elapsedTime)) < 0.01;
    if (isSettled) {
      this.settled = true;
      this.position = this.targetPosition;
    }
    return isSettled;
  };

  /**
   *
   *
   */
  setPosition = (position: number) => {
    this.targetPosition = position;
    this.position = position;
    this.positionSolver = () => this.targetPosition;
    this.velocitySolver = () => 0;
    this.accelerationSolver = () => 0;
    this.settled = true;
    this.pendingParams = undefined;
    this.pendingPosition = undefined;
  };

  /**
   *
   *
   */
  update = (deltaMs = 0) => {
    if (this.settled) return;
    this.elapsedTime += deltaMs / 1000;
    this.position = this.positionSolver(this.elapsedTime);

    if (this.pendingParams) {
      this.pendingParams.time -= deltaMs;
      if (this.pendingParams.time <= 0) {
        const { time: _, ...springParams } = this.pendingParams;
        this.updateParams(springParams);
      }
    }
    if (this.pendingPosition) {
      this.pendingPosition.time -= deltaMs;
      if (this.pendingPosition.time <= 0) {
        this.setTargetPosition(this.pendingPosition.position);
      }
    }
    if (this.arrived()) {
      this.position = this.targetPosition;
    }
  };

  /**
   *
   *
   */
  updateParams = (params: Partial<SpringParams>, delay = 0) => {
    if (delay > 0) {
      this.pendingParams = {
        ...(this.pendingParams ?? {}),
        ...params,
        time: delay,
      };
      this.settled = false;
    } else {
      this.pendingPosition = undefined;
      this.params = { ...this.params, ...params };
      this.rebuildSolver();
    }
  };

  /**
   *
   *
   */
  setTargetPosition = (position: number, delay = 0) => {
    if (delay > 0) {
      this.pendingPosition = {
        ...(this.pendingPosition ?? {}),
        position,
        time: delay,
      };
      this.settled = false;
    } else {
      this.pendingPosition = undefined;
      this.targetPosition = position;
      this.rebuildSolver();
    }
  };

  /**
   */
  getCurrentPosition = (): number => this.position;
}
