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
 * against the stub world, boot, and hand the inbound face out. The face's
 * only holder today is this module's own export, which is also what keeps
 * the compiler checking that every adapter still satisfies its port.
 */

import { DatabaseSync } from "node:sqlite";

import { deskStub } from "./adapters/deskStub.ts";
import { fabricStub } from "./adapters/fabricStub.ts";
import { sqliteJournal } from "./adapters/sqliteJournal.ts";
import { wrapUpStub } from "./adapters/wrapUpStub.ts";
import type { Config } from "./domain/config.ts";
import { budgeted, reworkBudgetOf } from "./domain/pricing.ts";
import type { Executor } from "./interpreter/executor.ts";
import type { Inbound } from "./interpreter/inbound.ts";
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

/** The one deployment choice read from outside: where the journal lives, defaulting beside the process. */
function composeJournalPath(argv: readonly string[]): string {
  return argv[2] ?? "chuggy.sqlite";
}

/** The real timer behind the runtime's one capability; a wake that fails ends the process only under Node's default unhandled-rejection policy, which this deployment leaves in place. */
const composeWakeAfter: WakeAfter = (delayMs, wake) => {
  setTimeout(() => void wake(), delayMs);
};

/** Wires the executor: the SQLite journal at the given path, and the stub world. */
function compose(config: Config, journalPath: string): Executor {
  return {
    config,
    store: sqliteJournal(new DatabaseSync(journalPath)),
    ports: { fabric: fabricStub(), desk: deskStub(), wrapUp: wrapUpStub() },
  };
}

const journalPath = composeJournalPath(process.argv);
const executor = compose(deployment, journalPath);
const booted = await boot(executor);

/** The face the adapters will be handed; until one takes it, the export is its holder. */
export const inbound: Inbound = drive(executor, composeWakeAfter, booted);

console.log(
  `chuggy: journal ${journalPath} replayed ${String(booted.journal.length)} decision(s); the inbound face is ready`,
);
