/**
 * A subsidized lead against a real server: the profile the selector publishes
 * as it starts and the API reads through its door, a project's stored choice
 * of it, and the offering its lead resolves to.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  postgresSessionPlacement,
  postgresSessionRoutingPrecondition,
  postgresSubsidizedLeadPrecondition,
} from "../../src/adapters/postgres/sessionPlacement.ts";
import {
  apiRole,
  schedulerRole,
  selectorServiceRole,
  sessionLeadOfferingFunction,
  subsidizedLeadReadFunction,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type {
  SessionPlacementChoice,
  SessionRouting,
  SubsidizedLeadProfile,
} from "../../src/interpreter/sessionPlacement.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let apiPool: pg.Pool;
let selectorPool: pg.Pool;
let schedulerPool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  apiPool = postgresHarnessRolePool(apiRole);
  selectorPool = postgresHarnessRolePool(selectorServiceRole);
  schedulerPool = postgresHarnessRolePool(schedulerRole);
});
after(async () => {
  await Promise.all([apiPool.end(), selectorPool.end(), schedulerPool.end()]);
  await harness.close();
});

const owner = {
  kind: asAuthorityKind("Member"),
  subject: asAuthoritySubject("an-owner"),
};

const profile: SubsidizedLeadProfile = {
  credentialSlot: "anthropic-api",
  model: "claude-haiku-5-5",
  effort: "low",
  autoCompactWindow: 100_000,
  inputBytesPerDecision: 65_536,
  turnTokensMax: 200_000,
};

/** Starts the selector's publication with `published`, or with none. */
async function subsidizedLeadStarted(
  published: SubsidizedLeadProfile | undefined,
): Promise<void> {
  assert.deepEqual(
    await postgresSubsidizedLeadPrecondition(selectorPool, published).check(
      new AbortController().signal,
    ),
    { met: "Met" },
  );
}

/** The profile as the API's door answers it, a row or none. */
async function subsidizedLeadRead(): Promise<readonly unknown[]> {
  return (
    await apiPool.query<Record<string, unknown>>(
      `SELECT credential_slot,model,effort,auto_compact_window::int,
              input_bytes_per_decision::int,turn_tokens_max::int
         FROM ${subsidizedLeadReadFunction}()`,
    )
  ).rows;
}

/** The lead offering one project resolves to, as the selector reads it. */
async function subsidizedLeadResolved(partition: Partition): Promise<string> {
  return postgresSessionPlacement(selectorPool).leadOffering(partition);
}

