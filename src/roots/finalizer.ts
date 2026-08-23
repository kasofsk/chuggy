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

import { assertNever } from "../domain/assertNever.ts";
import { composeFinalizerRuntime } from "../compose.ts";
import { finalizerSettingsOf } from "../interpreter/finalizerSettings.ts";
import type {
  RuntimePrecondition,
  ServiceRuntime,
} from "../interpreter/serviceRuntime.ts";
import { finalizerProcessRoot } from "./controlPlane.ts";

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

/** The first precondition this deployment does not meet, a throwing check counting as unmet. */
async function finalizerUnmet(
  preconditions: readonly RuntimePrecondition[],
): Promise<string | undefined> {
  const signal = new AbortController().signal;
  for (const precondition of preconditions) {
    const met = await precondition.check(signal).catch(() => false);
    if (!met) return precondition.name;
  }
  return undefined;
}

function finalizerCouldNotRun(precondition: string): void {
  finalizerReport(`${precondition} is not met`);
  process.exitCode = finalizerCouldNotRunExit;
}

/** Ends the process's own resources, a drain that expired being a failure to report. */
async function finalizerStop(runtime: ServiceRuntime): Promise<void> {
  const stopped = await runtime.stop();
  if (stopped.stopped === "DrainExpired") {
    finalizerReport("the shutdown drain expired");
    process.exitCode = finalizerFailedExit;
    return;
  }
  finalizerReport("stopped");
}

/** Starts the process, holds it until a signal, and reports what it left on. */
async function finalizerRun(runtime: ServiceRuntime): Promise<void> {
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> =>
    (stopping ??= finalizerStop(runtime).catch((failure: unknown) => {
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
      return;
    case "Stopped":
      return stop();
    case "CouldNotRun":
      finalizerCouldNotRun(started.precondition);
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

await main().catch((failure: unknown) => {
  finalizerReport(finalizerMessageOf(failure));
  process.exitCode = finalizerFailedExit;
});
