export interface ServiceRuntimeConfig {
  readonly idleIntervalMilliseconds: number;
  readonly shutdownDrainMilliseconds: number;
}

/**
 * What one precondition answered, in the three verdicts every gate in this tree
 * also answers in. Refused and Undecided both stop a start, and a caller that
 * conflated them would report a control that could not run as a control that
 * found something.
 */
export type RuntimePreconditionVerdict =
  | { readonly met: "Met" }
  | { readonly met: "Refused"; readonly why: string }
  | { readonly met: "Undecided"; readonly why: string };

export interface RuntimePrecondition {
  readonly name: string;
  check(signal: AbortSignal): Promise<RuntimePreconditionVerdict>;
}

/** The verdict a check with nothing but a yes or a no to report answers with. */
export function runtimePreconditionAnswer(
  met: boolean,
  why: string,
): RuntimePreconditionVerdict {
  return met ? { met: "Met" } : { met: "Refused", why };
}

/** The verdict a check that raised answers with: it reached no finding at all. */
export function runtimePreconditionUndecided(
  error: unknown,
): RuntimePreconditionVerdict {
  return {
    met: "Undecided",
    why: error instanceof Error ? error.message : "the check raised",
  };
}

export interface RuntimeSchemaVersionSource {
  applied(signal: AbortSignal): Promise<readonly RuntimeSchemaMigration[]>;
}

export interface RuntimeSchemaMigration {
  readonly version: number;
  readonly name: string;
}

export interface RuntimeSchemaContract {
  readonly required: readonly RuntimeSchemaMigration[];
  readonly compatible: readonly RuntimeSchemaMigration[];
}

export interface RuntimeDeploymentSchema {
  /** The immutable contract published with the candidate image. */
  readonly current: RuntimeSchemaContract;
  /** The immutable contract published with the retained rollback image. */
  readonly retainedPrevious: RuntimeSchemaContract;
}

export interface ServiceQuantum {
  run(signal: AbortSignal): Promise<void>;
}

export interface RuntimePacing {
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export type ServiceStartResult =
  | { readonly started: "Started" }
  | { readonly started: "Stopped" }
  | {
      readonly started: "CouldNotRun";
      readonly precondition: string;
      readonly verdict: "Refused" | "Undecided";
      readonly why: string;
    };

export interface ServiceHealth {
  readonly live: boolean;
  readonly ready: boolean;
  readonly failure?: string;
}

export interface ServiceRuntime {
  start(): Promise<ServiceStartResult>;
  stop(): Promise<ServiceStopResult>;
  health(): ServiceHealth;
  /**
   * The health a started run leaves behind once its loop ends, so a root learns
   * a dead loop rather than idling beside one. A stop that gave up on its drain
   * settles only when the over-running quantum returns, carrying that stop's
   * own verdict, which the root has already been given.
   */
  settled(): Promise<ServiceHealth>;
}

export type ServiceStopResult =
  { readonly stopped: "Stopped" } | { readonly stopped: "DrainExpired" };

type ServiceRuntimeState =
  "Stopped" | "Starting" | "Running" | "Stopping" | "Failed";

function serviceHealth(
  state: ServiceRuntimeState,
  failure: string | undefined,
): ServiceHealth {
  return {
    live: state !== "Failed",
    ready: state === "Running",
    ...(failure === undefined ? {} : { failure }),
  };
}

function checkedMilliseconds(milliseconds: number, what: string): number {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1)
    throw new RangeError(`${what} must be a positive integer`);
  return milliseconds;
}

function schemaPrefix(
  prefix: readonly RuntimeSchemaMigration[],
  whole: readonly RuntimeSchemaMigration[],
): boolean {
  return prefix.every(
    (migration, index) =>
      migration.version === whole[index]?.version &&
      migration.name === whole[index]?.name,
  );
}

export function schemaContractAccepts(
  contract: RuntimeSchemaContract,
  applied: readonly RuntimeSchemaMigration[],
): boolean {
  return (
    contract.required.length <= applied.length &&
    applied.length <= contract.compatible.length &&
    schemaPrefix(contract.required, applied) &&
    schemaPrefix(applied, contract.compatible)
  );
}

/** Requires the applied migration prefix to be accepted by this running image. */
export function schemaCompatibilityPrecondition(
  source: RuntimeSchemaVersionSource,
  contract: RuntimeSchemaContract,
): RuntimePrecondition {
  if (!schemaPrefix(contract.required, contract.compatible))
    throw new RangeError("runtime schema contract is not a migration prefix");
  return {
    name: "schema-compatible",
    check: async (signal) => {
      const applied = await source.applied(signal);
      return runtimePreconditionAnswer(
        schemaContractAccepts(contract, applied),
        `the applied migration prefix of ${String(applied.length)} is not one this image accepts`,
      );
    },
  };
}

/** What a stored-journal scan reached: the partitions it found illegal, or why it could not finish. */
export type RuntimeStoredJournalScan =
  | { readonly scanned: "Scanned"; readonly illegal: readonly string[] }
  | { readonly scanned: "Incomplete"; readonly why: string };

export interface RuntimeStoredJournalSource {
  /** Replays every stored history it can reach, naming the partitions this image could not have decided. */
  scan(signal: AbortSignal): Promise<RuntimeStoredJournalScan>;
}

/**
 * Requires every stored journal to replay under the decision semantics its own
 * rows declare, naming the partitions that do not. A writer that discovers this
 * inside its loop reports a dead loop instead, so the start is stopped here and
 * a scan that could not finish is Undecided rather than a finding.
 */
