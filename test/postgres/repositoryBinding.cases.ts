import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { setTimeout } from "node:timers/promises";
import type pg from "pg";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  postgresProjectRepositoryBindings,
  postgresRepositoryBinding,
  postgresRepositoryBindingListing,
} from "../../src/adapters/postgres/repositoryBinding.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import { repositoryBindingsPerImportMax } from "../../src/interpreter/repositoryConfiguration.ts";
import { checkedRepositoryBindingCommand } from "../../src/interpreter/repositoryBinding.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Partition,
  type RecoveryEpoch,
} from "../../src/interpreter/projectStore.ts";
import { apiRole } from "../../src/adapters/postgres/schema/shared.ts";
import {
  postgresHarnessDenial,
  postgresHarnessEpoch,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";

/** Long enough for the contender to reach the door and be held at it. */
const contenderWaitMs = 500;

let harness: PostgresHarness;
let pool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  pool = postgresPool(postgresHarnessUrl());
});
after(async () => {
  await pool.end();
  await harness.close();
});

interface FixtureStanding {
  readonly partition: Partition;
  readonly recoveryEpoch: RecoveryEpoch;
}

async function fixtureStanding(label: string): Promise<FixtureStanding> {
  return {
    partition: await postgresHarnessProject(harness.store, label),
    recoveryEpoch: await postgresHarnessEpoch(harness.store),
  };
}

/** A project provisioned at a partition the case built itself, for holding one term fixed. */
async function fixtureStandingAt(
  partition: Partition,
): Promise<FixtureStanding> {
  await harness.store.createProject(partition);
  return {
    partition,
    recoveryEpoch: await postgresHarnessEpoch(harness.store),
  };
}

function fixtureCommand(
  standing: FixtureStanding,
  repository: string,
  operation = `operation-${randomUUID()}`,
) {
  return checkedRepositoryBindingCommand({
    tenant: standing.partition.tenant,
    project: standing.partition.project,
    repository,
    recoveryEpoch: standing.recoveryEpoch,
    operation,
    authorityKind: "Administrator",
    authoritySubject: "test-operator",
  });
}

/** A project holding one binding, made through the door the cases exercise. */
async function fixture(label: string) {
  const standing = await fixtureStanding(label);
  const command = fixtureCommand(
    standing,
    `repository-${label}-${randomUUID()}`,
  );
  assert.equal(await postgresRepositoryBinding(pool).bind(command), "Bound");
  return {
    ...standing,
    repository: command.repository,
    operation: command.operation,
  };
}

async function fixtureRepositories(standing: FixtureStanding) {
  return (
    await harness.query(
      `SELECT repository FROM project_repository
        WHERE tenant=$1 AND project=$2 ORDER BY bound_at,repository`,
      [standing.partition.tenant, standing.partition.project],
    )
  ).map((row) => String(row["repository"]));
}

/** A replay changed from `command` in one argument, which the door always refuses. */
async function assertReplayConflicts(
  administration: ReturnType<typeof postgresRepositoryBinding>,
  command: ReturnType<typeof fixtureCommand>,
) {
  assert.equal(await administration.bind(command), "OperationConflict");
}

/** The arguments the door takes, in the order it declares them. */
function fixtureArguments(command: ReturnType<typeof fixtureCommand>) {
  return [
    command.partition.tenant,
    command.partition.project,
    command.repository,
    command.recoveryEpoch,
    command.operation,
    command.authority.kind,
    command.authority.subject,
  ];
}

test("the writer this connects as can execute the door", async () => {
  const writer = await postgresRepositoryBinding(pool).writer();
  assert.equal(writer.canExecute, true);
});

