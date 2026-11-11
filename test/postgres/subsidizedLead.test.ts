/**
 * A subsidized lead against a real server: the profile the selector publishes
 * as it starts and the API reads through its door, a project's stored choice
 * of it, and the offering its lead resolves to.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  postgresSelectorProjectSettings,
  postgresSelectorRuntimeControl,
} from "../../src/adapters/postgres/selector.ts";
import {
  postgresLeadRouteReads,
  postgresSessionPlacement,
  postgresSessionRouteReads,
  postgresSessionRoutingPrecondition,
  postgresSubsidizedLeadPrecondition,
} from "../../src/adapters/postgres/sessionPlacement.ts";
import {
  apiRole,
  schedulerRole,
  selectorServiceRole,
  sessionLeadOfferingFunction,
  sessionLeadProfileFunction,
  storedLeadOfferingFunction,
  subsidizedLeadReadFunction,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  leadInputBytesMax,
  type SelectorProjectOverrides,
  type SelectorResolvedSettings,
} from "../../src/interpreter/selector.ts";
import {
  sessionPlacementAdministration,
  type SessionPlacementChoice,
  type SessionPlacementStore,
  type SessionPlacementStored,
  type SessionRouting,
  type SubsidizedLeadOffer,
} from "../../src/interpreter/sessionPlacement.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";
import { memoryProjectAccess } from "./projectAccessMemory.ts";

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

const profile: SubsidizedLeadOffer = {
  credentialSlot: "anthropic-api",
  model: "claude-haiku-5-5",
  effort: "low",
  autoCompactWindow: 100_000,
  inputBytesPerDecision: 65_536,
  turnTokensMax: 200_000,
  tenantMonthlyMicros: 5_000_000,
  deploymentMonthlyMicros: 50_000_000,
  unmeasuredTurnMicros: 100_000,
};

/** Starts the selector's publication with `published`, or with none. */
async function subsidizedLeadStarted(
  published: SubsidizedLeadOffer | undefined,
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
  placement: SessionPlacementStored,
  subject = "an-owner",
): Promise<string> {
  return postgresSessionPlacement(apiPool).write(partition, placement, {
    ...owner,
    subject: asAuthoritySubject(subject),
  });
}

/** An administrator of `partition`, granted hosted runs where `hosted`, as their subject is stamped. */
const administrator = (partition: Partition, hosted: boolean) => {
  const principal = asPrincipal(hosted ? "a-hosted-owner" : "an-owner");
  const access = memoryProjectAccess();
  access.grant({ partition, principal, access: new Set(["Administer"]) });
  if (hosted)
    access.grantTenant({
      tenant: partition.tenant,
      principal,
      access: new Set(["ExecuteHosted"]),
    });
  return { access, principal };
};

/** `choice` written by an administrator of `partition` through the real administration over `store`, answered with its result. */
async function subsidizedLeadAdministered(
  partition: Partition,
  choice: SessionPlacementChoice,
  hosted = false,
  store: SessionPlacementStore = postgresSessionPlacement(apiPool),
): Promise<string> {
  const { access, principal } = administrator(partition, hosted);
  return (
    await sessionPlacementAdministration(access, store).write(
      principal,
      partition,
      choice,
    )
  ).result;
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
  const stored = `SELECT ${storedLeadOfferingFunction}(${project})`;
  assert.equal(await harness.attemptAs(apiRole, stored), undefined);
  for (const role of [selectorServiceRole, schedulerRole, workerPlaneRole])
    assert.match(
      (await harness.attemptAs(role, stored)) ?? "",
      postgresHarnessDenial(storedLeadOfferingFunction),
      role,
    );
});