export function journalLegalityPrecondition(
  source: RuntimeStoredJournalSource,
): RuntimePrecondition {
  return {
    name: "journal-legal",
    check: async (signal) => {
      const scan = await source.scan(signal);
      if (scan.scanned === "Incomplete")
        return { met: "Undecided", why: scan.why };
      return runtimePreconditionAnswer(
        scan.illegal.length === 0,
        `stored histories this image could not have decided: ${scan.illegal.join(", ")}`,
      );
    },
  };
}

export type RuntimeMigrationPlan =
  | {
      readonly planned: "Compatible";
      readonly pending: readonly RuntimeSchemaMigration[];
    }
  | { readonly planned: "Incompatible" };

/** Plans a forward migration only when both candidate and rollback images accept its target. */
export function runtimeMigrationPlan(
  applied: readonly RuntimeSchemaMigration[],
  target: readonly RuntimeSchemaMigration[],
  deployment: RuntimeDeploymentSchema,
): RuntimeMigrationPlan {
  if (
    !schemaPrefix(applied, target) ||
    !schemaContractAccepts(deployment.current, target) ||
    !schemaContractAccepts(deployment.retainedPrevious, target)
  )
    return { planned: "Incompatible" };
  return { planned: "Compatible", pending: target.slice(applied.length) };
}

async function serviceRuntimeLoop(
  quantum: ServiceQuantum,
  pacing: RuntimePacing,
  idleIntervalMilliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    await quantum.run(signal);
    if (!signal.aborted) await pacing.wait(idleIntervalMilliseconds, signal);
  }
}

interface ServiceSettlement {
  readonly reached: Promise<ServiceHealth>;
  readonly reach: (health: ServiceHealth) => void;
}

/** One run's end, reached at most once and replaced when the next run may begin. */
function serviceSettlement(): ServiceSettlement {
  let reach!: (health: ServiceHealth) => void;
  const reached = new Promise<ServiceHealth>((resolve) => {
    reach = resolve;
  });
  return { reached, reach };
}

interface ServiceRuntimeOwn {
  control: AbortController | undefined;
  starting: Promise<ServiceStartResult> | undefined;
  loop: Promise<void> | undefined;
  settlement: ServiceSettlement;
  state: ServiceRuntimeState;
  failure: string | undefined;
}

function serviceStart(
  own: ServiceRuntimeOwn,
  quantum: ServiceQuantum,
  pacing: RuntimePacing,
  preconditions: readonly RuntimePrecondition[],
  idleIntervalMilliseconds: number,
): Promise<ServiceStartResult> {
  if (own.state === "Running") return Promise.resolve({ started: "Started" });
  if (own.state !== "Stopped")
    throw new Error(`service cannot start while ${own.state.toLowerCase()}`);
  own.control = new AbortController();
  own.state = "Starting";
  const signal = own.control.signal;
  own.starting = (async () => {
    for (const precondition of preconditions) {
      const verdict = await precondition
        .check(signal)
        .catch(runtimePreconditionUndecided);
      if (signal.aborted) return { started: "Stopped" };
      if (verdict.met !== "Met") {
        own.state = "Stopped";
        own.control = undefined;
        return {
          started: "CouldNotRun",
          precondition: precondition.name,
          verdict: verdict.met,
          why: verdict.why,
        };
      }
    }
    if (signal.aborted) return { started: "Stopped" };
    own.state = "Running";
    const settlement = own.settlement;
    own.loop = serviceRuntimeLoop(
      quantum,
      pacing,
      idleIntervalMilliseconds,
      signal,
    )
      .catch((error: unknown) => {
        own.failure =
          error instanceof Error ? error.message : "unknown failure";
        own.state = "Failed";
      })
      .then(() => {
        settlement.reach(serviceHealth(own.state, own.failure));
      });
    return { started: "Started" };
  })();
  return own.starting;
}

async function serviceStop(
  own: ServiceRuntimeOwn,
  pacing: RuntimePacing,
  shutdownDrainMilliseconds: number,
): Promise<ServiceStopResult> {
  if (own.state === "Stopped") return { stopped: "Stopped" };
  own.state = "Stopping";
  own.control?.abort();
  const drainControl = new AbortController();
  const draining = (async () => {
    await own.starting;
    await own.loop;
  })();
  const drained = await Promise.race([
    draining.then(() => true),
    pacing
      .wait(shutdownDrainMilliseconds, drainControl.signal)
      .then(() => false),
  ]);
  drainControl.abort();
  if (!drained) {
    own.failure = "shutdown drain expired";
    own.state = "Failed";
    return { stopped: "DrainExpired" };
  }
  own.control = undefined;
  own.starting = undefined;
  own.loop = undefined;
  own.settlement = serviceSettlement();
  own.state = "Stopped";
  own.failure = undefined;
  return { stopped: "Stopped" };
}

/** Runs one bounded application quantum at a time behind a start, stop and health contract. */
export function serviceRuntime(
  quantum: ServiceQuantum,
  pacing: RuntimePacing,
  preconditions: readonly RuntimePrecondition[],
  config: ServiceRuntimeConfig,
): ServiceRuntime {
  const idleIntervalMilliseconds = checkedMilliseconds(
    config.idleIntervalMilliseconds,
    "service idle interval",
  );
  const shutdownDrainMilliseconds = checkedMilliseconds(
    config.shutdownDrainMilliseconds,
    "service shutdown drain",
  );
  const own: ServiceRuntimeOwn = {
    control: undefined,
    starting: undefined,
    loop: undefined,
    settlement: serviceSettlement(),
    state: "Stopped",
    failure: undefined,
  };

  return {
    start: () =>
      serviceStart(
        own,
        quantum,
        pacing,
        preconditions,
        idleIntervalMilliseconds,
      ),
    stop: () => serviceStop(own, pacing, shutdownDrainMilliseconds),
    health: () => serviceHealth(own.state, own.failure),
    settled: () => own.settlement.reached,
  };
}
