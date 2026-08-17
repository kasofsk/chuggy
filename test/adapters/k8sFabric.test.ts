/**
 * The Kubernetes fabric against the fake Jobs API: the fan-out a spawn writes
 * — names, spec, environment, labels and per-pair tokens — the two halves of
 * absorption exercised separately, the fold pinned to the emission's own
 * decision across a rework, the refusals that hold the cursor, the watch as
 * failure detector with its grace and its relist-reconnect loop, the
 * label-scoped cancellation, and the user-credential resolution — grant to
 * material to a per-job Secret the Job owns, failing the spawn closed where
 * any link is missing. Every case scripts the exact API behaviour it needs;
 * nothing in the fixture transitions a Job on its own.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  k8sFabricApiKeyEnv,
  k8sFabricSecretKey,
  type K8sFabric,
  type K8sFabricCredentials,
  type K8sFabricOptions,
} from "../../src/adapters/k8sFabric/k8sFabric.ts";
import type { FabricApiJob } from "../../src/adapters/k8sFabric/client.ts";
import { registrySqlite } from "../../src/adapters/registrySqlite.ts";
import { secretFileSource } from "../../src/adapters/secretFileSource.ts";
import type { Config } from "../../src/domain/config.ts";
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { budgeted, reworkBudgetOf } from "../../src/domain/pricing.ts";
import type { Stage } from "../../src/domain/program.ts";
import { wNone } from "../../src/domain/wrapUp.ts";
import type { Inbound, Submitted } from "../../src/interpreter/inbound.ts";
import type { Emission } from "../../src/interpreter/ports.ts";
import type {
  TicketAnnex,
  UserCredentials,
} from "../../src/interpreter/registry.ts";
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

interface GroundCredentials {
  readonly grant: UserCredentials | undefined;
  readonly files: Readonly<Record<string, string>>;
}

interface GroundOptions {
  readonly history?: readonly Cmd[];
  readonly loadRefused?: boolean;
  readonly annexTaskType?: string;
  readonly withoutAnnex?: boolean;
  readonly credentials?: GroundCredentials;
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

/** A real file source over the case's temp directory, answering the one handed grant for every ticket. */
function groundCredentials(
  dir: string,
  draw: GroundCredentials,
): K8sFabricCredentials {
  const secretsDirectory = join(dir, "secrets");
  mkdirSync(secretsDirectory);
  for (const [name, material] of Object.entries(draw.files)) {
    writeFileSync(join(secretsDirectory, name), material);
  }
  return {
    credentialsFor: () => Promise.resolve(draw.grant),
    source: secretFileSource(secretsDirectory),
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
    credentials:
      options.credentials === undefined
        ? undefined
        : groundCredentials(dir, options.credentials),
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

  const branchOf = (job: FabricApiJob): string | undefined => {
    const entry = job.spec.template.spec.containers[0].env.find(
      (one) => one.name === "CHUG_WORK_BRANCH",
    );
    return entry !== undefined && "value" in entry ? entry.value : undefined;
  };
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

/** The one grant the credentialed cases resolve, against a file the ground writes. */
const groundGrant: UserCredentials = {
  apiKeyRef: "author.key",
  gitName: "Ada",
  gitEmail: "ada@example.test",
};

test("a configured resolution writes the per-job Secret the Job owns and the env references", async (t) => {
  const g = await ground(t, {
    credentials: {
      grant: groundGrant,
      files: { "author.key": "author-material\n" },
    },
  });
  await g.fabric.spawnWorkTasks(emissionAt(3));

  const [job] = g.fake.created;
  assert.ok(job !== undefined && g.fake.created.length === 1);
  assert.deepEqual(job.spec.template.spec.containers[0].env, [
    { name: "EXTRA", value: "yes" },
    { name: "CHUG_TICKET", value: "1" },
    { name: "CHUG_TASK", value: "1" },
    { name: "CHUG_COMPLETION_URL", value: "http://desk.test/" },
    { name: "CHUG_COMPLETION_TOKEN", value: "tag-1-1" },
    { name: "CHUG_WORK_BRANCH", value: "chug/t1/k1" },
    {
      name: k8sFabricApiKeyEnv,
      valueFrom: {
        secretKeyRef: { name: "chug-t1-k1", key: k8sFabricSecretKey },
      },
    },
  ]);
  assert.deepEqual(g.fake.secrets(), [
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: "chug-t1-k1",
        labels: { "chug-ticket": "1", "chug-task": "1" },
        ownerReferences: [
          {
            apiVersion: "batch/v1",
            kind: "Job",
            name: "chug-t1-k1",
            uid: "uid-chug-t1-k1",
          },
        ],
      },
      type: "Opaque",
      stringData: { [k8sFabricSecretKey]: "author-material" },
    },
  ]);
  assert.deepEqual(groundSpawnRows(g.db), ["3:0"]);
});

