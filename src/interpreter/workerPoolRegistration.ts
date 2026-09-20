/**
 * Registering a worker pool against a project, and taking one off it, as the
 * three writes it is at three authorities.
 *
 * REGISTRATION IS THE PROJECT'S ACT AND NOT THE POOL'S. A machine cannot
 * present itself and be trusted, so a pool's OAuth2 client is minted here, the
 * relation the authority answers `Execute` from is written here, and the
 * principal those two agree on is what the row records. The secret is returned
 * once and stored nowhere: it is the issuer's, and a pool that loses it is
 * registered again.
 *
 * A HALF-REGISTRATION IS UNDONE RATHER THAN LEFT. No transaction spans the
 * three, so a failure after the client exists removes the client and the
 * relation before it reports — leaving a client nobody recorded is leaving a
 * credential with no owner. Deregistration is the same order reversed for the
 * same reason: the client and the relation go first and the row that names
 * them last, so a failure part-way leaves a row the re-run starts from.
 *
 * IT DECIDES NOTHING ABOUT A TICKET and reads no journal, which is why it is
 * here rather than in the command that composes it: what the command holds is
 * an address per authority, and what this holds is the order the three are
 * written in.
 */

import { workerPoolCapabilitiesSchema } from "../contract/workerPool.ts";
import { oidcPrincipal } from "./principal.ts";
import {
  projectPrincipalGrant,
  type ProjectGrant,
  type ProjectGrantWriter,
} from "./projectGrant.ts";
import type { ProjectAccessKind } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import type {
  WorkerPoolClients,
  WorkerPoolClientSecret,
  WorkerPoolRegistry,
} from "./workerPool.ts";

export type RegisterPoolEnvironment = Readonly<
  Record<string, string | undefined>
>;

/** Every variable the command is asked through, named once for the reader and the parser. */
export const registerPoolVariables = {
  tenant: "CHUG_WORKER_POOL_TENANT",
  project: "CHUG_WORKER_POOL_PROJECT",
  pool: "CHUG_WORKER_POOL_POOL",
  capabilities: "CHUG_WORKER_POOL_CAPABILITIES",
  operation: "CHUG_WORKER_POOL_OPERATION",
  issuer: "CHUG_WORKER_POOL_OIDC_ISSUER",
} as const;

/**
 * The relation a pool is written into. `Execute` is what the plane asks for and
 * `execute` is the permit it resolves to, which the deployed model follows from
 * this relation alone — so a pool holds that one permit and nothing a person's
 * relation carries.
 */
export const workerPoolGrantRelation = "pools";

/** The access the relation above is written to satisfy, named so the pair reads together. */
export const workerPoolGrantedAccess: ProjectAccessKind = "Execute";

