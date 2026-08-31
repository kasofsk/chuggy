import type {
  ClusterId,
  SchedulerOwnerId,
} from "../interpreter/executionScheduler.ts";
import { executionSchedulerPass } from "../interpreter/executionSchedulerRun.ts";
import type { ExecutionSchedulerService } from "../interpreter/executionSchedulerRun.ts";
import type { FinalizerOwnerId } from "../interpreter/finalizer.ts";
import {
  finalizerPass,
  type FinalizerService,
} from "../interpreter/finalizerRun.ts";
import type { Partition, RecoveryEpoch } from "../interpreter/projectStore.ts";
import type {
  RuntimePrecondition,
  ServiceRuntime,
  ServiceRuntimeConfig,
} from "../interpreter/serviceRuntime.ts";
import { serviceRuntime } from "../interpreter/serviceRuntime.ts";
import {
  ticketServiceRunOnce,
  type TicketServiceRuntimeConfig,
  type TicketServiceRuntimeService,
} from "../interpreter/ticketServiceRun.ts";
import type { SelectorRuntimeService } from "../compose.ts";
import {
  composeFinalizerService,
  composeSelectorRuntime,
  type FinalizerServiceRuntime,
} from "../compose.ts";
import { systemPacing } from "../adapters/runtime/systemPacing.ts";
import type pg from "pg";
import {
  postgresPool,
  type PostgresLimits,
} from "../adapters/postgres/pool.ts";
import { postgresProjectDecision } from "../adapters/postgres/projectDecision.ts";
import { postgresProjectDiscovery } from "../adapters/postgres/projectDiscovery.ts";
import { postgresProjectStore } from "../adapters/postgres/projectStore.ts";
import { postgresProjectRepositoryBinding } from "../adapters/postgres/repositoryConfiguration.ts";
import { postgresExecutionSourceHistory } from "../adapters/postgres/executionSourceHistory.ts";
import { executionSourceObservation } from "../interpreter/executionSourceObservation.ts";
import {
  credentialFiles,
  credentialFilesPrecondition,
  type CredentialFilesOptions,
} from "../adapters/credentials/credentialFiles.ts";
import {
  gitPromotion,
  type GitPromotionOptions,
} from "../adapters/git/gitPromotion.ts";
import {
  gitAvailablePrecondition,
  gitScratchWritablePrecondition,
} from "../adapters/git/gitPrerequisites.ts";
import { postgresExecutionScheduler } from "../adapters/postgres/scheduler.ts";
import { postgresPriorWorkReports } from "../adapters/postgres/evaluationReports.ts";
import { postgresTicketBrief } from "../adapters/postgres/ticketBrief.ts";
import { postgresPinnedConfigurations } from "../adapters/postgres/pinnedConfigurations.ts";
import {
  finalizerRole,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
} from "../adapters/postgres/schema.ts";
import { postgresDomainConfigurationPrecondition } from "../adapters/postgres/domainConfiguration.ts";
import { postgresWorkerCatalogPrecondition } from "../adapters/postgres/workerCatalog.ts";
import type { AdmittedWorker } from "../interpreter/workerCatalog.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
} from "../adapters/postgres/runtimeSchema.ts";
import { schemaCompatibilityPrecondition } from "../interpreter/serviceRuntime.ts";
import type { Config } from "../domain/config.ts";
import { asOwnerId } from "../interpreter/projectStore.ts";
import type {
  SelectorIdentityFactory,
  SelectorRuntimeConfig,
  SelectorRuntimeSource,
} from "../interpreter/selectorRuntime.ts";
import type { SelectorPolicyHost } from "../interpreter/selector.ts";
import type { TicketServiceConfig } from "../interpreter/ticketService.ts";
import type { FinalizerConfig } from "../interpreter/finalizer.ts";

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
      return found.rows[0]?.current_role === expected;
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
      return current === expected;
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

