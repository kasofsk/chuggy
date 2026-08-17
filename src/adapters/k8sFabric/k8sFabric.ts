/**
 * The fabric over Kubernetes Jobs: an adapter answering the fabric port and
 * nothing more — PLATFORM CAPTURE in `model/refinement.qnt` is exactly the
 * claim that this substitution moves no core. It runs the paid work a decision
 * spawned, and decides nothing: one Job per task of the deciding entry's task
 * set, each bounded by the catalog's deadline and relaunch limit, each handed
 * a credential for its own completion and no other's.
 *
 * ABSORPTION IS THE NAME FIRST AND THE ROW SECOND. A re-delivered emission
 * collides into already-exists instead of a second fan-out, and the served row
 * is what outlives the objects. The row is written only AFTER every Job of the
 * fan-out exists: written before, a crash between row and spawn would leave a
 * served key over Jobs that never ran, and the short-circuit would hold that
 * loss forever — whereas a crash after the spawns just re-serves into 409s on
 * the way to writing the row it lost. The window that order leaves open is a
 * crash-then-collection faster than the boot re-drive, and the names cover it
 * until collection does.
 *
 * A DELIVERY IT CANNOT YET SERVE IS REFUSED BY THROWING — a journal read
 * failing, a ticket with no annex, a type the catalog lacks — so the cursor
 * holds and the row re-emits. Failing closed on a missing grant is the
 * authority split, applied at spawn. What no delivery could ever survive ends
 * construction instead: an unservable catalog, or a work fan-out the
 * evaluation install's mark-to-branch derivation cannot carry.
 *
 * THE CREDENTIAL NAMES THE SPAWNED PAIR AND NOTHING ELSE. The mint is called
 * once per Job, on exactly the ticket and task that Job runs: a token for a
 * planned or future id would let a compromised sibling pre-write another
 * task's artifact row.
 */

import type { DatabaseSync } from "node:sqlite";

import { assertNever } from "../../domain/assertNever.ts";
import type { Config } from "../../domain/config.ts";
import type { TicketId } from "../../domain/ids.ts";
import type { Task, TaskKind } from "../../domain/task.ts";
import type { Ticket } from "../../domain/ticket.ts";
import { workBranch } from "../../interpreter/artifact.ts";
import type { Inbound } from "../../interpreter/inbound.ts";
import type { JobTokenMint } from "../../interpreter/jobToken.ts";
import {
  emissionKey,
  type Emission,
  type FabricPort,
  type JournalStore,
} from "../../interpreter/ports.ts";
import type { Registry } from "../../interpreter/registry.ts";
import { catalogLoad, type Catalog, type CatalogTaskType } from "./catalog.ts";
import {
  fabricApiCreateJob,
  fabricApiDeleteJobsByLabel,
  type FabricApiJob,
  type FabricApiJobEnv,
  type FabricApiOptions,
} from "./client.ts";
import { fabricJobName, fabricLabels, fabricTicketSelector } from "./names.ts";
import { fabricProducedBranchOf, fabricTicketAt } from "./resolve.ts";
import { fabricSpawns, type FabricSpawns } from "./spawns.ts";
import { fabricWatchStart } from "./watch.ts";

/** Everything the fabric is composed with; the reads arrive as values, never as adapters. */
export interface K8sFabricOptions {
  readonly config: Config;
  readonly load: JournalStore["load"];
  readonly annexes: Registry["annexes"];
  readonly mint: JobTokenMint;
  readonly db: DatabaseSync;
  readonly catalogPath: string;
  readonly api: FabricApiOptions;
  readonly completionUrl: string;
  readonly succeededGraceMs?: number | undefined;
  readonly watchRetryDelaysMs?: readonly number[] | undefined;
  readonly watchSignal?: AbortSignal | undefined;
}

/** The port, plus the one binding construction cannot make: the drive does not exist yet when boot re-delivers. */
export interface K8sFabric extends FabricPort {
  readonly bindInbound: (inbound: Inbound) => void;
}

/** The watch's reconnect ladder a deployment gets unless it hands its own. */
export const k8sFabricWatchRetryDelaysMs: readonly number[] = [
  1000, 5000, 25000,
];

/** How long a succeeded Job may stay undeclared before the watch fails it. */
export const k8sFabricSucceededGraceMsDefault = 60000;

/** What the fabric owns across deliveries: the parsed catalog and the served-key table. */
interface K8sFabricState {
  readonly options: K8sFabricOptions;
  readonly catalog: Catalog;
  readonly spawns: FabricSpawns;
}