test("a configured resolution fails the spawn closed: no grant or no material spawns nothing", async (t) => {
  const noRow = await ground(t, {
    credentials: { grant: undefined, files: {} },
  });
  await assert.rejects(
    noRow.fabric.spawnWorkTasks(emissionAt(3)),
    /no credential grant/,
  );

  const noFile = await ground(t, {
    credentials: { grant: groundGrant, files: {} },
  });
  await assert.rejects(
    noFile.fabric.spawnWorkTasks(emissionAt(3)),
    /author\.key/,
  );

  for (const g of [noRow, noFile]) {
    assert.equal(groundPosts(g.fake), 0);
    assert.equal(g.fake.secrets().length, 0);
    assert.deepEqual(groundSpawnRows(g.db), []);
  }
});

test("a catalog naming the credential variable is refused at construction under a configured resolution", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-k8sfabric-"));
  const db = new DatabaseSync(":memory:");
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const catalogPath = join(dir, "catalog.json");
  const shadowed = {
    build: {
      ...groundCatalog.build,
      work: {
        ...groundCatalog.build.work,
        env: { [k8sFabricApiKeyEnv]: "a-shared-key" },
      },
    },
  };
  writeFileSync(catalogPath, JSON.stringify(shadowed));
  assert.throws(
    () =>
      k8sFabric({
        config: groundConfig,
        load: () => Promise.resolve({ parsed: "Ok", value: [] }),
        annexes: () => Promise.resolve(new Map()),
        credentials: groundCredentials(dir, { grant: groundGrant, files: {} }),
        mint: () => "tag",
        db,
        catalogPath,
        api: { base: "http://127.0.0.1:9", namespace: "chuggy" },
        completionUrl: "http://desk.test/",
      }),
    /ANTHROPIC_API_KEY/,
  );
});

test("a re-served credentialed spawn re-creates idempotently: the Job and its Secret both absorb", async (t) => {
  const g = await ground(t, {
    credentials: { grant: groundGrant, files: { "author.key": "material" } },
  });
  await g.fabric.spawnWorkTasks(emissionAt(3));
  g.db.prepare("DELETE FROM fabric_spawns").run();

  await g.fabric.spawnWorkTasks(emissionAt(3));
  assert.equal(g.fake.created.length, 1);
  assert.equal(g.fake.secrets().length, 1);
  assert.ok(
    g.fake.log.some(
      (line) => line.startsWith("GET ") && line.includes("/jobs/chug-t1-k1"),
    ),
  );
  assert.deepEqual(groundSpawnRows(g.db), ["3:0"]);
});

/** Two tickets arrive, and each is released and dispatched in turn. */
const twoAuthorsHistory: readonly Cmd[] = [
  jArrive([], groundProgram, asProjectId(1), wNone),
  jArrive([], groundProgram, asProjectId(1), wNone),
  jRelease(id(1)),
  jDispatch(id(1)),
  jRelease(id(2)),
  jDispatch(id(2)),
];

test("two users' tickets run under different keys, resolved from their registered grants", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-k8sfabric-"));
  const fake = await fakeKubernetesApi();
  const db = new DatabaseSync(":memory:");
  t.after(async () => {
    await fake.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const registry = registrySqlite(db);
  await registry.upsertCredentials("alice-sub", {
    apiKeyRef: "alice.key",
    gitName: "Alice",
    gitEmail: "alice@example.test",
  });
  await registry.upsertCredentials("bob-sub", {
    apiKeyRef: "bob.key",
    gitName: "Bob",
    gitEmail: "bob@example.test",
  });
  const annex = { title: "t", brief: "b", taskType: "build" };
  await registry.writeAnnex(id(1), { ...annex, author: "alice-sub" });
  await registry.writeAnnex(id(2), { ...annex, author: "bob-sub" });
  const secretsDirectory = join(dir, "secrets");
  mkdirSync(secretsDirectory);
  writeFileSync(join(secretsDirectory, "alice.key"), "alice-material\n");
  writeFileSync(join(secretsDirectory, "bob.key"), "bob-material\n");
  const catalogPath = join(dir, "catalog.json");
  writeFileSync(catalogPath, JSON.stringify(groundCatalog));
  const journal = groundJournal(twoAuthorsHistory);
  const fabric = k8sFabric({
    config: groundConfig,
    load: () => Promise.resolve({ parsed: "Ok", value: journal }),
    annexes: () => registry.annexes(),
    credentials: {
      credentialsFor: (ticket) => registry.credentialsFor(ticket),
      source: secretFileSource(secretsDirectory),
    },
    mint: (ticket, taskId) => `tag-${String(ticket)}-${String(taskId)}`,
    db,
    catalogPath,
    api: { base: fake.base, namespace: "chuggy" },
    completionUrl: "http://desk.test/",
  });

  await fabric.spawnWorkTasks({ seq: 4, effectIndex: 0, ticket: id(1) });
  await fabric.spawnWorkTasks({ seq: 6, effectIndex: 0, ticket: id(2) });
  assert.deepEqual(
    fake.secrets().map((held) => [held.metadata.name, held.stringData]),
    [
      ["chug-t1-k1", { [k8sFabricSecretKey]: "alice-material" }],
      ["chug-t2-k1", { [k8sFabricSecretKey]: "bob-material" }],
    ],
  );
});