export function selectorProcess(
  service: SelectorRuntimeService,
  requirements: ControlPlaneRequirements,
  config: ServiceRuntimeConfig,
): ServiceRuntime {
  return serviceRuntime(
    { run: async () => void (await service.runOnce()) },
    systemPacing,
    processPreconditions(requirements),
    config,
  );
}

export function schedulerProcess(
  service: ExecutionSchedulerService,
  identity: {
    readonly owner: SchedulerOwnerId;
    readonly recoveryEpoch: RecoveryEpoch;
    readonly cluster: ClusterId;
  },
  requirements: ControlPlaneRequirements,
  config: ServiceRuntimeConfig,
): ServiceRuntime {
  return serviceRuntime(
    {
      run: async () =>
        void (await executionSchedulerPass(
          service,
          identity.owner,
          identity.recoveryEpoch,
          identity.cluster,
        )),
    },
    systemPacing,
    processPreconditions(requirements),
    config,
  );
}

/**
 * Holds the discovery cursor and the diagnosis a contained failure would
 * otherwise leave nowhere. The pass no longer ends the loop on a project it
 * cannot activate, so this is the only place an operator learns which one.
 */
export function ticketServiceProcess(
  service: TicketServiceRuntimeService,
  runtimeConfig: TicketServiceRuntimeConfig,
  requirements: ControlPlaneRequirements,
  config: ServiceRuntimeConfig,
): ServiceRuntime {
  let resumeAfter: Partition | undefined = undefined;
  return serviceRuntime(
    {
      run: async () => {
        const report = await ticketServiceRunOnce(
          service,
          runtimeConfig,
          resumeAfter,
        );
        resumeAfter = report.resumeAfter;
        for (const failure of report.failures) {
          process.stderr.write(
            `ticket service: ${failure.partition.tenant}/${failure.partition.project} ${failure.reason}: ${failure.message}\n`,
          );
        }
      },
    },
    systemPacing,
    processPreconditions(requirements),
    config,
  );
}

export function finalizerProcess(
  service: FinalizerService,
  identity: {
    readonly owner: FinalizerOwnerId;
    readonly recoveryEpoch: RecoveryEpoch;
  },
  requirements: ControlPlaneRequirements,
  config: ServiceRuntimeConfig,
): ServiceRuntime {
  return serviceRuntime(
    {
      run: async () =>
        void (await finalizerPass(
          service,
          identity.owner,
          identity.recoveryEpoch,
        )),
    },
    systemPacing,
    processPreconditions(requirements),
    config,
  );
}

export interface SelectorProcessRootConfig {
  readonly database: ProcessDatabaseConfig;
  readonly runtime: ServiceRuntimeConfig;
  readonly selector?: SelectorRuntimeConfig;
}

/** Owns the selector-role pool and composes the independently deployable selector process. */
export function selectorProcessRoot(
  config: SelectorProcessRootConfig,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  additional: readonly RuntimePrecondition[] = [],
): ServiceRuntime {
  const pool = processPool(config.database);
  const service = composeSelectorRuntime(
    pool,
    source,
    policy,
    identities,
    config.selector,
  );
  return ownedProcess(
    pool,
    selectorProcess(
      service,
      {
        pool,
        additional: [
          postgresRolePrecondition(pool, selectorServiceRole),
          ...additional,
        ],
      },
      config.runtime,
    ),
  );
}

export interface TicketServiceProcessRootConfig {
  readonly database: ProcessDatabaseConfig;
  readonly runtime: ServiceRuntimeConfig;
  readonly pass: TicketServiceRuntimeConfig;
  readonly domain: Config;
  readonly owner: string;
  readonly ticket?: TicketServiceConfig;
  readonly source: Omit<GitPromotionOptions, "credentials"> &
    CredentialFilesOptions;
}

