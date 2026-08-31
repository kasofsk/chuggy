import type { Config } from "../domain/config.ts";
import type { ProjectDecision } from "./projectDecision.ts";
import type { ProjectDiscovery, Readiness } from "./projectDiscovery.ts";
import type { OwnerId, Partition, ProjectStore } from "./projectStore.ts";
import {
  projectTicketWriterRun,
  type ProjectTicketWriter,
} from "./projectWriter.ts";
import type { ExecutionSourceObservationPort } from "./executionSource.ts";
import type { TicketBriefPort } from "./ticketBrief.ts";
import {
  observe,
  silentTicketServiceMetrics,
  ticketServiceDefaults,
  type TicketServiceConfig,
  type TicketServiceFailureReason,
  type TicketServiceMetrics,
} from "./ticketService.ts";

export interface TicketServiceRuntimeConfig {
  readonly projectsPerPassMax: number;
  readonly projectLeaseSeconds: number;
}

export interface TicketServiceRuntimeService {
  readonly domain: Config;
  readonly discovery: ProjectDiscovery;
  readonly decisions: ProjectDecision;
  readonly projects: ProjectStore;
  readonly executionSources: ExecutionSourceObservationPort;
  readonly ticketBriefs: TicketBriefPort;
  readonly owner: OwnerId;
  readonly monotonicNow: () => number;
  readonly ticketConfig?: TicketServiceConfig;
  readonly metrics?: TicketServiceMetrics;
}

/** One contained fault: whose turn raised it, what it was, and what it said. */
export interface TicketServiceProjectFailure {
  readonly partition: Partition;
  readonly reason: TicketServiceFailureReason;
  readonly message: string;
}

export interface TicketServicePassReport {
  readonly discovered: number;
  readonly activated: number;
  /** Projects whose turn did not complete, each left ready for a later pass. */
  readonly failed: number;
  /**
   * Every fault the pass contained, in the order it met them. A turn raises at
   * most one of each reason, so this is bounded by twice `discovered`.
   */
  readonly failures: readonly TicketServiceProjectFailure[];
  /**
   * Where the next pass should resume discovery, absent once the window ran
   * short and the sweep is back at the start of the fleet.
   */
  readonly resumeAfter?: Partition;
}

function checkedTicketServiceRuntimeConfig(
  config: TicketServiceRuntimeConfig,
): TicketServiceRuntimeConfig {
  if (
    !Number.isSafeInteger(config.projectsPerPassMax) ||
    config.projectsPerPassMax < 1 ||
    !Number.isFinite(config.projectLeaseSeconds) ||
    config.projectLeaseSeconds <= 0
  )
    throw new RangeError("ticket-service runtime bounds must be positive");
  return config;
}

function ticketServiceRunOnceFailure(
  partition: Partition,
  reason: TicketServiceFailureReason,
  error: unknown,
): TicketServiceProjectFailure {
  return {
    partition,
    reason,
    message: error instanceof Error ? error.message : "unknown failure",
  };
}

/** What one project's turn spent and raised, every fault of it a value. */
interface TicketServiceRunOnceTurn {
  readonly activated: boolean;
  readonly failures: readonly TicketServiceProjectFailure[];
}

/**
 * One project's turn under one fenced lease. A release that fails is reported
 * beside the turn rather than in place of it, so it can neither mask the fault
 * the turn already raised nor unsay an activation that completed.
 */
async function ticketServiceRunOnceTurn(
  service: TicketServiceRuntimeService,
  writer: ProjectTicketWriter,
  config: TicketServiceRuntimeConfig,
  ready: Readiness,
  metrics: TicketServiceMetrics,
): Promise<TicketServiceRunOnceTurn> {
  let acquired;
  try {
    acquired = await service.projects.acquire(
      ready.partition,
      service.owner,
      config.projectLeaseSeconds,
    );
  } catch (error: unknown) {
    const failure = ticketServiceRunOnceFailure(
      ready.partition,
      "AcquisitionFailed",
      error,
    );
    return { activated: false, failures: [failure] };
  }
  if (acquired.acquired !== "Granted")
    return { activated: false, failures: [] };
  const failures: TicketServiceProjectFailure[] = [];
  let activated = false;
  try {
    await projectTicketWriterRun(
      writer,
      service.discovery,
      ready,
      acquired.lease,
      service.monotonicNow,
      service.ticketConfig ?? ticketServiceDefaults,
      metrics,
    );
    activated = true;
  } catch (error: unknown) {
    failures.push(
      ticketServiceRunOnceFailure(ready.partition, "ActivationFailed", error),
    );
  } finally {
    try {
      await service.projects.release(acquired.lease);
    } catch (error: unknown) {
      failures.push(
        ticketServiceRunOnceFailure(ready.partition, "ReleaseFailed", error),
      );
    }
  }
  return { activated, failures };
}

/**
 * Activates a bounded set of ready projects under one fenced lease apiece,
 * resuming discovery after `resumeAfter` so no prefix of the fleet can hold the
 * window. A project whose turn raises is counted failed and reported by
 * partition, and the pass moves on: a partition nobody can replay stops itself
 * and not the installation.
 */
export async function ticketServiceRunOnce(
  service: TicketServiceRuntimeService,
  runtimeConfig: TicketServiceRuntimeConfig,
  resumeAfter?: Partition,
): Promise<TicketServicePassReport> {
  const config = checkedTicketServiceRuntimeConfig(runtimeConfig);
  const readiness = await service.discovery.ready(
    config.projectsPerPassMax,
    resumeAfter,
  );
  const metrics = service.metrics ?? silentTicketServiceMetrics;
  const writer: ProjectTicketWriter = {
    config: service.domain,
    store: service.projects,
    decisions: service.decisions,
    executionSources: service.executionSources,
    ticketBriefs: service.ticketBriefs,
  };
  let activated = 0;
  let failed = 0;
  const failures: TicketServiceProjectFailure[] = [];
  for (const ready of readiness) {
    const turn = await ticketServiceRunOnceTurn(
      service,
      writer,
      config,
      ready,
      metrics,
    );
    if (turn.activated) activated += 1;
    else if (turn.failures.length > 0) failed += 1;
    for (const failure of turn.failures) {
      failures.push(failure);
      observe(() => {
        metrics.projectFailed(failure.reason);
      });
    }
  }
  const swept = readiness.at(-1)?.partition;
  const next = readiness.length < config.projectsPerPassMax ? undefined : swept;
  return {
    discovered: readiness.length,
    activated,
    failed,
    failures,
    ...(next === undefined ? {} : { resumeAfter: next }),
  };
}
