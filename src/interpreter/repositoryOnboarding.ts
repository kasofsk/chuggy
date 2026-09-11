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
 *
 * A NEWLY BOUND REPOSITORY IS READ ONCE AND LEFT CONFIGURED EITHER WAY. A
 * project that binds a repository declaring configurations wanted them, and one
 * that binds a repository declaring none still needs something to run its first
 * ticket on — so the bind imports what is there and authors the bootstrap where
 * there is nothing, at the repository's own head because the caller holds no
 * ticket to take a commit from.
 *
 * THAT STEP IS BEST EFFORT AND THE BIND IS NOT. The binding is already durable
 * when it runs, so every way it can fail is a reason reported beside a
 * repository that is bound rather than a refusal that would claim it is not;
 * `AlreadyBound` runs nothing, a project having had its one chance at the
 * moment the repository became its own.
 */

import { assertNever } from "../domain/assertNever.ts";
import {
  asConfigurationRevisionId,
  type AuthoringStore,
  type ConfigurationRevisionId,
} from "./authoring.ts";
import {
  bootstrapConfiguration,
  bootstrapConfigurationCommitMessage,
  bootstrapConfigurationFile,
  bootstrapConfigurationName,
  bootstrapConfigurationPath,
} from "./bootstrapConfiguration.ts";
import type {
  GitRefName,
  RepositoryBinding,
  RepositoryCredentialPort,
  RepositoryId,
} from "./finalizer.ts";
import {
  importRepositoryConfigurations,
  type RepositoryConfigurationImportPorts,
  type RepositoryDefaultBranchPort,
} from "./repositoryConfiguration.ts";
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
  ForgeInstallation,
  ForgeInstallationId,
  ForgeRepositoryName,
} from "./forgeInstallation.ts";
import type {
  ForgeRepositoryCreation,
  ForgeRepositoryCreationMode,
  ForgeRepositoryMade,
  ForgeRepositoryVisibility,
  ForgeTemplateRepository,
} from "./forgeRepositoryCreation.ts";
import type {
  ForgeInstallationClaimed,
  ForgeInstallationClaims,
  ForgeInstallationRecording,
} from "./forgeInstallationClaim.ts";
import { allForgeApps } from "./forgeInstallation.ts";
import type { Authority, OperationId } from "./operationInbox.ts";
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

/**
 * Why a newly bound repository came away with no configurations of its own.
 * Every one of them is a step that did not run or did not take, and none of
 * them says anything about whether the repository is bound.
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
  "StaleBinding",
  "NotFound",
  "ParentNotFound",
  "StepFailed",
] as const;

export type ProjectRepositoryConfigurationsDeferral =
  (typeof allProjectRepositoryConfigurationsDeferrals)[number];

/** What configuring one newly bound repository came to. */
export type ProjectRepositoryConfigurationsResult =
  | { readonly result: "Imported"; readonly count: number }
  | {
      readonly result: "Bootstrapped";
      readonly revision: ConfigurationRevisionId;
    }
  | {
      readonly result: "Deferred";
      readonly reason: ProjectRepositoryConfigurationsDeferral;
    };

/** What binding one repository to one project came to. */
export type ProjectRepositoryBindResult =
  | {
      readonly result: "Bound";
      readonly repository: RepositoryId;
      readonly configurations: ProjectRepositoryConfigurationsResult;
    }
  | { readonly result: "AlreadyBound"; readonly repository: RepositoryId }
  | { readonly result: "NotInstalled" }
  | { readonly result: "OperationConflict" }
  | { readonly result: "BoundElsewhere" }
  | { readonly result: "EpochChanged" }
  | { readonly result: "NotFound" }
  | { readonly result: "Unavailable" };

/** The steps of a creation a forge can refuse outright, each named in the refusal. */
export const allProjectRepositoryCreateSteps = ["create", "seed"] as const;

export type ProjectRepositoryCreateStep =
  (typeof allProjectRepositoryCreateSteps)[number];

/**
 * What reserving a created repository's default branch came to. `Skipped` is a
 * repository with no branch to reserve, which is what an unseeded one is, and
 * an outage is neither created nor refused: the ruleset may yet be this app's
 * to make, and reading it as a refusal would say a decision was taken.
 */
