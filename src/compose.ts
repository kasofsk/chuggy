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
 * against the real desk and the stub fabric, boot, and serve the face over
 * HTTP. The three real adapters never meet — the desk's own store, the
 * registry and the HTTP face are constructed here and handed to each other as
 * values, which is what keeps `no-adapter-sees-another` a fact about the graph
 * rather than an intention.
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
import type { Identity } from "./adapters/httpApi/identity.ts";
import { httpApi } from "./adapters/httpApi/server.ts";
import { registrySqlite } from "./adapters/registrySqlite.ts";
import { sqliteJournal } from "./adapters/sqliteJournal.ts";
import { wrapUpStub } from "./adapters/wrapUpStub.ts";
import type { Config } from "./domain/config.ts";
import { budgeted, reworkBudgetOf } from "./domain/pricing.ts";
import type { Executor } from "./interpreter/executor.ts";
import type { DeskPort } from "./interpreter/ports.ts";
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

/** Wires the executor: the SQLite journal and the real desk on the one database, and the stub fabric and performer. */
function compose(config: Config, db: DatabaseSync, desk: DeskPort): Executor {
  return {
    config,
    store: sqliteJournal(db),
    ports: { fabric: fabricStub(), desk, wrapUp: wrapUpStub() },
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
const listenPort = composePort("CHUGGY_PORT");

const database = new DatabaseSync(journalPath);
const desk = deskEvents(database);
const registry = registrySqlite(database);
const executor = compose(deployment, database, desk);
const booted = await boot(executor);
const driven = drive(executor, composeWakeAfter, booted);

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
  identity,
  oauthClientId,
}).listen(listenPort);

console.log(
  `chuggy: journal ${journalPath} replayed ${String(booted.journal.length)} decision(s); the desk is serving on port ${String(listenPort)}`,
);
