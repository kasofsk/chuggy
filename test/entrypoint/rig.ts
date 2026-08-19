/**
 * The rig the process-level cases stand on: it boots the real entrypoint
 * (`src/compose.ts`) as a child against a fake Jobs API, a local JWKS server,
 * a file secret source and a bare git remote, drives the desk over HTTP as an
 * operator, plays the worker by running what the fabric spawned as a local
 * child process, and reads the aftermath from outside — the journal through
 * the wire parse, the adapters' own tables, and the remote itself. Nothing
 * here imports the composition root: the rig runs it, kills it, and reads
 * what it left, which is the whole point of asserting at this level.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TestContext } from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  journalLegalOn,
  replayCore,
  type Entry,
} from "../../src/actor/journal.ts";
import type { Config } from "../../src/domain/config.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { budgeted, reworkBudgetOf } from "../../src/domain/pricing.ts";
import { parseJournal } from "../../src/interpreter/wire.ts";
import {
  fakeKubernetesApi,
  type FakeKubernetesApi,
  type FakeStoredJob,
} from "../adapters/fakeKubernetesApi.ts";

const rigRoot = join(import.meta.dirname, "..", "..");

/** The composition root's own deployment constants, restated because nothing may import the root; a drift fails `journalLegalOn` loudly rather than silently. */
export const rigDeployment: Config = {
  nTickets: 64,
  nTasks: 1,
  reworkPolicy: reworkBudgetOf(2),
  gas: 8,
  wrapUpPricing: budgeted(2),
  opRetryPricing: "RetryCharged",
  maxStages: 4,
  nProjects: 8,
};

const rigTriesMax = 400;

