/**
 * Where a project's executions run, as its administrator reads and chooses it:
 * who may read, who may write, and which routes the tenant's hosted grant
 * decides.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  executionPlacementAdministration,
  type ExecutionPlacementStanding,
  type ExecutionPlacementStore,
} from "../../src/interpreter/executionPlacement.ts";
import type { ExecutionRoutes } from "../../src/interpreter/executionScheduler.ts";
import {
  placementChoices,
  type PlacementWrite,
} from "../../src/interpreter/placementRoute.ts";
import {
  memberAuthority,
  type ProjectAccess,
  type ProjectAccessKind,
  type TenantAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";

const partition: Partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};
const principal = asPrincipal("https://issuer.test#owner");

/** An authority granting the project kinds and tenant kinds a case names, recording every question. */
function accessGranting(
  project: readonly ProjectAccessKind[],
  tenant: readonly TenantAccessKind[],
  asked: string[],
): ProjectAccess {
  return {
    authorize: (_principal, _partition, kind) => {
      asked.push(kind);
      return Promise.resolve(
        project.includes(kind) ? memberAuthority(principal) : undefined,
      );
    },
    authorizeTenant: (_principal, _tenant, kind) => {
      asked.push(kind);
      return Promise.resolve(
        tenant.includes(kind) ? memberAuthority(principal) : undefined,
      );
    },
  };
}

const standing: ExecutionPlacementStanding = {
  defaults: { Work: "Pool", Evaluation: "Pool" },
  override: {},
  placement: { Work: "InCluster", Evaluation: "Pool" },
};

/** A store answering `written` to every write and recording what it was asked to write. */
function storeAnswering(
  written: PlacementWrite,
  writes: ExecutionRoutes[],
): ExecutionPlacementStore {
  return {
    standing: () => Promise.resolve(standing),
    write: (_partition, placement) => {
      writes.push(placement);
      return Promise.resolve(written);
    },
  };
}

const hostedPlacement: ExecutionRoutes = {
  Work: "InCluster",
  Evaluation: "Pool",
};
const pooledPlacement: ExecutionRoutes = { Work: "Pool", Evaluation: "Pool" };

test("a reader is offered no route, an administrator runners alone, and the hosted grant both", () => {
  assert.deepEqual(placementChoices(false, true), []);
  assert.deepEqual(placementChoices(true, false), ["Pool"]);
  assert.deepEqual(placementChoices(true, true), ["InCluster", "Pool"]);
});

test("a caller who cannot read the project is not told it exists", async () => {
  const asked: string[] = [];
  const administration = executionPlacementAdministration(
    accessGranting([], ["ExecuteHosted"], asked),
    storeAnswering("Written", []),
  );
  assert.deepEqual(await administration.read(principal, partition), {
    result: "NotFound",
  });
});

test("a reader reads each kind's route and its source, is offered nothing, and the tenant is not asked", async () => {
  const asked: string[] = [];
  const administration = executionPlacementAdministration(
    accessGranting(["Read"], ["ExecuteHosted"], asked),
    storeAnswering("Written", []),
  );
  assert.deepEqual(await administration.read(principal, partition), {
    result: "Found",
    view: {
      routes: {
        Work: { route: "InCluster", source: "Project" },
        Evaluation: { route: "Pool", source: "Project" },
      },
      choices: [],
    },
  });
  assert.deepEqual(asked, ["Read", "Administer"]);
});

test("an administrator the tenant granted hosted runs is offered both routes", async () => {
  const administration = executionPlacementAdministration(
    accessGranting(["Read", "Administer"], ["ExecuteHosted"], []),
    storeAnswering("Written", []),
  );
  const read = await administration.read(principal, partition);
  assert.equal(read.result, "Found");
  assert.deepEqual(read.view.choices, ["InCluster", "Pool"]);
});

test("a caller who does not administer the project writes nothing and is not told it exists", async () => {
  const writes: ExecutionRoutes[] = [];
  const administration = executionPlacementAdministration(
    accessGranting(["Read"], ["ExecuteHosted"], []),
    storeAnswering("Written", writes),
  );
  assert.deepEqual(
    await administration.write(principal, partition, pooledPlacement),
    { result: "NotFound" },
  );
  assert.deepEqual(writes, []);
});

test("an administrator without the hosted grant is refused a hosted route by its code and writes nothing", async () => {
  const writes: ExecutionRoutes[] = [];
  const administration = executionPlacementAdministration(
    accessGranting(["Read", "Administer"], [], []),
    storeAnswering("Written", writes),
  );
  assert.deepEqual(
    await administration.write(principal, partition, hostedPlacement),
    { result: "HostedRunsNotGranted" },
  );
  assert.deepEqual(
    await administration.write(principal, partition, {
      Work: "Pool",
      Evaluation: "InCluster",
    }),
    { result: "HostedRunsNotGranted" },
  );
  assert.deepEqual(writes, []);
});

test("an administrator without the hosted grant still places the project on runners", async () => {
  const writes: ExecutionRoutes[] = [];
  const administration = executionPlacementAdministration(
    accessGranting(["Read", "Administer"], [], []),
    storeAnswering("Written", writes),
  );
  const written = await administration.write(
    principal,
    partition,
    pooledPlacement,
  );
  assert.equal(written.result, "Written");
  assert.deepEqual(written.view.choices, ["Pool"]);
  assert.deepEqual(writes, [pooledPlacement]);
});

test("what the store answered is what the write answers, a project gone since being authorized included", async () => {
  for (const answered of ["Written", "Unchanged", "NotFound"] as const) {
    const administration = executionPlacementAdministration(
      accessGranting(["Read", "Administer"], ["ExecuteHosted"], []),
      storeAnswering(answered, []),
    );
    const written = await administration.write(
      principal,
      partition,
      hostedPlacement,
    );
    assert.equal(written.result, answered);
  }
});
