import type {
  ClusterId,
  SchedulerOwnerId,
} from "../interpreter/executionScheduler.ts";
import { executionSchedulerPass } from "../interpreter/executionSchedulerRun.ts";
import type {
  ExecutionSchedulerService,
  SchedulerPassNotice,
} from "../interpreter/executionSchedulerRun.ts";
import type { FinalizerOwnerId } from "../interpreter/finalizer.ts";
import { finalizerProcessLog } from "../interpreter/finalizerTelemetry.ts";
import {
  finalizerPass,
  type FinalizerService,
} from "../interpreter/finalizerRun.ts";
import type { ProjectAccessSettings } from "../interpreter/projectAccess.ts";
import type { Partition, RecoveryEpoch } from "../interpreter/projectStore.ts";
import {
  sessionSchedulerPass,
  type SessionSchedulerService,
} from "../interpreter/sessionSchedulerRun.ts";
import {
  threadWakePass,
  type ThreadWakeService,
} from "../interpreter/threadWake.ts";
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
import {
  composeFinalizerService,
  composeForgeRepositoryMinting,
  composeSchedulerBriefingReads,
  composeTicketServiceCredentials,
  type FinalizerServiceRuntime,
} from "../compose.ts";
import {
  githubInstallationTokensOptions,
  githubInstallationTokensPrecondition,
} from "../adapters/forge/githubInstallationTokens.ts";
import type { ForgeAppKey } from "../interpreter/forgeInstallation.ts";
import { ketoProjectAccess } from "../adapters/keto/projectAccess.ts";
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
import { postgresSessionScheduler } from "../adapters/postgres/sessionScheduler.ts";
import { postgresThreadWakes } from "../adapters/postgres/thread.ts";
import { postgresEvaluationStack } from "../adapters/postgres/evaluationStack.ts";
import { postgresTicketBrief } from "../adapters/postgres/ticketBrief.ts";
import { evaluationStackSpawn } from "../interpreter/evaluationStackSpawn.ts";
import { postgresTicketLandings } from "../adapters/postgres/ticketLandings.ts";
import { postgresDependencyResults } from "../adapters/postgres/dependencyDeliveries.ts";
import { gitCommitAncestry } from "../adapters/git/gitCommitAncestry.ts";
import { dependencyPinning } from "../interpreter/dependencyDelivery.ts";
import { artifactStore } from "../adapters/artifacts/artifactStore.ts";
import { postgresWorkerPoolRoster } from "../adapters/postgres/workerPool.ts";
import {
  finalizerRole,
  schedulerRole,
  ticketServiceRole,
} from "../adapters/postgres/schema.ts";
import { postgresDomainConfigurationPrecondition } from "../adapters/postgres/domainConfiguration.ts";
import { postgresWorkerCatalogPrecondition } from "../adapters/postgres/workerCatalog.ts";
import { postgresExecutionRoutingPrecondition } from "../adapters/postgres/executionPlacement.ts";
import { postgresSessionRoutingPrecondition } from "../adapters/postgres/sessionPlacement.ts";
import { postgresSessionLaunchPrecondition } from "../adapters/postgres/workerPoolSessions.ts";
import type { SessionRouting } from "../interpreter/sessionPlacement.ts";
import type { SessionLaunchFacts } from "../interpreter/workerPoolSessions.ts";
import type { OfferedWorker } from "../interpreter/workerCatalog.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
} from "../adapters/postgres/runtimeSchema.ts";
import {
  journalLegalityPrecondition,
  runtimePreconditionAnswer,
  schemaCompatibilityPrecondition,
} from "../interpreter/serviceRuntime.ts";
import { postgresJournalLegality } from "../adapters/postgres/journal.ts";
import type { Config } from "../domain/config.ts";
import { checkedReworkCap, type ReworkCap } from "../interpreter/reworkCap.ts";
import { asOwnerId } from "../interpreter/projectStore.ts";
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

/** The line an operator reads for one thing a scheduler pass could not mend, naming the attempt it was about. */
function schedulerProcessNoticeLine(notice: SchedulerPassNotice): string {
  const { partition, attempt } = notice.attempt;
  const where = `execution scheduler: ${partition.tenant}/${partition.project} attempt ${attempt}`;
  switch (notice.notice) {
    case "SiteFault":
      return `${where} withdrawn, its pod failed on the site: ${notice.why}\n`;
    case "ErrorUnwritten":
      return `${where} ended ${notice.ended}, and its error text was not stored: ${notice.why}: ${JSON.stringify(notice.text)}\n`;
  }
}

