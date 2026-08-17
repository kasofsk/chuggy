/**
 * The Kubernetes fabric against the fake Jobs API: the fan-out a spawn writes
 * — names, spec, environment, labels and per-pair tokens — the two halves of
 * absorption exercised separately, the fold pinned to the emission's own
 * decision across a rework, the refusals that hold the cursor, the watch as
 * failure detector with its grace and its relist-reconnect loop, and the
 * label-scoped cancellation. Every case scripts the exact API behaviour it
 * needs; nothing in the fixture transitions a Job on its own.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";

import {
  jArrive,
  jDispatch,
  jEvalReduce,
  jRelease,
  jTaskDone,
  jWorkReduce,
  type Cmd,
} from "../../src/actor/command.ts";
import type { Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import {
  k8sFabric,
  type K8sFabric,
  type K8sFabricOptions,
} from "../../src/adapters/k8sFabric/k8sFabric.ts";
import type { FabricApiJob } from "../../src/adapters/k8sFabric/client.ts";
import type { Config } from "../../src/domain/config.ts";
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { budgeted, reworkBudgetOf } from "../../src/domain/pricing.ts";
import type { Stage } from "../../src/domain/program.ts";
import { wNone } from "../../src/domain/wrapUp.ts";
import type { Inbound, Submitted } from "../../src/interpreter/inbound.ts";
import type { Emission } from "../../src/interpreter/ports.ts";
import type { TicketAnnex } from "../../src/interpreter/registry.ts";
import { id } from "../domain/fixtures.ts";
import {
  fakeKubernetesApi,
  type FakeKubernetesApi,
  type FakeStoredJob,
} from "./fakeKubernetesApi.ts";

const groundConfig: Config = {
  nTickets: 2,
  nTasks: 1,
  reworkPolicy: reworkBudgetOf(2),
  gas: 8,
  wrapUpPricing: budgeted(2),
  opRetryPricing: "RetryCharged",
  maxStages: 1,
  nProjects: 1,
};

const groundProgram: readonly Stage[] = [
  { fanout: 1, combinator: "CUnanimousPass" },
];

const groundCatalog = {
  build: {
    work: {
      image: "work-image:1",
      command: ["run", "work"],
      env: { EXTRA: "yes" },
    },
    eval: { image: "eval-image:1", command: ["run", "eval"] },
    resources: {
      requests: { cpu: "100m", memory: "64Mi" },
      limits: { cpu: "1", memory: "256Mi" },
    },
    activeDeadlineSeconds: 600,
    backoffLimit: 2,
  },
};

/** The journal a sequence of decisions leaves, built through the actor's own step so it is legal by construction. */
function groundJournal(commands: readonly Cmd[]): readonly Entry[] {
  return commands.reduce(
    (state, cmd) => journalStep(groundConfig, state, cmd),
    actorInit(),
  ).journal;
}

const spawnWorkHistory: readonly Cmd[] = [
  jArrive([], groundProgram, asProjectId(1), wNone),
  jRelease(id(1)),
  jDispatch(id(1)),
];

const spawnEvalHistory: readonly Cmd[] = [
  ...spawnWorkHistory,
  jTaskDone(id(1), asTaskId(1), "VPass"),
  jWorkReduce(id(1)),
];

const reworkHistory: readonly Cmd[] = [
  ...spawnEvalHistory,
  jTaskDone(id(1), asTaskId(2), "VFail"),
  jEvalReduce(id(1)),
  jTaskDone(id(1), asTaskId(3), "VPass"),
  jWorkReduce(id(1)),
];

function emissionAt(seq: number): Emission {
  return { seq, effectIndex: 0, ticket: id(1) };
}

interface GroundOptions {
  readonly history?: readonly Cmd[];
  readonly loadRefused?: boolean;
  readonly annexTaskType?: string;
  readonly withoutAnnex?: boolean;
  readonly succeededGraceMs?: number;
  readonly watchRetryDelaysMs?: readonly number[];
  readonly bearerToken?: string;
  readonly taskDoneAnswer?: Submitted;
}

