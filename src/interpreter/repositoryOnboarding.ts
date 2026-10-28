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
 * A tenant claims only the accounts a person's own authorization proves they
 * own; binding mints against the claim the repository's own owner is covered
 * by, so a repository no claimed installation grants is refused without this
 * tree holding a roster of what an installation contains.
 *
 * BINDING IS NOT CREATING. The project is the door's to find, and a project
 * that is not there is `NotFound` rather than a project this route makes: who
 * may make one is `./projectCreation.ts`'s question, and a route that created
 * one on the way past would answer it a second way.
 *
 * A TENANT INSTALLS TWO APPS AND A CLAIM NAMES WHICH. The portal app is what a
 * person authorizes and what this deployment mints through, and the worker app
 * is the plane's, found on each proven account under the worker's own key.
 *
 * A DEPLOYMENT HOLDING NO APP STILL BINDS. Only the questions that are the
 * forge's — what the app is, where it is installed, what one grants, and
 * whether one has accepted what its app asks for — need an app key, and each
 * of them is `NotConfigured` without one. Binding proves a repository through
 * the composed credential source, so a deployment whose credentials come from
 * files binds exactly as it always did, and one that mints is refused by the
 * same `Denied` the minting source already answers an unclaimed owner with.
 *
 * A NEWLY BOUND REPOSITORY IS LEFT CONFIGURED EITHER WAY. A project that binds
 * a repository declaring configurations wanted them, and one that binds a
 * repository declaring none still needs something to run its first ticket on —
 * so the bind imports what is there and authors the bootstrap where there is
 * nothing, at the repository's own head because the caller holds no ticket to
 * take a commit from.
 *
 * THAT STEP IS BEST EFFORT AND THE BIND IS NOT. The binding is already durable
 * when it runs, so every way it can fail is a reason reported beside a
 * repository that is bound rather than a refusal that would claim it is not.
 * `AlreadyBound` runs nothing; a step that did not take is asked for again by
 * the configuration route, which runs it for a repository the project holds
 * nothing for and answers what the project holds for any other.
 *
 * A BOOTSTRAP IS ONE REPOSITORY'S, AT A REVISION NAMED FOR IT, so two steps
 * racing to author it author one row and two repositories' bootstraps are two:
 * the second step meets the first's revision as the one it already is. A
 * revision is never rewritten, so a stored bootstrap whose text differs, being
 * one the generator words otherwise or one the release rule has since
 * outgrown, is met as `BootstrapDiffers` rather than replaced, and only counts
 * as held for its own repository and while it still releases.
 *
 * WHETHER THE WORKER APP REACHES A REPOSITORY IS REPORTED, NOT REQUIRED. A bind
 * proves the portal claim, and a repository the worker App's installation does
 * not select is still bound, with that reason beside it at the bind and on
 * every listing, read afresh each time by `./repositoryWorkerReach.ts`.
 */

import { assertNever } from "../domain/assertNever.ts";
import {
  bootstrapConfigurationRevision,
  releaseConfigurationReadiness,
  type AuthoringStore,
  type CanonicalConfiguration,
  type ConfigurationRevisionId,
} from "./authoring.ts";
import { bootstrapConfiguration } from "./bootstrapConfiguration.ts";
import type {
  GitRefName,
  RepositoryBinding,
  RepositoryCredentialPort,
  RepositoryId,
} from "./finalizer.ts";
import {
  importRepositoryConfigurations,
  importRepositoryConfigurationsHeadUnread,
  repositoryConfigurationIgnoredField,
  type RepositoryConfigurationIgnored,
  type RepositoryConfigurationImportAttempt,
  type RepositoryConfigurationImportPorts,
  type RepositoryDefaultBranchPort,
} from "./repositoryConfiguration.ts";
import type {
  ForgeAppDescription,
  ForgeApps,
  ForgeInstallationDirectory,
  ForgeInstallationPermissions,
  ForgeInstallationRepositories,
  ForgeRepositorySummary,
} from "./forgeDirectory.ts";
import {
  workerPodForgeApp,
  type ForgeAccount,
  type ForgeAccountKind,
  type ForgeApp,
  type ForgeId,
  type ForgeInstallationId,
  type ForgeInstallationStore,
} from "./forgeInstallation.ts";
import type {
  ForgeInstallationClaimed,
  ForgeInstallationClaims,
  ForgeInstallationRecording,
} from "./forgeInstallationClaim.ts";
import {
  forgeAccountProof,
  type ForgeAccountProof,
  type ForgeAppClaim,
  type ForgeAuthorizationGrant,
  type ForgeUser,
  type ForgeUserAuthorization,
  type ForgeUserInstallation,
} from "./forgeAuthorization.ts";
import type { Authority, OperationId } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition, TenantId } from "./projectStore.ts";
import type {
  ProjectRepositoryBindings,
  ProjectRepositoryBindingWrite,
  ProjectRepositoryBound,
  ProjectRepositoryLandingStore,
  ProjectRepositoryLandingWrite,
  ProjectRepositoryRetirementStore,
  RepositoryLanding,
} from "./repositoryBinding.ts";
import {
  repositoryWorkerReaches,
  type RepositoryWorkerReach,
} from "./repositoryWorkerReach.ts";