test("the door binds a second repository, and the leftover read still answers the oldest", async () => {
  const standing = await fixture("binding-peers");
  const later = `repository-later-${randomUUID()}`;
  assert.equal(
    await postgresRepositoryBinding(pool).bind(fixtureCommand(standing, later)),
    "Bound",
  );
  assert.deepEqual(await fixtureRepositories(standing), [
    standing.repository,
    later,
  ]);
  assert.deepEqual(
    await postgresProjectRepositoryBinding(pool).binding(standing.partition),
    {
      partition: standing.partition,
      repository: standing.repository,
      recoveryEpoch: standing.recoveryEpoch,
    },
  );
  await assert.rejects(
    () =>
      harness.query(
        `UPDATE project_repository SET repository=repository
          WHERE tenant=$1 AND project=$2 AND repository=$3`,
        [standing.partition.tenant, standing.partition.project, later],
      ),
    /repository bindings are immutable/u,
  );
});

test("what the door accepted is recorded, and no owner may rewrite it", async () => {
  const standing = await fixture("binding-authority");
  const [recorded] = await harness.query(
    `SELECT operation,authority_kind,authority_subject,outcome
       FROM project_repository_bind_operation
      WHERE tenant=$1 AND project=$2 AND repository=$3`,
    [
      standing.partition.tenant,
      standing.partition.project,
      standing.repository,
    ],
  );
  assert.deepEqual(recorded, {
    operation: standing.operation,
    authority_kind: "Administrator",
    authority_subject: "test-operator",
    outcome: "Bound",
  });
  for (const statement of [
    `UPDATE project_repository_bind_operation SET authority_subject=authority_subject
      WHERE operation=$1`,
    `DELETE FROM project_repository_bind_operation WHERE operation=$1`,
  ])
    await assert.rejects(
      () => harness.query(statement, [standing.operation]),
      /repository bind operations are immutable/u,
    );
});

test("an owner cannot record an outcome outside the accepted pair", async () => {
  const standing = await fixture("binding-outcome");
  await assert.rejects(
    () =>
      harness.query(
        `INSERT INTO project_repository_bind_operation
           (operation,tenant,project,repository,recovery_epoch,
            authority_kind,authority_subject,outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          `operation-${randomUUID()}`,
          standing.partition.tenant,
          standing.partition.project,
          standing.repository,
          standing.recoveryEpoch,
          "Administrator",
          "test-operator",
          "RepositoryBoundElsewhere",
        ],
      ),
    /project_repository_bind_operation_was_accepted/u,
  );
});

test("an owner cannot record an operation for a repository its project does not hold", async () => {
  const standing = await fixture("binding-unheld");
  await assert.rejects(
    () =>
      harness.query(
        `INSERT INTO project_repository_bind_operation
           (operation,tenant,project,repository,recovery_epoch,
            authority_kind,authority_subject,outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          `operation-${randomUUID()}`,
          standing.partition.tenant,
          standing.partition.project,
          `repository-unbound-${randomUUID()}`,
          standing.recoveryEpoch,
          "Administrator",
          "test-operator",
          "Bound",
        ],
      ),
    /project_repository_bind_operation_names_a_binding/u,
  );
});

test("an operation retries exactly and refuses changed inputs", async () => {
  const standing = await fixtureStanding("binding-idempotency");
  const operation = `operation-${randomUUID()}`;
  const command = fixtureCommand(
    standing,
    `repository-retry-${randomUUID()}`,
    operation,
  );
  const administration = postgresRepositoryBinding(pool);
  assert.equal(await administration.bind(command), "Bound");
  assert.equal(await administration.bind(command), "AlreadyBound");
  await assertReplayConflicts(administration, {
    ...command,
    repository: fixtureCommand(standing, `different-${randomUUID()}`)
      .repository,
  });
  await assertReplayConflicts(administration, {
    ...command,
    partition: {
      ...command.partition,
      tenant: asTenantId(`tenant-idempotency-elsewhere-${randomUUID()}`),
    },
  });
  await assertReplayConflicts(administration, {
    ...command,
    partition: {
      ...command.partition,
      project: asProjectId(`project-idempotency-elsewhere-${randomUUID()}`),
    },
  });
  const laterEpoch = await harness.store.establishRecoveryEpoch(
    asRecoveryEpoch(`idempotency-${randomUUID()}`),
  );
  await assertReplayConflicts(administration, {
    ...command,
    recoveryEpoch: laterEpoch,
  });
  await assertReplayConflicts(administration, {
    ...command,
    authority: {
      ...command.authority,
      kind: asAuthorityKind("DifferentAuthority"),
    },
  });
  await assertReplayConflicts(administration, {
    ...command,
    authority: {
      ...command.authority,
      subject: asAuthoritySubject("different-operator"),
    },
  });
  assert.deepEqual(await fixtureRepositories(standing), [command.repository]);
});

