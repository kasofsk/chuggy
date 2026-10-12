/**
 * A member's own runner: the token they mint for it, registering it in their
 * tenant, the projects it may serve, and taking it off.
 *
 * A PERSONAL RUNNER IS ITS OWNER'S, ONE PER TENANT. It is registered under the
 * tenant and the member whose token it redeemed, never under a project, and a
 * second registration by the same member replaces the first. Minting needs the
 * tenant's `RegisterPersonalRunner`, asked again of the minter when the token
 * is redeemed, so a permit taken away in between registers nothing.
 *
 * IT IS TWO WRITES AT TWO AUTHORITIES, NOT A POOL'S THREE. A pool's
 * registration writes the relation its principal is answered `Execute` from; a
 * personal runner's writes none, so its principal holds no permit of any
 * project, and nothing gated on `Execute` — the forge credential a project
 * mints among them — answers it. What it may serve is its allowlist, which
 * starts empty and which its owner writes, one project at a time, under their
 * own `Read` of that project.
 *
 * THE OLD CLIENT GOES BEFORE THE NEW ONE IS MINTED. Replacing a runner removes
 * the client its row names, then mints one and writes the row only where it
 * still names the client removed. A failure part-way leaves a row naming a
 * removed client, which registering again starts from, and two registrations
 * racing for one member leave one row and no client it does not name.
 */