/** One app this deployment holds the key of, as its own forge describes it. */
export interface ForgeAppSummary extends ForgeAppDescription {
  readonly app: ForgeApp;
}

/** The client a person authorizes to prove what they own, and where they are sent to do it. */
export interface ForgeAuthorizationClient {
  readonly clientId: string;
  readonly authorizeUrl: string;
}

/**
 * What describing this deployment's apps came to: one app this side could not
 * read makes the whole listing a wait, since a partial roster would read as an
 * app the deployment does not hold. `authorization` is present only where this
 * deployment can redeem one.
 */
export type ForgeAppsResult =
  | {
      readonly result: "Apps";
      readonly apps: readonly ForgeAppSummary[];
      readonly authorization?: ForgeAuthorizationClient;
    }
  | { readonly result: "NotConfigured" }
  | { readonly result: "Unavailable" };

/** What claiming one app on a proven account came to. */
export interface ForgeAuthorizedApp {
  readonly app: ForgeApp;
  readonly claim: ForgeAppClaim;
}

/** One account a person's authorization reaches, whether it is theirs, and each app claimed on it where it is. */
export interface ForgeAuthorizedAccount {
  readonly account: ForgeAccount;
  readonly accountKind: ForgeAccountKind;
  readonly proof: ForgeAccountProof;
  readonly apps: readonly ForgeAuthorizedApp[];
}

/** What redeeming one person's authorization for a tenant came to. */
export type ForgeAuthorizationResult =
  | {
      readonly result: "Authorized";
      readonly accounts: readonly ForgeAuthorizedAccount[];
      readonly truncated: boolean;
    }
  | { readonly result: "Refused" }
  | { readonly result: "Spent" }
  | { readonly result: "NotConfigured" }
  | { readonly result: "NotFound" }
  | { readonly result: "Unavailable" };

