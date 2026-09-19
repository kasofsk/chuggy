/**
 * Owner-role command that registers a worker pool against a project, or takes
 * one off it.
 *
 * REGISTRATION IS THE PROJECT'S ACT AND NOT THE POOL'S. A machine cannot
 * present itself and be trusted, so the credential is drawn here, printed once,
 * and stored only as its digest; a pool that loses it is registered again,
 * which rotates it. There is no route for this because there is no principal a
 * pool could authenticate as to ask — a registered pool's authorisation is its
 * credential and nothing else, and widening that is a decision this command
 * does not make.
 */
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresWorkerPoolRegistry } from "../adapters/postgres/workerPool.ts";
import { workerPoolCapabilitySchema } from "../contract/workerPool.ts";
import type { Partition } from "../interpreter/projectStore.ts";
import type { WorkerPoolRegistry } from "../interpreter/workerPool.ts";

export type RegisterPoolEnvironment = Readonly<
  Record<string, string | undefined>
>;

const variables = {
  databaseUrl: "CHUG_WORKER_POOL_DATABASE_URL",
  tenant: "CHUG_WORKER_POOL_TENANT",
  project: "CHUG_WORKER_POOL_PROJECT",
  pool: "CHUG_WORKER_POOL_POOL",
  capabilities: "CHUG_WORKER_POOL_CAPABILITIES",
  operation: "CHUG_WORKER_POOL_OPERATION",
} as const;

function required(environment: RegisterPoolEnvironment, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

/** What the command was asked to do, refused here rather than by the registry. */
export interface RegisterPoolRequest {
  readonly partition: Partition;
  readonly pool: string;
  readonly capabilities: readonly string[];
  readonly operation: "register" | "deregister";
}

export function registerPoolRequestOf(
  environment: RegisterPoolEnvironment,
): RegisterPoolRequest {
  const operation = required(environment, variables.operation);
  if (operation !== "register" && operation !== "deregister")
    throw new Error(`${variables.operation} must be register or deregister`);
  const declared = environment[variables.capabilities];
  const capabilities =
    declared === undefined || declared.length === 0 ? [] : declared.split(",");
  for (const capability of capabilities)
    workerPoolCapabilitySchema.parse(capability);
  return {
    partition: {
      tenant: required(environment, variables.tenant),
      project: required(environment, variables.project),
    } as Partition,
    pool: required(environment, variables.pool),
    capabilities,
    operation,
  };
}

export async function registerPoolRun(input: {
  readonly environment: RegisterPoolEnvironment;
  readonly registry: WorkerPoolRegistry;
  readonly credential: () => string;
}): Promise<string> {
  const request = registerPoolRequestOf(input.environment);
  const named = `${request.partition.tenant}/${request.partition.project} pool ${request.pool}`;
  if (request.operation === "deregister")
    return (await input.registry.deregister(request.partition, request.pool))
      ? `Deregistered: ${named}`
      : `NotRegistered: ${named}`;
  const credential = input.credential();
  if (
    !(await input.registry.register(
      request.partition,
      request.pool,
      request.capabilities,
      credential,
    ))
  )
    throw new Error(`NotRegistered: ${named} names no active project`);
  return `Registered: ${named} declaring ${request.capabilities.join(",")}\n${credential}`;
}

async function main(environment: RegisterPoolEnvironment): Promise<void> {
  const pool = postgresPool(required(environment, variables.databaseUrl));
  try {
    process.stdout.write(
      `${await registerPoolRun({
        environment,
        registry: postgresWorkerPoolRegistry(pool),
        credential: () => randomBytes(32).toString("base64url"),
      })}\n`,
    );
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main(process.env).catch((failure: unknown) => {
    const message =
      failure instanceof Error
        ? failure.message
        : "unknown registration failure";
    process.stderr.write(`register worker pool: ${message}\n`);
    process.exitCode = 1;
  });