interface Ground {
  readonly fake: FakeKubernetesApi;
  readonly fabric: K8sFabric;
  readonly minted: readonly (readonly number[])[];
  readonly delivered: readonly (readonly [number, number, string])[];
  readonly db: DatabaseSync;
  readonly dir: string;
  readonly bind: () => void;
}

function groundInbound(ground: {
  delivered: [number, number, string][];
  answer: Submitted;
}): Inbound {
  const refused = (): Promise<Submitted> =>
    Promise.reject(new Error("the watch may only deliver completions"));
  return {
    arrive: refused,
    release: refused,
    revoke: refused,
    opRetry: refused,
    gateOutcome: refused,
    taskDone: (ticket, taskId, verdict) => {
      ground.delivered.push([ticket, taskId, verdict]);
      return Promise.resolve(ground.answer);
    },
  };
}

/** The ticket's annex map as the case shapes it: absent, oddly typed, or the catalog's own. */
function groundAnnexes(
  options: GroundOptions,
): ReadonlyMap<ReturnType<typeof id>, TicketAnnex> {
  const annexes = new Map<ReturnType<typeof id>, TicketAnnex>();
  if (options.withoutAnnex !== true) {
    annexes.set(id(1), {
      title: "t",
      brief: "b",
      taskType: options.annexTaskType ?? "build",
      author: "a",
    });
  }
  return annexes;
}

/** The adapter over a fresh fake, torn down with the case: signal first, then the fake, then the store. */
async function ground(
  t: TestContext,
  options: GroundOptions = {},
): Promise<Ground> {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-k8sfabric-"));
  const fake = await fakeKubernetesApi();
  const stop = new AbortController();
  const db = new DatabaseSync(":memory:");
  t.after(async () => {
    stop.abort();
    await fake.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const catalogPath = join(dir, "catalog.json");
  writeFileSync(catalogPath, JSON.stringify(groundCatalog));
  const journal = groundJournal(options.history ?? spawnWorkHistory);
  const annexes = groundAnnexes(options);
  const minted: number[][] = [];
  const delivered: [number, number, string][] = [];
  const bearerTokenPath = join(dir, "bearer.token");
  if (options.bearerToken !== undefined) {
    writeFileSync(bearerTokenPath, `${options.bearerToken}\n`);
  }
  const fabric = k8sFabric({
    config: groundConfig,
    load: () =>
      Promise.resolve(
        options.loadRefused === true
          ? { parsed: "Refused", why: "torn row" }
          : { parsed: "Ok", value: journal },
      ),
    annexes: () => Promise.resolve(annexes),
    mint: (ticket, taskId) => {
      minted.push([ticket, taskId]);
      return `tag-${String(ticket)}-${String(taskId)}`;
    },
    db,
    catalogPath,
    api: {
      base: fake.base,
      namespace: "chuggy",
      bearerTokenPath:
        options.bearerToken === undefined ? undefined : bearerTokenPath,
    },
    completionUrl: "http://desk.test/",
    succeededGraceMs: options.succeededGraceMs ?? 40,
    watchRetryDelaysMs: options.watchRetryDelaysMs ?? [10, 20, 5000],
    watchSignal: stop.signal,
  });
  const answer: Submitted = options.taskDoneAnswer ?? {
    submitted: "Accepted",
    seq: 1,
  };
  return {
    fake,
    fabric,
    minted,
    delivered,
    db,
    dir,
    bind: () => fabric.bindInbound(groundInbound({ delivered, answer })),
  };
}

const untilTriesMax = 400;

/** Polls for the watch's observable, bounded, so a wedged loop fails the case rather than the runner. */
async function until(read: () => boolean, what: string): Promise<void> {
  for (let tries = 0; tries < untilTriesMax; tries++) {
    if (read()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`waited out ${what}`);
}

function groundPosts(fake: FakeKubernetesApi): number {
  return fake.log.filter((line) => line.startsWith("POST ")).length;
}

function groundSpawnRows(db: DatabaseSync): readonly string[] {
  return db
    .prepare("SELECT emission_key FROM fabric_spawns ORDER BY emission_key")
    .all()
    .map((row) => String(row["emission_key"]));
}

/** A Job object as the API would frame it in a list or a watch event. */
function groundJob(
  name: string,
  ticket: number,
  taskId: number,
  conditions: readonly { type: string; status: string }[],
): FakeStoredJob {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name,
      labels: { "chug-ticket": String(ticket), "chug-task": String(taskId) },
    },
    spec: {
      activeDeadlineSeconds: 1,
      backoffLimit: 0,
      template: {
        metadata: { labels: {} },
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "task",
              image: "x",
              command: ["x"],
              env: [],
              resources: groundCatalog.build.resources,
            },
          ],
        },
      },
    },
    status: { conditions },
  };
}

