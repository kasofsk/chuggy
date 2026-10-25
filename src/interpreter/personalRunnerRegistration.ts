/**
 * A member's own runners: the token they mint for one, registering it in their
 * tenant, the projects their runners may serve, and taking them off.
 *
 * A PERSONAL RUNNER IS ITS OWNER'S, AS MANY PER TENANT AS `personalRunnersMax`.
 * It is registered under the tenant and the member whose token it redeemed,
 * never under a project, and each registration adds a runner of its own, named
 * by the client it minted. Minting needs the tenant's `RegisterPersonalRunner`,
 * asked again of the minter when the token is redeemed, so a permit taken away
 * in between registers nothing.
 *
 * IT IS TWO WRITES AT TWO AUTHORITIES, NOT A POOL'S THREE. A pool's
 * registration writes the relation its principal is answered `Execute` from; a
 * personal runner's writes none, so its principal holds no permit of any
 * project, and nothing gated on `Execute` — the forge credential a project
 * mints among them — answers it. What its owner's runners may serve is one
 * allowlist, which starts empty, which its owner writes one project at a time
 * under their own `Read` of that project, and which goes with their last
 * runner.
 *
 * A CLIENT GOES BEFORE ITS ROW. Taking a runner off removes the client its row
 * names and then deletes the row, so a failure part-way leaves a row naming a
 * removed client, which taking it off again starts from. A registration the
 * registry refuses takes the client it minted with it.
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
import {
  workerRunnerListed,
  type WorkerRunnerListed,
  type WorkerRunnerReleases,
} from "./workerRunnerRelease.ts";

/** Whose runners a row is one of: a member, in one tenant. */
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
 * One runner as its owner reads it, by the client it registered: its newest
 * poll of either kind, absent until it polls, and whether that poll is within
 * the window a runner is held live for; whether its newest poll for executions
 * is, which is the liveness a pool's claim defers to under Preferred; and the
 * runner its newest poll named, absent where it named none.
 */
export interface PersonalRunnerView {
  readonly id: string;
  readonly capabilities: readonly string[];
  readonly registeredAt: string;
  readonly polledAt?: string;
  readonly live: boolean;
  readonly executionsLive: boolean;
  readonly runner?: WorkerRunnerListed;
}

/** A member's runners in a tenant, oldest first, and the projects they serve, in project order. */
export interface PersonalRunnerOwnerView {
  readonly runners: readonly PersonalRunnerView[];
  readonly projects: readonly ProjectId[];
}

/** What one registration came to: written, no tenant to write it in, or the member already holding `personalRunnersMax`. */
export type PersonalRunnerWritten = "Registered" | "NotFound" | "LimitReached";

/** What one allowlist addition came to: added or already there, no runner or no active project, or the allowlist at its bound. */
export type PersonalRunnerAllowed = "Allowed" | "NotFound" | "LimitReached";

/**
 * The registry personal runners are known by. `clientsOf` answers the clients
 * of a member's runners, oldest first; `deregister` deletes the member's runner
 * naming a client, and with the last of them their allowlist, answering
 * whether there was one to delete; `disallow` answers whether the member has a
 * runner at all.
 */
export interface PersonalRunnerRegistry {
  clientsOf(key: PersonalRunnerKey): Promise<readonly string[]>;
  register(
    registration: PersonalRunnerRegistration,
  ): Promise<PersonalRunnerWritten>;
  deregister(key: PersonalRunnerKey, clientId: string): Promise<boolean>;
  runners(key: PersonalRunnerKey): Promise<PersonalRunnerOwnerView | undefined>;
  allow(
    key: PersonalRunnerKey,
    project: ProjectId,
  ): Promise<PersonalRunnerAllowed>;
  disallow(key: PersonalRunnerKey, project: ProjectId): Promise<boolean>;
}

/** The tenant a personal token registers a runner in, and the member it registers it for. */
export interface PersonalRunnerTokenTerms {
  readonly tenant: TenantId;
  readonly mintedBy: Principal;
}

/** The most tokens one member may have outstanding in one tenant at once. */
export const personalRunnerTokensLiveMax = 4;

/**
 * A personal token's whole life, as `WorkerPoolRegistrationTokens` is a pool
 * token's, bounded per member and tenant, and `permitted` beside it, which
 * reads one neither spent nor expired without spending it.
 */
