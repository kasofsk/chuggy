/**
 * What each work cycle of a ticket was prepared over, as the API reads it
 * beside the ticket's landings from a real server.
 *
 * A STACK IS RECORDED AND A DECISION WRITTEN AS THE FINALIZER WRITES THEM,
 * under the relations' own constraints, against a project brought to
 * finalization by real decisions. The reads are made as the API, through the
 * read the route is composed over.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { artifactStore } from "../../src/adapters/artifacts/artifactStore.ts";
import {
  postgresTicketLandingStacks,
  postgresTicketLandings,
} from "../../src/adapters/postgres/ticketLandings.ts";
import {
  apiRole,
  boundaryOwnerRole,
  finalizerRole,
  schedulerRole,
  ticketEvaluationStacksReadFunction,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { ticketLandingStacksAnsweredMax } from "../../src/contract/http.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import {
  ticketLandingReads,
  type TicketLandings,
} from "../../src/interpreter/ticketLandings.ts";
import { recordStack } from "./evaluationStackLandings.ts";
import {
  finalizerBriefLanding,
  finalizerCommit,
  finalizerProject,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import { postgresHarnessDenial, postgresHarnessRolePool } from "./harness.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";

let rig: FinalizerRig;
let apiPool: pg.Pool;
before(async () => {
  rig = await finalizerRigOpen();
  apiPool = postgresHarnessRolePool(apiRole);
});
after(async () => {
  await apiPool.end();
  await rig.close();
});

const target = "refs/heads/release";

/** What a member is answered of `project`'s ticket, read as the API. */
function landingsOf(
  project: FinalizerProject,
): Promise<TicketLandings | undefined> {
  return ticketLandingReads({
    access: {
      authorize: (who) => Promise.resolve(memberAuthority(who)),
      authorizeTenant: () => Promise.resolve(undefined),
      authorizeSite: projectAccessSiteRefused,
    },
    store: postgresTicketLandings(apiPool),
    stacks: postgresTicketLandingStacks(apiPool),
    artifacts: artifactStore({ root: rig.artifactRoot }),
  }).read(asPrincipal("reader"), project.partition, asTicketId(project.ticket));
}

/** A project whose ticket lands as `landing` names. */
async function landing(
  label: string,
  how: "Direct" | "Serialized" | "Stacked",
): Promise<FinalizerProject> {
  const project = await finalizerProject(rig, label);
  await finalizerBriefLanding(
    rig,
    project.partition,
    project.ticket,
    how,
    project.repository,
  );
  return project;
}

/** Records the stack of `cycle` over tickets 3 and then 4, answering what it recorded beneath and its tip. */
async function stacked(project: FinalizerProject, cycle: number) {
  const beneath = [3, 4].map((ticket) => ({
    ticket: asTicketId(ticket),
    commit: asGitObjectId(finalizerCommit()),
  }));
  const tip = asGitObjectId(finalizerCommit());
  await recordStack(rig.pool, project.partition, {
    ticket: asTicketId(project.ticket),
    cycle,
    repository: project.repository,
    target,
    tip,
    beneath,
    stackCommit: asGitObjectId(finalizerCommit()),
    stackTree: asGitObjectId(finalizerCommit()),
  });
  return { beneath, tip };
}

/** Writes the finalizer's decision to evaluate `cycle` unstacked, for `reason`. */
async function unstacked(
  project: FinalizerProject,
  cycle: number,
  reason: string,
): Promise<void> {
  await rig.as(
    `INSERT INTO evaluation_stack_none (tenant, project, ticket, work_cycle, reason)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      project.partition.tenant,
      project.partition.project,
      project.ticket,
      cycle,
      reason,
    ],
  );
}

test("a cycle prepared a stack answers its beneath bottom first with their commits, its reference and its tip", async () => {
  const project = await landing("stacks-stack", "Stacked");
  const { beneath, tip } = await stacked(project, 1);
  assert.deepEqual((await landingsOf(project))?.stacks, {
    cycles: [
      { cycle: 1, prepared: "Stacked", beneath, reference: target, tip },
    ],
    truncated: false,
  });
});

test("a cycle decided unstacked answers its reason, each cycle in order, and a cycle with no decision answers nothing", async () => {
  const project = await landing("stacks-none", "Stacked");
  const { beneath, tip } = await stacked(project, 1);
  await unstacked(project, 2, "Conflicted");
  await unstacked(project, 4, "Unpublished");
  assert.deepEqual((await landingsOf(project))?.stacks?.cycles, [
    { cycle: 1, prepared: "Stacked", beneath, reference: target, tip },
    { cycle: 2, prepared: "Unstacked", reason: "Conflicted" },
    { cycle: 4, prepared: "Unstacked", reason: "Unpublished" },
  ]);
  const undecided = await landing("stacks-undecided", "Stacked");
  const read = await landingsOf(undecided);
  assert.ok(read !== undefined);
  assert.equal(read.stacks, undefined);
});

test("a ticket that is not Stacked answers no stacks, though the finalizer left one for it", async () => {
  for (const how of ["Direct", "Serialized"] as const) {
    const project = await landing(`stacks-${how.toLowerCase()}`, how);
    await stacked(project, 1);
    await unstacked(project, 2, "Unchosen");
    const read = await landingsOf(project);
    assert.ok(read !== undefined, how);
    assert.equal(read.stacks, undefined, how);
  }
});

test("a ticket with more prepared cycles than one read answers answers the newest, oldest first, and says there were more", async () => {
  const project = await landing("stacks-many", "Stacked");
  const cycles = ticketLandingStacksAnsweredMax + 1;
  for (let cycle = 1; cycle <= cycles; cycle += 1)
    await unstacked(project, cycle, "Unchosen");
  const read = (await landingsOf(project))?.stacks;
  assert.equal(read?.truncated, true);
  assert.deepEqual(
    read.cycles.map((cycle) => cycle.cycle),
    Array.from({ length: ticketLandingStacksAnsweredMax }, (_, at) => at + 2),
  );
});

test("the API reads the stacks through a door of its own and holds no grant on the relations behind it", async () => {
  for (const relation of [
    "evaluation_stack",
    "evaluation_stack_beneath",
    "evaluation_stack_none",
  ]) {
    assert.match(
      (await rig.harness.attemptAs(apiRole, `SELECT 1 FROM ${relation}`)) ?? "",
      postgresHarnessDenial(relation),
      relation,
    );
    const [held] = await rig.harness.query(
      `SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS any`,
      [apiRole, relation],
    );
    assert.deepEqual(held, { any: false }, relation);
  }
  const call = `SELECT * FROM ${ticketEvaluationStacksReadFunction}('tenant','project',1,1)`;
  assert.equal(await rig.harness.attemptAs(apiRole, call), undefined);
  for (const role of [ticketServiceRole, schedulerRole, finalizerRole])
    assert.match(
      (await rig.harness.attemptAs(role, call)) ?? "",
      postgresHarnessDenial(ticketEvaluationStacksReadFunction),
      role,
    );
  const [door] = await rig.harness.query(
    `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
            p.provolatile AS volatility, p.proconfig::text AS settings,
            has_function_privilege('public', p.oid, 'EXECUTE') AS anyone
       FROM pg_proc p WHERE p.proname=$1`,
    [ticketEvaluationStacksReadFunction],
  );
  assert.deepEqual(door, {
    owner: boundaryOwnerRole,
    definer: true,
    volatility: "s",
    settings: '{"search_path=pg_catalog, public, pg_temp"}',
    anyone: false,
  });
});
