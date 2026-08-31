import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ProjectDiscovery,
  Readiness,
} from "../../src/interpreter/projectDiscovery.ts";
import {
  asOwnerId,
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Lease,
  type Partition,
  type ProjectStore,
} from "../../src/interpreter/projectStore.ts";
import {
  silentTicketServiceMetrics,
  type TicketServiceMetrics,
} from "../../src/interpreter/ticketService.ts";
import {
  ticketServiceRunOnce,
  type TicketServiceRuntimeService,
} from "../../src/interpreter/ticketServiceRun.ts";
import { budgetedInstance } from "../domain/configs.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const poisoned = {
  tenant: asTenantId("tenant"),
  project: asProjectId("poisoned"),
};
const healthy = {
  tenant: asTenantId("tenant"),
  project: asProjectId("healthy"),
};
const owner = asOwnerId("writer");
const recoveryEpoch = asRecoveryEpoch("epoch");
const lease: Lease = {
  partition,
  owner,
  recoveryEpoch,
  fencingEpoch: 1,
  head: 0,
};

function unreachablePromise<Result>(): Promise<Result> {
  return Promise.reject(new Error("unreachable test port"));
}

const executionSources = {
  observe: () =>
    Promise.resolve({
      observed: "Unreadable" as const,
      evidence: "RefUnreadable" as const,
    }),
};

/** The pass's service around the two ports every case here is actually about. */
function passService(
  projects: ProjectStore,
  discovery: ProjectDiscovery,
  metrics?: TicketServiceMetrics,
): TicketServiceRuntimeService {
  return {
    domain: budgetedInstance,
    discovery,
    decisions: { decide: () => unreachablePromise() },
    projects,
    executionSources,
    ticketBriefs: { brief: () => Promise.resolve(undefined) },
    owner,
    monotonicNow: () => 0,
    ...(metrics === undefined ? {} : { metrics }),
  };
}

/** A per-partition fault a port raises, absent for the partitions it spares. */
type FleetFault = (partition: Partition) => Error | undefined;

/**
 * The two-project fleet the containment cases draw, recording every call it is
 * asked so a case can say which ports a failing project did and did not reach.
 */
function recordingFleet(
  calls: string[],
  faults: { readonly acquire?: FleetFault; readonly load?: FleetFault },
): { projects: ProjectStore; discovery: ProjectDiscovery } {
  const projects = {
    acquire: (held: Partition) => {
      calls.push(`acquire:${held.project}`);
      const fault = faults.acquire?.(held);
      return fault === undefined
        ? Promise.resolve({
            acquired: "Granted",
            lease: { ...lease, partition: held },
          })
        : Promise.reject(fault);
    },
    release: (held: Lease) => {
      calls.push(`release:${held.partition.project}`);
      return Promise.resolve();
    },
    load: (held: Lease) => {
      const fault = faults.load?.(held.partition);
      return fault === undefined
        ? Promise.resolve({ parsed: "Ok", value: [] })
        : Promise.reject(fault);
    },
  } as unknown as ProjectStore;
  const discovery = {
    ready: () =>
      Promise.resolve([
        { partition: poisoned, generation: 1 },
        { partition: healthy, generation: 1 },
      ]),
    next: () => Promise.resolve(undefined),
    clearReadiness: (readiness: Readiness) => {
      calls.push(`clear:${readiness.partition.project}`);
      return Promise.resolve({ cleared: "Cleared" });
    },
  } as unknown as ProjectDiscovery;
  return { projects, discovery };
}

/** The fault that poisons one partition and spares every other. */
function poisonedBy(message: string): FleetFault {
  return (candidate) =>
    candidate.project === poisoned.project ? new Error(message) : undefined;
}