/** One project's stored row, as its owner reads it. */
async function subsidizedLeadStored(
  partition: Partition,
): Promise<readonly unknown[]> {
  return harness.query(
    `SELECT lead_route,lead_offering,set_by_subject,set_at IS NOT NULL AS set
       FROM project_session_placement WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
}

async function subsidizedLeadWritten(
  partition: Partition,
  placement: SessionPlacementChoice,
  subject = "an-owner",
): Promise<string> {
  return postgresSessionPlacement(apiPool).write(partition, placement, {
    ...owner,
    subject: asAuthoritySubject(subject),
  });
}

test("a selector started with a profile publishes it and one started without withdraws it, and the API reads both through its door", async () => {
  const api = postgresSessionPlacement(apiPool);
  await subsidizedLeadStarted(undefined);
  assert.deepEqual(await subsidizedLeadRead(), []);
  assert.equal(await api.subsidizedLeadOffered(), false);
  await subsidizedLeadStarted(profile);
  await subsidizedLeadStarted(profile);
  assert.deepEqual(await subsidizedLeadRead(), [
    {
      credential_slot: "anthropic-api",
      model: "claude-haiku-5-5",
      effort: "low",
      auto_compact_window: 100_000,
      input_bytes_per_decision: 65_536,
      turn_tokens_max: 200_000,
    },
  ]);
  assert.equal(await api.subsidizedLeadOffered(), true);
  await subsidizedLeadStarted({ ...profile, model: "claude-sonnet-5-5" });
  assert.deepEqual(
    ((await subsidizedLeadRead())[0] as { model: string }).model,
    "claude-sonnet-5-5",
  );
  await subsidizedLeadStarted(undefined);
  assert.deepEqual(await subsidizedLeadRead(), []);
  assert.equal(await api.subsidizedLeadOffered(), false);
});

test("only the selector writes the profile, only the API reads it through its door, and both resolve a lead's offering", async () => {
  const partition = await postgresHarnessProject(harness.store, "doors");
  const project = `'${partition.tenant}','${partition.project}'`;
  for (const role of [apiRole, schedulerRole, ticketServiceRole])
    assert.match(
      (await harness.attemptAs(role, `SELECT * FROM subsidized_lead`)) ?? "",
      postgresHarnessDenial("subsidized_lead"),
      role,
    );
  const read = `SELECT * FROM ${subsidizedLeadReadFunction}()`;
  assert.equal(await harness.attemptAs(apiRole, read), undefined);
  for (const role of [selectorServiceRole, schedulerRole, workerPlaneRole])
    assert.match(
      (await harness.attemptAs(role, read)) ?? "",
      postgresHarnessDenial(subsidizedLeadReadFunction),
      role,
    );
  const resolve = `SELECT ${sessionLeadOfferingFunction}(${project})`;
  for (const role of [apiRole, selectorServiceRole])
    assert.equal(await harness.attemptAs(role, resolve), undefined, role);
  for (const role of [schedulerRole, ticketServiceRole, workerPlaneRole])
    assert.match(
      (await harness.attemptAs(role, resolve)) ?? "",
      postgresHarnessDenial(sessionLeadOfferingFunction),
      role,
    );
});

test("a write naming no offering keeps a stored subsidized lead while it stays in cluster, and one moving it to runners resets it", async () => {
  await subsidizedLeadStarted(profile);
  const partition = await postgresHarnessProject(harness.store, "kept");
  assert.equal(
    await subsidizedLeadWritten(partition, {
      Thread: "Pool",
      Lead: "InCluster",
      leadOffering: "Subsidized",
    }),
    "Written",
  );
  assert.equal(
    await subsidizedLeadWritten(partition, {
      Thread: "Pool",
      Lead: "InCluster",
    }),
    "Unchanged",
  );
  assert.equal(
    await subsidizedLeadWritten(partition, {
      Thread: "InCluster",
      Lead: "InCluster",
    }),
    "Written",
  );
  assert.deepEqual(await subsidizedLeadStored(partition), [
    {
      lead_route: "InCluster",
      lead_offering: "Subsidized",
      set_by_subject: "an-owner",
      set: true,
    },
  ]);
  assert.equal(
    await subsidizedLeadWritten(partition, {
      Thread: "InCluster",
      Lead: "Pool",
    }),
    "Written",
  );
  assert.equal(
    await subsidizedLeadWritten(partition, {
      Thread: "InCluster",
      Lead: "InCluster",
    }),
    "Written",
  );
  assert.deepEqual(await subsidizedLeadStored(partition), [
    {
      lead_route: "InCluster",
      lead_offering: "Own",
      set_by_subject: "an-owner",
      set: true,
    },
  ]);
});

test("a write of the offering alone is written and stamped with its setter", async () => {
  await subsidizedLeadStarted(profile);
  const partition = await postgresHarnessProject(harness.store, "stamped");
  const placement = { Thread: "Pool", Lead: "InCluster" } as const;
  assert.equal(await subsidizedLeadWritten(partition, placement), "Written");
  assert.equal(
    await subsidizedLeadWritten(
      partition,
      { ...placement, leadOffering: "Subsidized" },
      "an-administrator",
    ),
    "Written",
  );
  assert.deepEqual(await subsidizedLeadStored(partition), [
    {
      lead_route: "InCluster",
      lead_offering: "Subsidized",
      set_by_subject: "an-administrator",
      set: true,
    },
  ]);
});

test("a subsidized lead on runners is refused by the row's own constraint", async () => {
  const partition = await postgresHarnessProject(harness.store, "refused");
  await assert.rejects(
    subsidizedLeadWritten(partition, {
      Thread: "Pool",
      Lead: "Pool",
      leadOffering: "Subsidized",
    }),
    /project_session_placement_subsidized_lead_is_in_cluster/u,
  );
  assert.equal(
    await subsidizedLeadWritten(partition, {
      Thread: "Pool",
      Lead: "InCluster",
      leadOffering: "Subsidized",
    }),
    "Written",
  );
  await assert.rejects(
    harness.query(
      `UPDATE project_session_placement SET lead_route='Pool'
        WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    /project_session_placement_subsidized_lead_is_in_cluster/u,
  );
});

test("a stored subsidized lead resolves so only from the project's own row and only while the profile is published", async () => {
  const partition = await postgresHarnessProject(harness.store, "resolved");
  const unplaced = await postgresHarnessProject(harness.store, "unplaced");
  await subsidizedLeadStarted(profile);
  assert.equal(await subsidizedLeadResolved(unplaced), "Own");
  assert.equal(
    await subsidizedLeadWritten(partition, {
      Thread: "Pool",
      Lead: "InCluster",
      leadOffering: "Subsidized",
    }),
    "Written",
  );
  assert.equal(await subsidizedLeadResolved(partition), "Subsidized");
  assert.equal(
    await postgresSessionPlacement(apiPool).leadOffering(partition),
    "Subsidized",
  );
  await subsidizedLeadStarted(undefined);
  assert.equal(await subsidizedLeadResolved(partition), "Own");
  await subsidizedLeadStarted(profile);
  assert.equal(await subsidizedLeadResolved(partition), "Subsidized");
  const overridden = async (routing: SessionRouting) => {
    assert.deepEqual(
      await postgresSessionRoutingPrecondition(schedulerPool, routing).check(
        new AbortController().signal,
      ),
      { met: "Met" },
    );
  };
  await overridden({
    routes: { Thread: "Pool", Lead: "Pool" },
    projectRoutes: new Map([
      [
        partition.tenant,
        new Map([[partition.project, { Lead: "InCluster" as const }]]),
      ],
    ]),
  });
  assert.equal(await subsidizedLeadResolved(partition), "Own");
  await overridden({
    routes: { Thread: "Pool", Lead: "Pool" },
    projectRoutes: new Map(),
  });
  assert.equal(await subsidizedLeadResolved(partition), "Subsidized");
});
