import {
  composeFinalizerService,
  composeTicketMachineRuntime,
  type FinalizerServiceRuntime,
} from "../compose.ts";
import { runtimePair } from "../interpreter/runtimePair.ts";
import { ticketMachineRunOnce } from "../interpreter/ticketMachineRun.ts";
import type {
  ClusterId,
  SchedulerOwnerId,
} from "../interpreter/schedulerIdentity.ts";
import type { FinalizerOwnerId } from "../interpreter/finalizer.ts";
import {
  ticketFinalizerPass,
  type TicketFinalizerService,
} from "../interpreter/ticketFinalizer.ts";
import type { Partition, RecoveryEpoch } from "../interpreter/projectStore.ts";
import {
  sessionSchedulerPass,
  type SessionSchedulerService,
} from "../interpreter/sessionSchedulerRun.ts";
import type {
  RuntimePrecondition,
  ServiceRuntime,
  ServiceRuntimeConfig,
} from "../interpreter/serviceRuntime.ts";
import { serviceRuntime } from "../interpreter/serviceRuntime.ts";
import { systemPacing } from "../adapters/runtime/systemPacing.ts";
import type pg from "pg";
import {
  postgresPool,
  type PostgresLimits,
} from "../adapters/postgres/pool.ts";
import { postgresProjectStore } from "../adapters/postgres/projectStore.ts";
import { postgresProjectRepositoryBinding } from "../adapters/postgres/repositoryConfiguration.ts";
import { postgresSessionScheduler } from "../adapters/postgres/sessionScheduler.ts";
import {
  finalizerRole,
  schedulerRole,
  ticketServiceRole,
} from "../adapters/postgres/schema.ts";
import { postgresWorkerCatalogPrecondition } from "../adapters/postgres/workerCatalog.ts";
import type { AdmittedWorker } from "../interpreter/workerCatalog.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
} from "../adapters/postgres/runtimeSchema.ts";
import {
  runtimePreconditionAnswer,
  schemaCompatibilityPrecondition,
} from "../interpreter/serviceRuntime.ts";
import { asOwnerId } from "../interpreter/projectStore.ts";
import {
  ticketFinalizerDefaults,
  type TicketFinalizerConfig,
} from "../interpreter/ticketFinalizer.ts";

/** The database preconditions shared by every control-plane process. */
export function controlPlanePreconditions(
  pool: pg.Pool,
): readonly RuntimePrecondition[] {
  return [
    schemaCompatibilityPrecondition(
      postgresRuntimeSchema(pool),
      currentRuntimeSchemaContract,
    ),
  ];
}

export interface ControlPlaneRequirements {
  readonly pool: pg.Pool;
  readonly additional?: readonly RuntimePrecondition[];
}

export interface ProcessDatabaseConfig {
  readonly url: string;
  readonly limits?: PostgresLimits;
}

function ownedProcess(pool: pg.Pool, runtime: ServiceRuntime): ServiceRuntime {
  let closed = false;
  return {
    start: () => {
      if (closed)
        throw new Error("process cannot restart after resources close");
      return runtime.start();
    },
    health: () => runtime.health(),
    settled: () => runtime.settled(),
    stop: async () => {
      if (closed) return { stopped: "Stopped" };
      const stopped = await runtime.stop();
      await pool.end();
      closed = true;
      return stopped;
    },
  };
}

/** Requires a process credential to be the least-authority role assigned to it. */
export function postgresRolePrecondition(
  pool: pg.Pool,
  expected: string,
): RuntimePrecondition {
  return {
    name: "database-role",
    check: async (signal) => {
      signal.throwIfAborted();
      const found = await pool.query<{ current_role: string }>(
        "SELECT current_user AS current_role",
      );
      signal.throwIfAborted();
      return runtimePreconditionAnswer(
        found.rows[0]?.current_role === expected,
        `this process connected as ${found.rows[0]?.current_role ?? "no role"} rather than ${expected}`,
      );
    },
  };
}

function recoveryEpochPrecondition(
  pool: pg.Pool,
  expected: RecoveryEpoch,
): RuntimePrecondition {
  return {
    name: "recovery-epoch-current",
    check: async (signal) => {
      signal.throwIfAborted();
      const current = await postgresProjectStore(pool).currentRecoveryEpoch();
      signal.throwIfAborted();
      return runtimePreconditionAnswer(
        current === expected,
        `the current recovery epoch is ${current} rather than the ${expected} this process was issued under`,
      );
    },
  };
}

function processPool(database: ProcessDatabaseConfig): pg.Pool {
  return postgresPool(database.url, database.limits);
}

function processPreconditions(
  requirements: ControlPlaneRequirements,
): readonly RuntimePrecondition[] {
  return [
    ...controlPlanePreconditions(requirements.pool),
    ...(requirements.additional ?? []),
  ];
}

export function finalizerProcess(
  service: TicketFinalizerService,
  requestsPerPassMax: number,
  requirements: ControlPlaneRequirements,
  config: ServiceRuntimeConfig,
): ServiceRuntime {
  return serviceRuntime(
    {
      run: async () =>
        void (await ticketFinalizerPass(service, requestsPerPassMax)),
    },
    systemPacing,
    processPreconditions(requirements),
    config,
  );
}