test("one pass leases each discovered project and releases it after idle", async () => {
  const calls: string[] = [];
  const projects: ProjectStore = {
    currentRecoveryEpoch: () => Promise.resolve(recoveryEpoch),
    establishRecoveryEpoch: () => Promise.resolve(recoveryEpoch),
    createProject: () => unreachablePromise(),
    standing: () => unreachablePromise(),
    acquire: (_partition, _owner, seconds) => {
      calls.push(`acquire:${String(seconds)}`);
      return Promise.resolve({ acquired: "Granted", lease });
    },
    renew: () => unreachablePromise(),
    release: () => {
      calls.push("release");
      return Promise.resolve();
    },
    load: () => Promise.resolve({ parsed: "Ok", value: [] }),
    fence: () => unreachablePromise(),
  };
  const discovery: ProjectDiscovery = {
    ready: (maximum) => {
      calls.push(`ready:${String(maximum)}`);
      return Promise.resolve([{ partition, generation: 1 }]);
    },
    next: () => Promise.resolve(undefined),
    clearReadiness: () => {
      calls.push("clear");
      return Promise.resolve({ cleared: "Cleared" });
    },
  };

  assert.deepEqual(
    await ticketServiceRunOnce(passService(projects, discovery), {
      projectsPerPassMax: 4,
      projectLeaseSeconds: 10,
    }),
    { discovered: 1, activated: 1, failed: 0, failures: [] },
  );
  assert.deepEqual(calls, ["ready:4", "acquire:10", "clear", "release"]);
});

test("a project held by another writer is discovered but not activated", async () => {
  const projects = {
    acquire: () => Promise.resolve({ acquired: "HeldByAnother", owner }),
  } as unknown as ProjectStore;
  const discovery = {
    ready: () => Promise.resolve([{ partition, generation: 1 }]),
  } as unknown as ProjectDiscovery;

  assert.deepEqual(
    await ticketServiceRunOnce(passService(projects, discovery), {
      projectsPerPassMax: 1,
      projectLeaseSeconds: 10,
    }),
    {
      discovered: 1,
      activated: 0,
      failed: 0,
      failures: [],
      resumeAfter: partition,
    },
  );
});

test("a project whose journal cannot be loaded is counted failed and the next is still activated", async () => {
  const calls: string[] = [];
  const fleet = recordingFleet(calls, {
    load: poisonedBy("journal is illegal to replay"),
  });

  assert.deepEqual(
    await ticketServiceRunOnce(passService(fleet.projects, fleet.discovery), {
      projectsPerPassMax: 4,
      projectLeaseSeconds: 10,
    }),
    {
      discovered: 2,
      activated: 1,
      failed: 1,
      failures: [
        {
          partition: poisoned,
          reason: "ActivationFailed",
          message: "journal is illegal to replay",
        },
      ],
    },
  );
  assert.deepEqual(calls, [
    "acquire:poisoned",
    "release:poisoned",
    "acquire:healthy",
    "clear:healthy",
    "release:healthy",
  ]);
});

test("a project whose lease cannot be acquired is counted failed and never released", async () => {
  const calls: string[] = [];
  const fleet = recordingFleet(calls, {
    acquire: poisonedBy("lease table is unreachable"),
  });

  assert.deepEqual(
    await ticketServiceRunOnce(passService(fleet.projects, fleet.discovery), {
      projectsPerPassMax: 4,
      projectLeaseSeconds: 10,
    }),
    {
      discovered: 2,
      activated: 1,
      failed: 1,
      failures: [
        {
          partition: poisoned,
          reason: "AcquisitionFailed",
          message: "lease table is unreachable",
        },
      ],
    },
  );
  assert.deepEqual(calls, [
    "acquire:poisoned",
    "acquire:healthy",
    "clear:healthy",
    "release:healthy",
  ]);
});

