/**
 * Connecting a forge account to a tenant and a repository to a project: the
 * authorized service the API's onboarding routes answer from.
 *
 * EVERY QUESTION OF STANDING IS A PERMIT AND NOTHING ELSE. A tenant's
 * administrator claims an installation and reads what it grants; a project's
 * administrator binds one of those repositories; a project's readers see what
 * it binds. No row here records who may do any of that, and the authority a
 * write is audited to is the one the permit answered with, so no transport can
 * authorize one subject and record another.
 *
 * A REFUSED PERMIT IS `NotFound`, as it is at every other route in this tree: a
 * caller who may not see a tenant is not told which of its accounts are
 * claimed, and one who may not administer a project is not told whether it
 * exists.
 *
 * THE FORGE DECIDES WHAT AN INSTALLATION HOLDS, AND A ROW DECIDES WHOSE IT IS.
 * Claiming reads the installation as the app before recording it, so a tenant
 * cannot claim an identity that is not an installation of that app; binding
 * mints against the claim the repository's own owner is covered by, so a
 * repository no claimed installation grants is refused without this tree
 * holding a roster of what an installation contains.
 *
 * BINDING IS NOT CREATING. The project is the door's to find, and a project
 * that is not there is `NotFound` rather than a project this route makes: what
 * a project is and who may make one is 083's question, and a route that created
 * one on the way past would answer it a second way.
 *
 * A TENANT INSTALLS TWO APPS AND A CLAIM NAMES WHICH. The portal app is what
 * this deployment reads and mints through and the worker app is the plane's, so
 * a claim carries the app it is of: an installation identity is the forge's and
 * says nothing about which app it belongs to, and the api verifies one as the
 * app it is claimed for or not at all.
 *
 * A DEPLOYMENT HOLDING NO APP STILL BINDS. Only the three questions that are
 * the forge's — what the app is, what an installation is, and what one grants —
 * need an app key, and each of them is `NotConfigured` without one. Binding
 * proves a repository through the composed credential source, so a deployment
 * whose credentials come from files binds exactly as it always did, and one
 * that mints is refused by the same `Denied` the minting source already
 * answers an unclaimed owner with.
 */

import { assertNever } from "../domain/assertNever.ts";
import type { RepositoryCredentialPort, RepositoryId } from "./finalizer.ts";
import type {
  ForgeAppDescription,
  ForgeApps,
  ForgeInstallationDirectory,
  ForgeInstallationRepositories,
  ForgeRepositorySummary,
} from "./forgeDirectory.ts";
import type {
  ForgeAccount,
  ForgeAccountKind,
  ForgeApp,
  ForgeId,
  ForgeInstallationId,
} from "./forgeInstallation.ts";
import type {
  ForgeInstallationClaimed,
  ForgeInstallationClaims,
  ForgeInstallationRecording,
} from "./forgeInstallationClaim.ts";
import type { OperationId } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition, TenantId } from "./projectStore.ts";
import type {
  ProjectRepositoryBindings,
  ProjectRepositoryBindingWrite,
  ProjectRepositoryBound,
} from "./repositoryBinding.ts";

/** One app this deployment holds the key of, as its own forge describes it. */
export interface ForgeAppSummary extends ForgeAppDescription {
  readonly app: ForgeApp;
}

/**
 * What describing this deployment's apps came to. A deployment holding none is
 * its own answer, and one app this side could not read makes the whole listing
 * a wait: a partial roster would read as an app the deployment does not hold.
 */
export type ForgeAppsResult =
  | { readonly result: "Apps"; readonly apps: readonly ForgeAppSummary[] }
  | { readonly result: "NotConfigured" }
  | { readonly result: "Unavailable" };

/** One installation this tenant holds, which is the claim without the moment it was made. */
export interface ForgeInstallationSummary {
  readonly forge: ForgeId;
  readonly app: ForgeApp;
  readonly account: ForgeAccount;
  readonly accountKind: ForgeAccountKind;
  readonly installationId: ForgeInstallationId;
}

/** What claiming one installation for a tenant came to. */
export type ForgeInstallationClaimResult =
  | {
      readonly result: "Claimed";
      readonly installation: ForgeInstallationSummary;
    }
  | {
      readonly result: "AlreadyClaimed";
      readonly installation: ForgeInstallationSummary;
    }
  | { readonly result: "ClaimedElsewhere" }
  | { readonly result: "InstallationUnknown" }
  | { readonly result: "NotConfigured" }
  | { readonly result: "NotFound" }
  | { readonly result: "Unavailable" };

/** What reading a tenant's claims came to. */
export type ForgeInstallationsResult =
  | {
      readonly result: "Installations";
      readonly installations: readonly ForgeInstallationClaimed[];
    }
  | { readonly result: "NotFound" };

/** What enumerating one claimed installation's repositories came to. */
export type ForgeRepositoriesResult =
  | {
      readonly result: "Repositories";
      readonly repositories: readonly ForgeRepositorySummary[];
      readonly truncated: boolean;
    }
  | { readonly result: "NotConfigured" }
  | { readonly result: "NotFound" }
  | { readonly result: "Unavailable" };

