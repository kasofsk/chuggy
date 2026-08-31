/**
 * The finalizer as a process: the one place its configuration is read from an
 * environment, and everything a deployment needs above `finalizerProcessRoot`.
 *
 * A PREREQUISITE IS NOT A MISCONFIGURATION, and they leave with different
 * statuses. A configuration this cannot parse is a mistake somebody has to fix;
 * a git, a scratch, an artifact root, a credential, a schema, a role or an
 * epoch that is not there is a could-not-run, named by the precondition it
 * failed. Neither is ever reported as readiness.
 *
 * THE LOCAL PREREQUISITES ARE CHECKED BEFORE ANYTHING DURABLE IS OPENED, so a
 * deployment missing its git, its storage or its credentials says which without
 * a database to ask. The signal handlers go on once there is something for them
 * to shut down, and until then the default disposition is the bounded one.
 *
 * NO CREDENTIAL PASSES THROUGH HERE. A deployment names the file each
 * repository's credential stands in and the source reads it per act, so nothing
 * this process holds, prints or hands a child carries a secret.
 */

import { pathToFileURL } from "node:url";

import { assertNever } from "../domain/assertNever.ts";
import { composeFinalizerRuntime } from "../compose.ts";
import { finalizerSettingsOf } from "../interpreter/finalizerSettings.ts";
import {
  runtimePreconditionUndecided,
  type RuntimePrecondition,
  type ServiceRuntime,
} from "../interpreter/serviceRuntime.ts";
import { finalizerProcessRoot } from "./controlPlane.ts";

/** One precondition that stopped a start, named beside what it answered. */
interface RuntimePreconditionUnmet {
  readonly precondition: string;
  readonly met: "Refused" | "Undecided";
  readonly why: string;
}

/** What a configuration this cannot parse, or a shutdown that did not drain, leaves with. */
const finalizerFailedExit = 1;

/** What an unmet precondition leaves with, which is a could-not-run and not a failure. */
const finalizerCouldNotRunExit = 2;

function finalizerReport(message: string): void {
  process.stderr.write(`finalizer: ${message}\n`);
}

function finalizerMessageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : "unknown failure";
}

/** The first precondition this deployment does not meet, a throwing check counting as undecided. */
async function finalizerUnmet(
  preconditions: readonly RuntimePrecondition[],
): Promise<RuntimePreconditionUnmet | undefined> {
  const signal = new AbortController().signal;
  for (const precondition of preconditions) {
    const verdict = await precondition
      .check(signal)
      .catch(runtimePreconditionUndecided);
    if (verdict.met !== "Met")
      return { precondition: precondition.name, ...verdict };
  }
  return undefined;
}

function finalizerCouldNotRun(unmet: RuntimePreconditionUnmet): void {
  finalizerReport(
    `${unmet.precondition} ${unmet.met.toLowerCase()} — ${unmet.why}`,
  );
  process.exitCode = finalizerCouldNotRunExit;
}

/** Ends the process's own resources, answering whether the drain it was given expired. */
async function finalizerStop(runtime: ServiceRuntime): Promise<boolean> {
  const stopped = await runtime.stop();
  if (stopped.stopped === "DrainExpired") {
    finalizerReport("the shutdown drain expired");
    process.exitCode = finalizerFailedExit;
    return true;
  }
  finalizerReport("stopped");
  return false;
}

/**
 * Holds the process for the started run and reports a loop that ended in
 * failure. An expiry the stop has already reported is left to that report.
 */
async function finalizerSettled(
  runtime: ServiceRuntime,
  stop: () => Promise<void>,
  drainExpired: () => boolean,
): Promise<void> {
  const ended = await runtime.settled();
  if (ended.live) return;
  if (drainExpired()) return;
  finalizerReport(ended.failure ?? "unknown failure");
  process.exitCode = finalizerFailedExit;
  await stop();
}

/** Starts the process, holds it until a signal or a dead loop, and reports what it left on. */
export async function finalizerRun(runtime: ServiceRuntime): Promise<void> {
  let expired = false;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> =>
    (stopping ??= finalizerStop(runtime)
      .then((drainExpired) => {
        expired = drainExpired;
      })
      .catch((failure: unknown) => {
        finalizerReport(finalizerMessageOf(failure));
        process.exitCode = finalizerFailedExit;
      }));
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stop();
    });
  }
  finalizerReport("starting");
  const started = await runtime.start();
  switch (started.started) {
    case "Started":
      finalizerReport("ready");
      return finalizerSettled(runtime, stop, () => expired);
    case "Stopped":
      return stop();
    case "CouldNotRun":
      finalizerCouldNotRun({
        precondition: started.precondition,
        met: started.verdict,
        why: started.why,
      });
      return stop();
    default:
      return assertNever(started);
  }
}

async function main(): Promise<void> {
  const settings = finalizerSettingsOf(process.env);
  const composition = composeFinalizerRuntime(settings);
  const unmet = await finalizerUnmet(composition.preconditions);
  if (unmet !== undefined) {
    finalizerCouldNotRun(unmet);
    return;
  }
  await finalizerRun(
    finalizerProcessRoot({
      database: { url: settings.databaseUrl },
      runtime: settings.runtime,
      identity: {
        owner: settings.owner,
        recoveryEpoch: settings.recoveryEpoch,
      },
      service: composition.service(),
      finalizer: settings.finalizer,
    }),
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main().catch((failure: unknown) => {
    finalizerReport(finalizerMessageOf(failure));
    process.exitCode = finalizerFailedExit;
  });