test("a work spawn writes one Job per live task, from the catalog's work half", async (t) => {
  const g = await ground(t);
  await g.fabric.spawnWorkTasks(emissionAt(3));

  const labels = { "chug-ticket": "1", "chug-task": "1" };
  const expected: FabricApiJob = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: "chug-t1-k1", labels },
    spec: {
      activeDeadlineSeconds: 600,
      backoffLimit: 2,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "task",
              image: "work-image:1",
              command: ["run", "work"],
              env: [
                { name: "EXTRA", value: "yes" },
                { name: "CHUG_TICKET", value: "1" },
                { name: "CHUG_TASK", value: "1" },
                { name: "CHUG_COMPLETION_URL", value: "http://desk.test/" },
                { name: "CHUG_COMPLETION_TOKEN", value: "tag-1-1" },
                { name: "CHUG_WORK_BRANCH", value: "chug/t1/k1" },
              ],
              resources: groundCatalog.build.resources,
            },
          ],
        },
      },
    },
  };
  assert.deepEqual(g.fake.created, [expected]);
  assert.deepEqual(g.minted, [[1, 1]]);
  assert.deepEqual(groundSpawnRows(g.db), ["3:0"]);
});

test("an eval spawn takes the eval half and installs the producing branch the mark re-forms", async (t) => {
  const g = await ground(t, { history: spawnEvalHistory });
  await g.fabric.spawnEvalTasks(emissionAt(5));

  const [job] = g.fake.created;
  assert.ok(job !== undefined && g.fake.created.length === 1);
  assert.equal(job.metadata.name, "chug-t1-k2");
  const [container] = job.spec.template.spec.containers;
  assert.equal(container.image, "eval-image:1");
  assert.deepEqual(container.command, ["run", "eval"]);
  assert.deepEqual(container.env, [
    { name: "CHUG_TICKET", value: "1" },
    { name: "CHUG_TASK", value: "2" },
    { name: "CHUG_COMPLETION_URL", value: "http://desk.test/" },
    { name: "CHUG_COMPLETION_TOKEN", value: "tag-1-2" },
    { name: "CHUG_WORK_BRANCH", value: "chug/t1/k1" },
  ]);
  assert.deepEqual(g.minted, [[1, 2]]);
});

test("the fold serves each emission at its own decision, and a rework bends no old spawn", async (t) => {
  const g = await ground(t, { history: reworkHistory });
  await g.fabric.spawnEvalTasks(emissionAt(9));
  await g.fabric.spawnWorkTasks(emissionAt(3));
  await g.fabric.spawnEvalTasks(emissionAt(5));

  const branchOf = (job: FabricApiJob): string | undefined =>
    job.spec.template.spec.containers[0].env.find(
      (entry) => entry.name === "CHUG_WORK_BRANCH",
    )?.value;
  assert.deepEqual(
    g.fake.created.map((job) => [job.metadata.name, branchOf(job)]),
    [
      ["chug-t1-k4", "chug/t1/k3"],
      ["chug-t1-k1", "chug/t1/k1"],
      ["chug-t1-k2", "chug/t1/k1"],
    ],
  );
  assert.deepEqual(g.minted, [
    [1, 4],
    [1, 1],
    [1, 2],
  ]);
});

