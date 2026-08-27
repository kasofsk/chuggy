/**
 * The worker catalog against a real server: what a boot publishes, what a
 * second boot leaves standing, and what a read decorates an execution with.
 *
 * A RETIRED IMAGE IS THE CASE THAT MATTERS. A publication that cleared the
 * table first would satisfy every assertion about the images this release
 * admits and silently strip the label off every execution that ran on an image
 * an earlier release admitted — which is the whole reason rows are never
 * deleted, and is what the retention case here is for.
 *
 * AND RETENTION IS WHY A LABEL IS NOT UNIQUE ACROSS THE TABLE. Rows outlive the
 * releases that wrote them, so a label held by a retired image would refuse the
 * boot of the release that reused it, with nothing here able to delete the row
 * standing in the way. The reuse case holds that boot open.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresOperationalReads } from "../../src/adapters/postgres/operationalReads.ts";
import {
  postgresWorkerCatalog,
  postgresWorkerCatalogPrecondition,
} from "../../src/adapters/postgres/workerCatalog.ts";
import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  admittedImagesMax,
  type AdmittedWorker,
  type Worker,
} from "../../src/interpreter/workerCatalog.ts";
import { id } from "../domain/fixtures.ts";
import {
  schedulerClaimFor,
  schedulerIngressPool,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  schedulerRolePool,
  type SchedulerRig,
} from "./schedulerHarness.ts";
import { postgresHarnessDenial } from "./harness.ts";
import { apiRole, schedulerRole } from "../../src/adapters/postgres/schema.ts";

let rig: SchedulerRig;
let scheduler: ReturnType<typeof schedulerRolePool>;
let ingress: ReturnType<typeof schedulerIngressPool>;

before(async () => {
  rig = await schedulerRigOpen();
  scheduler = schedulerRolePool();
  ingress = schedulerIngressPool();
});

after(async () => {
  await ingress.end();
  await scheduler.end();
  await rig.close();
});

/** The image the harness configuration pins, which is what an execution requires. */
const harnessImage = "worker:v1";

/** The label the project's one ready configuration reads back under, where it has one. */
async function readyConfigurationWorker(
  partition: Partition,
): Promise<Worker | undefined> {
  const page = await rig.harness.authoring.configurations(partition, {
    limit: 1,
  });
  const summary = page.configurations[0];
  assert.equal(summary?.readiness, "Ready");
  return summary?.readiness === "Ready" ? summary.worker : undefined;
}

/** When the catalog last published this image, read off the row itself. */
async function publishedAt(image: string): Promise<Date> {
  const rows = (await rig.harness.query(
    "SELECT published_at FROM admitted_worker WHERE image=$1",
    [image],
  )) as readonly { published_at: Date }[];
  const row = rows[0];
  if (row === undefined) throw new Error(`${image} is not catalogued`);
  return row.published_at;
}

/** Publishes one catalog as a scheduler boot does, refusing to pass a failure off as met. */
async function publish(workers: readonly AdmittedWorker[]): Promise<void> {
  assert.equal(
    await postgresWorkerCatalogPrecondition(scheduler, workers).check(
      new AbortController().signal,
    ),
    true,
  );
}

test("a second publication updates what it names and retains what it drops", async () => {
  const retired = "registry.invalid/catalog-retired:1";
  const renamed = "registry.invalid/catalog-renamed:1";
  await publish([
    { image: renamed, name: "catalog-renamed", version: "1" },
    { image: retired, name: "catalog-retired", version: "1" },
  ]);
  await publish([{ image: renamed, name: "catalog-renamed", version: "2" }]);
  assert.deepEqual(
    [...(await postgresWorkerCatalog(ingress, [renamed, retired]))].sort(),
    [
      [renamed, { name: "catalog-renamed", version: "2" }],
      [retired, { name: "catalog-retired", version: "1" }],
    ].sort(),
  );
});