test("a write naming no offering keeps a stored subsidized lead while it stays in cluster, and one moving it to runners resets it", async () => {
  await subsidizedLeadStarted(profile);
  const partition = await postgresHarnessProject(harness.store, "kept");
  assert.equal(
    await subsidizedLeadAdministered(partition, {
      Thread: "Pool",
      Lead: "InCluster",
      leadOffering: "Subsidized",
    }),
    "Written",
  );
  assert.equal(
    await subsidizedLeadAdministered(partition, {
      Thread: "Pool",
      Lead: "InCluster",
    }),
    "Unchanged",
  );
  assert.equal(
    await subsidizedLeadAdministered(
      partition,
      { Thread: "InCluster", Lead: "InCluster" },
      true,
    ),
    "Written",
  );
  assert.deepEqual(await subsidizedLeadStored(partition), [
    {
      lead_route: "InCluster",
      lead_offering: "Subsidized",
      set_by_subject: "a-hosted-owner",
      set: true,
    },
  ]);
  assert.equal(
    await subsidizedLeadAdministered(
      partition,
      { Thread: "InCluster", Lead: "Pool" },
      true,
    ),
    "Written",
  );
  assert.equal(
    await subsidizedLeadAdministered(
      partition,
      { Thread: "InCluster", Lead: "InCluster" },
      true,
    ),
    "Written",
  );
  assert.deepEqual(await subsidizedLeadStored(partition), [
    {
      lead_route: "InCluster",
      lead_offering: "Own",
      set_by_subject: "a-hosted-owner",
      set: true,
    },
  ]);
});

test("a write held to a stored subsidized lead stores it, though the row is reset before the write reaches it", async () => {
  await subsidizedLeadStarted(profile);
  const partition = await postgresHarnessProject(harness.store, "raced");
  assert.equal(
    await subsidizedLeadAdministered(partition, {
      Thread: "Pool",
      Lead: "InCluster",
      leadOffering: "Subsidized",
    }),
    "Written",
  );
  const real = postgresSessionPlacement(apiPool);
  const racing: SessionPlacementStore = {
    ...real,
    storedLeadOffering: async (at) => {
      const stored = await real.storedLeadOffering(at);
      assert.equal(
        await subsidizedLeadAdministered(
          partition,
          { Thread: "Pool", Lead: "Pool" },
          true,
        ),
        "Written",
      );
      return stored;
    },
  };
  assert.equal(
    await subsidizedLeadAdministered(
      partition,
      { Thread: "Pool", Lead: "InCluster" },
      false,
      racing,
    ),
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
});

test("a write of the offering alone is written and stamped with its setter", async () => {
  await subsidizedLeadStarted(profile);
  const partition = await postgresHarnessProject(harness.store, "stamped");
  const placement = {
    Thread: "Pool",
    Lead: "InCluster",
    leadOffering: "Own",
  } as const;
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
  const api = postgresSessionPlacement(apiPool);
  assert.equal(await subsidizedLeadResolved(unplaced), "Own");
  assert.equal(await api.storedLeadOffering(unplaced), "Own");
  assert.equal(
    await subsidizedLeadWritten(partition, {
      Thread: "Pool",
      Lead: "InCluster",
      leadOffering: "Subsidized",
    }),
    "Written",
  );
  assert.equal(await subsidizedLeadResolved(partition), "Subsidized");
  assert.equal(await api.leadOffering(partition), "Subsidized");
  await subsidizedLeadStarted(undefined);
  assert.equal(await subsidizedLeadResolved(partition), "Own");
  assert.equal(await api.storedLeadOffering(partition), "Subsidized");
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
  assert.equal(await api.storedLeadOffering(partition), "Subsidized");
  await overridden({
    routes: { Thread: "Pool", Lead: "Pool" },
    projectRoutes: new Map(),
  });
  assert.equal(await subsidizedLeadResolved(partition), "Subsidized");
});

const settingsAdministrator = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("selector-admin"),
};

/** Overrides set above the profile on every bound it holds, on another model than its. */
const settingsAboveProfile: SelectorProjectOverrides = {
  leadModel: "claude-opus-5-5",
  leadEffort: "max",
  modelAllowlist: ["claude-opus-5-5"],
  limits: { autoCompactWindow: 400_000, inputBytesPerDecision: 2_000_000 },
};

/** What a decision of `partition` runs under, as the selector's own settings read resolves it. */
async function subsidizedLeadDecidedUnder(
  partition: Partition,
): Promise<SelectorResolvedSettings> {
  return postgresSelectorRuntimeControl(selectorPool).projectSettings(
    partition,
  );
}

