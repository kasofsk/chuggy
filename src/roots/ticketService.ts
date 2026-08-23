import { pathToFileURL } from "node:url";

import { z } from "zod";

import type {
  ServiceRuntime,
  ServiceStopResult,
} from "../interpreter/serviceRuntime.ts";
import {
  ticketServiceProcessRoot,
  type TicketServiceProcessRootConfig,
} from "./controlPlane.ts";

const configurationVariable = "CHUG_TICKET_SERVICE_CONFIG";

const positiveInteger = z.number().int().positive();
const positiveNumber = z.number().positive().finite();
const budgeted = z
  .object({
    type: z.literal("Budgeted"),
    value: z.number().int().nonnegative(),
  })
  .strict();
const configurationSchema = z
  .object({
    database: z
      .object({
        url: z.string().min(1),
        limits: z
          .object({
            connectionsMax: positiveInteger,
            connectionWaitMs: positiveInteger,
            statementTimeoutMs: positiveInteger,
          })
          .strict()
          .optional(),
      })
      .strict(),
    runtime: z
      .object({
        idleIntervalMilliseconds: positiveInteger,
        shutdownDrainMilliseconds: positiveInteger,
      })
      .strict(),
    pass: z
      .object({
        projectsPerPassMax: positiveInteger,
        projectLeaseSeconds: positiveNumber,
      })
      .strict(),
    domain: z
      .object({
        nTickets: positiveInteger,
        nTasks: positiveInteger,
        reworkPolicy: z
          .object({
            type: z.literal("BudgetedRework"),
            value: z.number().int().nonnegative(),
          })
          .strict(),
        gas: z.number().int().nonnegative(),
        finalizationPricing: z.union([z.literal("DeadlineOnly"), budgeted]),
        maxStages: positiveInteger,
      })
      .strict(),
    owner: z.string().min(1),
    ticket: z
      .object({
        agingIntervalSeconds: positiveNumber,
        ordinarySoftLimit: positiveInteger,
        mailboxHardLimit: positiveInteger,
        writerDecisionQuantum: positiveInteger,
        writerTimeQuantumMilliseconds: positiveNumber,
        backpressureRetryAfterSeconds: positiveNumber,
      })
      .strict()
      .optional(),
  })
  .strict();

export type TicketServiceCommandResult =
  | { readonly outcome: "Stopped"; readonly stop: ServiceStopResult }
  | { readonly outcome: "CouldNotRun"; readonly precondition: string }
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
  const encoded = environment[configurationVariable];
  if (encoded === undefined || encoded.length === 0)
    throw new Error(`${configurationVariable} is required`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error(`${configurationVariable} must be valid JSON`);
  }
  const result = configurationSchema.safeParse(parsed);
  if (!result.success) {
    const path = result.error.issues[0]?.path.join(".") || "value";
    throw new Error(`${configurationVariable}.${path} is invalid`);
  }
  if (
    result.data.ticket !== undefined &&
    result.data.ticket.ordinarySoftLimit >= result.data.ticket.mailboxHardLimit
  )
    throw new Error(`${configurationVariable}.ticket count bounds are invalid`);
  const data = result.data;
  return {
    database: {
      url: data.database.url,
      ...(data.database.limits === undefined
        ? {}
        : { limits: data.database.limits }),
    },
    runtime: data.runtime,
    pass: data.pass,
    domain: data.domain,
    owner: data.owner,
    ...(data.ticket === undefined ? {} : { ticket: data.ticket }),
  };
}

function ticketServiceFailure(runtime: ServiceRuntime): string | undefined {
  const health = runtime.health();
  if (health.live) return undefined;
  return health.failure ?? "unknown runtime failure";
}

function ticketServiceFailureWait(runtime: ServiceRuntime): {
  readonly found: Promise<string>;
  readonly cancel: () => void;
} {
  let timeout: NodeJS.Timeout | undefined;
  let cancelled = false;
  const found = new Promise<string>((resolve) => {
    const inspect = (): void => {
      if (cancelled) return;
      const failure = ticketServiceFailure(runtime);
      if (failure !== undefined) {
        resolve(failure);
        return;
      }
      timeout = setTimeout(inspect, 25);
    };
    inspect();
  });
  return {
    found,
    cancel: () => {
      cancelled = true;
      if (timeout !== undefined) clearTimeout(timeout);
    },
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
      return { outcome: "CouldNotRun", precondition: started.precondition };
    }
    if (started.started === "Stopped")
      return { outcome: "Stopped", stop: await (stop ?? runtime.stop()) };
    const failure = ticketServiceFailureWait(runtime);
    const completion = await Promise.race([
      failure.found.then((message) => ({ kind: "failure", message }) as const),
      signal.then(() => ({ kind: "signal" }) as const),
    ]);
    failure.cancel();
    if (completion.kind === "failure") {
      await runtime.stop();
      return { outcome: "Failed", failure: completion.message };
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
      diagnostic: `ticket service could not run: ${result.precondition}`,
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