/** What binding one repository to one project came to. */
export type ProjectRepositoryBindResult =
  | { readonly result: "Bound"; readonly repository: RepositoryId }
  | { readonly result: "AlreadyBound"; readonly repository: RepositoryId }
  | { readonly result: "NotInstalled" }
  | { readonly result: "OperationConflict" }
  | { readonly result: "BoundElsewhere" }
  | { readonly result: "EpochChanged" }
  | { readonly result: "NotFound" }
  | { readonly result: "Unavailable" };

/** What reading a project's bindings came to. */
export type ProjectRepositoriesResult =
  | {
      readonly result: "Repositories";
      readonly repositories: readonly ProjectRepositoryBound[];
    }
  | { readonly result: "NotFound" };

/** One claim as a caller sends it: which forge, which app, and which installation of it. */
export interface ForgeInstallationClaimRequest {
  readonly forge: ForgeId;
  readonly app: ForgeApp;
  readonly installationId: ForgeInstallationId;
}

/** One binding as a caller sends it, under the identity that makes a retry one attempt. */
export interface ProjectRepositoryBindRequest {
  readonly repository: RepositoryId;
  readonly operation: OperationId;
}

/** One app's half of the composition, composed for each app this deployment holds a key for. */
export interface RepositoryOnboardingForgeApp {
  readonly forge: ForgeId;
  readonly app: ForgeApp;
  readonly apps: ForgeApps;
  readonly directory: ForgeInstallationDirectory;
  readonly installationRepositories: ForgeInstallationRepositories;
}

/** Everything the service is composed with, one forge half per app a key is held for. */
export interface RepositoryOnboardingPorts {
  readonly access: ProjectAccess;
  readonly forgeApps: readonly RepositoryOnboardingForgeApp[];
  readonly credentials: RepositoryCredentialPort;
  readonly recording: ForgeInstallationRecording;
  readonly claims: ForgeInstallationClaims;
  readonly bindings: ProjectRepositoryBindings;
  readonly binding: ProjectRepositoryBindingWrite;
}

/** The six questions the onboarding routes ask, each behind the permit it needs. */
export interface RepositoryOnboarding {
  forgeApps(): Promise<ForgeAppsResult>;

  claimInstallation(
    principal: Principal,
    tenant: TenantId,
    request: ForgeInstallationClaimRequest,
  ): Promise<ForgeInstallationClaimResult>;

  installations(
    principal: Principal,
    tenant: TenantId,
  ): Promise<ForgeInstallationsResult>;

  installationRepositories(
    principal: Principal,
    tenant: TenantId,
    installationId: ForgeInstallationId,
  ): Promise<ForgeRepositoriesResult>;

  bindRepository(
    principal: Principal,
    partition: Partition,
    request: ProjectRepositoryBindRequest,
  ): Promise<ProjectRepositoryBindResult>;

  projectRepositories(
    principal: Principal,
    partition: Partition,
  ): Promise<ProjectRepositoriesResult>;
}

/** The claim this tenant holds under the identity asked about, and nothing where it holds none. */
function claimedInstallation(
  held: readonly ForgeInstallationClaimed[],
  installationId: ForgeInstallationId,
): ForgeInstallationClaimed | undefined {
  return held.find((claim) => claim.installationId === installationId);
}

/** The half composed for one app on one forge, and nothing where this deployment holds no key for it. */
function heldForgeApp(
  ports: RepositoryOnboardingPorts,
  forge: ForgeId,
  app: ForgeApp,
): RepositoryOnboardingForgeApp | undefined {
  return ports.forgeApps.find(
    (held) => held.forge === forge && held.app === app,
  );
}

/** Every app this deployment holds, as each of their forges describes them. */
async function describedForgeApps(
  ports: RepositoryOnboardingPorts,
): Promise<ForgeAppsResult> {
  if (ports.forgeApps.length === 0) return { result: "NotConfigured" };
  const apps: ForgeAppSummary[] = [];
  for (const held of ports.forgeApps) {
    const described = await held.apps.app();
    if (described.described !== "App") return { result: "Unavailable" };
    apps.push({ app: held.app, ...described.app });
  }
  return { result: "Apps", apps };
}

/** What a recorded claim answers with, the outcome deciding only whether it is new. */
function claimResult(
  recorded: "Recorded" | "AlreadyRecorded" | "Reinstalled",
  installation: ForgeInstallationSummary,
): ForgeInstallationClaimResult {
  return recorded === "AlreadyRecorded"
    ? { result: "AlreadyClaimed", installation }
    : { result: "Claimed", installation };
}

/** The claims this tenant holds, and nothing at all where the permit is refused. */
async function tenantClaims(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  tenant: TenantId,
): Promise<readonly ForgeInstallationClaimed[] | undefined> {
  const authority = await ports.access.authorizeTenant(
    principal,
    tenant,
    "AdministerTenant",
  );
  return authority === undefined ? undefined : ports.claims.claims(tenant);
}