/**
 * Drives both schedulers and the thread wake pass in one tick of one pacing
 * loop, execution first and sessions last: either cleanup raises on a cluster
 * answering `Unavailable` to a cancel and `../interpreter/serviceRuntime.ts`
 * ends the loop on a raise out of `run`, so the proved execution machine is not
 * denied a dispatch on its way out, a turn the wake pass wakes is placed in the
 * same tick, and one loop is the whole of the pacing because a second over the
 * wake cursor would be a second writer to it. What the execution pass could
 * not mend, and a change whose fan-out one wake pass cannot read, which is the
 * one arm in which a notice is dropped for good, reach stderr, since an
 * operator is who mends them.
 */
export function schedulerProcess(
  service: ExecutionSchedulerService,
  sessions: SessionSchedulerService,
  wakes: ThreadWakeService,
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
      run: async () => {
        const report = await executionSchedulerPass(
          service,
          identity.owner,
          identity.recoveryEpoch,
          identity.cluster,
        );
        for (const notice of report.notices)
          process.stderr.write(schedulerProcessNoticeLine(notice));
        const woken = await threadWakePass(wakes);
        if (woken.truncatedAt !== undefined)
          process.stderr.write(
            `thread wakes: change ${String(woken.truncatedAt)} wakes more threads than one pass reads, and the pass moved past it\n`,
          );
        await sessionSchedulerPass(sessions, identity.recoveryEpoch);
      },
    },
    systemPacing,
    processPreconditions(requirements),
    config,
  );
}

/**
 * Holds the discovery cursor and the diagnosis a contained failure would
 * otherwise leave nowhere. The pass contains a project it cannot activate, so
 * this is the only place an operator learns which one.
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

export interface TicketServiceProcessRootConfig {
  readonly database: ProcessDatabaseConfig;
  readonly runtime: ServiceRuntimeConfig;
  readonly pass: TicketServiceRuntimeConfig;
  readonly domain: Config;
  /** How many rework cycles this deployment gives a ticket before parking it. */
  readonly rework: ReworkCap;
  readonly owner: string;
  readonly ticket?: TicketServiceConfig;
  readonly source: Omit<GitPromotionOptions, "credentials"> &
    CredentialFilesOptions;
  /** Where a brief's named images are read back, to pin the digest every spawn's bundle carries. */
  readonly artifacts: { readonly root: string };
  /**
   * The App key this deployment observes a source through, when it holds one.
   * A deployment naming neither a key nor a credential file could observe
   * nothing, which its configuration is what refuses.
   */
  readonly forge?: ForgeAppKey;
}

function ticketServiceAncestry(
  source: TicketServiceProcessRootConfig["source"],
  credentials: ReturnType<typeof composeTicketServiceCredentials>,
) {
  return gitCommitAncestry({
    scratchDirectory: source.scratchDirectory,
    identity: source.identity,
    environment: source.environment,
    credentials,
    ...(source.credentialUsername === undefined
      ? {}
      : { credentialUsername: source.credentialUsername }),
  });
}

