/**
 * The composition root and the process entrypoint: the only file that
 * constructs an adapter, the only one that holds ambient capability outside
 * `src/adapters/`, and the only one nothing else may import.
 *
 * Both graph halves are enforced in `.dependency-cruiser.cjs` and neither is
 * a style preference. Constructing an adapter anywhere else would put a
 * choice of deployment inside a layer that must not have one; being imported
 * by anything would make this a module in the graph rather than its root,
 * and the moment it is in the graph the layers below can reach an adapter
 * through it. A start script names it instead, and a script is not an edge
 * in the module graph.
 *
 * Running it is the deployment: open the one database, wire the executor
 * against the real desk and whichever fabric and wrap-up performer the
 * environment names — Kubernetes Jobs and git against configured endpoints,
 * or the recording stubs without them — then boot, and serve the face over
 * HTTP. The real adapters never meet: each is constructed here and handed the
 * others as values, which is what keeps `no-adapter-sees-another` a fact
 * about the graph rather than an intention.
 *
 * IDENTITY IS CONFIGURED, NOT COMPILED IN. The issuer, the audience and the
 * key source arrive from the environment and are handed to the face as one
 * value, so a suite verifies against a key pair it generated and this
 * deployment verifies against Google's published keys, through the same code.
 * A missing client id is a start-up failure rather than a face that refuses
 * every caller: a desk that can verify nobody serves nobody, and that is a
 * precondition for serving at all rather than an answer to one request.
 */

import { DatabaseSync } from "node:sqlite";

import { createRemoteJWKSet } from "jose";

import { deskEvents } from "./adapters/deskEvents.ts";
import { fabricStub } from "./adapters/fabricStub.ts";
import { gitWrapUp, type GitWrapUp } from "./adapters/gitWrapUp/gitWrapUp.ts";
import { httpApiArtifacts } from "./adapters/httpApi/artifacts.ts";
import type { Identity } from "./adapters/httpApi/identity.ts";
import { httpApiJobTokenMint } from "./adapters/httpApi/jobToken.ts";
import { httpApi } from "./adapters/httpApi/server.ts";
import { k8sFabric, type K8sFabric } from "./adapters/k8sFabric/k8sFabric.ts";
import { registrySqlite } from "./adapters/registrySqlite.ts";
import { sqliteJournal } from "./adapters/sqliteJournal.ts";
import { wrapUpStub } from "./adapters/wrapUpStub.ts";
import type { Config } from "./domain/config.ts";
import { budgeted, reworkBudgetOf } from "./domain/pricing.ts";
import type { Executor } from "./interpreter/executor.ts";
import type { JobTokenMint } from "./interpreter/jobToken.ts";
import type {
  DeskPort,
  FabricPort,
  JournalStore,
  WrapUpPort,
} from "./interpreter/ports.ts";
import type { Registry } from "./interpreter/registry.ts";
import { boot } from "./runtime/boot.ts";
import { drive, type WakeAfter } from "./runtime/drive.ts";

/** The deployment's constants. The ticket bound outlives the store so it is set well ahead of the fleet; `nTasks` is the work fan-out every dispatch and rework spawns, fixed at one task per cycle (doc 007). */
const deployment: Config = {
  nTickets: 64,
  nTasks: 1,
  reworkPolicy: reworkBudgetOf(2),
  gas: 8,
  wrapUpPricing: budgeted(2),
  opRetryPricing: "RetryCharged",
  maxStages: 4,
  nProjects: 8,
};

/** The one issuer this deployment admits a token from. */
const composeIssuer = "https://accounts.google.com";

/** Where that issuer publishes the keys a token is verified against. */
const composeJwksUri = "https://www.googleapis.com/oauth2/v3/certs";

/** The port the desk listens on when the environment names none. */
const composePortDefault = 8080;

/** The one deployment choice read from the command line: where the journal lives, defaulting beside the process. */
function composeJournalPath(argv: readonly string[]): string {
  return argv[2] ?? "chuggy.sqlite";
}

/** A named environment value, or nothing when it is unset or empty. */
function composeSetting(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/** A setting the desk cannot invent for itself; its absence ends start-up rather than every request. */
function composeRequired(name: string, needed: string): string {
  const value = composeSetting(name);
  if (value === undefined) {
    throw new Error(`compose: ${name} is not set, and ${needed}`);
  }
  return value;
}

/** The port to listen on, ending start-up on a setting that is not one rather than listening somewhere nobody named. */
function composePort(name: string): number {
  const value = composeSetting(name);
  if (value === undefined) return composePortDefault;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`compose: ${name} is ${value}, which is not a port`);
  }
  return port;
}

/**
 * Re-asserts the deployment's operator on every boot, keeping whatever display
 * name has been set since. Nothing else re-asserts it: `/api/users` writes what
 * it is posted and forbids nobody from posting this subject, so a one-operator
 * deployment that demoted its only operator would have no way back.
 */