/** One claim, read as the app before it is recorded as the tenant's. */
async function claimInstallation(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  tenant: TenantId,
  request: ForgeInstallationClaimRequest,
): Promise<ForgeInstallationClaimResult> {
  const authority = await ports.access.authorizeTenant(
    principal,
    tenant,
    "AdministerTenant",
  );
  if (authority === undefined) return { result: "NotFound" };
  if (ports.forgeApps.length === 0) return { result: "NotConfigured" };
  if (!ports.forgeApps.some((held) => held.forge === request.forge))
    return { result: "InstallationUnknown" };
  const forge = heldForgeApp(ports, request.forge, request.app);
  if (forge === undefined) return { result: "NotConfigured" };
  const read = await forge.directory.installation(request.installationId);
  if (read.read === "Unavailable") return { result: "Unavailable" };
  if (read.read === "Unknown") return { result: "InstallationUnknown" };
  const installation: ForgeInstallationSummary = {
    forge: forge.forge,
    app: forge.app,
    account: read.installation.account,
    accountKind: read.installation.accountKind,
    installationId: request.installationId,
  };
  const recorded = await ports.recording.record({
    ...installation,
    tenant,
    authority,
  });
  return recorded === "ClaimedElsewhere"
    ? { result: "ClaimedElsewhere" }
    : claimResult(recorded, installation);
}

/** What one claimed installation grants, the claim itself being the tenant's proof. */
async function installationRepositories(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  tenant: TenantId,
  installationId: ForgeInstallationId,
): Promise<ForgeRepositoriesResult> {
  const held = await tenantClaims(ports, principal, tenant);
  if (held === undefined) return { result: "NotFound" };
  const claim = claimedInstallation(held, installationId);
  if (claim === undefined) return { result: "NotFound" };
  const forge = heldForgeApp(ports, claim.forge, claim.app);
  if (forge === undefined) return { result: "NotConfigured" };
  const read = await forge.installationRepositories.repositories({
    forge: claim.forge,
    app: claim.app,
    account: claim.account,
    installationId: claim.installationId,
  });
  switch (read.read) {
    case "Repositories":
      return {
        result: "Repositories",
        repositories: read.repositories,
        truncated: read.truncated,
      };
    case "Denied":
      return { result: "NotFound" };
    case "Unavailable":
      return { result: "Unavailable" };
    default:
      return assertNever(read);
  }
}

/**
 * One binding, proved against the credential source before the door is asked:
 * a repository this deployment cannot get a credential for is one no act on it
 * could ever run, so the source that would have to answer at execution time is
 * the one asked here, and the token that comes back is read for its verdict and
 * dropped. It is the portal claim that is proved, the api's own reads minting
 * under the portal app, and whether the tenant also claimed the worker app on
 * the repository's owner is the plane's question at execution time.
 */
async function bindRepository(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  partition: Partition,
  request: ProjectRepositoryBindRequest,
): Promise<ProjectRepositoryBindResult> {
  const authority = await ports.access.authorize(
    principal,
    partition,
    "Administer",
  );
  if (authority === undefined) return { result: "NotFound" };
  const recoveryEpoch = await ports.binding.currentRecoveryEpoch();
  const proved = await ports.credentials.credential({
    partition,
    repository: request.repository,
    recoveryEpoch,
  });
  if (proved.resolved === "Denied") return { result: "NotInstalled" };
  if (proved.resolved === "Unavailable") return { result: "Unavailable" };
  const outcome = await ports.binding.bind({
    partition,
    repository: request.repository,
    recoveryEpoch,
    operation: request.operation,
    authority,
  });
  switch (outcome) {
    case "Bound":
      return { result: "Bound", repository: request.repository };
    case "AlreadyBound":
      return { result: "AlreadyBound", repository: request.repository };
    case "OperationConflict":
      return { result: "OperationConflict" };
    case "RepositoryBoundElsewhere":
      return { result: "BoundElsewhere" };
    case "RecoveryEpochMismatch":
      return { result: "EpochChanged" };
    case "ProjectAbsent":
      return { result: "NotFound" };
    default:
      return assertNever(outcome);
  }
}

export function repositoryOnboarding(
  ports: RepositoryOnboardingPorts,
): RepositoryOnboarding {
  return {
    forgeApps: () => describedForgeApps(ports),

    claimInstallation: (principal, tenant, request) =>
      claimInstallation(ports, principal, tenant, request),

    installations: async (principal, tenant) => {
      const held = await tenantClaims(ports, principal, tenant);
      return held === undefined
        ? { result: "NotFound" }
        : { result: "Installations", installations: held };
    },

    installationRepositories: (principal, tenant, installationId) =>
      installationRepositories(ports, principal, tenant, installationId),

    bindRepository: (principal, partition, request) =>
      bindRepository(ports, principal, partition, request),

    projectRepositories: async (principal, partition) => {
      if (
        (await ports.access.authorize(principal, partition, "Read")) ===
        undefined
      )
        return { result: "NotFound" };
      return {
        result: "Repositories",
        repositories: await ports.bindings.bindings(partition),
      };
    },
  };
}
