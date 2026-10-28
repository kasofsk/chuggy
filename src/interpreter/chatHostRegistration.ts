/**
 * A member's chat host: registering it from a token minted for one, reading
 * it, and taking it off.
 *
 * A CHAT HOST IS ITS OWNER'S, ONE PER TENANT. It is registered under the
 * tenant and the member whose token it redeemed, under the same permit a
 * personal runner is, and serves its owner's threads and inquiries in every
 * project they may read, so it keeps no allowlist. Registering again replaces
 * the row and, in the same transaction, fences every attempt the replaced
 * host held; the replaced client is removed after the row that replaced it
 * stands, and a removal that fails leaves a client no row names, which no
 * poll resolves.
 *
 * A CLIENT GOES BEFORE ITS ROW. Taking a host off removes the client its row
 * names and then deletes the row, which fences what it held, so a failure
 * part-way leaves a row naming a removed client, which taking it off again
 * starts from.
 */

import { oidcPrincipal, type Principal } from "./principal.ts";
import type { TenantId } from "./projectStore.ts";
import type {
  WorkerPoolClients,
  WorkerPoolClientSecret,
} from "./workerPool.ts";
import type { WorkerPoolSite } from "./workerPoolRegistrationToken.ts";
import {
  workerRunnerListed,
  type WorkerRunnerListed,
  type WorkerRunnerReleases,
} from "./workerRunnerRelease.ts";

/** Whose chat host a row is: a member, in one tenant. */
export interface ChatHostKey {
  readonly tenant: TenantId;
  readonly owner: Principal;
}

/** What registering one host records: who it is at the issuer. */
export interface ChatHostRegistration extends ChatHostKey {
  readonly clientId: string;
  readonly principal: Principal;
}

/**
 * A member's chat host as its owner reads it, by the client it registered: its
 * newest poll, absent until it polls, whether that poll is within the window a
 * host is held live for, and the runner its newest poll named, absent where it
 * named none.
 */
export interface ChatHostView {
  readonly id: string;
  readonly registeredAt: string;
  readonly polledAt?: string;
  readonly live: boolean;
  readonly runner?: WorkerRunnerListed;
}

/** What one registration came to: written, naming the client of the host it replaced where it replaced one, or no tenant to write it in. */
export type ChatHostWritten =
  | { readonly written: "Registered"; readonly replaced?: string }
  | { readonly written: "NotFound" };

/**
 * The registry chat hosts are known by. `register` replaces whatever host the
 * member held and fences its attempts; `deregister` deletes the member's host
 * naming a client and fences its attempts, answering whether there was one.
 */
export interface ChatHostRegistry {
  clientOf(key: ChatHostKey): Promise<string | undefined>;
  register(registration: ChatHostRegistration): Promise<ChatHostWritten>;
  deregister(key: ChatHostKey, clientId: string): Promise<boolean>;
  host(key: ChatHostKey): Promise<ChatHostView | undefined>;
}

/** The two authorities a registration writes at, and how a client is named. */
export interface ChatHostPorts {
  readonly registry: ChatHostRegistry;
  readonly clients: WorkerPoolClients;
  readonly clientId: () => string;
}

/** Everything a chat host needs to serve its owner, its secret included, answered once and naming no project. */
export interface ChatHostCredentials
  extends Omit<WorkerPoolSite, "issuer">, WorkerPoolClientSecret {
  readonly tenant: TenantId;
  readonly owner: Principal;
}

/** What one registration's writes came to. */
export type ChatHostRegisteredAt =
  | { readonly result: "NotFound" }
  | { readonly result: "Registered"; readonly value: WorkerPoolClientSecret };

/**
 * The writes registering a member's chat host is: a client minted, and the row
 * naming it in place of any other. A row that could not be written takes the
 * client with it, and a row that replaced another removes the client that one
 * named.
 */
export async function chatHostRegisteredAt(
  key: ChatHostKey,
  issuer: string,
  ports: ChatHostPorts,
): Promise<ChatHostRegisteredAt> {
  const minted = await ports.clients.create(ports.clientId());
  let written: ChatHostWritten;
  try {
    written = await ports.registry.register({
      ...key,
      clientId: minted.clientId,
      principal: oidcPrincipal(issuer, minted.clientId),
    });
  } catch (failure) {
    await ports.clients.remove(minted.clientId).catch(() => undefined);
    throw failure;
  }
  if (written.written === "NotFound") {
    await ports.clients.remove(minted.clientId);
    return { result: "NotFound" };
  }
  if (written.replaced !== undefined)
    await ports.clients.remove(written.replaced).catch(() => undefined);
  return { result: "Registered", value: minted };
}

/** What taking a host off came to: gone, or none there to take. */
export type ChatHostDeregistered = "Deregistered" | "NotFound";

/** The two writes of a host taken back, the client and then the row naming it, and nothing where the member holds none. */
export async function chatHostDeregisteredAt(
  key: ChatHostKey,
  ports: ChatHostPorts,
): Promise<ChatHostDeregistered> {
  const clientId = await ports.registry.clientOf(key);
  if (clientId === undefined) return "NotFound";
  await ports.clients.remove(clientId);
  return (await ports.registry.deregister(key, clientId))
    ? "Deregistered"
    : "NotFound";
}

/** The credentials one registration answers, the site's endpoints beside the client. */
export function chatHostCredentialsOf(
  key: ChatHostKey,
  site: WorkerPoolSite,
  minted: WorkerPoolClientSecret,
): ChatHostCredentials {
  return {
    tenant: key.tenant,
    owner: key.owner,
    tokenUrl: site.tokenUrl,
    audience: site.audience,
    planeUrl: site.planeUrl,
    ...(site.registryHost === undefined
      ? {}
      : { registryHost: site.registryHost }),
    clientId: minted.clientId,
    clientSecret: minted.clientSecret,
  };
}

/** A member's own chat host, or nothing where they have none. */
export type ChatHostRead =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly value: ChatHostView };

/** The member's chat host as they read it, its runner beside the release pinned for its package. */
export async function chatHostRead(
  registry: ChatHostRegistry,
  releases: WorkerRunnerReleases,
  key: ChatHostKey,
): Promise<ChatHostRead> {
  const found = await registry.host(key);
  if (found === undefined) return { result: "NotFound" };
  const { runner, ...view } = found;
  const listed = workerRunnerListed(releases, runner);
  return {
    result: "Found",
    value: listed === undefined ? view : { ...view, runner: listed },
  };
}
