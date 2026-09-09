import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { setTimeout } from "node:timers/promises";
import type pg from "pg";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { postgresRepositoryBinding } from "../../src/adapters/postgres/repositoryBinding.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
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
import {
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