/** The fabric over its options, refusing at construction what no delivery could survive. */
export function k8sFabric(options: K8sFabricOptions): K8sFabric {
  if (options.config.nTasks !== 1) {
    throw new Error(
      "k8sFabric: the mark-to-branch derivation needs the one-task work set; nTasks is not 1",
    );
  }
  const own: K8sFabricState = {
    options,
    catalog: catalogLoad(options.catalogPath),
    spawns: fabricSpawns(options.db),
  };
  let alreadyBound = false;
  return {
    spawnWorkTasks: (emission) => k8sFabricSpawn(own, emission),
    spawnEvalTasks: (emission) => k8sFabricSpawn(own, emission),
    cancelTasks: (emission) =>
      fabricApiDeleteJobsByLabel(
        options.api,
        fabricTicketSelector(emission.ticket),
      ),
    bindInbound: (inbound) => {
      if (alreadyBound) {
        throw new Error("k8sFabric: the inbound face is already bound");
      }
      alreadyBound = true;
      fabricWatchStart({
        api: options.api,
        inbound,
        succeededGraceMs:
          options.succeededGraceMs ?? k8sFabricSucceededGraceMsDefault,
        retryDelaysMs:
          options.watchRetryDelaysMs ?? k8sFabricWatchRetryDelaysMs,
        signal: options.watchSignal,
      });
    },
  };
}

/** One delivery: short-circuit a served key, resolve the set, spawn into name absorption, then record. */
async function k8sFabricSpawn(
  own: K8sFabricState,
  emission: Emission,
): Promise<void> {
  const key = emissionKey(emission);
  if (own.spawns.served(key)) return;
  const loaded = await own.options.load();
  if (loaded.parsed === "Refused") {
    throw new Error(
      `k8sFabric: the stored journal did not parse — ${loaded.why}`,
    );
  }
  const ticket = fabricTicketAt(own.options.config, loaded.value, emission);
  const taskType = await k8sFabricTaskTypeOf(own, emission.ticket);
  for (const task of ticket.tasks) {
    await fabricApiCreateJob(
      own.options.api,
      k8sFabricJob(own, emission, ticket, taskType, task),
    );
  }
  own.spawns.record(key);
}

/** The type the ticket's annex names, resolved against the catalog; either absence refuses the delivery. */
async function k8sFabricTaskTypeOf(
  own: K8sFabricState,
  ticket: TicketId,
): Promise<CatalogTaskType> {
  const annex = (await own.options.annexes()).get(ticket);
  if (annex === undefined) {
    throw new Error(
      `k8sFabric: ticket ${String(ticket)} has no annex to name its task type`,
    );
  }
  const taskType = own.catalog[annex.taskType];
  if (taskType === undefined) {
    throw new Error(
      `k8sFabric: the catalog holds no type ${annex.taskType}, which ticket ${String(ticket)} names`,
    );
  }
  return taskType;
}

/** The half of the type a task's kind runs; evaluation adds no environment of its own. */
function k8sFabricHalf(
  taskType: CatalogTaskType,
  kind: TaskKind,
): CatalogTaskType["work"] {
  switch (kind.kind) {
    case "TKWork":
      return taskType.work;
    case "TKEval":
      return { ...taskType.eval, env: {} };
    default:
      return assertNever(kind);
  }
}

/** The branch env a task is told: its own to push for work, the produced one to install for evaluation. */
function k8sFabricBranchOf(
  emission: Emission,
  ticket: Ticket,
  task: Task,
): string {
  switch (task.kind.kind) {
    case "TKWork":
      return workBranch(emission.ticket, task.id);
    case "TKEval":
      return fabricProducedBranchOf(emission, ticket);
    default:
      return assertNever(task.kind);
  }
}

/** One task's Job: the catalog's half by kind, the axioms' bounds, and the credential for this pair alone. */
function k8sFabricJob(
  own: K8sFabricState,
  emission: Emission,
  ticket: Ticket,
  taskType: CatalogTaskType,
  task: Task,
): FabricApiJob {
  const half = k8sFabricHalf(taskType, task.kind);
  const labels = fabricLabels(emission.ticket, task.id);
  const env: readonly FabricApiJobEnv[] = [
    ...Object.entries(half.env).map(([name, value]) => ({ name, value })),
    { name: "CHUG_TICKET", value: String(emission.ticket) },
    { name: "CHUG_TASK", value: String(task.id) },
    { name: "CHUG_COMPLETION_URL", value: own.options.completionUrl },
    {
      name: "CHUG_COMPLETION_TOKEN",
      value: own.options.mint(emission.ticket, task.id),
    },
    {
      name: "CHUG_WORK_BRANCH",
      value: k8sFabricBranchOf(emission, ticket, task),
    },
  ];
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: fabricJobName(emission.ticket, task.id), labels },
    spec: {
      activeDeadlineSeconds: taskType.activeDeadlineSeconds,
      backoffLimit: taskType.backoffLimit,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "task",
              image: half.image,
              command: half.command,
              env,
              resources: taskType.resources,
            },
          ],
        },
      },
    },
  };
}