async function composeBootstrapOperator(
  registry: Registry,
  subject: string,
): Promise<void> {
  const held = await registry.userBySubject(subject);
  await registry.upsertUser(subject, held?.display ?? subject, true);
}

/** The real timer behind the runtime's one capability; a wake that fails ends the process only under Node's default unhandled-rejection policy, which this deployment leaves in place. */
const composeWakeAfter: WakeAfter = (delayMs, wake) => {
  setTimeout(() => void wake(), delayMs);
};

/** The machine's committer identity when the environment names none. */
const composeGitIdentityDefault = { name: "chuggy", email: "chuggy@localhost" };

/**
 * The wrap-up performer this deployment runs: git against the configured
 * remote, or nothing — the caller falls back to the stub — so a deployment
 * with no repository keeps working unchanged.
 */
function composeWrapUp(
  store: JournalStore,
  db: DatabaseSync,
): GitWrapUp | undefined {
  const remote = composeSetting("CHUGGY_GIT_REMOTE");
  if (remote === undefined) return undefined;
  return gitWrapUp({
    config: deployment,
    store,
    db,
    remote,
    scratchDirectory: composeRequired(
      "CHUGGY_GIT_SCRATCH_DIR",
      "a scratch mirror needs a volume to live on",
    ),
    identity: {
      name:
        composeSetting("CHUGGY_GIT_IDENT_NAME") ??
        composeGitIdentityDefault.name,
      email:
        composeSetting("CHUGGY_GIT_IDENT_EMAIL") ??
        composeGitIdentityDefault.email,
    },
  });
}

/**
 * The fabric this deployment runs: Kubernetes Jobs against the configured API,
 * or nothing — the caller falls back to the stub — so a deployment with no
 * cluster keeps working unchanged.
 */
function composeFabric(
  store: JournalStore,
  registry: Registry,
  mint: JobTokenMint,
  db: DatabaseSync,
): K8sFabric | undefined {
  const apiBase = composeSetting("CHUGGY_FABRIC_API_BASE");
  if (apiBase === undefined) return undefined;
  const bearerTokenPath = composeSetting("CHUGGY_FABRIC_TOKEN_FILE");
  return k8sFabric({
    config: deployment,
    load: () => store.load(),
    annexes: () => registry.annexes(),
    mint,
    db,
    catalogPath: composeRequired(
      "CHUGGY_FABRIC_CATALOG",
      "a fabric with no task-type catalog can run nothing",
    ),
    api: {
      base: apiBase,
      namespace: composeSetting("CHUGGY_FABRIC_NAMESPACE") ?? "default",
      bearerTokenPath,
    },
    completionUrl: composeRequired(
      "CHUGGY_COMPLETION_URL",
      "a job that cannot reach the completion route can declare nothing",
    ),
  });
}

/** Wires the executor: the journal store and the real desk on the one database, and the handed fabric and performer. */
function compose(
  config: Config,
  store: JournalStore,
  desk: DeskPort,
  wrapUp: WrapUpPort,
  fabric: FabricPort,
): Executor {
  return {
    config,
    store,
    ports: { fabric, desk, wrapUp },
  };
}

const journalPath = composeJournalPath(process.argv);
const oauthClientId = composeRequired(
  "CHUGGY_OAUTH_CLIENT_ID",
  "a desk that can verify no token serves nobody",
);
const adminSubject = composeRequired(
  "CHUGGY_ADMIN_SUBJECT",
  "a registry with no operator in it can never gain one",
);
const jobSecret = composeRequired(
  "CHUGGY_JOB_SECRET",
  "a desk that cannot verify a job's token accepts no completion, and the fabric has no other way back",
);
const listenPort = composePort("CHUGGY_PORT");

const database = new DatabaseSync(journalPath);
const store = sqliteJournal(database);
const desk = deskEvents(database);
const registry = registrySqlite(database);
const artifacts = httpApiArtifacts(database);
const performer = composeWrapUp(store, database);
const fabric = composeFabric(
  store,
  registry,
  httpApiJobTokenMint(jobSecret),
  database,
);
const executor = compose(
  deployment,
  store,
  desk,
  performer ?? wrapUpStub(),
  fabric ?? fabricStub(),
);
const booted = await boot(executor);
const driven = drive(executor, composeWakeAfter, booted);
performer?.bindInbound(driven);
fabric?.bindInbound(driven);

await composeBootstrapOperator(registry, adminSubject);

const identity: Identity = {
  keys: createRemoteJWKSet(new URL(composeJwksUri)),
  issuer: composeSetting("CHUGGY_ISSUER") ?? composeIssuer,
  audience: oauthClientId,
};

httpApi({
  config: deployment,
  inbound: driven,
  core: driven.core,
  registry,
  deskLog: desk,
  artifacts,
  identity,
  oauthClientId,
  jobSecret,
}).listen(listenPort);

console.log(
  `chuggy: journal ${journalPath} replayed ${String(booted.journal.length)} decision(s); the desk is serving on port ${String(listenPort)}`,
);