test("a subsidized project's settings, as the selector and the API read and write them, run its lead on the profile and under its bounds", async () => {
  await subsidizedLeadStarted(profile);
  const partition = await postgresHarnessProject(harness.store, "settings");
  const settings = postgresSelectorProjectSettings(apiPool);
  const first = await settings.write(
    partition,
    0,
    settingsAboveProfile,
    settingsAdministrator,
  );
  assert.equal(first.written, "Settings");
  assert.equal(
    await subsidizedLeadAdministered(partition, {
      Thread: "Pool",
      Lead: "InCluster",
      leadOffering: "Subsidized",
    }),
    "Written",
  );
  const subsidized = {
    offering: "Subsidized",
    model: profile.model,
    effort: profile.effort,
    credentialSlot: profile.credentialSlot,
    turnTokensMax: profile.turnTokensMax,
  };
  const decided = await subsidizedLeadDecidedUnder(partition);
  assert.deepEqual(decided.lead, subsidized);
  assert.deepEqual(decided.modelAllowlist, [profile.model]);
  assert.deepEqual(
    [decided.limits.autoCompactWindow, decided.limits.inputBytesPerDecision],
    [profile.autoCompactWindow, profile.inputBytesPerDecision],
  );
  assert.equal(leadInputBytesMax(decided), profile.inputBytesPerDecision);
  assert.deepEqual(
    (await settings.read(partition)).settings.effective,
    decided,
    "the API reads what the selector decides under",
  );
  const rewritten = await settings.write(
    partition,
    1,
    settingsAboveProfile,
    settingsAdministrator,
  );
  assert.ok(rewritten.written === "Settings");
  assert.deepEqual(rewritten.settings.effective.lead, subsidized);
});

test("a project switched back to its own lead runs on its own model, effort and bounds again", async () => {
  await subsidizedLeadStarted(profile);
  const partition = await postgresHarnessProject(harness.store, "switched");
  assert.equal(
    (
      await postgresSelectorProjectSettings(apiPool).write(
        partition,
        0,
        settingsAboveProfile,
        settingsAdministrator,
      )
    ).written,
    "Settings",
  );
  for (const leadOffering of ["Subsidized", "Own"] as const)
    assert.equal(
      await subsidizedLeadAdministered(
        partition,
        { Thread: "Pool", Lead: "InCluster", leadOffering },
        true,
      ),
      "Written",
      leadOffering,
    );
  const decided = await subsidizedLeadDecidedUnder(partition);
  assert.deepEqual(decided.lead, {
    offering: "Own",
    model: "claude-opus-5-5",
    effort: "max",
  });
  assert.deepEqual(decided.modelAllowlist, ["claude-opus-5-5"]);
  assert.deepEqual(
    [decided.limits.autoCompactWindow, decided.limits.inputBytesPerDecision],
    [400_000, 2_000_000],
  );
});

test("the selector's lead admission reads a subsidized offering, and only the selector and the API may ask a project's profile", async () => {
  await subsidizedLeadStarted(profile);
  const partition = await postgresHarnessProject(harness.store, "profiled");
  assert.equal(
    await subsidizedLeadAdministered(partition, {
      Thread: "Pool",
      Lead: "InCluster",
      leadOffering: "Subsidized",
    }),
    "Written",
  );
  assert.equal(
    await postgresLeadRouteReads(selectorPool).leadOffering(partition),
    "Subsidized",
  );
  assert.equal(
    await postgresSessionRouteReads(apiPool).leadOffering(partition),
    "Subsidized",
  );
  const asked = `SELECT * FROM ${sessionLeadProfileFunction}('${partition.tenant}','${partition.project}')`;
  for (const role of [apiRole, selectorServiceRole])
    assert.equal(await harness.attemptAs(role, asked), undefined, role);
  for (const role of [schedulerRole, ticketServiceRole, workerPlaneRole])
    assert.match(
      (await harness.attemptAs(role, asked)) ?? "",
      postgresHarnessDenial(sessionLeadProfileFunction),
      role,
    );
});