test("a contained failure reaches the metrics sink as a closed reason", async () => {
  const reasons: string[] = [];
  const metrics: TicketServiceMetrics = {
    ...silentTicketServiceMetrics,
    projectFailed: (reason) => {
      reasons.push(reason);
    },
  };
  const projects = {
    acquire: () => Promise.resolve({ acquired: "Granted", lease }),
    release: () => Promise.resolve(),
    load: () => Promise.reject(new Error("journal is illegal to replay")),
  } as unknown as ProjectStore;
  const discovery = {
    ready: () => Promise.resolve([{ partition, generation: 1 }]),
  } as unknown as ProjectDiscovery;

  const report = await ticketServiceRunOnce(
    passService(projects, discovery, metrics),
    { projectsPerPassMax: 4, projectLeaseSeconds: 10 },
  );

  assert.deepEqual(reasons, ["ActivationFailed"]);
  assert.equal(report.failed, 1);
  assert.deepEqual(report.failures, [
    {
      partition,
      reason: "ActivationFailed",
      message: "journal is illegal to replay",
    },
  ]);
});

test("a lease the pass cannot release is reported without unsaying the activation", async () => {
  const projects = {
    acquire: () => Promise.resolve({ acquired: "Granted", lease }),
    release: () => Promise.reject(new Error("lease row is gone")),
    load: () => Promise.resolve({ parsed: "Ok", value: [] }),
  } as unknown as ProjectStore;
  const discovery = {
    ready: () => Promise.resolve([{ partition, generation: 1 }]),
    next: () => Promise.resolve(undefined),
    clearReadiness: () => Promise.resolve({ cleared: "Cleared" }),
  } as unknown as ProjectDiscovery;

  assert.deepEqual(
    await ticketServiceRunOnce(passService(projects, discovery), {
      projectsPerPassMax: 4,
      projectLeaseSeconds: 10,
    }),
    {
      discovered: 1,
      activated: 1,
      failed: 0,
      failures: [
        { partition, reason: "ReleaseFailed", message: "lease row is gone" },
      ],
    },
  );
});

test("projects that fail every pass cannot hold the discovery window against a healthy one", async () => {
  const fleet = [
    { tenant: asTenantId("tenant"), project: asProjectId("a-poisoned") },
    { tenant: asTenantId("tenant"), project: asProjectId("b-poisoned") },
    { tenant: asTenantId("tenant"), project: asProjectId("c-healthy") },
  ];
  const activated: string[] = [];
  const projects = {
    acquire: (held: Partition) =>
      Promise.resolve({
        acquired: "Granted",
        lease: { ...lease, partition: held },
      }),
    release: () => Promise.resolve(),
    load: (held: Lease) =>
      held.partition.project.endsWith("poisoned")
        ? Promise.reject(new Error("journal is illegal to replay"))
        : Promise.resolve({ parsed: "Ok", value: [] }),
  } as unknown as ProjectStore;
  const discovery = {
    ready: (partitionsMax: number, after?: Partition) =>
      Promise.resolve(
        fleet
          .filter((one) => after === undefined || one.project > after.project)
          .slice(0, partitionsMax)
          .map((one) => ({ partition: one, generation: 1 })),
      ),
    next: () => Promise.resolve(undefined),
    clearReadiness: (readiness: Readiness) => {
      activated.push(readiness.partition.project);
      return Promise.resolve({ cleared: "Cleared" });
    },
  } as unknown as ProjectDiscovery;
  const service = passService(projects, discovery);
  const runtimeConfig = { projectsPerPassMax: 2, projectLeaseSeconds: 10 };

  const first = await ticketServiceRunOnce(service, runtimeConfig);
  assert.deepEqual(
    { activated: first.activated, failed: first.failed },
    { activated: 0, failed: 2 },
  );
  assert.deepEqual(activated, []);

  const second = await ticketServiceRunOnce(
    service,
    runtimeConfig,
    first.resumeAfter,
  );
  assert.deepEqual(
    { activated: second.activated, failed: second.failed },
    { activated: 1, failed: 0 },
  );
  assert.deepEqual(activated, ["c-healthy"]);
  assert.equal(second.resumeAfter, undefined);
});