test("rebinding what a project holds adds no binding and spends the operation", async () => {
  const standing = await fixture("binding-repeat");
  const operation = `operation-${randomUUID()}`;
  const administration = postgresRepositoryBinding(pool);
  assert.equal(
    await administration.bind(
      fixtureCommand(standing, standing.repository, operation),
    ),
    "AlreadyBound",
  );
  assert.equal(
    await administration.bind(
      fixtureCommand(standing, `repository-other-${randomUUID()}`, operation),
    ),
    "OperationConflict",
  );
  assert.deepEqual(await fixtureRepositories(standing), [standing.repository]);
});

test("a repository bound to another project is refused", async () => {
  const standing = await fixture("binding-owner");
  const foreign = await fixture("binding-foreign");
  assert.equal(
    await postgresRepositoryBinding(pool).bind(
      fixtureCommand(standing, foreign.repository),
    ),
    "RepositoryBoundElsewhere",
  );
  assert.deepEqual(await fixtureRepositories(standing), [standing.repository]);
  assert.deepEqual(await fixtureRepositories(foreign), [foreign.repository]);
});

/**
 * `holding` binds a fresh repository and `reaching`, whose partition differs
 * from it in exactly one term, is refused it. The caller builds the pair so
 * that each term of the door's holder comparison is proved alone.
 */
async function assertHeldElsewhere(
  holding: FixtureStanding,
  reaching: FixtureStanding,
): Promise<void> {
  const repository = `repository-owner-${randomUUID()}`;
  assert.equal(
    await postgresRepositoryBinding(pool).bind(
      fixtureCommand(holding, repository),
    ),
    "Bound",
  );
  assert.equal(
    await postgresRepositoryBinding(pool).bind(
      fixtureCommand(reaching, repository),
    ),
    "RepositoryBoundElsewhere",
  );
  assert.deepEqual(await fixtureRepositories(holding), [repository]);
  assert.deepEqual(await fixtureRepositories(reaching), []);
}

test("a repository bound to another project in the same tenant is refused", async () => {
  const tenant = asTenantId(`tenant-owner-tenant-${randomUUID()}`);
  const holding = await fixtureStandingAt({
    tenant,
    project: asProjectId(`project-owner-tenant-holder-${randomUUID()}`),
  });
  const reaching = await fixtureStandingAt({
    tenant,
    project: asProjectId(`project-owner-tenant-reacher-${randomUUID()}`),
  });
  await assertHeldElsewhere(holding, reaching);
});

test("a repository bound under another tenant's project of the same name is refused", async () => {
  const project = asProjectId(`project-owner-name-${randomUUID()}`);
  const holding = await fixtureStandingAt({
    tenant: asTenantId(`tenant-owner-name-holder-${randomUUID()}`),
    project,
  });
  const reaching = await fixtureStandingAt({
    tenant: asTenantId(`tenant-owner-name-reacher-${randomUUID()}`),
    project,
  });
  await assertHeldElsewhere(holding, reaching);
});