/** Polls a read, bounded, so a wedged child fails the case rather than the runner. */
export async function rigUntil(
  read: () => boolean,
  what: string,
): Promise<void> {
  for (let tries = 0; tries < rigTriesMax; tries++) {
    if (read()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`waited out ${what}`);
}

/** The identity the rig verifies the dispatcher against: a key pair this process generated, served as a JWKS the entrypoint is pointed at. */
export interface RigIdentity {
  readonly jwksUri: string;
  readonly issuer: string;
  readonly audience: string;
  readonly tokenFor: (subject: string) => Promise<string>;
  readonly close: () => Promise<void>;
}

export async function rigIdentity(): Promise<RigIdentity> {
  const algorithm = "RS256";
  const issuer = "https://rig.test";
  const audience = "chuggy-rig";
  const pair = await generateKeyPair(algorithm, { extractable: true });
  const jwks = JSON.stringify({
    keys: [
      { ...(await exportJWK(pair.publicKey)), alg: algorithm, kid: "rig" },
    ],
  });
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(jwks);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
  const port = (server.address() as AddressInfo).port;
  return {
    jwksUri: `http://127.0.0.1:${String(port)}/`,
    issuer,
    audience,
    tokenFor: (subject) =>
      new SignJWT({ iss: issuer, aud: audience, sub: subject })
        .setProtectedHeader({ alg: algorithm, kid: "rig" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(pair.privateKey),
    close,
  };
}

/** A port the operating system just proved free, taken so both boots of one case serve the completion URL the first boot's Jobs were told. */
export function rigFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createTcpServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

export function rigGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

/** A bare remote holding one commit on main, seeded through a throwaway clone. */
export function rigBareRemote(dir: string): string {
  const remote = join(dir, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  const seed = join(dir, "seed");
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  writeFileSync(join(seed, "base.txt"), "base\n");
  rigGit(seed, "add", "base.txt");
  rigGit(
    seed,
    "-c",
    "user.name=rig",
    "-c",
    "user.email=rig@example.test",
    "commit",
    "-q",
    "-m",
    "base",
  );
  rigGit(seed, "push", "-q", remote, "main:main");
  return remote;
}

/** A hold over the next push that moves the remote's main: `marker` appears carrying the pushed sha once the refs have updated, and the push does not answer until released. */
export interface RigPushHold {
  readonly marker: string;
  readonly release: () => void;
}

export function rigHoldMainPush(remote: string, dir: string): RigPushHold {
  const marker = join(dir, "push-held");
  const released = join(dir, "push-release");
  const hook = [
    "#!/bin/sh",
    "while read old new ref; do",
    '  if [ "$ref" = "refs/heads/main" ]; then',
    `    printf '%s\\n' "$new" > '${marker}'`,
    "    n=0",
    `    while [ ! -e '${released}' ] && [ "$n" -lt 600 ]; do`,
    "      n=$((n + 1))",
    "      sleep 0.1",
    "    done",
    "  fi",
    "done",
    "",
  ].join("\n");
  writeFileSync(join(remote, "hooks", "post-receive"), hook, { mode: 0o755 });
  return {
    marker,
    release: () => {
      writeFileSync(released, "released\n");
    },
  };
}

/** The completion a worker curls, and the git work a `merge`-typed ticket's worker really does before it. */
export interface RigWorkers {
  readonly declare: string;
  readonly gitWork: string;
}

export function rigWorkers(dir: string): RigWorkers {
  const declare = join(dir, "declare.sh");
  writeFileSync(
    declare,
    [
      "#!/bin/sh",
      "set -eu",
      "curl -fsS -o /dev/null -X POST \\",
      '  -H "authorization: Bearer $CHUG_COMPLETION_TOKEN" \\',
      '  -H "content-type: application/json" \\',
      '  -d "$1" \\',
      '  "${CHUG_COMPLETION_URL}internal/tasks/${CHUG_TICKET}/${CHUG_TASK}/completion"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const gitWork = join(dir, "gitwork.sh");
  writeFileSync(
    gitWork,
    [
      "#!/bin/sh",
      "set -eu",
      'work="$(mktemp -d)/work"',
      'git clone -q "$RIG_REMOTE" "$work"',
      'cd "$work"',
      'git checkout -q -b "$CHUG_WORK_BRANCH"',
      'echo "work" > work.txt',
      "git add work.txt",
      "git -c user.name=worker -c user.email=worker@example.test \\",
      '  commit -q -m "the work"',
      'git push -q origin "HEAD:$CHUG_WORK_BRANCH"',
      "exec /bin/sh \\",
      `  '${declare}' \\`,
      '  "{\\"verdict\\":\\"VPass\\",\\"artifact\\":{\\"body\\":\\"BGitRef\\",\\"branch\\":\\"$CHUG_WORK_BRANCH\\"}}"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { declare, gitWork };
}

const rigDeclareNothing = '{"verdict":"VPass","artifact":{"body":"BNone"}}';

/** One catalog type over the handed work command, with the curl declaration as its evaluation. */
function rigCatalogType(
  work: readonly string[],
  workEnv: Readonly<Record<string, string>>,
  workers: RigWorkers,
): unknown {
  return {
    work: { image: "rig-image", command: work, env: workEnv },
    eval: {
      image: "rig-image",
      command: ["/bin/sh", workers.declare, rigDeclareNothing],
    },
    resources: {
      requests: { cpu: "100m", memory: "64Mi" },
      limits: { cpu: "1", memory: "256Mi" },
    },
    activeDeadlineSeconds: 600,
    backoffLimit: 0,
  };
}

/** The rig's catalog: `code` declares at once, `merge` really commits and pushes its branch first. */
export function rigCatalog(
  dir: string,
  workers: RigWorkers,
  remote: string,
): string {
  const path = join(dir, "catalog.json");
  writeFileSync(
    path,
    JSON.stringify({
      code: rigCatalogType(
        ["/bin/sh", workers.declare, rigDeclareNothing],
        {},
        workers,
      ),
      merge: rigCatalogType(
        ["/bin/sh", workers.gitWork],
        { RIG_REMOTE: remote },
        workers,
      ),
    }),
  );
  return path;
}

/** What one boot of the entrypoint is told, assembled once so a restart is the same deployment. */
export function rigEnv(draw: {
  readonly port: number;
  readonly fakeBase: string;
  readonly identity: RigIdentity;
  readonly catalogPath: string;
  readonly remote: string;
  readonly secretsDir: string;
  readonly scratchDir: string;
}): Readonly<Record<string, string>> {
  return {
    CHUGGY_OAUTH_CLIENT_ID: draw.identity.audience,
    CHUGGY_ADMIN_SUBJECT: "operator",
    CHUGGY_JOB_SECRET: "rig-job-secret",
    CHUGGY_PORT: String(draw.port),
    CHUGGY_ISSUER: draw.identity.issuer,
    CHUGGY_JWKS_URI: draw.identity.jwksUri,
    CHUGGY_FABRIC_API_BASE: draw.fakeBase,
    CHUGGY_FABRIC_CATALOG: draw.catalogPath,
    CHUGGY_COMPLETION_URL: `http://127.0.0.1:${String(draw.port)}/`,
    CHUGGY_SECRETS_DIR: draw.secretsDir,
    CHUGGY_GIT_REMOTE: draw.remote,
    CHUGGY_GIT_SCRATCH_DIR: draw.scratchDir,
  };
}

/** One case's whole ground: the temp world, the fake API, the identity, and the environment both boots share. */
export interface RigGround {
  readonly dir: string;
  readonly dbPath: string;
  readonly base: string;
  readonly remote: string;
  readonly fake: FakeKubernetesApi;
  readonly identity: RigIdentity;
  readonly env: Readonly<Record<string, string>>;
}

export async function rigGround(t: TestContext): Promise<RigGround> {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-rig-"));
  const fake = await fakeKubernetesApi();
  t.after(async () => {
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const identity = await rigIdentity();
  t.after(identity.close);
  const port = await rigFreePort();
  const remote = rigBareRemote(dir);
  const secretsDir = join(dir, "secrets");
  mkdirSync(secretsDir);
  writeFileSync(join(secretsDir, "author.key"), "rig-material\n");
  const env = rigEnv({
    port,
    fakeBase: fake.base,
    identity,
    catalogPath: rigCatalog(dir, rigWorkers(dir), remote),
    remote,
    secretsDir,
    scratchDir: join(dir, "scratch.git"),
  });
  return {
    dir,
    dbPath: join(dir, "chuggy.sqlite"),
    base: `http://127.0.0.1:${String(port)}`,
    remote,
    fake,
    identity,
    env,
  };
}

/** One running dispatcher child, killable mid-anything. */
export interface RigRun {
  readonly child: ChildProcess;
  readonly exited: Promise<number | null>;
  readonly output: () => string;
}

export async function rigServe(g: RigGround): Promise<RigRun> {
  const child = spawn(process.execPath, ["src/compose.ts", g.dbPath], {
    cwd: rigRoot,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      ...g.env,
    },
  });
  const held: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => held.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => held.push(chunk));
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
  });
  const run: RigRun = {
    child,
    exited,
    output: () => Buffer.concat(held).toString("utf8"),
  };
  try {
    await rigUntil(
      () =>
        run.output().includes("the desk is serving") || child.exitCode !== null,
      "the dispatcher to serve",
    );
  } catch (failure) {
    /** A boot that wedged is killed here, so no failure path hands back — or strands — a live child. */
    await rigKill(run);
    throw failure;
  }
  if (child.exitCode !== null) {
    throw new Error(
      `the dispatcher exited instead of serving: ${run.output()}`,
    );
  }
  return run;
}

/** The crash itself; resolved only once the process is gone. */
export async function rigKill(run: RigRun): Promise<void> {
  run.child.kill("SIGKILL");
  await run.exited;
}

/** A caller of the booted desk: where it is, and the bearer it offers. */
export interface RigDesk {
  readonly base: string;
  readonly token: string;
}

export async function rigOperator(g: RigGround): Promise<RigDesk> {
  return { base: g.base, token: await g.identity.tokenFor("operator") };
}

export async function rigPost(
  desk: RigDesk,
  path: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const answer = await fetch(`${desk.base}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${desk.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await answer.text();
  if (answer.status !== 200) {
    throw new Error(`${path} answered ${String(answer.status)}: ${text}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export async function rigGet(
  desk: RigDesk,
  path: string,
): Promise<Record<string, unknown>> {
  const answer = await fetch(`${desk.base}${path}`, {
    headers: { authorization: `Bearer ${desk.token}` },
  });
  const text = await answer.text();
  if (answer.status !== 200) {
    throw new Error(`${path} answered ${String(answer.status)}: ${text}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** The operator's own credential grant, resolved by every spawn under the configured file source. */
export async function rigGrant(desk: RigDesk): Promise<void> {
  await rigPost(desk, "/api/users/credentials", {
    subject: "operator",
    apiKeyRef: "author.key",
    gitName: "Rig Author",
    gitEmail: "author@example.test",
  });
}

/** One authored ticket of the named type and wrap-up, answered with the id the machine grew. */
export async function rigArrive(
  desk: RigDesk,
  taskType: string,
  wrapUp: string,
): Promise<number> {
  const made = await rigPost(desk, "/api/tickets", {
    title: `a ${taskType} ticket`,
    brief: "driven by the rig",
    taskType,
    project: 1,
    wrapUp,
  });
  return Number(made["ticket"]);
}

/** The stored Job of the given name, once the fake holds it. */
export async function rigJob(
  fake: FakeKubernetesApi,
  name: string,
): Promise<FakeStoredJob> {
  await rigUntil(
    () => fake.jobs().some((job) => job.metadata.name === name),
    `the Job ${name}`,
  );
  const job = fake.jobs().find((held) => held.metadata.name === name);
  if (job === undefined) throw new Error(`the Job ${name} vanished`);
  return job;
}

/** Runs one spawned Job's command as a local child with the Job's own environment, secret references resolved against the fake API's store. */
export async function rigRunJob(
  fake: FakeKubernetesApi,
  job: FakeStoredJob,
): Promise<{ readonly code: number; readonly output: string }> {
  const [container] = job.spec.template.spec.containers;
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "",
  };
  for (const entry of container.env) {
    env[entry.name] =
      "value" in entry
        ? entry.value
        : await rigRunJobSecret(fake, entry.valueFrom.secretKeyRef);
  }
  const [argv0, ...argv] = container.command;
  if (argv0 === undefined) {
    throw new Error(`job ${job.metadata.name} carries no command`);
  }
  return new Promise((resolve, reject) => {
    const worker = spawn(argv0, argv, { env });
    /** The Job's own deadline, honored here the way the platform's axiom bound would be, so no worker await is unbounded. */
    const deadline = setTimeout(() => {
      worker.kill("SIGKILL");
    }, job.spec.activeDeadlineSeconds * 1000);
    deadline.unref();
    const held: Buffer[] = [];
    worker.stdout.on("data", (chunk: Buffer) => held.push(chunk));
    worker.stderr.on("data", (chunk: Buffer) => held.push(chunk));
    worker.on("error", reject);
    worker.on("exit", (code) => {
      clearTimeout(deadline);
      resolve({
        code: code ?? 1,
        output: Buffer.concat(held).toString("utf8"),
      });
    });
  });
}

async function rigRunJobSecret(
  fake: FakeKubernetesApi,
  ref: { readonly name: string; readonly key: string },
): Promise<string> {
  await rigUntil(
    () => fake.secrets().some((held) => held.metadata.name === ref.name),
    `the Secret ${ref.name}`,
  );
  const material = fake
    .secrets()
    .find((held) => held.metadata.name === ref.name)?.stringData[ref.key];
  if (material === undefined) {
    throw new Error(`the Secret ${ref.name} holds no ${ref.key}`);
  }
  return material;
}

function rigRead<Row>(dbPath: string, read: (db: DatabaseSync) => Row): Row {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/** The killed store's journal, read back through the wire parse and required legal under the deployment's config. */
export function rigJournal(dbPath: string): readonly Entry[] {
  const raw = rigRead(dbPath, (db) =>
    db
      .prepare("SELECT entry FROM journal ORDER BY seq")
      .all()
      .map((row) => JSON.parse(String(row["entry"])) as unknown),
  );
  const parsed = parseJournal(raw);
  if (parsed.parsed === "Refused") {
    throw new Error(`the stored journal did not parse: ${parsed.why}`);
  }
  if (!journalLegalOn(rigDeployment, parsed.value)) {
    throw new Error("the stored journal is not a legal history");
  }
  return parsed.value;
}

export function rigCursor(dbPath: string): number {
  return rigRead(dbPath, (db) =>
    Number(db.prepare("SELECT applied FROM cursor").get()?.["applied"] ?? 0),
  );
}

export function rigSpawnRows(dbPath: string): readonly string[] {
  return rigRead(dbPath, (db) =>
    db
      .prepare("SELECT emission_key FROM fabric_spawns ORDER BY emission_key")
      .all()
      .map((row) => String(row["emission_key"])),
  );
}

export function rigAttempts(
  dbPath: string,
): readonly { readonly outcome: string; readonly detail: string }[] {
  return rigRead(dbPath, (db) =>
    db
      .prepare("SELECT outcome, detail FROM wrapup_attempts ORDER BY rowid")
      .all()
      .map((row) => ({
        outcome: String(row["outcome"]),
        detail: String(row["detail"]),
      })),
  );
}

/** The phase the journal alone puts the ticket in, which is all a crash leaves. */
export function rigPhaseOf(entries: readonly Entry[], ticket: number): string {
  return ticketAt(replayCore(rigDeployment, entries), asTicketId(ticket)).phase;
}

/** The step labels the journal holds, in order. */
export function rigLabels(entries: readonly Entry[]): readonly string[] {
  return entries.map((entry) => entry.rec.label);
}

/** The fake's Job-collection creates alone, Secrets excluded, which is where absorption is counted. */
export function rigJobPosts(fake: FakeKubernetesApi): readonly string[] {
  return fake.log.filter(
    (line) => line.startsWith("POST ") && line.includes("/jobs"),
  );
}