export type ProjectRepositoryRulesetResult =
  | { readonly result: "Created" }
  | { readonly result: "Refused"; readonly message: string }
  | { readonly result: "Skipped" }
  | { readonly result: "Unavailable" };

/** The repository a forge made, as the answer names it. */
export interface ProjectRepositoryMade {
  readonly account: ForgeAccount;
  readonly name: ForgeRepositoryName;
  readonly url: RepositoryId;
}

/**
 * What creating one repository came to. A repository that was made and then met
 * a refusal is reported with the refusal and not undone: it exists on the forge
 * either way, and the caller is told how far the request got so the bind route
 * can finish what this one started.
 */
export type ProjectRepositoryCreateResult =
  | {
      readonly result: "Created";
      readonly repository: RepositoryId;
      readonly created: ProjectRepositoryMade;
      readonly seeded: boolean;
      readonly ruleset: ProjectRepositoryRulesetResult;
      readonly configurations: ProjectRepositoryConfigurationsResult;
    }
  | { readonly result: "InstallationMissing"; readonly app: ForgeApp }
  | { readonly result: "PersonalAccountCreatesOnGitHub" }
  | { readonly result: "RepositoryExists" }
  | {
      readonly result: "ForgeRefused";
      readonly step: ProjectRepositoryCreateStep;
      readonly message: string;
    }
  | {
      readonly result: "BindRefused";
      readonly bind: Exclude<
        ProjectRepositoryBindResult,
        { readonly result: "Bound" }
      >;
    }
  | { readonly result: "NotConfigured" }
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

/**
 * One repository to create, under the identity the binding inside it is one
 * attempt at. The forge is not the caller's to name: a deployment creates
 * through the one forge its creation half is composed for.
 */
export interface ProjectRepositoryCreateRequest {
  readonly account: ForgeAccount;
  readonly name: ForgeRepositoryName;
  readonly visibility: ForgeRepositoryVisibility;
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
}

/**
 * The half creating a repository is composed with: which forge it makes one on,
 * the three acts it makes one by, and the repository a personal account's is
 * copied from. A deployment naming no template creates for organizations only,
 * which is the one shape a forge admits from an app without one.
 */
export interface RepositoryCreationPorts {
  readonly forge: ForgeId;
  readonly repositories: ForgeRepositoryCreation;
  readonly template?: ForgeTemplateRepository;
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
  readonly configurations?: RepositoryConfigurationsPorts;
  readonly creation?: RepositoryCreationPorts;
}

/** The seven questions the onboarding routes ask, each behind the permit it needs. */
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

  createRepository(
    principal: Principal,
    partition: Partition,
    request: ProjectRepositoryCreateRequest,
  ): Promise<ProjectRepositoryCreateResult>;

  projectRepositories(
    principal: Principal,
    partition: Partition,
  ): Promise<ProjectRepositoriesResult>;
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

/** Whether this principal administers the tenant, which every claim question asks first. */
function administersTenant(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  tenant: TenantId,
): Promise<Authority | undefined> {
  return ports.access.authorizeTenant(principal, tenant, "AdministerTenant");
}