test("the recovery epoch fences a binding and the refusal spends nothing", async () => {
  const standing = await fixtureStanding("binding-epoch");
  const later = await harness.store.establishRecoveryEpoch(
    asRecoveryEpoch(`later-${randomUUID()}`),
  );
  assert.notEqual(later, standing.recoveryEpoch);
  const operation = `operation-${randomUUID()}`;
  const repository = `repository-next-${randomUUID()}`;
  const administration = postgresRepositoryBinding(pool);
  assert.equal(
    await administration.bind(fixtureCommand(standing, repository, operation)),
    "RecoveryEpochMismatch",
  );
  assert.deepEqual(await fixtureRepositories(standing), []);
  assert.equal(
    await administration.bind(
      fixtureCommand(
        { ...standing, recoveryEpoch: later },
        repository,
        operation,
      ),
    ),
    "Bound",
  );
  assert.deepEqual(await fixtureRepositories(standing), [repository]);
});

test("a repository one project is binding is not bound by another", async () => {
  const holding = await fixtureStanding("binding-race-holder");
  const reaching = await fixtureStanding("binding-race-contender");
  const contested = `repository-contested-${randomUUID()}`;
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(
      "SELECT bind_project_repository($1,$2,$3,$4,$5,$6,$7)",
      fixtureArguments(fixtureCommand(holding, contested)),
    );
    const contender = postgresRepositoryBinding(pool).bind(
      fixtureCommand(reaching, contested),
    );
    assert.equal(
      await Promise.race([contender, setTimeout(contenderWaitMs, "Waiting")]),
      "Waiting",
    );
    await holder.query("COMMIT");
    assert.equal(await contender, "RepositoryBoundElsewhere");
  } finally {
    holder.release();
  }
  assert.deepEqual(
    [
      ...(await fixtureRepositories(holding)),
      ...(await fixtureRepositories(reaching)),
    ],
    [contested],
  );
});

test("a replay of the same operation waits for the first rather than racing it", async () => {
  const standing = await fixtureStanding("binding-operation-race");
  const command = fixtureCommand(
    standing,
    `repository-operation-race-${randomUUID()}`,
  );
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    const held = await holder.query<{ outcome: string }>(
      "SELECT bind_project_repository($1,$2,$3,$4,$5,$6,$7) AS outcome",
      fixtureArguments(command),
    );
    const contender = postgresRepositoryBinding(pool).bind(command);
    assert.equal(
      await Promise.race([contender, setTimeout(contenderWaitMs, "Waiting")]),
      "Waiting",
    );
    await holder.query("COMMIT");
    assert.equal(held.rows[0]?.outcome, "Bound");
    assert.equal(await contender, "AlreadyBound");
  } finally {
    holder.release();
  }
  assert.deepEqual(await fixtureRepositories(standing), [command.repository]);
});

test("a bind for a different repository under the same operation waits for the first rather than racing it", async () => {
  const standing = await fixtureStanding("binding-operation-lock");
  const operation = `operation-${randomUUID()}`;
  const holderCommand = fixtureCommand(
    standing,
    `repository-operation-lock-holder-${randomUUID()}`,
    operation,
  );
  const contenderCommand = fixtureCommand(
    standing,
    `repository-operation-lock-contender-${randomUUID()}`,
    operation,
  );
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    const held = await holder.query<{ outcome: string }>(
      "SELECT bind_project_repository($1,$2,$3,$4,$5,$6,$7) AS outcome",
      fixtureArguments(holderCommand),
    );
    const contender = postgresRepositoryBinding(pool).bind(contenderCommand);
    assert.equal(
      await Promise.race([contender, setTimeout(contenderWaitMs, "Waiting")]),
      "Waiting",
    );
    await holder.query("COMMIT");
    assert.equal(held.rows[0]?.outcome, "Bound");
    assert.equal(await contender, "OperationConflict");
  } finally {
    holder.release();
  }
  assert.deepEqual(await fixtureRepositories(standing), [
    holderCommand.repository,
  ]);
});

/**
 * The listing 085 added, which is the read a project's own members are answered
 * from and which is a door rather than a grant, so the cases assert that the
 * relation behind it still refuses the same role. THE ORDER IS THE ELECTION:
 * `read_project_repository_binding` picks the oldest binding when a caller
 * names no repository, so a listing in another order would put a different
 * repository at the head than the one every such caller works against.
 */