/** What reading a tenant's claims came to, `truncated` saying it holds more. */
export type ForgeInstallationsResult =
  | {
      readonly result: "Installations";
      readonly installations: readonly ForgeInstallationClaimed[];
      readonly truncated: boolean;
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

/** What comparing one claimed installation's permissions with its app's came to. */
export type ForgeInstallationPermissionsResult =
  | {
      readonly result: "Permissions";
      readonly permissions: ForgeInstallationPermissions;
      readonly settingsUrl: string;
    }
  | { readonly result: "NotConfigured" }
  | { readonly result: "NotFound" }
  | { readonly result: "Unavailable" };

/**
 * Why a bound repository came away from the configuration step with no
 * configurations of its own. Every one of them is a step that did not run or
 * did not take, and none of them says anything about whether the repository is
 * bound.
 */
export const allProjectRepositoryConfigurationsDeferrals = [
  "NotConfigured",
  "NoBootstrapImage",
  "DefaultBranchAbsent",
  "DefaultBranchUnavailable",
  "RepositoryAbsent",
  "SnapshotAbsent",
  "SnapshotUnavailable",
  "SnapshotRefused",
  "DeclarationsRefused",
  "IdentityConflict",
  "BootstrapDiffers",
  "StaleBinding",
  "NotFound",
  "ParentNotFound",
  "StepFailed",
] as const;

export type ProjectRepositoryConfigurationsDeferral =
  (typeof allProjectRepositoryConfigurationsDeferrals)[number];

/** What a project holds for one bound repository, which a step that deferred left none of. */
export type ProjectRepositoryConfigurationsHeld =
  | { readonly result: "Imported"; readonly count: number }
  | {
      readonly result: "Bootstrapped";
      readonly revision: ConfigurationRevisionId;
    };

/**
 * What configuring one bound repository came to, or what the project already
 * held for it. A bootstrap authored for a head declaring no configuration says
 * what under `.chug/` the head held instead; what the project held was answered
 * without reading one.
 */
export type ProjectRepositoryConfigurationsResult =
  | { readonly result: "Imported"; readonly count: number }
  | {
      readonly result: "Bootstrapped";
      readonly revision: ConfigurationRevisionId;
      readonly ignored?: RepositoryConfigurationIgnored;
    }
  | {
      readonly result: "Deferred";
      readonly reason: ProjectRepositoryConfigurationsDeferral;
    };

/** Why the worker App cannot be said to reach a bound repository, which a binding it reaches carries none of. */
export type ProjectRepositoryWorkerUnreached = Exclude<
  RepositoryWorkerReach,
  { readonly reach: "Covered" }
>;

/** A binding's `workerReach`, absent where the worker App reaches it or this deployment asks no worker App. */
type ProjectRepositoryWorkerReachField = {
  readonly workerReach?: ProjectRepositoryWorkerUnreached;
};

/** What binding one repository to one project came to. */
export type ProjectRepositoryBindResult =
  | ({
      readonly result: "Bound";
      readonly repository: RepositoryId;
      readonly landing: RepositoryLanding;
      readonly configurations: ProjectRepositoryConfigurationsResult;
    } & ProjectRepositoryWorkerReachField)
  | { readonly result: "AlreadyBound"; readonly repository: RepositoryId }
  | { readonly result: "NotInstalled" }
  | { readonly result: "OperationConflict" }
  | { readonly result: "BoundElsewhere" }
  | { readonly result: "EpochChanged" }
  | { readonly result: "NotFound" }
  | { readonly result: "Unavailable" };

/**
 * One binding as the listing answers it. `configurationsHeld` is the names
 * this repository declared into the project, or the bootstrap that still
 * releases for it, and `configured` is its presence; where the project holds
 * neither, the configuration route runs the step again.
 */
export type ProjectRepositoryListed = ProjectRepositoryBound & {
  /** The last configuration import attempted of it, absent where none was. */
  readonly lastImport?: RepositoryConfigurationImportAttempt;
} & ProjectRepositoryWorkerReachField &
  (
    | { readonly configured: false }
    | {
        readonly configured: true;
        readonly configurationsHeld: ProjectRepositoryConfigurationsHeld;
      }
  );

/** What reading a project's bindings came to. */
export type ProjectRepositoriesResult =
  | {
      readonly result: "Repositories";
      readonly repositories: readonly ProjectRepositoryListed[];
    }
  | { readonly result: "NotFound" };

/**
 * What asking for one binding's configuration step came to. A retired binding
 * is refused rather than configured, because no ticket names it and binding it
 * again runs the step anyway.
 */
export type ProjectRepositoryConfigureResult =
  | {
      readonly result: "Configurations";
      readonly repository: RepositoryId;
      readonly configurations: ProjectRepositoryConfigurationsResult;
    }
  | { readonly result: "Retired" }
  | { readonly result: "NotBound" }
  | { readonly result: "NotFound" };

/**
 * What writing one binding's settings came to. A conflict answers the binding
 * as it stands, because the writer's next act is to read it again; a repository
 * this project does not bind is the same miss as a project it may not see.
 */
export type ProjectRepositoryLandingResult =
  | { readonly result: "Written"; readonly repository: ProjectRepositoryBound }
  | {
      readonly result: "LandingMoved";
      readonly repository: ProjectRepositoryBound;
    }
  | { readonly result: "NotBound" }
  | { readonly result: "NotFound" }
  | { readonly result: "Unavailable" };

/**
 * What retiring one binding came to. `Retired` carries the row as it now
 * stands, which is what the caller reads to see that the retirement landed; a
 * repository this project does not bind is the same miss as a project it may
 * not see.
 */
export type ProjectRepositoryRetirementResult =
  | { readonly result: "Retired"; readonly repository: ProjectRepositoryBound }
  | { readonly result: "NotBound" }
  | { readonly result: "NotFound" }
  | { readonly result: "Unavailable" };

/** One authorization as a caller sends it: which forge, and what the person's authorization came back with. */
export interface ForgeAuthorizationRequest extends ForgeAuthorizationGrant {
  readonly forge: ForgeId;
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
  /** The account owning a repository on this forge, nothing where the forge addresses no such repository. */
  readonly accountOf: (repository: RepositoryId) => ForgeAccount | undefined;
  readonly apps: ForgeApps;
  readonly directory: ForgeInstallationDirectory;
  readonly installationRepositories: ForgeInstallationRepositories;
}

/** The app a person authorizes, and the port that redeems what their authorization came back with. */
export interface RepositoryOnboardingAuthorization {
  readonly forge: ForgeId;
  readonly app: ForgeApp;
  readonly user: ForgeUserAuthorization;
}

/**
 * What a project already holds from the configuration step: how many names
 * each repository asked about declared into it, a repository that declared none
 * absent, and the text of each bootstrap revision asked about that the project
 * holds, one it does not absent. The text rather than a flag, because whether a
 * stored revision still releases is the release rule's answer today and not the
 * one it gave when authored.
 */
export interface RepositoryConfigurationsHeld {
  readonly declared: ReadonlyMap<RepositoryId, number>;
  readonly bootstraps: ReadonlyMap<
    ConfigurationRevisionId,
    CanonicalConfiguration
  >;
}

/** Reads what a project holds from the configuration step, for the repositories it binds and their bootstraps' revisions. */
export interface RepositoryConfigurationsHeldRead {
  held(query: {
    readonly partition: Partition;
    readonly repositories: readonly RepositoryId[];
    readonly bootstraps: readonly ConfigurationRevisionId[];
  }): Promise<RepositoryConfigurationsHeld>;
}

/** Reads the last configuration import attempted of each repository named, a repository never attempted absent. */
export interface RepositoryConfigurationImportAttemptsRead {
  attempted(query: {
    readonly partition: Partition;
    readonly repositories: readonly RepositoryId[];
  }): Promise<ReadonlyMap<RepositoryId, RepositoryConfigurationImportAttempt>>;
}

/**
 * The half a bind's configuration step is composed with. `bootstrapImage` is
 * the worker image a bootstrap configuration commands, and a deployment naming
 * none imports what a repository declares and defers the rest: a configuration
 * commanding no image is one nothing could run.
 */
export interface RepositoryConfigurationsPorts {
  readonly heads: RepositoryDefaultBranchPort;
  readonly imports: RepositoryConfigurationImportPorts;
  readonly authoring: Pick<AuthoringStore, "createConfiguration">;
  readonly bootstrapImage?: string;
  /**
   * The origin the API is publicly reached at, which a bootstrap names the
   * configuration schema under; a deployment naming none tells its worker the
   * route alone.
   */
  readonly publicOrigin?: string;
}

/** Everything the service is composed with, one forge half per app a key is held for. */
export interface RepositoryOnboardingPorts {
  readonly access: ProjectAccess;
  readonly forgeApps: readonly RepositoryOnboardingForgeApp[];
  readonly credentials: RepositoryCredentialPort;
  /** The claim a repository's owner is minted under, looked up as the plane's mint looks it up. */
  readonly installations: ForgeInstallationStore;
  readonly recording: ForgeInstallationRecording;
  readonly claims: ForgeInstallationClaims;
  readonly bindings: ProjectRepositoryBindings;
  readonly binding: ProjectRepositoryBindingWrite;
  readonly landing: ProjectRepositoryLandingStore;
  readonly retirement: ProjectRepositoryRetirementStore;
  readonly configurationsHeld: RepositoryConfigurationsHeldRead;
  readonly importAttempts: RepositoryConfigurationImportAttemptsRead;
  readonly configurations?: RepositoryConfigurationsPorts;
  readonly authorization?: RepositoryOnboardingAuthorization;
}

/** The questions the onboarding routes ask, each behind the permit it needs. */
export interface RepositoryOnboarding {
  forgeApps(): Promise<ForgeAppsResult>;

  authorizeForge(
    principal: Principal,
    tenant: TenantId,
    request: ForgeAuthorizationRequest,
  ): Promise<ForgeAuthorizationResult>;

  installations(
    principal: Principal,
    tenant: TenantId,
  ): Promise<ForgeInstallationsResult>;

  installationRepositories(
    principal: Principal,
    tenant: TenantId,
    installationId: ForgeInstallationId,
  ): Promise<ForgeRepositoriesResult>;

  installationPermissions(
    principal: Principal,
    tenant: TenantId,
    installationId: ForgeInstallationId,
  ): Promise<ForgeInstallationPermissionsResult>;

  bindRepository(
    principal: Principal,
    partition: Partition,
    request: ProjectRepositoryBindRequest,
  ): Promise<ProjectRepositoryBindResult>;

  projectRepositories(
    principal: Principal,
    partition: Partition,
  ): Promise<ProjectRepositoriesResult>;

  setLanding(
    principal: Principal,
    partition: Partition,
    written: ProjectRepositoryLandingWrite,
  ): Promise<ProjectRepositoryLandingResult>;

  retireRepository(
    principal: Principal,
    partition: Partition,
    repository: RepositoryId,
  ): Promise<ProjectRepositoryRetirementResult>;

  configureRepository(
    principal: Principal,
    partition: Partition,
    repository: RepositoryId,
  ): Promise<ProjectRepositoryConfigureResult>;
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
  let authorization: ForgeAuthorizationClient | undefined;
  for (const held of ports.forgeApps) {
    const described = await held.apps.app();
    if (described.described !== "App") return { result: "Unavailable" };
    apps.push({ app: held.app, ...described.app });
    if (
      held.forge === ports.authorization?.forge &&
      held.app === ports.authorization.app
    )
      authorization = {
        clientId: described.app.clientId,
        authorizeUrl: described.app.authorizeUrl,
      };
  }
  return {
    result: "Apps",
    apps,
    ...(authorization === undefined ? {} : { authorization }),
  };
}

/** Whether this principal administers the tenant, which every claim question asks first. */
function administersTenant(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  tenant: TenantId,
): Promise<Authority | undefined> {
  return ports.access.authorizeTenant(principal, tenant, "AdministerTenant");
}

/** Everything one authorization's claims are recorded under. */
interface ForgeAuthorizationContext {
  readonly authorization: RepositoryOnboardingAuthorization;
  readonly tenant: TenantId;
  readonly authority: Authority;
}

/**
 * One app claimed on a proven account. The authorized app's installation is the
 * one the person reached; any other app's is found under its own key, and is
 * claimed only where it stands on the same account number.
 */
async function authorizedAppClaim(
  ports: RepositoryOnboardingPorts,
  context: ForgeAuthorizationContext,
  held: RepositoryOnboardingForgeApp,
  installation: ForgeUserInstallation,
): Promise<ForgeAppClaim> {
  const found =
    held.app === context.authorization.app
      ? {
          read: "Installation" as const,
          installationId: installation.installationId,
          accountId: installation.accountId,
        }
      : await held.directory.accountInstallation({
          account: installation.account,
          accountKind: installation.accountKind,
        });
  if (found.read === "Missing") return "Missing";
  if (found.read === "Unavailable") return "Unavailable";
  if (found.accountId !== installation.accountId) return "Missing";
  const recorded = await ports.recording.record({
    forge: held.forge,
    app: held.app,
    account: installation.account,
    accountKind: installation.accountKind,
    installationId: found.installationId,
    tenant: context.tenant,
    authority: context.authority,
  });
  return recorded === "AlreadyRecorded" ? "AlreadyClaimed" : "Claimed";
}

/** One account the person reaches: whether it is theirs, and each app claimed on it where it is. */
async function authorizedAccount(
  ports: RepositoryOnboardingPorts,
  context: ForgeAuthorizationContext,
  user: ForgeUser,
  installation: ForgeUserInstallation,
): Promise<ForgeAuthorizedAccount> {
  const proof = forgeAccountProof(user, installation);
  const apps: ForgeAuthorizedApp[] = [];
  if (proof === "Proven")
    for (const held of ports.forgeApps)
      if (held.forge === context.authorization.forge)
        apps.push({
          app: held.app,
          claim: await authorizedAppClaim(ports, context, held, installation),
        });
  return {
    account: installation.account,
    accountKind: installation.accountKind,
    proof,
    apps,
  };
}

/**
 * A person's authorization redeemed for a tenant, which claims every account it
 * proves they own and nothing else. The permit is asked before the forge is, so
 * a caller who may not administer the tenant spends no request of this
 * deployment's.
 */
async function authorizeForge(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  tenant: TenantId,
  request: ForgeAuthorizationRequest,
): Promise<ForgeAuthorizationResult> {
  const authority = await administersTenant(ports, principal, tenant);
  if (authority === undefined) return { result: "NotFound" };
  const authorization = ports.authorization;
  if (authorization === undefined || authorization.forge !== request.forge)
    return { result: "NotConfigured" };
  const read = await authorization.user.authorized({
    code: request.code,
    redirectUri: request.redirectUri,
    codeVerifier: request.codeVerifier,
  });
  if (read.authorized !== "User") return { result: read.authorized };
  const context = { authorization, tenant, authority };
  const accounts: ForgeAuthorizedAccount[] = [];
  for (const installation of read.installations)
    accounts.push(
      await authorizedAccount(ports, context, read.user, installation),
    );
  return { result: "Authorized", accounts, truncated: read.truncated };
}

/** The claim one installation is held under and the half of its app, or why a reader is answered without either. */
async function claimedForgeApp(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  tenant: TenantId,
  installationId: ForgeInstallationId,
): Promise<
  | {
      readonly claim: ForgeInstallationClaimed;
      readonly forge: RepositoryOnboardingForgeApp;
    }
  | { readonly result: "NotConfigured" | "NotFound" }
> {
  if ((await administersTenant(ports, principal, tenant)) === undefined)
    return { result: "NotFound" };
  const claim = await ports.claims.claim(tenant, installationId);
  if (claim === undefined) return { result: "NotFound" };
  const forge = heldForgeApp(ports, claim.forge, claim.app);
  if (forge === undefined) return { result: "NotConfigured" };
  return { claim, forge };
}

/**
 * What one claimed installation grants, the claim itself being the tenant's
 * proof. The claim is looked up rather than searched for in the listing, whose
 * bound is a reader's and would refuse a tenant the claim it holds past it.
 */
async function installationRepositories(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  tenant: TenantId,
  installationId: ForgeInstallationId,
): Promise<ForgeRepositoriesResult> {
  const held = await claimedForgeApp(ports, principal, tenant, installationId);
  if ("result" in held) return held;
  const { claim, forge } = held;
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
 * Whether one claimed installation has accepted what its app asks for, read
 * under the claim's own app as `installationRepositories` reads what it grants.
 */
async function installationPermissions(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  tenant: TenantId,
  installationId: ForgeInstallationId,
): Promise<ForgeInstallationPermissionsResult> {
  const held = await claimedForgeApp(ports, principal, tenant, installationId);
  if ("result" in held) return held;
  const read = await held.forge.directory.installationPermissions(
    held.claim.installationId,
  );
  switch (read.read) {
    case "Permissions":
      return {
        result: "Permissions",
        permissions: read.permissions,
        settingsUrl: read.settingsUrl,
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
 * The bootstrap configuration authored as this repository's own, at the
 * revision named for it. Identical text is that revision and any other is
 * `BootstrapDiffers`, whether it was authored under another image, origin or
 * branch or in other words than the generator's, or no longer releases, and in
 * each case the repository declaring its own configurations is what clears it.
 */
async function bindRepositoryBootstrapped(
  configurations: RepositoryConfigurationsPorts,
  binding: RepositoryBinding,
  head: {
    readonly branch: GitRefName;
    readonly ignored: RepositoryConfigurationIgnored | undefined;
  },
  authority: Authority,
): Promise<ProjectRepositoryConfigurationsResult> {
  if (configurations.bootstrapImage === undefined)
    return { result: "Deferred", reason: "NoBootstrapImage" };
  const created = await configurations.authoring.createConfiguration({
    partition: binding.partition,
    authority,
    revision: bootstrapConfigurationRevision(binding.repository),
    canonical: bootstrapConfiguration({
      repository: binding.repository,
      defaultBranch: head.branch,
      image: configurations.bootstrapImage,
      ...(configurations.publicOrigin === undefined
        ? {}
        : { publicOrigin: configurations.publicOrigin }),
    }),
  });
  switch (created.created) {
    case "Created":
    case "AlreadyExists":
      return {
        result: "Bootstrapped",
        revision: created.revision.revision,
        ...repositoryConfigurationIgnoredField(head.ignored),
      };
    case "IdentityConflict":
      return { result: "Deferred", reason: "BootstrapDiffers" };
    case "ParentNotFound":
      return { result: "Deferred", reason: "ParentNotFound" };
    default:
      return assertNever(created);
  }
}

/**
 * What a newly bound repository declares, imported at its own head, and the
 * bootstrap where it declares nothing. A snapshot absent for want of the
 * configuration directory is the one outcome that is not a deferral: it is the
 * repository saying it has none, which is what the bootstrap is for.
 */
async function bindRepositoryConfigurations(
  ports: RepositoryOnboardingPorts,
  binding: RepositoryBinding,
  authority: Authority,
): Promise<ProjectRepositoryConfigurationsResult> {
  const configurations = ports.configurations;
  if (configurations === undefined)
    return { result: "Deferred", reason: "NotConfigured" };
  const head = await configurations.heads.defaultBranch(binding);
  if (head.read !== "Branch") {
    await importRepositoryConfigurationsHeadUnread(
      configurations.imports.attempts,
      binding,
      head,
    );
    return {
      result: "Deferred",
      reason:
        head.read === "Absent"
          ? "DefaultBranchAbsent"
          : "DefaultBranchUnavailable",
    };
  }
  const imported = await importRepositoryConfigurations({
    partition: binding.partition,
    repository: binding.repository,
    commit: head.commit,
    authority,
    ports: configurations.imports,
  });
  switch (imported.result) {
    case "Imported":
      return { result: "Imported", count: imported.declarations };
    case "SnapshotAbsent":
      return imported.absent === "ConfigurationDirectory"
        ? bindRepositoryBootstrapped(
            configurations,
            binding,
            { branch: head.branch, ignored: imported.ignored },
            authority,
          )
        : { result: "Deferred", reason: "SnapshotAbsent" };
    case "Unavailable":
      return { result: "Deferred", reason: "SnapshotUnavailable" };
    case "SnapshotRefused":
      return { result: "Deferred", reason: "SnapshotRefused" };
    case "DeclarationsRefused":
      return { result: "Deferred", reason: "DeclarationsRefused" };
    case "IdentityConflict":
      return { result: "Deferred", reason: "IdentityConflict" };
    case "StaleBinding":
      return { result: "Deferred", reason: "StaleBinding" };
    case "RepositoryAbsent":
      return { result: "Deferred", reason: "RepositoryAbsent" };
    case "NotFound":
      return { result: "Deferred", reason: "NotFound" };
    default:
      return assertNever(imported);
  }
}

/**
 * The configuration step under the binding it follows, contained. The binding
 * row is committed before this runs, so a port that raises rather than answers
 * — a store that lost its connection, a scratch the reader cannot write — is
 * reported as a deferral beside a repository that is bound, never as a failure
 * claiming it is not.
 */
async function boundRepositoryConfigurations(
  ports: RepositoryOnboardingPorts,
  binding: RepositoryBinding,
  authority: Authority,
): Promise<ProjectRepositoryConfigurationsResult> {
  try {
    return await bindRepositoryConfigurations(ports, binding, authority);
  } catch {
    return { result: "Deferred", reason: "StepFailed" };
  }
}

/**
 * The landing the row a bind just made stands at, read rather than assumed:
 * what a repository nobody has edited lands by is the durable column's default
 * and not a value this tree also holds.
 */
async function boundRepositoryLanding(
  ports: RepositoryOnboardingPorts,
  partition: Partition,
  request: ProjectRepositoryBindRequest,
): Promise<RepositoryLanding> {
  const bound = await ports.landing.landing(partition, request.repository);
  if (bound === undefined)
    throw new Error("repository onboarding: a bound repository has no binding");
  return bound.landing;
}

/**
 * What the worker App reaches of each repository named, under the project's
 * tenant, through the first worker App half this deployment holds; none held
 * is nothing asked. A binding is durable before this runs, so a question that
 * raised is every repository's `Unknown` rather than a failed bind or listing.
 */
async function boundRepositoryWorkerReaches(
  ports: RepositoryOnboardingPorts,
  partition: Partition,
  repositories: readonly RepositoryId[],
): Promise<ReadonlyMap<RepositoryId, RepositoryWorkerReach>> {
  const worker = ports.forgeApps.find((held) => held.app === workerPodForgeApp);
  if (worker === undefined || repositories.length === 0) return new Map();
  return repositoryWorkerReaches(
    { ...worker, installations: ports.installations },
    partition.tenant,
    repositories,
  ).catch(
    () =>
      new Map(
        repositories.map((repository) => [
          repository,
          { reach: "Unknown" } as const,
        ]),
      ),
  );
}

/** A binding's reach as it is answered: nothing where the worker App reaches it or nothing was asked. */
function projectRepositoryWorkerReachField(
  reach: RepositoryWorkerReach | undefined,
): ProjectRepositoryWorkerReachField {
  return reach === undefined || reach.reach === "Covered"
    ? {}
    : { workerReach: reach };
}

/** One binding as the bind route asks for it, which is the permit and then the act. */
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
  return boundRepository(ports, partition, authority, request);
}

/**
 * One binding under an already-resolved authority, proved against the
 * credential source before the door is asked: a repository this deployment
 * cannot get a credential for is one no act on it could ever run, so the source
 * that would have to answer at execution time is the one asked here, and the
 * token that comes back is read for its verdict and dropped. It is the portal
 * claim that is proved, the api's own reads minting under the portal app, and
 * whether the worker app reaches the repository is the plane's question at
 * execution time, reported beside the binding here rather than refused.
 */
async function boundRepository(
  ports: RepositoryOnboardingPorts,
  partition: Partition,
  authority: Authority,
  request: ProjectRepositoryBindRequest,
): Promise<ProjectRepositoryBindResult> {
  const recoveryEpoch = await ports.binding.currentRecoveryEpoch();
  const binding: RepositoryBinding = {
    partition,
    repository: request.repository,
    recoveryEpoch,
  };
  const proved = await ports.credentials.credential(binding);
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
      return {
        result: "Bound",
        repository: request.repository,
        landing: await boundRepositoryLanding(ports, partition, request),
        configurations: await boundRepositoryConfigurations(
          ports,
          binding,
          authority,
        ),
        ...projectRepositoryWorkerReachField(
          (
            await boundRepositoryWorkerReaches(ports, partition, [
              request.repository,
            ])
          ).get(request.repository),
        ),
      };
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

/**
 * One binding's settings written, behind the permit that binds: what a
 * repository lands by and whether its jobs may write its pipeline definitions
 * are the same administration as what a project binds, and a project this
 * caller may not administer is not there.
 */
async function setLanding(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  partition: Partition,
  write: ProjectRepositoryLandingWrite,
): Promise<ProjectRepositoryLandingResult> {
  const authority = await ports.access.authorize(
    principal,
    partition,
    "Administer",
  );
  if (authority === undefined) return { result: "NotFound" };
  const written = await ports.landing.setLanding({ ...write, partition });
  switch (written.outcome) {
    case "Written":
      return { result: "Written", repository: written.binding };
    case "LandingMoved":
      return { result: "LandingMoved", repository: written.binding };
    case "NotBound":
      return { result: "NotBound" };
    case "Unavailable":
      return { result: "Unavailable" };
    default:
      return assertNever(written);
  }
}

/**
 * One binding retired, behind the permit that binds: ending a binding is the
 * same administration as making one, and a project this caller may not
 * administer is not there.
 */
async function retireRepository(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  partition: Partition,
  repository: RepositoryId,
): Promise<ProjectRepositoryRetirementResult> {
  const authority = await ports.access.authorize(
    principal,
    partition,
    "Administer",
  );
  if (authority === undefined) return { result: "NotFound" };
  const written = await ports.retirement.retire({ partition, repository });
  switch (written.outcome) {
    case "Retired":
      return { result: "Retired", repository: written.binding };
    case "NotBound":
      return { result: "NotBound" };
    case "Unavailable":
      return { result: "Unavailable" };
    default:
      return assertNever(written);
  }
}

/** What a project holds from the configuration step for the repositories named. */
function heldConfigurations(
  ports: RepositoryOnboardingPorts,
  partition: Partition,
  repositories: readonly RepositoryId[],
): Promise<RepositoryConfigurationsHeld> {
  return ports.configurationsHeld.held({
    partition,
    repositories,
    bootstraps: repositories.map(bootstrapConfigurationRevision),
  });
}

/**
 * What the step has already left one repository, or nothing: the names it
 * declared where it declared any, and otherwise the bootstrap authored for it
 * while that still releases.
 */
function heldRepositoryConfigurations(
  held: RepositoryConfigurationsHeld,
  repository: RepositoryId,
): ProjectRepositoryConfigurationsHeld | undefined {
  const declared = held.declared.get(repository) ?? 0;
  if (declared > 0) return { result: "Imported", count: declared };
  const revision = bootstrapConfigurationRevision(repository);
  const bootstrap = held.bootstraps.get(revision);
  if (
    bootstrap !== undefined &&
    releaseConfigurationReadiness(bootstrap).readiness === "Ready"
  )
    return { result: "Bootstrapped", revision };
  return undefined;
}

/** What one listing reads beside the bindings themselves. */
interface ListedRepositoryReads {
  readonly held: RepositoryConfigurationsHeld;
  readonly attempted: ReadonlyMap<
    RepositoryId,
    RepositoryConfigurationImportAttempt
  >;
  readonly reaches: ReadonlyMap<RepositoryId, RepositoryWorkerReach>;
}

/** One binding beside what the step has left the project for it, the last import attempted of it, and what the worker App reaches of it. */
function listedRepository(
  row: ProjectRepositoryBound,
  reads: ListedRepositoryReads,
): ProjectRepositoryListed {
  const configurationsHeld = heldRepositoryConfigurations(
    reads.held,
    row.repository,
  );
  const lastImport = reads.attempted.get(row.repository);
  const listed = {
    ...row,
    ...(lastImport === undefined ? {} : { lastImport }),
    ...projectRepositoryWorkerReachField(reads.reaches.get(row.repository)),
  };
  return configurationsHeld === undefined
    ? { ...listed, configured: false }
    : { ...listed, configured: true, configurationsHeld };
}

/** Every binding a reader may see, each with what the step has left the project for it and, where it is live, what the worker App reaches of it. */
async function projectRepositories(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  partition: Partition,
): Promise<ProjectRepositoriesResult> {
  if (
    (await ports.access.authorize(principal, partition, "Read")) === undefined
  )
    return { result: "NotFound" };
  const bound = await ports.bindings.bindings(partition);
  const repositories = bound.map((row) => row.repository);
  const held = await heldConfigurations(ports, partition, repositories);
  const attempted = await ports.importAttempts.attempted({
    partition,
    repositories,
  });
  const reaches = await boundRepositoryWorkerReaches(
    ports,
    partition,
    bound
      .filter((row) => row.retiredAt === undefined)
      .map((row) => row.repository),
  );
  return {
    result: "Repositories",
    repositories: bound.map((row) =>
      listedRepository(row, { held, attempted, reaches }),
    ),
  };
}

/**
 * One binding's configuration step asked for again, behind the permit that
 * binds. What the project already holds for the repository is answered without
 * reading it; otherwise the step runs under a binding shaped as the bind's own,
 * and meets a bootstrap that no longer releases as the revision it cannot
 * replace.
 */
async function configureRepository(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  partition: Partition,
  repository: RepositoryId,
): Promise<ProjectRepositoryConfigureResult> {
  const authority = await ports.access.authorize(
    principal,
    partition,
    "Administer",
  );
  if (authority === undefined) return { result: "NotFound" };
  const bound = await ports.landing.landing(partition, repository);
  if (bound === undefined) return { result: "NotBound" };
  if (bound.retiredAt !== undefined) return { result: "Retired" };
  const held = heldRepositoryConfigurations(
    await heldConfigurations(ports, partition, [repository]),
    repository,
  );
  if (held !== undefined)
    return { result: "Configurations", repository, configurations: held };
  const binding: RepositoryBinding = {
    partition,
    repository,
    recoveryEpoch: await ports.binding.currentRecoveryEpoch(),
  };
  return {
    result: "Configurations",
    repository,
    configurations: await boundRepositoryConfigurations(
      ports,
      binding,
      authority,
    ),
  };
}

export function repositoryOnboarding(
  ports: RepositoryOnboardingPorts,
): RepositoryOnboarding {
  return {
    forgeApps: () => describedForgeApps(ports),

    authorizeForge: (principal, tenant, request) =>
      authorizeForge(ports, principal, tenant, request),

    installations: async (principal, tenant) => {
      if ((await administersTenant(ports, principal, tenant)) === undefined)
        return { result: "NotFound" };
      const page = await ports.claims.claims(tenant);
      return {
        result: "Installations",
        installations: page.claims,
        truncated: page.truncated,
      };
    },

    installationRepositories: (principal, tenant, installationId) =>
      installationRepositories(ports, principal, tenant, installationId),

    installationPermissions: (principal, tenant, installationId) =>
      installationPermissions(ports, principal, tenant, installationId),

    bindRepository: (principal, partition, request) =>
      bindRepository(ports, principal, partition, request),

    projectRepositories: (principal, partition) =>
      projectRepositories(ports, principal, partition),

    setLanding: (principal, partition, written) =>
      setLanding(ports, principal, partition, written),

    retireRepository: (principal, partition, repository) =>
      retireRepository(ports, principal, partition, repository),

    configureRepository: (principal, partition, repository) =>
      configureRepository(ports, principal, partition, repository),
  };
}
