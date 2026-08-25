import type { Config } from "../domain/config.ts";
import type { ProjectDecision } from "./projectDecision.ts";
import type { ProjectDiscovery } from "./projectDiscovery.ts";
import type { OwnerId, ProjectStore } from "./projectStore.ts";
import {
  projectTicketWriterRun,
  type ProjectTicketWriter,
} from "./projectWriter.ts";
import type { ExecutionSourceObservationPort } from "./executionSource.ts";
import {
  silentTicketServiceMetrics,
  ticketServiceDefaults,
  type TicketServiceConfig,
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
  readonly executionSources?: ExecutionSourceObservationPort;
  readonly owner: OwnerId;
  readonly monotonicNow: () => number;
  readonly ticketConfig?: TicketServiceConfig;
  readonly metrics?: TicketServiceMetrics;
}

export interface TicketServicePassReport {
  readonly discovered: number;
  readonly activated: number;
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

/** Activates a bounded set of ready projects under one fenced lease apiece. */
export async function ticketServiceRunOnce(
  service: TicketServiceRuntimeService,
  runtimeConfig: TicketServiceRuntimeConfig,
): Promise<TicketServicePassReport> {
  const config = checkedTicketServiceRuntimeConfig(runtimeConfig);
  const readiness = await service.discovery.ready(config.projectsPerPassMax);
  const writer: ProjectTicketWriter = {
    config: service.domain,
    store: service.projects,
    decisions: service.decisions,
    ...(service.executionSources === undefined
      ? {}
      : { executionSources: service.executionSources }),
  };
  let activated = 0;
  for (const ready of readiness) {
    const acquired = await service.projects.acquire(
      ready.partition,
      service.owner,
      config.projectLeaseSeconds,
    );
    if (acquired.acquired !== "Granted") continue;
    try {
      await projectTicketWriterRun(
        writer,
        service.discovery,
        ready,
        acquired.lease,
        service.monotonicNow,
        service.ticketConfig ?? ticketServiceDefaults,
        service.metrics ?? silentTicketServiceMetrics,
      );
      activated += 1;
    } finally {
      await service.projects.release(acquired.lease);
    }
  }
  return { discovered: readiness.length, activated };
}