test("the listing answers one project's bindings, oldest first", async () => {
  const standing = await fixtureStanding("binding-listing");
  const first = fixtureCommand(
    standing,
    `repository-listing-b-${randomUUID()}`,
  );
  const second = fixtureCommand(
    standing,
    `repository-listing-a-${randomUUID()}`,
  );
  const administration = postgresRepositoryBinding(pool);
  assert.equal(await administration.bind(first), "Bound");
  assert.equal(await administration.bind(second), "Bound");
  const elsewhere = await fixture("binding-listing-elsewhere");
  const listed = await postgresProjectRepositoryBindings(pool).bindings(
    standing.partition,
  );
  assert.deepEqual(
    listed.map((bound) => String(bound.repository)),
    [first.repository, second.repository],
  );
  assert.equal(
    listed.every((bound) => bound.boundAt.length > 0),
    true,
  );
  assert.equal(
    listed.some((bound) => String(bound.repository) === elsewhere.repository),
    false,
  );
});

/** What one partition's listing named, which is the string form every case compares by. */
async function fixtureListed(
  standing: FixtureStanding,
): Promise<readonly string[]> {
  const listed = await postgresProjectRepositoryBindings(pool).bindings(
    standing.partition,
  );
  return listed.map((bound) => String(bound.repository));
}

/**
 * Both terms of the listing's partition, each held while the other varies. A
 * tenant-only filter answers one project's question with every project in the
 * tenant, and a project-only filter answers it across tenants; the suite's own
 * fixtures separate on both terms at once, so neither failure would show
 * without a pair that agrees on one of them.
 */
test("a listing names its own project's bindings and no sibling project's", async () => {
  const tenant = asTenantId(`tenant-listing-tenant-${randomUUID()}`);
  const mine = await fixtureStandingAt({
    tenant,
    project: asProjectId(`project-listing-mine-${randomUUID()}`),
  });
  const sibling = await fixtureStandingAt({
    tenant,
    project: asProjectId(`project-listing-sibling-${randomUUID()}`),
  });
  const administration = postgresRepositoryBinding(pool);
  const ours = fixtureCommand(mine, `repository-listing-mine-${randomUUID()}`);
  const theirs = fixtureCommand(
    sibling,
    `repository-listing-sibling-${randomUUID()}`,
  );
  assert.equal(await administration.bind(ours), "Bound");
  assert.equal(await administration.bind(theirs), "Bound");
  assert.deepEqual(await fixtureListed(mine), [ours.repository]);
  assert.deepEqual(await fixtureListed(sibling), [theirs.repository]);
});

test("a listing names its own tenant's bindings and no other tenant's project of that name", async () => {
  const project = asProjectId(`project-listing-name-${randomUUID()}`);
  const mine = await fixtureStandingAt({
    tenant: asTenantId(`tenant-listing-name-mine-${randomUUID()}`),
    project,
  });
  const stranger = await fixtureStandingAt({
    tenant: asTenantId(`tenant-listing-name-stranger-${randomUUID()}`),
    project,
  });
  const administration = postgresRepositoryBinding(pool);
  const ours = fixtureCommand(mine, `repository-listing-name-${randomUUID()}`);
  const theirs = fixtureCommand(
    stranger,
    `repository-listing-name-other-${randomUUID()}`,
  );
  assert.equal(await administration.bind(ours), "Bound");
  assert.equal(await administration.bind(theirs), "Bound");
  assert.deepEqual(await fixtureListed(mine), [ours.repository]);
  assert.deepEqual(await fixtureListed(stranger), [theirs.repository]);
});

/**
 * The epoch a binding is made under is the one this adapter reads for itself,
 * which is the standing one and not the database's first. A reader that elected
 * the other way would answer `RecoveryEpochMismatch` to every bind forever on a
 * deployment that has had a single recovery.
 */
