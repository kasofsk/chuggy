/**
 * The Job watch: the fabric's failure detector, and deliberately nothing more.
 * A failed Job — its deadline exceeded included — is delivered as the fail
 * verdict, the model's own decision that infrastructure death and a red
 * verdict are one event; success is only ever the worker's own declaration
 * through the completion route. A Job that succeeded but declared nothing is
 * failed after a grace, because a fabric that synthesized a pass would be
 * deciding — and where the declaration did arrive, enablement drops the late
 * fail as the straggler it is.
 *
 * EVERY LAP RELISTS. The loop lists the labelled Jobs, serves what the list
 * already shows, then watches from the list's own resourceVersion; a dropped
 * stream or an expired version just ends the lap, so a resume never trusts a
 * version the server disowned. Reconnection walks the bounded delay ladder —
 * a successful list resets it — and the ladder's end re-raises the failure
 * through a timer, where the composition root lets it end the process and the
 * boot re-drive relists.
 *
 * A DELIVERY IS ANSWERED, AND EITHER ANSWER ENDS THE DUTY. A Dropped names a
 * completion the machine refuses — a stale re-observation, a task no longer
 * live — and this loop neither retries nor mourns it. The grace timers are
 * unreferenced on purpose: every observation here is reconstructed from the
 * next list, so no timer needs to hold the process open.
 */

import type { Inbound } from "../../interpreter/inbound.ts";
import {
  asTaskId,
  asTicketId,
  type TaskId,
  type TicketId,
} from "../../domain/ids.ts";
import {
  fabricApiListJobs,
  fabricApiWatchJobs,
  type FabricApiJobView,
  type FabricApiOptions,
} from "./client.ts";
import { fabricTaskLabel, fabricTicketLabel } from "./names.ts";

/** Everything the watch runs on; the signal is the one way a caller ends it. */
export interface FabricWatchOptions {
  readonly api: FabricApiOptions;
  readonly inbound: Inbound;
  readonly succeededGraceMs: number;
  readonly retryDelaysMs: readonly number[];
  readonly signal?: AbortSignal | undefined;
}

/** The pair a Job's labels carry back. */
interface FabricWatchPair {
  readonly ticket: TicketId;
  readonly taskId: TaskId;
}

/** Starts the loop on the adapter's own stack; what exhausts the ladder is re-raised loudly through a timer. */
export function fabricWatchStart(options: FabricWatchOptions): void {
  void fabricWatchLaps(options).catch((failure: unknown) => {
    if (fabricWatchAborted(options)) return;
    fabricWatchRaise(failure);
  });
}

function fabricWatchRaise(failure: unknown): void {
  setTimeout(() => {
    throw failure instanceof Error ? failure : new Error(String(failure));
  });
}

function fabricWatchSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs).unref();
  });
}

/** Read through a call because the signal flips during awaits, where a narrowed property read would lie. */
function fabricWatchAborted(options: FabricWatchOptions): boolean {
  return options.signal?.aborted === true;
}

/** List, serve, watch, reconnect: one bounded lap after another until aborted or the ladder runs out. */
async function fabricWatchLaps(options: FabricWatchOptions): Promise<void> {
  for (let rung = 0; ;) {
    if (fabricWatchAborted(options)) return;
    try {
      const listed = await fabricApiListJobs(
        options.api,
        fabricTicketLabel,
        options.signal,
      );
      for (const job of listed.jobs) await fabricWatchServe(options, job);
      rung = 0;
      await fabricApiWatchJobs(
        options.api,
        fabricTicketLabel,
        listed.resourceVersion,
        (job) => fabricWatchServe(options, job),
        options.signal,
      );
      rung = 1;
    } catch (failure) {
      if (fabricWatchAborted(options)) return;
      rung += 1;
      if (options.retryDelaysMs.at(rung - 1) === undefined) throw failure;
    }
    const delayMs = options.retryDelaysMs.at(rung - 1);
    if (delayMs !== undefined) await fabricWatchSleep(delayMs);
  }
}

/** One observed Job: a failure delivers now, a success starts the grace, anything else is still running. */
async function fabricWatchServe(
  options: FabricWatchOptions,
  job: FabricApiJobView,
): Promise<void> {
  const pair = fabricWatchPairOf(job.labels);
  if (pair === undefined) return;
  if (fabricWatchHolds(job, "Failed")) {
    await fabricWatchDeliver(options, pair);
    return;
  }
  if (fabricWatchHolds(job, "Complete")) fabricWatchGrace(options, pair);
}

/** Whether the Job's status holds the named condition as true. */
function fabricWatchHolds(job: FabricApiJobView, condition: string): boolean {
  return job.conditions.some(
    (held) => held.type === condition && held.status === "True",
  );
}

/** The pair off a Job's labels, or nothing where the labels are not this fabric's. The guard admits exactly what the id branding accepts, so a foreign object can never reach the brands' own refusal. */
function fabricWatchPairOf(
  labels: Readonly<Record<string, string>>,
): FabricWatchPair | undefined {
  const ticket = Number(labels[fabricTicketLabel]);
  const taskId = Number(labels[fabricTaskLabel]);
  if (!Number.isSafeInteger(ticket) || ticket < 1) return undefined;
  if (!Number.isSafeInteger(taskId) || taskId < 1) return undefined;
  return { ticket: asTicketId(ticket), taskId: asTaskId(taskId) };
}

/** Books the undeclared-success grace; a declaration that did arrive makes the late fail a dropped straggler. */
function fabricWatchGrace(
  options: FabricWatchOptions,
  pair: FabricWatchPair,
): void {
  setTimeout(() => {
    if (fabricWatchAborted(options)) return;
    void fabricWatchDeliver(options, pair).catch(fabricWatchRaise);
  }, options.succeededGraceMs).unref();
}

/** The one verdict this detector may deliver, answered by the machine and done with either way. */
async function fabricWatchDeliver(
  options: FabricWatchOptions,
  pair: FabricWatchPair,
): Promise<void> {
  await options.inbound.taskDone(pair.ticket, pair.taskId, "VFail");
}