/** Owns the writer-role pool and composes the independently deployable ticket service. */
export function ticketServiceProcessRoot(
  config: TicketServiceProcessRootConfig,
): ServiceRuntime {
  const pool = processPool(config.database);
  const credentials = composeTicketServiceCredentials(
    config.source,
    composeForgeRepositoryMinting(pool, config.forge, "Settled"),
  );
  const git = gitPromotion({ ...config.source, credentials });
  const bindings = postgresProjectRepositoryBinding(pool);
  const briefs = postgresTicketBrief(pool);
  const ancestry = ticketServiceAncestry(config.source, credentials);
  const service: TicketServiceRuntimeService = {
    domain: config.domain,
    rework: checkedReworkCap(config.rework),
    discovery: postgresProjectDiscovery(pool),
    decisions: postgresProjectDecision(pool),
    projects: postgresProjectStore(pool),
    owner: asOwnerId(config.owner),
    monotonicNow: () => performance.now(),
    executionSources: executionSourceObservation(
      bindings,
      git,
      postgresExecutionSourceHistory(pool),
      ancestry,
      evaluationStackSpawn({ store: postgresEvaluationStack(pool), briefs }),
      briefs,
    ),
    ticketBriefs: briefs,
    projectArtifacts: artifactStore({ root: config.artifacts.root }),
    dependencyPinning: dependencyPinning({
      results: postgresDependencyResults(pool),
      landings: postgresTicketLandings(pool),
      bindings,
      ancestry,
    }),
    stacks: postgresEvaluationStack(pool),
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
          journalLegalityPrecondition(postgresJournalLegality(pool)),
          gitAvailablePrecondition(config.source.environment),
          gitScratchWritablePrecondition(config.source.scratchDirectory),
          credentialFilesPrecondition(config.source),
          ...(config.forge === undefined
            ? []
            : [
                githubInstallationTokensPrecondition(
                  githubInstallationTokensOptions(config.forge),
                ),
              ]),
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
    | "store"
    | "configurations"
    | "priorWorkReports"
    | "priorEvaluationReports"
    | "failedLanding"
    | "readOnlyRepositories"
    | "northStar"
    | "dependencyDeliveries"
    | "ticketBriefs"
    | "bindings"
    | "workerPools"
    | "access"
  >;
  /**
   * Where the project authority is. A pass asks it whether a member's runner
   * may still run their work in a project, and the wake pass whether a
   * thread's principal may still read the project, which no row in this
   * database says.
   */
  readonly access: ProjectAccessSettings;
  /**
   * The wake pass's bound. It is required rather than defaulted here, because a
   * root that supplied its own default would be a second place the default
   * lives and an arm in which a deployment's bound is not the bound that runs.
   */
  readonly wakes: { readonly wakesPerPassMax: number };
  /**
   * The session half of the same process; its own store and its binding read
   * come from the same pool, so a deployment names neither.
   */
  readonly sessions: Omit<SessionSchedulerService, "store" | "bindings">;
  /** Where sessions run, published before the loop so the pass that places them reads this process's routing. */
  readonly sessionRouting: SessionRouting;
  /** What a session's pod is launched with beyond its policy, published with it so a pool's claim launches a session as this process would. */
  readonly sessionLaunch: Pick<
    SessionLaunchFacts,
    "bounds" | "model" | "deadlineSecs"
  >;
  readonly workerCatalog: readonly OfferedWorker[];
  readonly additional?: readonly RuntimePrecondition[];
}

/** Composes the scheduler service with the PostgreSQL ports its process owns. */
export function schedulerProcessRootService(
  pool: pg.Pool,
  service: SchedulerProcessRootConfig["service"],
  access: ProjectAccessSettings,
): ExecutionSchedulerService {
  return {
    ...service,
    access: ketoProjectAccess(access),
    store: postgresExecutionScheduler(pool),
    ...composeSchedulerBriefingReads(pool),
    workerPools: postgresWorkerPoolRoster(pool),
  };
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
  const service = schedulerProcessRootService(
    pool,
    config.service,
    config.access,
  );
  return ownedProcess(
    pool,
    schedulerProcess(
      service,
      schedulerProcessRootSessions(pool, config.sessions),
      {
        store: postgresThreadWakes(pool),
        access: ketoProjectAccess(config.access),
        clock: { nowIso: () => new Date().toISOString() },
        wakesPerPassMax: config.wakes.wakesPerPassMax,
      },
      config.identity,
      {
        pool,
        additional: [
          postgresRolePrecondition(pool, schedulerRole),
          recoveryEpochPrecondition(pool, config.identity.recoveryEpoch),
          postgresWorkerCatalogPrecondition(pool, config.workerCatalog),
          postgresExecutionRoutingPrecondition(
            pool,
            config.service.policy.routing,
          ),
          postgresSessionRoutingPrecondition(pool, config.sessionRouting),
          postgresSessionLaunchPrecondition(pool, {
            image: config.sessions.policy.image,
            authority: config.sessions.policy.grant,
            mirrors: config.sessions.policy.mirrors,
            placementBackoffSecs: config.sessions.config.placementBackoffSecs,
            ...config.sessionLaunch,
          }),
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
  /**
   * The ports one finalizer acts through, over the pool this root owns: a
   * deployment that mints its own credentials reaches the forge installations
   * through that same pool, and a second one would be a second connection
   * limit to hold this role under.
   */
  readonly service: (pool: pg.Pool) => FinalizerServiceRuntime;
  readonly finalizer?: FinalizerConfig;
}

/**
 * Composes the finalizer service over the pool its process owns, its holds and
 * every forge act it makes written to stderr: a request held where it was found
 * writes nothing anywhere else, and neither does what a forge answered beyond
 * the newest of each act its row keeps, so this is where an operator learns
 * both.
 */
export function finalizerProcessRootService(
  pool: pg.Pool,
  config: Pick<FinalizerProcessRootConfig, "service" | "finalizer">,
): FinalizerService {
  return composeFinalizerService(
    pool,
    config.service(pool),
    config.finalizer,
    finalizerProcessLog((line) => {
      process.stderr.write(line);
    }),
  );
}

/** Owns the finalizer-role pool while repository access remains an explicit port. */
export function finalizerProcessRoot(
  config: FinalizerProcessRootConfig,
): ServiceRuntime {
  const pool = processPool(config.database);
  const service = finalizerProcessRootService(pool, config);
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
