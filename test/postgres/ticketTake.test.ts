/**
 * `take_ticket` against a real PostgreSQL, under the API role a deployment
 * runs it as: what a take and a return of a released ticket answer, what each
 * refuses, and the history every one of them leaves, which no role changes.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresTicketTakes } from "../../src/adapters/postgres/ticketTake.ts";
import { apiRole, schedulerRole } from "../../src/adapters/postgres/schema.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import type { TicketTakeKind } from "../../src/interpreter/ticketTake.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import {
  schedulerProject,
  schedulerRigOpen,
  type SchedulerProject,
} from "./schedulerHarness.ts";

const rig = await schedulerRigOpen();
const apiPool = postgresHarnessRolePool(apiRole);
const schedulerPool = postgresHarnessRolePool(schedulerRole);

after(async () => {
  await Promise.all([apiPool.end(), schedulerPool.end()]);
  await rig.close();
});

const takes = postgresTicketTakes(apiPool);

function principal(label: string): Principal {
  return asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`);
}

/** A project whose one released ticket `creator` filed. */
async function filedBy(
  label: string,
  creator: Principal,
): Promise<SchedulerProject> {
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const drafted = (await rig.harness.query(
    `UPDATE draft_revision SET authority_kind='Member',authority_subject=$4
      WHERE tenant=$1 AND project=$2 AND ticket=$3 AND authoring_version=1
      RETURNING 1 AS one`,
    [
      project.partition.tenant,
      project.partition.project,
      project.ticket,
      creator,
    ],
  )) as readonly unknown[];
  assert.equal(drafted.length, 1, "the ticket has a first draft revision");
  return project;
}

function written(
  project: SchedulerProject,
  kind: TicketTakeKind,
  caller: Principal,
  ticket: number = project.ticket,
) {
  return takes.write(
    project.partition,
    asTicketId(ticket),
    kind,
    memberAuthority(caller),
  );
}

/** Every take and return of the project's ticket, oldest first. */
async function history(
  project: SchedulerProject,
): Promise<readonly [number, string, string][]> {
  const found = await schedulerPool.query<{
    number: string;
    kind: string;
    actor_subject: string;
  }>(
    `SELECT number::text AS number,kind,actor_subject FROM ticket_take
      WHERE tenant=$1 AND project=$2 AND ticket=$3 ORDER BY number`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  return found.rows.map((row) => [
    Number(row.number),
    row.kind,
    row.actor_subject,
  ]);
}

test("a take replaces the taker before it, only the current taker returns, and the history holds every act in order", async () => {
  const alice = principal("alice");
  const bob = principal("bob");
  const carol = principal("carol");
  const project = await filedBy("take-history", alice);
  assert.deepEqual(await written(project, "Take", bob), {
    stored: "Taken",
    owner: bob,
  });
  assert.deepEqual(await written(project, "Take", carol), {
    stored: "Taken",
    owner: carol,
  });
  for (const caller of [bob, alice])
    assert.deepEqual(
      await written(project, "Return", caller),
      { stored: "Refused", reason: "NotTaker" },
      "neither a replaced taker nor the creator returns a ticket Carol holds",
    );
  assert.deepEqual(await written(project, "Return", carol), {
    stored: "Returned",
    owner: alice,
  });
  assert.deepEqual(
    await written(project, "Return", carol),
    { stored: "Refused", reason: "NotTaker" },
    "a returned ticket has no taker to return it",
  );
  assert.deepEqual(await history(project), [
    [1, "Take", bob],
    [2, "Take", carol],
    [3, "Return", carol],
  ]);
});

test("taking a ticket the caller already owns is answered as such and writes nothing", async () => {
  const alice = principal("alice");
  const bob = principal("bob");
  const project = await filedBy("take-owned", alice);
  assert.deepEqual(await written(project, "Take", alice), {
    stored: "AlreadyOwner",
    owner: alice,
  });
  assert.deepEqual(await history(project), [], "the creator took nothing");
  await written(project, "Take", bob);
  assert.deepEqual(await written(project, "Take", bob), {
    stored: "AlreadyOwner",
    owner: bob,
  });
  assert.deepEqual(await history(project), [[1, "Take", bob]]);
});

test("a draft never released, a Done and a Revoked ticket are refused, and a ticket the project lacks is missing", async () => {
  const alice = principal("alice");
  const bob = principal("bob");
  const unreleased = await filedBy("take-unreleased", alice);
  const draft = unreleased.ticket + 100;
  await rig.harness.query(
    `INSERT INTO draft (tenant,project,ticket,authoring_version,state,configuration_revision)
     SELECT tenant,project,$4,authoring_version,'Draft',configuration_revision FROM draft
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [
      unreleased.partition.tenant,
      unreleased.partition.project,
      unreleased.ticket,
      draft,
    ],
  );
  for (const kind of ["Take", "Return"] as const) {
    assert.deepEqual(await written(unreleased, kind, bob, draft), {
      stored: "Refused",
      reason: "Unreleased",
    });
    assert.deepEqual(await written(unreleased, kind, bob, draft + 1), {
      stored: "MissingTicket",
    });
  }
  for (const [phase, reason] of [
    ["Done", "TicketDone"],
    ["Revoked", "TicketRevoked"],
  ] as const) {
    const finished = await filedBy(`take-${phase}`, alice);
    await written(finished, "Take", bob);
    await rig.harness.query(
      `UPDATE ticket_projection SET phase=$4
        WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      [
        finished.partition.tenant,
        finished.partition.project,
        finished.ticket,
        phase,
      ],
    );
    for (const kind of ["Take", "Return"] as const)
      assert.deepEqual(await written(finished, kind, bob), {
        stored: "Refused",
        reason,
      });
    assert.deepEqual(await history(finished), [[1, "Take", bob]]);
  }
});

test("no role changes or removes a take, and the API writes one only through the door", async () => {
  const project = await filedBy("take-immutable", principal("alice"));
  const bob = principal("bob");
  await written(project, "Take", bob);
  const keys = [
    project.partition.tenant,
    project.partition.project,
    project.ticket,
  ];
  for (const statement of [
    `UPDATE ticket_take SET actor_subject='someone-else'
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    `DELETE FROM ticket_take WHERE tenant=$1 AND project=$2 AND ticket=$3`,
  ])
    await assert.rejects(
      rig.harness.query(statement, keys),
      /ticket_take rows are immutable/u,
      statement,
    );
  await assert.rejects(
    apiPool.query(
      `INSERT INTO ticket_take (tenant,project,ticket,number,kind,actor_kind,actor_subject)
       VALUES ($1,$2,$3,2,'Take','Member','someone-else')`,
      keys,
    ),
    /permission denied/u,
  );
  assert.deepEqual(await history(project), [[1, "Take", bob]]);
});