test("the binding adapter reads the standing epoch and binds under it", async () => {
  const partition = await postgresHarnessProject(harness.store, "binding-own");
  await harness.store.establishRecoveryEpoch(
    asRecoveryEpoch(`own-${randomUUID()}`),
  );
  const administration = postgresRepositoryBinding(pool);
  const recoveryEpoch = await administration.currentRecoveryEpoch();
  assert.equal(recoveryEpoch, await postgresHarnessEpoch(harness.store));
  assert.equal(
    await administration.bind(
      fixtureCommand(
        { partition, recoveryEpoch },
        `repository-own-${randomUUID()}`,
      ),
    ),
    "Bound",
  );
});

test("the API reads a project's bindings through the door and not the relation", async () => {
  const standing = await fixtureStanding("binding-listing-privilege");
  assert.equal(
    await harness.attemptAs(
      apiRole,
      `SELECT repository FROM list_project_repository_bindings(
         '${standing.partition.tenant}','${standing.partition.project}',NULL)`,
    ),
    undefined,
  );
  assert.match(
    (await harness.attemptAs(apiRole, "SELECT * FROM project_repository")) ??
      "",
    postgresHarnessDenial("project_repository"),
  );
});

/**
 * 088's listing, which the importer runs over. It crosses partitions because
 * the importer's job is every partition's declarations: a run told to import
 * one project's would need the list it is asking for before it could ask.
 */
test("the estate listing names every partition's bindings, oldest first", async () => {
  const mine = await fixtureStandingAt({
    tenant: asTenantId(`tenant-estate-mine-${randomUUID()}`),
    project: asProjectId(`project-estate-mine-${randomUUID()}`),
  });
  const stranger = await fixtureStandingAt({
    tenant: asTenantId(`tenant-estate-stranger-${randomUUID()}`),
    project: asProjectId(`project-estate-stranger-${randomUUID()}`),
  });
  const administration = postgresRepositoryBinding(pool);
  const ours = fixtureCommand(mine, `repository-estate-mine-${randomUUID()}`);
  const theirs = fixtureCommand(
    stranger,
    `repository-estate-stranger-${randomUUID()}`,
  );
  assert.equal(await administration.bind(ours), "Bound");
  assert.equal(await administration.bind(theirs), "Bound");

  const listed = await postgresRepositoryBindingListing(pool).bindings(
    repositoryBindingsPerImportMax,
  );

  const named = new Map(
    listed.map((bound) => [String(bound.repository), bound]),
  );
  assert.deepEqual(named.get(ours.repository)?.partition, mine.partition);
  assert.deepEqual(named.get(theirs.repository)?.partition, stranger.partition);
  assert.equal(
    listed.every((bound) => bound.boundAt.length > 0),
    true,
  );
  const boundAt = listed.map((bound) => bound.boundAt);
  assert.deepEqual(
    boundAt,
    [...boundAt].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    "the run reads a prefix of the estate, so the order is the age",
  );
});

test("the estate listing is bounded by what the caller asks for", async () => {
  const listed = await postgresRepositoryBindingListing(pool).bindings(1);
  assert.equal(listed.length <= 1, true);
});

/**
 * The door's own ceiling, which a caller may narrow and may not widen. The
 * bindings are dated past every other case's so that a listing this case fills
 * is still the oldest prefix for the cases that read one; the trigger 040
 * installed lets nobody take them out again.
 */
test("a caller asking the estate listing for more than the bound gets the bound", async () => {
  const standing = await fixtureStanding("binding-estate-ceiling");
  await harness.query(
    `INSERT INTO project_repository (tenant,project,repository,recovery_epoch,bound_at)
       SELECT $1,$2,$3||n,$4,now()+interval '100 years'
         FROM generate_series(1,$5::int) AS n`,
    [
      standing.partition.tenant,
      standing.partition.project,
      `repository-estate-ceiling-${randomUUID()}-`,
      standing.recoveryEpoch,
      repositoryBindingsPerImportMax + 1,
    ],
  );

  const listed = await postgresRepositoryBindingListing(pool).bindings(
    repositoryBindingsPerImportMax * 10,
  );

  assert.equal(listed.length, repositoryBindingsPerImportMax);
});