/** One value the command cannot be run without, or the refusal naming what is absent. */
export function registerPoolRequired(
  environment: RegisterPoolEnvironment,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

/** One pool as the three writes need it named, whichever caller asked for them. */
export interface WorkerPoolRegistrationRequest {
  readonly partition: Partition;
  readonly pool: string;
  readonly capabilities: readonly string[];
  readonly issuer: string;
}

/** What the command was asked to do, refused here rather than by the registry. */
export type RegisterPoolRequest = WorkerPoolRegistrationRequest & {
  readonly operation: "register" | "deregister";
};

export function registerPoolRequestOf(
  environment: RegisterPoolEnvironment,
): RegisterPoolRequest {
  const operation = registerPoolRequired(
    environment,
    registerPoolVariables.operation,
  );
  if (operation !== "register" && operation !== "deregister")
    throw new Error(
      `${registerPoolVariables.operation} must be register or deregister`,
    );
  const declared = environment[registerPoolVariables.capabilities];
  const capabilities = workerPoolCapabilitiesSchema.parse(
    declared === undefined || declared.length === 0 ? [] : declared.split(","),
  );
  return {
    partition: {
      tenant: registerPoolRequired(environment, registerPoolVariables.tenant),
      project: registerPoolRequired(environment, registerPoolVariables.project),
    } as Partition,
    pool: registerPoolRequired(environment, registerPoolVariables.pool),
    capabilities,
    operation,
    issuer: registerPoolRequired(environment, registerPoolVariables.issuer),
  };
}

/** The tuple one pool's client is written as, derived from the same subject the row records. */
function registerPoolGrant(
  request: WorkerPoolRegistrationRequest,
  clientId: string,
): ProjectGrant {
  return projectPrincipalGrant({
    issuer: request.issuer,
    subject: clientId,
    tenant: request.partition.tenant,
    project: request.partition.project,
    relation: workerPoolGrantRelation,
  });
}

export interface RegisterPoolPorts {
  readonly registry: WorkerPoolRegistry;
  readonly clients: WorkerPoolClients;
  readonly grants: ProjectGrantWriter;
  readonly clientId: () => string;
}

/**
 * The client and the relation taken back, each attempted whether or not the
 * other could be: the authority that refused to write a relation refuses to
 * remove it too, and the client must not outlive that refusal. Answers the
 * first removal that failed, for the caller to raise where nothing else did.
 */
async function workerPoolRegistrationUndone(
  ports: RegisterPoolPorts,
  grant: ProjectGrant,
  clientId: string,
): Promise<Error | undefined> {
  const settled = await Promise.allSettled([
    ports.clients.remove(clientId),
    ports.grants.remove(grant),
  ]);
  const failed = settled.find((outcome) => outcome.status === "rejected");
  if (failed === undefined) return undefined;
  return failed.reason instanceof Error
    ? failed.reason
    : new Error(String(failed.reason));
}

/**
 * The three writes registering one pool is — a client, a relation and a row —
 * each undone where the next could not be made, and answering nothing where the
 * row names no active project.
 */
export async function workerPoolRegisteredAt(
  request: WorkerPoolRegistrationRequest,
  ports: RegisterPoolPorts,
): Promise<WorkerPoolClientSecret | undefined> {
  const minted = await ports.clients.create(ports.clientId());
  const grant = registerPoolGrant(request, minted.clientId);
  let registered;
  try {
    await ports.grants.write(grant);
    registered = await ports.registry.register({
      partition: request.partition,
      pool: request.pool,
      capabilities: request.capabilities,
      clientId: minted.clientId,
      principal: oidcPrincipal(request.issuer, minted.clientId),
    });
  } catch (failure) {
    await workerPoolRegistrationUndone(ports, grant, minted.clientId);
    throw failure;
  }
  if (registered) return minted;
  const left = await workerPoolRegistrationUndone(
    ports,
    grant,
    minted.clientId,
  );
  if (left !== undefined) throw left;
  return undefined;
}

async function registerPoolRegistered(
  request: RegisterPoolRequest,
  ports: RegisterPoolPorts,
  named: string,
): Promise<string> {
  const minted = await workerPoolRegisteredAt(request, ports);
  if (minted === undefined)
    throw new Error(`NotRegistered: ${named} names no active project`);
  return [
    `Registered: ${named} declaring ${request.capabilities.join(",")}`,
    `holding ${workerPoolGrantedAccess} as ${workerPoolGrantRelation}`,
    minted.clientId,
    minted.clientSecret,
  ].join("\n");
}

export async function registerPoolRun(input: {
  readonly environment: RegisterPoolEnvironment;
  readonly ports: RegisterPoolPorts;
}): Promise<string> {
  const request = registerPoolRequestOf(input.environment);
  const named = `${request.partition.tenant}/${request.partition.project} pool ${request.pool}`;
  if (request.operation === "register")
    return registerPoolRegistered(request, input.ports, named);
  return registerPoolDeregistered(request, input.ports, named);
}

/**
 * The three writes taken back: the client, the relation, and last the row that
 * named them. The row goes only with the client that was read out of it, so a
 * pool registered again in between keeps its newer client and this run says so.
 */
async function registerPoolDeregistered(
  request: RegisterPoolRequest,
  ports: RegisterPoolPorts,
  named: string,
): Promise<string> {
  const clientId = await ports.registry.clientOf(
    request.partition,
    request.pool,
  );
  if (clientId === undefined) return `NotRegistered: ${named}`;
  await ports.clients.remove(clientId);
  await ports.grants.remove(registerPoolGrant(request, clientId));
  if (
    !(await ports.registry.deregister(
      request.partition,
      request.pool,
      clientId,
    ))
  )
    throw new Error(
      `${named} was registered again while it was being taken off; run again`,
    );
  return `Deregistered: ${named}`;
}
