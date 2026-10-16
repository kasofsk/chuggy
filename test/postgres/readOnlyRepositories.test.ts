/**
 * Whether the scheduler's own role reads the repositories an execution's
 * project binds beside the one its bundle pins, asked of the server by running
 * it: the repositories a job is told it may read and never deliver to.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresReadOnlyRepositories } from "../../src/adapters/postgres/repositoryBinding.ts";
import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";
import type { ExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import {
  schedulerClaimFor,
  schedulerInCluster,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";

let rig: SchedulerRig;

before(async () => {
  rig = await schedulerRigOpen();
});

after(async () => {
  await rig.close();
});

/** One repository bound to `project`, retired where `retired` says so; a repository is bound live by one project at a time. */
async function readOnlyBound(
  project: SchedulerProject,
  repository: string,
  retired = false,
): Promise<void> {
  const { tenant, project: projectId } = project.partition;
  await rig.harness.query(
    `INSERT INTO project_repository (tenant,project,repository,recovery_epoch,landing_mode)
     VALUES ($1,$2,$3,$4,'Push')`,
    [tenant, projectId, repository, project.epoch],
  );
  if (retired)
    await rig.harness.query(
      `UPDATE project_repository SET retired_at=now()
        WHERE tenant=$1 AND project=$2 AND repository=$3`,
      [tenant, projectId, repository],
    );
}

/** A project whose first work spawn pins `own` where one is given, registered and its execution admitted. */
async function readOnlyExecution(
  label: string,
  own?: string,
): Promise<{
  readonly project: SchedulerProject;
  readonly execution: ExecutionId;
}> {
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const { tenant, project: projectId } = project.partition;
  if (own !== undefined)
    await rig.harness.query(
      `INSERT INTO input_bundle_reference
         (tenant,project,bundle,ordinal,reference_kind,reference_id)
       SELECT q.tenant,q.project,q.input_bundle,
              (SELECT coalesce(max(b.ordinal),0)+1 FROM input_bundle_reference b
                WHERE b.tenant=q.tenant AND b.project=q.project AND b.bundle=q.input_bundle),
              'Repository',$4
         FROM execution_request q
        WHERE q.tenant=$1 AND q.project=$2 AND q.request=$3`,
      [tenant, projectId, project.request, own],
    );
  const registered = await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  assert.equal(registered.registered, "Registered");
  const admitted = await rig.store.admit(project.cluster);
  assert.ok(admitted.admitted === "Admitted");
  return { project, execution: admitted.execution };
}

test("the scheduler role reads every repository its execution's project binds live beside its own, oldest first", async () => {
  const { project, execution } = await readOnlyExecution(
    "read-only-repositories",
    "https://github.com/o/a.git",
  );
  await readOnlyBound(project, "https://github.com/o/a.git");
  await readOnlyBound(project, "https://github.com/o/b.git");
  await readOnlyBound(project, "https://github.com/o/c.git", true);
  await readOnlyBound(project, "https://github.com/o/d.git");

  assert.deepEqual(
    await postgresReadOnlyRepositories(rig.pool).repositories(
      project.partition,
      execution,
    ),
    {
      read: "Repositories",
      repositories: [
        "https://github.com/o/b.git",
        "https://github.com/o/d.git",
      ],
    },
  );
});

test("an execution pinning no repository reads every live one, and a project binding none reads none", async () => {
  const { project, execution } = await readOnlyExecution("read-only-unpinned");
  const read = () =>
    postgresReadOnlyRepositories(rig.pool).repositories(
      project.partition,
      execution,
    );
  assert.deepEqual(await read(), { read: "Repositories", repositories: [] });

  await readOnlyBound(project, "https://github.com/o/unpinned.git");
  assert.deepEqual(await read(), {
    read: "Repositories",
    repositories: ["https://github.com/o/unpinned.git"],
  });
});
