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
 *
 * THE USER-CREDENTIAL RESOLUTION READS CONFIGURATION ALONE — the registry's
 * grant row through the handed read, and the task-type catalog — so nothing a
 * work task writes can influence which credential reaches a job, and with a
 * resolution configured an author with no stored grant or no material fails
 * the spawn closed: the delivery throws before anything is created, and the
 * cursor holds. The material lands as a Secret named for the Job and owned by
 * it, so collecting the Job collects the material. The Job is created first
 * because the ownerReference needs its uid; in the window before its Secret
 * lands the pod merely waits on the reference, and a crash inside it is
 * re-served into 409s that finish the pair.
 */

import type { DatabaseSync } from "node:sqlite";

import { assertNever } from "../../domain/assertNever.ts";
import type { Config } from "../../domain/config.ts";
import type { TaskId, TicketId } from "../../domain/ids.ts";
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
import type { SecretSource } from "../../interpreter/secretSource.ts";
import { catalogLoad, type Catalog, type CatalogTaskType } from "./catalog.ts";
import {
  fabricApiCreateJob,
  fabricApiCreateSecret,
  fabricApiDeleteJobsByLabel,
  fabricApiReadJobUid,
  type FabricApiJob,
  type FabricApiJobEnv,
  type FabricApiOptions,
  type FabricApiSecret,
} from "./client.ts";
import { fabricJobName, fabricLabels, fabricTicketSelector } from "./names.ts";
import { fabricProducedBranchOf, fabricTicketAt } from "./resolve.ts";
import { fabricSpawns, type FabricSpawns } from "./spawns.ts";
import { fabricWatchStart } from "./watch.ts";

/** The user-credential resolution when a deployment configures one: the grant read and the material source, both handed as values. */
export interface K8sFabricCredentials {
  readonly credentialsFor: Registry["credentialsFor"];
  readonly source: SecretSource;
}

/** Everything the fabric is composed with; the reads arrive as values, never as adapters. */
export interface K8sFabricOptions {
  readonly config: Config;
  readonly load: JournalStore["load"];
  readonly annexes: Registry["annexes"];
  readonly credentials?: K8sFabricCredentials | undefined;
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

/** The variable the resolved key lands under in every credentialed Job. */
export const k8sFabricApiKeyEnv = "ANTHROPIC_API_KEY";

/** The one key inside a per-job Secret's data. */
export const k8sFabricSecretKey = "apiKey";

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
  if (options.credentials !== undefined) {
    k8sFabricRefuseShadowedKey(own.catalog);
  }
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

/** Refuses a catalog naming the credential variable itself: under a configured resolution that variable is the spawner's own, like the CHUG_ names. */
function k8sFabricRefuseShadowedKey(catalog: Catalog): void {
  for (const [name, taskType] of Object.entries(catalog)) {
    if (Object.hasOwn(taskType.work.env, k8sFabricApiKeyEnv)) {
      throw new Error(
        `k8sFabric: type ${name} names ${k8sFabricApiKeyEnv} in its env, which a configured credentials resolution owns`,
      );
    }
  }
}

/** One delivery: short-circuit a served key, resolve the set and the grant, spawn into name absorption, then record. */
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
  const material = await k8sFabricMaterialOf(own, emission.ticket);
  for (const task of ticket.tasks) {
    const job = k8sFabricJob(own, emission, ticket, taskType, task);
    const created = await fabricApiCreateJob(own.options.api, job);
    if (material !== undefined) {
      const uid =
        created.created === "Created"
          ? created.uid
          : await fabricApiReadJobUid(own.options.api, job.metadata.name);
      await fabricApiCreateSecret(
        own.options.api,
        k8sFabricJobSecret(job, uid, material),
      );
    }
  }
  own.spawns.record(key);
}

/** The author's material under a configured resolution, or nothing under none; a missing grant refuses the delivery, which is the spawn failing closed. */
async function k8sFabricMaterialOf(
  own: K8sFabricState,
  ticket: TicketId,
): Promise<string | undefined> {
  const credentials = own.options.credentials;
  if (credentials === undefined) return undefined;
  const held = await credentials.credentialsFor(ticket);
  if (held === undefined) {
    throw new Error(
      `k8sFabric: ticket ${String(ticket)}'s author holds no credential grant, so the spawn fails closed`,
    );
  }
  return await credentials.source(held.apiKeyRef);
}

/** One Job's Secret: named for the Job and owned by the instance the uid names, so collection takes the material with it. */
function k8sFabricJobSecret(
  job: FabricApiJob,
  uid: string,
  material: string,
): FabricApiSecret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: job.metadata.name,
      labels: job.metadata.labels,
      ownerReferences: [
        { apiVersion: "batch/v1", kind: "Job", name: job.metadata.name, uid },
      ],
    },
    type: "Opaque",
    stringData: { [k8sFabricSecretKey]: material },
  };
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

/** The env entry pointing one Job at its own Secret's key. */
function k8sFabricKeyEnv(ticket: TicketId, taskId: TaskId): FabricApiJobEnv {
  return {
    name: k8sFabricApiKeyEnv,
    valueFrom: {
      secretKeyRef: {
        name: fabricJobName(ticket, taskId),
        key: k8sFabricSecretKey,
      },
    },
  };
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
    ...(own.options.credentials === undefined
      ? []
      : [k8sFabricKeyEnv(emission.ticket, task.id)]),
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