test("a later release may publish a label an earlier release retired", async () => {
  const label = { name: "catalog-reused", version: "1" };
  const earlier = "registry.invalid/catalog-reused-earlier:1";
  const later = "registry.invalid/catalog-reused-later:1";
  await publish([{ image: earlier, ...label }]);
  await publish([{ image: later, ...label }]);
  const catalogued = await postgresWorkerCatalog(ingress, [earlier, later]);
  assert.deepEqual(catalogued.get(earlier), label);
  assert.deepEqual(catalogued.get(later), label);
});

test("a republication moves published_at forward, it being the last one", async () => {
  const image = "registry.invalid/catalog-republished:1";
  await publish([{ image, name: "catalog-republished", version: "1" }]);
  const first = await publishedAt(image);
  await publish([{ image, name: "catalog-republished", version: "2" }]);
  const second = await publishedAt(image);
  assert.ok(
    second > first,
    `published_at stayed at ${first.toISOString()} across a republication`,
  );
});

test("a list longer than its bound is refused where the statement is built", () => {
  const overlong = Array.from({ length: admittedImagesMax + 1 }, (_, at) => ({
    image: `registry.invalid/catalog-overlong:${String(at)}`,
    name: "catalog-overlong",
    version: String(at),
  }));
  assert.throws(
    () => postgresWorkerCatalogPrecondition(scheduler, overlong),
    RangeError,
  );
});

test("an image labels its execution and its configuration only once catalogued", async () => {
  const project = await schedulerProject(rig, "worker-catalog-read", {
    tasks: 1,
  });
  const claim = await schedulerClaimFor(
    rig,
    project.partition,
    project.request,
    schedulerOwner("worker-catalog-read"),
  );
  assert.equal(
    (await rig.store.registerSpawn(claim, executionSchedulerDefaults.nTasks))
      .registered,
    "Registered",
  );
  const reads = postgresOperationalReads(ingress);
  const query = {
    limit: 10,
    ticket: id(project.ticket),
    selection: { selection: "NonTerminal" },
  } as const;
  const worker = { name: "chuggy-worker", version: "7" };
  const uncatalogued = await reads.executions(project.partition, query);
  assert.equal(uncatalogued.executions.length, 1);
  assert.equal(uncatalogued.executions[0]?.worker, undefined);
  assert.equal(await readyConfigurationWorker(project.partition), undefined);
  await publish([{ image: harnessImage, ...worker }]);
  const catalogued = await reads.executions(project.partition, query);
  assert.deepEqual(catalogued.executions[0]?.worker, worker);
  assert.deepEqual(await readyConfigurationWorker(project.partition), worker);
});

test("the API reads the catalog and cannot publish to it", async () => {
  assert.equal(
    await rig.harness.attemptAs(apiRole, "SELECT image FROM admitted_worker"),
    undefined,
  );
  assert.match(
    (await rig.harness.attemptAs(
      apiRole,
      "INSERT INTO admitted_worker (image,name,version) VALUES ('i','n','v')",
    )) ?? "",
    postgresHarnessDenial("admitted_worker"),
  );
  assert.match(
    (await rig.harness.attemptAs(apiRole, "DELETE FROM admitted_worker")) ?? "",
    postgresHarnessDenial("admitted_worker"),
  );
});

test("the scheduler publishes to the catalog and cannot delete from it", async () => {
  assert.equal(
    await rig.harness.attemptAs(
      schedulerRole,
      "INSERT INTO admitted_worker (image,name,version) VALUES ('i','n','v')",
    ),
    undefined,
  );
  assert.equal(
    await rig.harness.attemptAs(
      schedulerRole,
      "UPDATE admitted_worker SET version=version",
    ),
    undefined,
  );
  assert.match(
    (await rig.harness.attemptAs(
      schedulerRole,
      "DELETE FROM admitted_worker",
    )) ?? "",
    postgresHarnessDenial("admitted_worker"),
  );
});
