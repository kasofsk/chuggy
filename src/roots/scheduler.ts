import {
  kubernetesNamespacePrecondition,
  kubernetesWorkerLaunch,
} from "../adapters/kubernetes/workerLaunch.ts";
import {
  suppliedExecutionPolicy,
  suppliedRuntimeFacts,
} from "../adapters/supplied/schedulerPorts.ts";
import { silentSchedulerTelemetry } from "../interpreter/executionScheduler.ts";
import type { ServiceRuntime } from "../interpreter/serviceRuntime.ts";
import { blessedPracticeCatalog } from "../interpreter/taskBriefing.ts";
import { schedulerProcessRoot } from "./controlPlane.ts";
import {
  schedulerCommandConfig,
  type SchedulerCommandConfig,
} from "./schedulerConfig.ts";

function schedulerRuntime(config: SchedulerCommandConfig): ServiceRuntime {
  return schedulerProcessRoot({
    database: config.database,
    runtime: config.runtime,
    identity: config.identity,
    service: {
      placement: kubernetesWorkerLaunch(config.workers),
      policy: suppliedExecutionPolicy(config.policy),
      runtimeFacts: suppliedRuntimeFacts(config.runtimeFacts),
      practices: blessedPracticeCatalog,
      config: config.scheduler,
      ticketService: config.ticketService,
      finalizer: config.finalizer,
      metrics: silentSchedulerTelemetry,
    },
    additional: [kubernetesNamespacePrecondition(config.workers)],
  });
}

/**
 * Ends the process where the drain it was given has run out. A stop waits on
 * the pool's own close, and a connection still being attempted holds that open
 * for as long as the connection wait allows.
 */
function schedulerDrainExpired(): void {
  process.stderr.write("execution scheduler: shutdown drain expired\n", () => {
    process.exit(1);
  });
}

function schedulerShutdown(
  runtime: ServiceRuntime,
  drainMilliseconds: number,
): () => Promise<void> {
  let stopping = false;
  return async () => {
    if (stopping) return;
    stopping = true;
    const expired = setTimeout(schedulerDrainExpired, drainMilliseconds);
    const stopped = await runtime.stop();
    clearTimeout(expired);
    if (stopped.stopped === "DrainExpired") schedulerDrainExpired();
  };
}

async function main(): Promise<void> {
  const config = schedulerCommandConfig(process.env);
  const runtime = schedulerRuntime(config);
  const shutdown = schedulerShutdown(
    runtime,
    config.runtime.shutdownDrainMilliseconds,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown().catch((failure: unknown) => {
        const message =
          failure instanceof Error ? failure.message : "unknown failure";
        process.stderr.write(`execution scheduler shutdown: ${message}\n`);
        process.exitCode = 1;
      });
    });
  }
  const started = await runtime.start();
  if (started.started !== "CouldNotRun") return;
  process.stderr.write(
    `execution scheduler: could not run without ${started.precondition}\n`,
  );
  process.exitCode = 2;
  await shutdown();
}

await main().catch((failure: unknown) => {
  const message =
    failure instanceof Error ? failure.message : "unknown startup failure";
  process.stderr.write(`execution scheduler: ${message}\n`);
  process.exitCode = 1;
});