test("a served row short-circuits a re-delivery outliving the collected Jobs", async (t) => {
  const g = await ground(t);
  await g.fabric.spawnWorkTasks(emissionAt(3));
  g.fake.clearJobs();

  await g.fabric.spawnWorkTasks(emissionAt(3));
  assert.equal(groundPosts(g.fake), 1);
  assert.equal(g.fake.jobs().length, 0);
});

test("without its row a re-delivery re-serves, and the name collision absorbs it", async (t) => {
  const g = await ground(t);
  await g.fabric.spawnWorkTasks(emissionAt(3));
  g.db.prepare("DELETE FROM fabric_spawns").run();

  await g.fabric.spawnWorkTasks(emissionAt(3));
  assert.equal(groundPosts(g.fake), 2);
  assert.equal(g.fake.created.length, 1);
  assert.deepEqual(groundSpawnRows(g.db), ["3:0"]);
});

test("a delivery the fabric cannot yet serve is refused by throwing, and nothing spawns", async (t) => {
  const noAnnex = await ground(t, { withoutAnnex: true });
  await assert.rejects(
    noAnnex.fabric.spawnWorkTasks(emissionAt(3)),
    /no annex/,
  );

  const unknownType = await ground(t, { annexTaskType: "mystery" });
  await assert.rejects(
    unknownType.fabric.spawnWorkTasks(emissionAt(3)),
    /holds no type mystery/,
  );

  const tornJournal = await ground(t, { loadRefused: true });
  await assert.rejects(
    tornJournal.fabric.spawnWorkTasks(emissionAt(3)),
    /did not parse/,
  );

  const wrongSeq = await ground(t);
  await assert.rejects(
    wrongSeq.fabric.spawnWorkTasks(emissionAt(99)),
    /no decision 99/,
  );
  await assert.rejects(
    wrongSeq.fabric.spawnWorkTasks(emissionAt(2)),
    /no live task/,
  );

  for (const g of [noAnnex, unknownType, tornJournal, wrongSeq]) {
    assert.equal(groundPosts(g.fake), 0);
    assert.deepEqual(groundSpawnRows(g.db), []);
  }
});

test("what no delivery could survive ends construction instead", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-k8sfabric-"));
  const db = new DatabaseSync(":memory:");
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const catalogPath = join(dir, "catalog.json");
  const options = (over: Partial<K8sFabricOptions>): K8sFabricOptions => ({
    config: groundConfig,
    load: () => Promise.resolve({ parsed: "Ok", value: [] }),
    annexes: () => Promise.resolve(new Map()),
    mint: () => "tag",
    db,
    catalogPath,
    api: { base: "http://127.0.0.1:9", namespace: "chuggy" },
    completionUrl: "http://desk.test/",
    ...over,
  });

  assert.throws(
    () => k8sFabric(options({ catalogPath: join(dir, "absent.json") })),
    /cannot be read/,
  );
  writeFileSync(catalogPath, "not json");
  assert.throws(() => k8sFabric(options({})), /not JSON/);
  const bent = {
    build: {
      ...groundCatalog.build,
      work: { ...groundCatalog.build.work, env: { CHUG_TASK: "9" } },
    },
  };
  writeFileSync(catalogPath, JSON.stringify(bent));
  assert.throws(() => k8sFabric(options({})), /CHUG_/);
  writeFileSync(catalogPath, JSON.stringify(groundCatalog));
  assert.throws(
    () => k8sFabric(options({ config: { ...groundConfig, nTasks: 2 } })),
    /nTasks is not 1/,
  );
});

test("a failed Job is delivered as the fail verdict through the face", async (t) => {
  const g = await ground(t);
  g.bind();
  await until(
    () => g.fake.log.some((line) => line.includes("watch=1")),
    "the watch to connect",
  );

  g.fake.send({
    type: "MODIFIED",
    object: groundJob("chug-t1-k1", 1, 1, [{ type: "Failed", status: "True" }]),
  });
  await until(() => g.delivered.length === 1, "the fail verdict");
  assert.deepEqual(g.delivered, [[1, 1, "VFail"]]);
});