export interface TicketServiceProcessRootConfig {
  readonly database: ProcessDatabaseConfig;
  readonly runtime: ServiceRuntimeConfig;
  readonly pass: {
    readonly projectsPerPassMax: number;
    readonly projectLeaseSeconds: number;
    readonly inputsPerProjectMax?: number;
    readonly obligationsPerProjectMax?: number;
  };
  readonly owner: string;
}

/** Owns the writer-role pool and composes the independently deployable ticket service. */
export function ticketServiceProcessRoot(
  config: TicketServiceProcessRootConfig,
): ServiceRuntime {
  const pool = processPool(config.database);
  const service = composeTicketMachineRuntime(pool, asOwnerId(config.owner));
  let after: Partition | undefined;
  const runtime = serviceRuntime(
    {
      run: async () => {
        const report = await ticketMachineRunOnce(
          service,
          {
            projectsPerPassMax: config.pass.projectsPerPassMax,
            inputsPerProjectMax: config.pass.inputsPerProjectMax ?? 32,
            obligationsPerProjectMax:
              config.pass.obligationsPerProjectMax ?? 1000,
            leaseSeconds: config.pass.projectLeaseSeconds,
          },
          after,
        );
        after = report.resumeAfter;
        for (const failure of report.failures)
          process.stderr.write(
            `ticket service: ${failure.partition.tenant}/${failure.partition.project}: ${failure.message}\n`,
          );
      },
    },
    systemPacing,
    processPreconditions({
      pool,
      additional: [postgresRolePrecondition(pool, ticketServiceRole)],
    }),
    config.runtime,
  );
  return ownedProcess(pool, runtime);
}

export interface SchedulerProcessRootConfig {
  readonly database: ProcessDatabaseConfig;
  readonly runtime: ServiceRuntimeConfig;
  readonly identity: {
    readonly owner: SchedulerOwnerId;
    readonly recoveryEpoch: RecoveryEpoch;
    readonly cluster: ClusterId;
  };
  /**
   * The session half of the same process; its own store and its binding read
   * come from the same pool, so a deployment names neither.
   */
  readonly tickets: (pool: pg.Pool) => { run(): Promise<void> };
  readonly sessions: Omit<SessionSchedulerService, "store" | "bindings">;
  readonly workerCatalog: readonly AdmittedWorker[];
  readonly additional?: readonly RuntimePrecondition[];
}

/**
 * Composes the session half with the PostgreSQL ports its process owns. It is
 * separate from `schedulerProcessRoot` so a suite can say which adapters the
 * root reaches for without standing up a process: the binding read in
 * particular is one a stub would satisfy the type of and answer nothing from,
 * which is a deployment placing every session with no tree.
 */
export function schedulerProcessRootSessions(
  pool: pg.Pool,
  sessions: SchedulerProcessRootConfig["sessions"],
): SessionSchedulerService {
  return {
    ...sessions,
    store: postgresSessionScheduler(pool),
    bindings: postgresProjectRepositoryBinding(pool),
  };
}

/** Owns the scheduler-role pool while its cluster and policy adapters stay explicit ports. */
export function schedulerProcessRoot(
  config: SchedulerProcessRootConfig,
): ServiceRuntime {
  const pool = processPool(config.database);
  const tickets = config.tickets(pool);
  const sessions = schedulerProcessRootSessions(pool, config.sessions);
  const checks = processPreconditions({
    pool,
    additional: [
      postgresRolePrecondition(pool, schedulerRole),
      recoveryEpochPrecondition(pool, config.identity.recoveryEpoch),
      postgresWorkerCatalogPrecondition(pool, config.workerCatalog),
      ...(config.additional ?? []),
    ],
  });
  const runtime = runtimePair(
    serviceRuntime(tickets, systemPacing, checks, config.runtime),
    serviceRuntime(
      {
        run: async () => {
          await sessionSchedulerPass(sessions, config.identity.recoveryEpoch);
        },
      },
      systemPacing,
      [],
      config.runtime,
    ),
  );
  return ownedProcess(pool, runtime);
}

export interface FinalizerProcessRootConfig {
  readonly database: ProcessDatabaseConfig;
  readonly runtime: ServiceRuntimeConfig;
  readonly identity: {
    readonly owner: FinalizerOwnerId;
    readonly recoveryEpoch: RecoveryEpoch;
  };
  /**
   * The ports one finalizer acts through, over the pool this root owns: a
   * deployment that mints its own credentials reaches the forge installations
   * through that same pool, and a second one would be a second connection
   * limit to hold this role under.
   */
  readonly service: (pool: pg.Pool) => FinalizerServiceRuntime;
  readonly finalizer?: TicketFinalizerConfig;
}

/** Owns the finalizer-role pool while repository access remains an explicit port. */
export function finalizerProcessRoot(
  config: FinalizerProcessRootConfig,
): ServiceRuntime {
  const pool = processPool(config.database);
  const service = composeFinalizerService(
    pool,
    config.service(pool),
    config.identity.owner,
    config.identity.recoveryEpoch,
    config.finalizer,
  );
  return ownedProcess(
    pool,
    finalizerProcess(
      service,
      config.finalizer?.requestsPerPassMax ??
        ticketFinalizerDefaults.requestsPerPassMax,
      {
        pool,
        additional: [
          postgresRolePrecondition(pool, finalizerRole),
          recoveryEpochPrecondition(pool, config.identity.recoveryEpoch),
        ],
      },
      config.runtime,
    ),
  );
}
