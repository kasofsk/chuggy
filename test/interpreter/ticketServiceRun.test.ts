import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectDecision } from "../../src/interpreter/projectDecision.ts";
import type { ProjectDiscovery } from "../../src/interpreter/projectDiscovery.ts";
import {
  asOwnerId,
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Lease,
  type ProjectStore,
} from "../../src/interpreter/projectStore.ts";
import { ticketServiceRunOnce } from "../../src/interpreter/ticketServiceRun.ts";
import { budgetedInstance } from "../domain/configs.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
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
  const decisions: ProjectDecision = {
    decide: () => unreachablePromise(),
  };

  assert.deepEqual(
    await ticketServiceRunOnce(
      {
        domain: budgetedInstance,
        discovery,
        decisions,
        projects,
        owner,
        monotonicNow: () => 0,
      },
      { projectsPerPassMax: 4, projectLeaseSeconds: 10 },
    ),
    { discovered: 1, activated: 1 },
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
    await ticketServiceRunOnce(
      {
        domain: budgetedInstance,
        discovery,
        decisions: { decide: () => unreachablePromise() },
        projects,
        owner,
        monotonicNow: () => 0,
      },
      { projectsPerPassMax: 1, projectLeaseSeconds: 10 },
    ),
    { discovered: 1, activated: 0 },
  );
});