test("a persisted foreign object under the selector is served past, never crashed on", async (t) => {
  const g = await ground(t);
  g.fake.putJob(
    groundJob("foreign", 10000000000000000, 1, [
      { type: "Failed", status: "True" },
    ]),
  );
  g.bind();
  await until(
    () => g.fake.log.some((line) => line.includes("watch=1")),
    "the list to survive the foreign object and the watch to connect",
  );

  g.fake.send({
    type: "MODIFIED",
    object: groundJob("chug-t1-k1", 1, 1, [{ type: "Failed", status: "True" }]),
  });
  await until(() => g.delivered.length === 1, "the real pair to deliver");
  assert.deepEqual(g.delivered, [[1, 1, "VFail"]]);
  assert.equal(
    g.fake.log.filter(
      (line) => line.startsWith("GET ") && !line.includes("watch=1"),
    ).length,
    1,
  );
});

test("a Job that succeeded without declaring is failed only after the grace, and a Dropped answer ends the duty", async (t) => {
  const g = await ground(t, {
    succeededGraceMs: 60,
    taskDoneAnswer: { submitted: "Dropped", why: "already declared" },
  });
  g.bind();
  await until(
    () => g.fake.log.some((line) => line.includes("watch=1")),
    "the watch to connect",
  );

  g.fake.send({
    type: "MODIFIED",
    object: groundJob("chug-t1-k2", 1, 2, [
      { type: "Complete", status: "True" },
    ]),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(g.delivered.length, 0);
  await until(() => g.delivered.length === 1, "the grace to fail it");
  assert.deepEqual(g.delivered, [[1, 2, "VFail"]]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(g.delivered.length, 1);
});

test("a dropped watch reconnects through the ladder and resyncs from a fresh list", async (t) => {
  const g = await ground(t);
  const watches = (): number =>
    g.fake.log.filter((line) => line.includes("watch=1")).length;
  const lists = (): number =>
    g.fake.log.filter(
      (line) => line.startsWith("GET ") && !line.includes("watch=1"),
    ).length;
  g.bind();
  await until(() => watches() === 1, "the first watch");

  g.fake.putJob(
    groundJob("chug-t1-k1", 1, 1, [{ type: "Failed", status: "True" }]),
  );
  g.fake.dropWatches();
  await until(() => watches() === 2, "the reconnect after the drop");
  await until(() => g.delivered.length === 1, "the resync to serve the list");
  assert.deepEqual(g.delivered[0], [1, 1, "VFail"]);
  assert.equal(lists(), 2);

  g.fake.expireWatches();
  await until(() => watches() === 3, "the reconnect after the expiry");
  assert.equal(lists(), 3);
});

test("cancelTasks deletes the ticket's Jobs by label and absorbs an already-gone answer", async (t) => {
  const g = await ground(t);
  await g.fabric.spawnWorkTasks(emissionAt(3));
  g.fake.putJob(groundJob("chug-t2-k1", 2, 1, []));

  await g.fabric.cancelTasks(emissionAt(3));
  assert.deepEqual(g.fake.deletes, [
    { selector: "chug-ticket=1", propagationPolicy: "Foreground" },
  ]);
  assert.deepEqual(
    g.fake.jobs().map((job) => job.metadata.name),
    ["chug-t2-k1"],
  );

  g.fake.failNextDelete(404);
  await g.fabric.cancelTasks(emissionAt(3));
  g.fake.failNextDelete(500);
  await assert.rejects(g.fabric.cancelTasks(emissionAt(3)), /answered 500/);
});

test("a configured token file rides every call as the bearer credential", async (t) => {
  const g = await ground(t, { bearerToken: "sekret" });
  await g.fabric.spawnWorkTasks(emissionAt(3));
  assert.ok(g.fake.authorizations.includes("Bearer sekret"));
});
