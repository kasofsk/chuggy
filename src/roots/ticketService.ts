import { pathToFileURL } from "node:url";

import { z } from "zod";

import type {
  ServiceRuntime,
  ServiceStopResult,
} from "../interpreter/serviceRuntime.ts";
import {
  commandDatabaseConfig,
  commandDatabaseSchema,
  commandRuntimeSchema,
  decodedCommandConfiguration,
  positiveInteger,
} from "./commandConfig.ts";
import {
  ticketServiceProcessRoot,
  type TicketServiceProcessRootConfig,
} from "./controlPlane.ts";

const configurationVariable = "CHUG_TICKET_SERVICE_CONFIG";

const positiveNumber = z.number().positive().finite();
const configurationSchema = z
  .object({
    database: commandDatabaseSchema,
    runtime: commandRuntimeSchema,
    pass: z
      .object({
        projectsPerPassMax: positiveInteger,
        projectLeaseSeconds: positiveNumber,
        inputsPerProjectMax: positiveInteger.max(1000).default(32),
        obligationsPerProjectMax: positiveInteger.max(1000).default(1000),
      })
      .strict(),
    owner: z.string().min(1),
  })
  .strict();

export type TicketServiceCommandResult =
  | { readonly outcome: "Stopped"; readonly stop: ServiceStopResult }
  | {
      readonly outcome: "CouldNotRun";
      readonly precondition: string;
      readonly verdict: "Refused" | "Undecided";
      readonly why: string;
    }
  | { readonly outcome: "Failed"; readonly failure: string };

export interface TicketServiceCommandExit {
  readonly code: 0 | 1 | 2 | 3;
  readonly diagnostic?: string;
}

interface ProcessSignals {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
}

export function ticketServiceConfiguration(
  environment: NodeJS.ProcessEnv,
): TicketServiceProcessRootConfig {
  const data = decodedCommandConfiguration(
    configurationVariable,
    configurationSchema,
    environment,
  );
  return {
    database: commandDatabaseConfig(data.database),
    runtime: data.runtime,
    pass: data.pass,
    owner: data.owner,
  };
}

export async function runTicketService(
  runtime: ServiceRuntime,
  signals: ProcessSignals = process,
): Promise<TicketServiceCommandResult> {
  let stop: Promise<ServiceStopResult> | undefined;
  let signalReceived!: () => void;
  const signal = new Promise<void>((resolve) => {
    signalReceived = resolve;
  });
  const terminate = (): void => {
    stop ??= runtime.stop();
    signalReceived();
  };
  for (const name of ["SIGINT", "SIGTERM"] as const)
    signals.once(name, terminate);
  try {
    const started = await Promise.race([
      runtime.start(),
      signal.then(() => ({ started: "Stopped" }) as const),
    ]);
    if (started.started === "CouldNotRun") {
      await runtime.stop();
      return {
        outcome: "CouldNotRun",
        precondition: started.precondition,
        verdict: started.verdict,
        why: started.why,
      };
    }
    if (started.started === "Stopped")
      return { outcome: "Stopped", stop: await (stop ?? runtime.stop()) };
    const completion = await Promise.race([
      runtime
        .settled()
        .then((health) => ({ kind: "settled", health }) as const),
      signal.then(() => ({ kind: "signal" }) as const),
    ]);
    if (completion.kind === "settled" && !completion.health.live) {
      await runtime.stop();
      return {
        outcome: "Failed",
        failure: completion.health.failure ?? "unknown runtime failure",
      };
    }
    return { outcome: "Stopped", stop: await (stop ?? runtime.stop()) };
  } finally {
    for (const name of ["SIGINT", "SIGTERM"] as const)
      signals.removeListener(name, terminate);
  }
}

export async function ticketServiceMain(
  environment: NodeJS.ProcessEnv,
  root: (
    config: TicketServiceProcessRootConfig,
  ) => ServiceRuntime = ticketServiceProcessRoot,
  signals: ProcessSignals = process,
): Promise<TicketServiceCommandExit> {
  let config: TicketServiceProcessRootConfig;
  try {
    config = ticketServiceConfiguration(environment);
  } catch (failure) {
    const message =
      failure instanceof Error ? failure.message : "invalid configuration";
    return {
      code: 2,
      diagnostic: `ticket service configuration: ${message}`,
    };
  }
  let result: TicketServiceCommandResult;
  try {
    result = await runTicketService(root(config), signals);
  } catch (failure) {
    const message =
      failure instanceof Error ? failure.message : "unknown failure";
    return { code: 1, diagnostic: `ticket service failed: ${message}` };
  }
  if (result.outcome === "CouldNotRun") {
    return {
      code: 3,
      diagnostic: `ticket service could not run: ${result.precondition} ${result.verdict.toLowerCase()} — ${result.why}`,
    };
  }
  if (result.outcome === "Failed") {
    return { code: 1, diagnostic: `ticket service failed: ${result.failure}` };
  }
  if (result.stop.stopped === "DrainExpired")
    return {
      code: 1,
      diagnostic: "ticket service failed: shutdown drain expired",
    };
  return { code: 0 };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await ticketServiceMain(process.env).then((result) => {
    if (result.diagnostic !== undefined)
      process.stderr.write(`${result.diagnostic}\n`);
    process.exitCode = result.code;
  });