/** One claim, read as the app before it is recorded as the tenant's. */
async function claimInstallation(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  tenant: TenantId,
  request: ForgeInstallationClaimRequest,
): Promise<ForgeInstallationClaimResult> {
  const authority = await administersTenant(ports, principal, tenant);
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
  if ((await administersTenant(ports, principal, tenant)) === undefined)
    return { result: "NotFound" };
  const claim = await ports.claims.claim(tenant, installationId);
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
 * The bootstrap configuration authored as this project's own, at the revision
 * the name itself is. A second repository in one project needing a bootstrap
 * meets the first one's revision: identical text is that revision and different
 * text is `IdentityConflict`, which is the deferral saying the project already
 * has a bootstrap to bind the second repository's tickets against.
 */
async function bindRepositoryBootstrapped(
  configurations: RepositoryConfigurationsPorts,
  binding: RepositoryBinding,
  defaultBranch: GitRefName,
  authority: Authority,
): Promise<ProjectRepositoryConfigurationsResult> {
  if (configurations.bootstrapImage === undefined)
    return { result: "Deferred", reason: "NoBootstrapImage" };
  const revision = asConfigurationRevisionId(bootstrapConfigurationName);
  const created = await configurations.authoring.createConfiguration({
    partition: binding.partition,
    authority,
    revision,
    canonical: bootstrapConfiguration({
      repository: binding.repository,
      defaultBranch,
      image: configurations.bootstrapImage,
    }),
  });
  switch (created.created) {
    case "Created":
    case "AlreadyExists":
      return { result: "Bootstrapped", revision: created.revision.revision };
    case "IdentityConflict":
      return { result: "Deferred", reason: "IdentityConflict" };
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
  if (head.read === "Absent")
    return { result: "Deferred", reason: "DefaultBranchAbsent" };
  if (head.read === "Unavailable")
    return { result: "Deferred", reason: "DefaultBranchUnavailable" };
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
            head.branch,
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
 * whether the tenant also claimed the worker app on the repository's owner is
 * the plane's question at execution time.
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
        configurations: await boundRepositoryConfigurations(
          ports,
          binding,
          authority,
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
 * Both of this tenant's claims on the account, the portal's answered back
 * because it carries the kind of account the creation mode is decided from.
 * Both are required rather than the portal's alone: a repository this tree
 * makes is meant to run attempts from the moment it exists, and the plane mints
 * under the worker app.
 */
async function createRepositoryClaims(
  ports: RepositoryOnboardingPorts,
  creation: RepositoryCreationPorts,
  tenant: TenantId,
  account: ForgeAccount,
): Promise<ForgeInstallationClaimed | { readonly missing: ForgeApp }> {
  let portal: ForgeInstallationClaimed | undefined;
  for (const app of allForgeApps) {
    const claimed = await ports.claims.accountClaim({
      tenant,
      forge: creation.forge,
      app,
      account,
    });
    if (claimed === undefined) return { missing: app };
    if (app === "portal") portal = claimed;
  }
  if (portal === undefined)
    throw new Error("create repository: no portal app is named");
  return portal;
}

/**
 * Which of a forge's collections the repository is made in, which the claimed
 * account's own kind decides. A personal account is served by copying a
 * template and by nothing else, so a deployment naming none has no way to make
 * one and says so.
 */
function createRepositoryMode(
  creation: RepositoryCreationPorts,
  accountKind: ForgeAccountKind,
): ForgeRepositoryCreationMode | undefined {
  if (accountKind === "Organization") return { mode: "Organization" };
  return creation.template === undefined
    ? undefined
    : { mode: "Template", template: creation.template };
}

/**
 * How far the first commit got, which is what puts a branch under a created
 * repository. A refusal is the forge's own and settled; an outage is the
 * caller's to retry, and the retry meets `RepositoryExists`.
 */
type CreateRepositorySeeding =
  | { readonly seeding: "Seeded" }
  | { readonly seeding: "Unseeded" }
  | { readonly seeding: "Refused"; readonly message: string }
  | { readonly seeding: "Unavailable" };

/**
 * The first commit, written where there is an image to command. A deployment
 * naming no bootstrap image seeds nothing: the file it would write is a
 * configuration commanding no image, which nothing could run.
 */
async function createRepositorySeeded(
  ports: RepositoryOnboardingPorts,
  creation: RepositoryCreationPorts,
  installation: ForgeInstallation,
  request: ProjectRepositoryCreateRequest,
  made: ForgeRepositoryMade,
): Promise<CreateRepositorySeeding> {
  const image = ports.configurations?.bootstrapImage;
  if (image === undefined) return { seeding: "Unseeded" };
  const seeded = await creation.repositories.seed({
    installation,
    name: request.name,
    branch: made.defaultBranch,
    path: bootstrapConfigurationPath,
    message: bootstrapConfigurationCommitMessage,
    content: bootstrapConfigurationFile({
      repository: made.url,
      defaultBranch: made.defaultBranch,
      image,
    }),
  });
  switch (seeded.seeded) {
    case "Seeded":
      return { seeding: "Seeded" };
    case "Refused":
      return { seeding: "Refused", message: seeded.message };
    case "Unavailable":
      return { seeding: "Unavailable" };
    default:
      return assertNever(seeded);
  }
}

/**
 * The ruleset that reserves the default branch, which is asked for only where
 * there is a branch to reserve. A refusal leaves the repository standing and
 * unprotected, which is reported rather than undone.
 */
async function createRepositoryRuleset(
  creation: RepositoryCreationPorts,
  installation: ForgeInstallation,
  name: ForgeRepositoryName,
  seeded: boolean,
): Promise<ProjectRepositoryRulesetResult> {
  if (!seeded) return { result: "Skipped" };
  const reserved = await creation.repositories.reserveDefaultBranch({
    installation,
    name,
  });
  switch (reserved.created) {
    case "Ruleset":
      return { result: "Created" };
    case "Refused":
      return { result: "Refused", message: reserved.message };
    case "Unavailable":
      return { result: "Unavailable" };
    default:
      return assertNever(reserved);
  }
}

/**
 * One repository made, seeded, reserved and bound. Nothing here is undone: the
 * repository is the forge's from the moment it answers, so each step after it
 * is reported beside a repository that stands, and a request that got as far as
 * making one and no further answers `RepositoryExists` when it is sent again.
 */
async function createRepository(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  partition: Partition,
  request: ProjectRepositoryCreateRequest,
): Promise<ProjectRepositoryCreateResult> {
  const authority = await ports.access.authorize(
    principal,
    partition,
    "Administer",
  );
  if (authority === undefined) return { result: "NotFound" };
  const creation = ports.creation;
  if (creation === undefined) return { result: "NotConfigured" };
  const claimed = await createRepositoryClaims(
    ports,
    creation,
    partition.tenant,
    request.account,
  );
  if ("missing" in claimed)
    return { result: "InstallationMissing", app: claimed.missing };
  const mode = createRepositoryMode(creation, claimed.accountKind);
  if (mode === undefined) return { result: "PersonalAccountCreatesOnGitHub" };
  const installation: ForgeInstallation = {
    forge: claimed.forge,
    app: claimed.app,
    account: claimed.account,
    installationId: claimed.installationId,
  };
  const created = await creation.repositories.create({
    installation,
    name: request.name,
    visibility: request.visibility,
    creation: mode,
  });
  switch (created.created) {
    case "Repository":
      return createRepositoryBound(
        ports,
        creation,
        { authority, installation, partition, request },
        created.repository,
      );
    case "Exists":
      return { result: "RepositoryExists" };
    case "Refused":
      return {
        result: "ForgeRefused",
        step: "create",
        message: created.message,
      };
    case "Unavailable":
      return { result: "Unavailable" };
    default:
      return assertNever(created);
  }
}

/** Everything the steps after the create share, gathered so each of them takes one argument for it. */
interface CreateRepositoryContext {
  readonly authority: Authority;
  readonly installation: ForgeInstallation;
  readonly partition: Partition;
  readonly request: ProjectRepositoryCreateRequest;
}

/** The seed, the ruleset and the binding, over a repository the forge has already made. */
async function createRepositoryBound(
  ports: RepositoryOnboardingPorts,
  creation: RepositoryCreationPorts,
  context: CreateRepositoryContext,
  made: ForgeRepositoryMade,
): Promise<ProjectRepositoryCreateResult> {
  const seeding = await createRepositorySeeded(
    ports,
    creation,
    context.installation,
    context.request,
    made,
  );
  if (seeding.seeding === "Refused")
    return { result: "ForgeRefused", step: "seed", message: seeding.message };
  if (seeding.seeding === "Unavailable") return { result: "Unavailable" };
  const seeded = seeding.seeding === "Seeded";
  const ruleset = await createRepositoryRuleset(
    creation,
    context.installation,
    context.request.name,
    seeded,
  );
  const bound = await boundRepository(
    ports,
    context.partition,
    context.authority,
    { repository: made.url, operation: context.request.operation },
  );
  if (bound.result !== "Bound") return { result: "BindRefused", bind: bound };
  return {
    result: "Created",
    repository: bound.repository,
    created: {
      account: context.installation.account,
      name: context.request.name,
      url: made.url,
    },
    seeded,
    ruleset,
    configurations: bound.configurations,
  };
}

export function repositoryOnboarding(
  ports: RepositoryOnboardingPorts,
): RepositoryOnboarding {
  return {
    forgeApps: () => describedForgeApps(ports),

    claimInstallation: (principal, tenant, request) =>
      claimInstallation(ports, principal, tenant, request),

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

    bindRepository: (principal, partition, request) =>
      bindRepository(ports, principal, partition, request),

    createRepository: (principal, partition, request) =>
      createRepository(ports, principal, partition, request),

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
