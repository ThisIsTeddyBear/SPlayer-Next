/**
 * Spring physics solver based on damped harmonic oscillator model
 */

/** Spring physics parameters */
export interface SpringParams {
  /**
   * Mass
   * @default 0.9
   */
  mass: number;
  /**
   * Damping coefficient
   * @default 15
   */
  damping: number;
  /**
   * Stiffness coefficient
   * @default 90
   */
  stiffness: number;
  /**
   * Whether to force over-damped mode (pure exponential decay without oscillation)
   * @default false
   */
  soft: boolean;
}

/** Time represented in seconds */
type Seconds = number;

/**
 * Compute numerical derivative of a function (central difference method)
 * @param fn - Source function
 * @returns Derivative function
 */
const derivative = (fn: (x: number) => number) => (x: number) =>
  (fn(x + 0.001) - fn(x - 0.001)) * 500;

/**
 * Solve spring equation of motion, returning position as a function of time.
 * Automatically chooses over-damped or under-damped solver:
 * - Over-damped (zeta >= 1): exponential decay without oscillation
 * - Under-damped (zeta < 1): damped harmonic oscillation
 *
 * @param fromPos - Starting position
 * @param velocity - Initial velocity
 * @param toPos - Target position
 * @param delay - Delay in seconds
 * @param params - Spring parameters
 * @returns Position function (t: Seconds) => position
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

  // Over-damped or forced soft mode
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

  // Under-damped mode
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
 * Spring animation instance
 * Solves spring equations of motion with support for:
 * - Setting target positions (with optional delay)
 * - Dynamic parameter updates
 * - Settlement detection
 */
export class Spring {
  /** Current position */
  private position = 0;
  /** Target position */
  private targetPosition = 0;
  /** Elapsed time (s) */
  private elapsedTime = 0;
  /** Spring parameters */
  private params: Partial<SpringParams> = {};
  /** Position solver function */
  private positionSolver: (t: Seconds) => number;
  /** Velocity solver function (first derivative) */
  private velocitySolver: (t: Seconds) => number;
  /** Acceleration solver function (second derivative) */
  private accelerationSolver: (t: Seconds) => number;
  /** Queued parameter update */
  private pendingParams: (Partial<SpringParams> & { time: number }) | undefined;
  /** Queued position update */
  private pendingPosition: { time: number; position: number } | undefined;
  /** Whether the spring is settled */
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
   * Rebuild spring motion equation based on current position, velocity, and target
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
   * Determine whether the spring has reached settled state
   * @returns Whether the spring is settled
   */
  arrived = (): boolean => {
    if (this.settled) return true;
    if (this.pendingParams !== undefined || this.pendingPosition !== undefined) return false;
    // Skip derivative evaluation when far from target
    if (Math.abs(this.targetPosition - this.position) >= 0.01) return false;
    const isSettled =
      Math.abs(this.velocitySolver(this.elapsedTime)) < 0.01 &&
      Math.abs(this.accelerationSolver(this.elapsedTime)) < 0.01;
    if (isSettled) {
      this.settled = true;
      this.position = this.targetPosition;
    }
    return isSettled;
  };

  /**
   * Instantly set position without animation
   * Clears all pending updates and marks the spring as settled
   * @param position - Target position
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
   * Advance spring state by delta time in milliseconds
   * @param deltaMs - Delta time in ms
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
   * Update spring physical parameters
   * @param params - Partial spring parameters
   * @param delay - Optional delay in ms (0 for immediate)
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
   * Set target position with smooth spring animation
   * @param position - New target position
   * @param delay - Optional delay in ms (0 for immediate)
   */
  setTargetPosition = (position: number, delay = 0) => {
    if (delay === 0 && position === this.targetPosition && this.pendingPosition === undefined) {
      return;
    }
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
   * Get current spring position
   * @returns Current position
   */
  getCurrentPosition = (): number => this.position;

  /**
   * Get target position
   * @returns Target position
   */
  getTargetPosition = (): number => this.pendingPosition?.position ?? this.targetPosition;
}