export interface PersonalRunnerRegistrationTokens {
  mint(
    tenant: TenantId,
    digest: string,
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
  | { readonly result: "LimitReached" }
  | { readonly result: "Registered"; readonly value: WorkerPoolClientSecret };

/**
 * The writes registering one more of a member's runners is: a client minted,
 * and a row naming it. A row that could not be written takes the client with
 * it.
 */
export async function personalRunnerRegisteredAt(
  key: PersonalRunnerKey,
  capabilities: readonly string[],
  issuer: string,
  ports: PersonalRunnerPorts,
): Promise<PersonalRunnerRegisteredAt> {
  const minted = await ports.clients.create(ports.clientId());
  let written: PersonalRunnerWritten;
  try {
    written = await ports.registry.register({
      ...key,
      capabilities,
      clientId: minted.clientId,
      principal: oidcPrincipal(issuer, minted.clientId),
    });
  } catch (failure) {
    await ports.clients.remove(minted.clientId).catch(() => undefined);
    throw failure;
  }
  if (written === "Registered") return { result: "Registered", value: minted };
  await ports.clients.remove(minted.clientId);
  return { result: written };
}

/** What taking runners off came to: gone, or none there to take. */
export type PersonalRunnerDeregistered = "Deregistered" | "NotFound";

/** The two writes of one runner taken back, the client and then the row naming it, and nothing where the member holds no runner of that client. */
export async function personalRunnerDeregisteredAt(
  key: PersonalRunnerKey,
  clientId: string,
  ports: PersonalRunnerPorts,
): Promise<PersonalRunnerDeregistered> {
  if (!(await ports.registry.clientsOf(key)).includes(clientId))
    return "NotFound";
  await ports.clients.remove(clientId);
  return (await ports.registry.deregister(key, clientId))
    ? "Deregistered"
    : "NotFound";
}

/** Every runner the member holds taken back, one at a time and oldest first. */
export async function personalRunnersDeregisteredAt(
  key: PersonalRunnerKey,
  ports: PersonalRunnerPorts,
): Promise<PersonalRunnerDeregistered> {
  const held = await ports.registry.clientsOf(key);
  if (held.length === 0) return "NotFound";
  for (const clientId of held) {
    await ports.clients.remove(clientId);
    await ports.registry.deregister(key, clientId);
  }
  return "Deregistered";
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

/** What redeeming came to; `LimitReached` is the member already holding `personalRunnersMax`, and its token is given back. */
export type PersonalRunnerTokenRedeemed =
  | { readonly result: "NotFound" }
  | { readonly result: "LimitReached" }
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
 * Redemption, authenticated on the token alone and authorized on its minter's
 * current permit, registering the runner with what it declares. The token is
 * read before it is spent, so one whose minter has lost the permit stays
 * unspent, and given back where the writes after the spend faulted, as a pool
 * token is.
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
    case "LimitReached":
      await minting.tokens.restore(digest);
      return { result: "LimitReached" };
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

/** A member's own runners, or nothing where they have none. */
export type PersonalRunnerRead =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly value: PersonalRunnerOwnerView };

/** What one allowlist removal came to. */
export type PersonalRunnerDisallowed = "Removed" | "NotFound";

/**
 * Adding a project to the caller's own allowlist, only where the caller may
 * read it: a project the owner cannot see is one their runners may not serve,
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
 * Taking every runner of a member's off, by their owner or by an administrator
 * of the tenant. The member is named by their subject under the site's issuer,
 * and a caller who is neither is answered as a member with no runner.
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
  return personalRunnersDeregisteredAt({ tenant, owner }, ports);
}

/**
 * The calls the boundary makes, composed once so that no route holds the
 * issuer's name or the ports registration is written at. Every call but
 * `deregisterMember` acts on the caller's own runners; `deregister` takes all
 * of them off and `deregisterRunner` the one its client names.
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
  runners(principal: Principal, tenant: TenantId): Promise<PersonalRunnerRead>;
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
  deregisterRunner(
    principal: Principal,
    tenant: TenantId,
    runner: string,
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
  readonly releases: WorkerRunnerReleases;
}): PersonalRunnerService {
  const { access, minting, ports, site, releases } = input;
  return {
    mint: (principal, tenant, request) =>
      personalRunnerTokenMint(access, minting, principal, tenant, request),
    redeem: (offered) =>
      personalRunnerTokenRedeem(access, minting, ports, site, offered),
    runners: async (owner, tenant) => {
      const found = await ports.registry.runners({ tenant, owner });
      if (found === undefined) return { result: "NotFound" };
      return {
        result: "Found",
        value: {
          ...found,
          runners: found.runners.map(({ runner, ...view }) => {
            const listed = workerRunnerListed(releases, runner);
            return listed === undefined ? view : { ...view, runner: listed };
          }),
        },
      };
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
      personalRunnersDeregisteredAt({ tenant, owner }, ports),
    deregisterRunner: (owner, tenant, runner) =>
      personalRunnerDeregisteredAt({ tenant, owner }, runner, ports),
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