/** Owns the writer-role pool and composes the independently deployable ticket service. */
export function ticketServiceProcessRoot(
  config: TicketServiceProcessRootConfig,
): ServiceRuntime {
  const pool = processPool(config.database);
  const credentials = credentialFiles(config.source);
  const git = gitPromotion({ ...config.source, credentials });
  const service: TicketServiceRuntimeService = {
    domain: config.domain,
    discovery: postgresProjectDiscovery(pool),
    decisions: postgresProjectDecision(pool),
    projects: postgresProjectStore(pool),
    owner: asOwnerId(config.owner),
    monotonicNow: () => performance.now(),
    executionSources: executionSourceObservation(
      postgresProjectRepositoryBinding(pool),
      git,
      postgresExecutionSourceHistory(pool),
    ),
    ticketBriefs: postgresTicketBrief(pool),
    ...(config.ticket === undefined ? {} : { ticketConfig: config.ticket }),
  };
  return ownedProcess(
    pool,
    ticketServiceProcess(
      service,
      config.pass,
      {
        pool,
        additional: [
          postgresRolePrecondition(pool, ticketServiceRole),
          postgresDomainConfigurationPrecondition(pool, config.domain),
          gitAvailablePrecondition(config.source.environment),
          gitScratchWritablePrecondition(config.source.scratchDirectory),
          credentialFilesPrecondition(config.source),
        ],
      },
      config.runtime,
    ),
  );
}

export interface SchedulerProcessRootConfig {
  readonly database: ProcessDatabaseConfig;
  readonly runtime: ServiceRuntimeConfig;
  readonly identity: {
    readonly owner: SchedulerOwnerId;
    readonly recoveryEpoch: RecoveryEpoch;
    readonly cluster: ClusterId;
  };
  readonly service: Omit<
    ExecutionSchedulerService,
    "store" | "configurations" | "priorWorkReports" | "ticketBriefs"
  >;
  readonly workerCatalog: readonly AdmittedWorker[];
  readonly additional?: readonly RuntimePrecondition[];
}

/** Composes the scheduler service with the PostgreSQL ports its process owns. */
export function schedulerProcessRootService(
  pool: pg.Pool,
  service: SchedulerProcessRootConfig["service"],
): ExecutionSchedulerService {
  return {
    ...service,
    store: postgresExecutionScheduler(pool),
    configurations: postgresPinnedConfigurations(pool),
    priorWorkReports: postgresPriorWorkReports(pool),
    ticketBriefs: postgresTicketBrief(pool),
  };
}

/** Owns the scheduler-role pool while its cluster and policy adapters stay explicit ports. */
export function schedulerProcessRoot(
  config: SchedulerProcessRootConfig,
): ServiceRuntime {
  const pool = processPool(config.database);
  const service = schedulerProcessRootService(pool, config.service);
  return ownedProcess(
    pool,
    schedulerProcess(
      service,
      config.identity,
      {
        pool,
        additional: [
          postgresRolePrecondition(pool, schedulerRole),
          recoveryEpochPrecondition(pool, config.identity.recoveryEpoch),
          postgresWorkerCatalogPrecondition(pool, config.workerCatalog),
          ...(config.additional ?? []),
        ],
      },
      config.runtime,
    ),
  );
}

export interface FinalizerProcessRootConfig {
  readonly database: ProcessDatabaseConfig;
  readonly runtime: ServiceRuntimeConfig;
  readonly identity: {
    readonly owner: FinalizerOwnerId;
    readonly recoveryEpoch: RecoveryEpoch;
  };
  readonly service: FinalizerServiceRuntime;
  readonly finalizer?: FinalizerConfig;
}

/** Owns the finalizer-role pool while repository access remains an explicit port. */
export function finalizerProcessRoot(
  config: FinalizerProcessRootConfig,
): ServiceRuntime {
  const pool = processPool(config.database);
  const service = composeFinalizerService(
    pool,
    config.service,
    config.finalizer,
  );
  return ownedProcess(
    pool,
    finalizerProcess(
      service,
      config.identity,
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