import { assertNever } from "../domain/assertNever.ts";
import { oidcPrincipal, type Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { ProjectId, TenantId } from "./projectStore.ts";
import type {
  WorkerPoolClients,
  WorkerPoolClientSecret,
} from "./workerPool.ts";
import {
  workerPoolTokenLifetimeSecsMax,
  type WorkerPoolSite,
  type WorkerPoolTokenMinted,
  type WorkerPoolTokenRequest,
  type WorkerPoolTokenWritten,
} from "./workerPoolRegistrationToken.ts";

/** Whose runner one row is: a member, in one tenant. */
export interface PersonalRunnerKey {
  readonly tenant: TenantId;
  readonly owner: Principal;
}

/** What registering one runner records: who it is at the issuer and what it declared. */
export interface PersonalRunnerRegistration extends PersonalRunnerKey {
  readonly capabilities: readonly string[];
  readonly clientId: string;
  readonly principal: Principal;
}

/**
 * One runner as its owner reads it, its allowlist in project order: its newest
 * poll of either kind, absent until it polls, and whether that poll is within
 * the window a runner is held live for; and whether its newest poll for
 * executions is, which is the liveness a pool's claim defers to under
 * Preferred.
 */
export interface PersonalRunnerView {
  readonly capabilities: readonly string[];
  readonly registeredAt: string;
  readonly polledAt?: string;
  readonly live: boolean;
  readonly executionsLive: boolean;
  readonly projects: readonly ProjectId[];
}

/** What one row write came to: written, no tenant to write it in, or a row that no longer names the client it was to replace. */
export type PersonalRunnerWritten = "Registered" | "NotFound" | "Moved";

/** What one allowlist addition came to: added or already there, no runner or no active project, or the allowlist at its bound. */
export type PersonalRunnerAllowed = "Allowed" | "NotFound" | "LimitReached";

/**
 * The registry a personal runner is known by. `register` writes a member's row
 * where `replacing` is the client it names now, or where it has none when
 * `replacing` is absent, and `deregister` deletes it on the same condition;
 * `disallow` answers whether the member has a runner at all.
 */
export interface PersonalRunnerRegistry {
  clientOf(key: PersonalRunnerKey): Promise<string | undefined>;
  register(
    registration: PersonalRunnerRegistration,
    replacing: string | undefined,
  ): Promise<PersonalRunnerWritten>;
  deregister(key: PersonalRunnerKey, clientId: string): Promise<boolean>;
  runner(key: PersonalRunnerKey): Promise<PersonalRunnerView | undefined>;
  allow(
    key: PersonalRunnerKey,
    project: ProjectId,
  ): Promise<PersonalRunnerAllowed>;
  disallow(key: PersonalRunnerKey, project: ProjectId): Promise<boolean>;
}

/** What a personal token permits, and the member it registers a runner for. */
export interface PersonalRunnerTokenTerms {
  readonly tenant: TenantId;
  readonly capabilities: readonly string[];
  readonly mintedBy: Principal;
}

/** The most tokens one member may have outstanding in one tenant at once. */
export const personalRunnerTokensLiveMax = 4;

/** A personal token's whole life, as `WorkerPoolRegistrationTokens` is a pool token's, bounded per member and tenant. */
export interface PersonalRunnerRegistrationTokens {
  mint(
    tenant: TenantId,
    digest: string,
    capabilities: readonly string[],
    expiresAtMs: number,
    mintedBy: Principal,
  ): Promise<WorkerPoolTokenWritten>;
  permitted(digest: string): Promise<PersonalRunnerTokenTerms | undefined>;
  consume(digest: string): Promise<PersonalRunnerTokenTerms | undefined>;
  restore(digest: string): Promise<boolean>;
}

/** How a token is drawn and digested, and what the clock says, all supplied. */
export interface PersonalRunnerTokenMinting {
  readonly tokens: PersonalRunnerRegistrationTokens;
  readonly draw: () => string;
  readonly digest: (token: string) => string;
  readonly nowMs: () => number;
}

/** The two authorities a registration writes at, and how a client is named. */
export interface PersonalRunnerPorts {
  readonly registry: PersonalRunnerRegistry;
  readonly clients: WorkerPoolClients;
  readonly clientId: () => string;
}

/** Everything a runner needs to serve its owner, its secret included, answered once and naming no project. */
export interface PersonalRunnerCredentials
  extends Omit<WorkerPoolSite, "issuer">, WorkerPoolClientSecret {
  readonly tenant: TenantId;
  readonly owner: Principal;
  readonly capabilities: readonly string[];
}

/** What one registration's writes came to. */
export type PersonalRunnerRegisteredAt =
  | { readonly result: "NotFound" }
  | { readonly result: "Moved" }
  | { readonly result: "Registered"; readonly value: WorkerPoolClientSecret };

/**
 * The writes registering a member's runner is: the client the row names now
 * removed, a client minted, and the row written over the one read. A row that
 * could not be written takes the new client with it.
 */
export async function personalRunnerRegisteredAt(
  key: PersonalRunnerKey,
  capabilities: readonly string[],
  issuer: string,
  ports: PersonalRunnerPorts,
): Promise<PersonalRunnerRegisteredAt> {
  const replacing = await ports.registry.clientOf(key);
  if (replacing !== undefined) await ports.clients.remove(replacing);
  const minted = await ports.clients.create(ports.clientId());
  let written: PersonalRunnerWritten;
  try {
    written = await ports.registry.register(
      {
        ...key,
        capabilities,
        clientId: minted.clientId,
        principal: oidcPrincipal(issuer, minted.clientId),
      },
      replacing,
    );
  } catch (failure) {
    await ports.clients.remove(minted.clientId).catch(() => undefined);
    throw failure;
  }
  if (written === "Registered") return { result: "Registered", value: minted };
  await ports.clients.remove(minted.clientId);
  return { result: written };
}

/** What taking a runner off came to: gone, never there, or registered again while it was being taken off. */
export type PersonalRunnerDeregistered = "Deregistered" | "NotFound" | "Moved";

/** The two writes taken back: the client, then the row that named it, and the row only where it still does. */
export async function personalRunnerDeregisteredAt(
  key: PersonalRunnerKey,
  ports: PersonalRunnerPorts,
): Promise<PersonalRunnerDeregistered> {
  const clientId = await ports.registry.clientOf(key);
  if (clientId === undefined) return "NotFound";
  await ports.clients.remove(clientId);
  return (await ports.registry.deregister(key, clientId))
    ? "Deregistered"
    : "Moved";
}

const millisecondsPerSecond = 1_000;

/**
 * Minting, exposed only through the tenant's current `RegisterPersonalRunner`
 * for the caller, who is the owner of whatever the token registers.
 */
export async function personalRunnerTokenMint(
  access: ProjectAccess,
  minting: PersonalRunnerTokenMinting,
  principal: Principal,
  tenant: TenantId,
  request: WorkerPoolTokenRequest,
): Promise<WorkerPoolTokenMinted> {
  if (
    !Number.isSafeInteger(request.lifetimeSecs) ||
    request.lifetimeSecs < 1 ||
    request.lifetimeSecs > workerPoolTokenLifetimeSecsMax
  )
    throw new RangeError(
      "personal runner registration token lifetime is past its bound",
    );
  if (
    (await access.authorizeTenant(
      principal,
      tenant,
      "RegisterPersonalRunner",
    )) === undefined
  )
    return { result: "NotFound" };
  const token = minting.draw();
  const expiresAtMs =
    minting.nowMs() + request.lifetimeSecs * millisecondsPerSecond;
  const written = await minting.tokens.mint(
    tenant,
    minting.digest(token),
    request.capabilities,
    expiresAtMs,
    principal,
  );
  switch (written) {
    case "Minted":
      return { result: "Minted", value: { token, expiresAtMs } };
    case "NotFound":
      return { result: "NotFound" };
    case "LimitReached":
      return { result: "LimitReached" };
    default:
      return assertNever(written);
  }
}

/** What one redemption offers: the token it holds and what it claims. */
export interface PersonalRunnerRedemption {
  readonly token: string;
  readonly capabilities: readonly string[];
}

/** What redeeming came to; `Conflict` is another registration for the same member winning the race, and its token is given back. */
export type PersonalRunnerTokenRedeemed =
  | { readonly result: "NotFound" }
  | { readonly result: "CapabilityNotPermitted" }
  | { readonly result: "Conflict" }
  | {
      readonly result: "Registered";
      readonly value: PersonalRunnerCredentials;
    };

/** Whether the token's minter is still permitted to register a runner in its tenant. */
async function personalRunnerMinterPermitted(
  access: ProjectAccess,
  terms: PersonalRunnerTokenTerms,
): Promise<boolean> {
  return (
    (await access.authorizeTenant(
      terms.mintedBy,
      terms.tenant,
      "RegisterPersonalRunner",
    )) !== undefined
  );
}

/** The credentials one registration answers, the site's endpoints beside the client. */
function personalRunnerCredentialsOf(
  terms: PersonalRunnerTokenTerms,
  offered: PersonalRunnerRedemption,
  site: WorkerPoolSite,
  minted: WorkerPoolClientSecret,
): PersonalRunnerCredentials {
  return {
    tenant: terms.tenant,
    owner: terms.mintedBy,
    capabilities: offered.capabilities,
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

/**
 * Redemption, authenticated on the token alone and authorized on what it
 * permits and on its minter's current permit. As a pool token's, it is read
 * before it is spent and given back where the writes after the spend faulted.
 */
export async function personalRunnerTokenRedeem(
  access: ProjectAccess,
  minting: PersonalRunnerTokenMinting,
  ports: PersonalRunnerPorts,
  site: WorkerPoolSite,
  offered: PersonalRunnerRedemption,
): Promise<PersonalRunnerTokenRedeemed> {
  const digest = minting.digest(offered.token);
  const terms = await minting.tokens.permitted(digest);
  if (terms === undefined) return { result: "NotFound" };
  if (!offered.capabilities.every((held) => terms.capabilities.includes(held)))
    return { result: "CapabilityNotPermitted" };
  if (!(await personalRunnerMinterPermitted(access, terms)))
    return { result: "NotFound" };
  const spent = await minting.tokens.consume(digest);
  if (spent === undefined) return { result: "NotFound" };
  let registered: PersonalRunnerRegisteredAt;
  try {
    registered = await personalRunnerRegisteredAt(
      { tenant: spent.tenant, owner: spent.mintedBy },
      offered.capabilities,
      site.issuer,
      ports,
    );
  } catch (failure) {
    await minting.tokens.restore(digest);
    throw failure;
  }
  switch (registered.result) {
    case "NotFound":
      return { result: "NotFound" };
    case "Moved":
      await minting.tokens.restore(digest);
      return { result: "Conflict" };
    case "Registered":
      return {
        result: "Registered",
        value: personalRunnerCredentialsOf(
          spent,
          offered,
          site,
          registered.value,
        ),
      };
    default:
      return assertNever(registered);
  }
}

/** A member's own runner, or nothing where they have none. */
export type PersonalRunnerRead =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly value: PersonalRunnerView };

/** What one allowlist removal came to. */
export type PersonalRunnerDisallowed = "Removed" | "NotFound";

/**
 * Adding a project to the caller's own allowlist, only where the caller may
 * read it: a project the owner cannot see is one their runner may not serve,
 * and is answered as a project that is not there.
 */
async function personalRunnerProjectAllowed(
  access: ProjectAccess,
  registry: PersonalRunnerRegistry,
  key: PersonalRunnerKey,
  project: ProjectId,
): Promise<PersonalRunnerAllowed> {
  if (
    (await access.authorize(
      key.owner,
      { tenant: key.tenant, project },
      "Read",
    )) === undefined
  )
    return "NotFound";
  return registry.allow(key, project);
}

/**
 * Taking a member's runner off, by its owner or by an administrator of the
 * tenant. The member is named by their subject under the site's issuer, and a
 * caller who is neither is answered as a runner that is not there.
 */
async function personalRunnerMemberDeregistered(
  access: ProjectAccess,
  ports: PersonalRunnerPorts,
  issuer: string,
  caller: Principal,
  tenant: TenantId,
  subject: string,
): Promise<PersonalRunnerDeregistered> {
  const owner = oidcPrincipal(issuer, subject);
  if (
    owner !== caller &&
    (await access.authorizeTenant(caller, tenant, "AdministerTenant")) ===
      undefined
  )
    return "NotFound";
  return personalRunnerDeregisteredAt({ tenant, owner }, ports);
}

/**
 * The calls the boundary makes, composed once so that no route holds the
 * issuer's name or the ports registration is written at. Every call but
 * `deregisterMember` acts on the caller's own runner.
 */
export interface PersonalRunnerService {
  mint(
    principal: Principal,
    tenant: TenantId,
    request: WorkerPoolTokenRequest,
  ): Promise<WorkerPoolTokenMinted>;
  redeem(
    offered: PersonalRunnerRedemption,
  ): Promise<PersonalRunnerTokenRedeemed>;
  runner(principal: Principal, tenant: TenantId): Promise<PersonalRunnerRead>;
  /** Whether the tenant permits the caller to register a runner, which is what minting asks. */
  permitted(principal: Principal, tenant: TenantId): Promise<boolean>;
  allow(
    principal: Principal,
    tenant: TenantId,
    project: ProjectId,
  ): Promise<PersonalRunnerAllowed>;
  disallow(
    principal: Principal,
    tenant: TenantId,
    project: ProjectId,
  ): Promise<PersonalRunnerDisallowed>;
  deregister(
    principal: Principal,
    tenant: TenantId,
  ): Promise<PersonalRunnerDeregistered>;
  deregisterMember(
    principal: Principal,
    tenant: TenantId,
    subject: string,
  ): Promise<PersonalRunnerDeregistered>;
}

export function personalRunnerService(input: {
  readonly access: ProjectAccess;
  readonly minting: PersonalRunnerTokenMinting;
  readonly ports: PersonalRunnerPorts;
  readonly site: WorkerPoolSite;
}): PersonalRunnerService {
  const { access, minting, ports, site } = input;
  return {
    mint: (principal, tenant, request) =>
      personalRunnerTokenMint(access, minting, principal, tenant, request),
    redeem: (offered) =>
      personalRunnerTokenRedeem(access, minting, ports, site, offered),
    runner: async (owner, tenant) => {
      const found = await ports.registry.runner({ tenant, owner });
      return found === undefined
        ? { result: "NotFound" }
        : { result: "Found", value: found };
    },
    permitted: async (principal, tenant) =>
      (await access.authorizeTenant(
        principal,
        tenant,
        "RegisterPersonalRunner",
      )) !== undefined,
    allow: (owner, tenant, project) =>
      personalRunnerProjectAllowed(
        access,
        ports.registry,
        { tenant, owner },
        project,
      ),
    disallow: async (owner, tenant, project) =>
      (await ports.registry.disallow({ tenant, owner }, project))
        ? "Removed"
        : "NotFound",
    deregister: (owner, tenant) =>
      personalRunnerDeregisteredAt({ tenant, owner }, ports),
    deregisterMember: (caller, tenant, subject) =>
      personalRunnerMemberDeregistered(
        access,
        ports,
        site.issuer,
        caller,
        tenant,
        subject,
      ),
  };
}
