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
 */
import { assertNever } from "../domain/assertNever.ts";
import type {
  RepositoryBinding,
  RepositoryCredentialPort,
  RepositoryId,
} from "./finalizer.ts";
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
  ProjectRepositoryLandingStore,
  ProjectRepositoryRetirementStore,
  RepositoryLanding,
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

/** What binding one repository to one project came to. */
export type ProjectRepositoryBindResult =
  | {
      readonly result: "Bound";
      readonly repository: RepositoryId;
      readonly landing: RepositoryLanding;
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
      readonly landing: RepositoryLanding;
      readonly created: ProjectRepositoryMade;
      readonly seeded: boolean;
      readonly ruleset: ProjectRepositoryRulesetResult;
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

/**
 * What moving one repository's landing came to. A conflict answers the binding
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
  readonly landing: ProjectRepositoryLandingStore;
  readonly retirement: ProjectRepositoryRetirementStore;
  readonly creation?: RepositoryCreationPorts;
}

/** The nine questions the onboarding routes ask, each behind the permit it needs. */
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

  setLanding(
    principal: Principal,
    partition: Partition,
    repository: RepositoryId,
    expected: RepositoryLanding,
    landing: RepositoryLanding,
  ): Promise<ProjectRepositoryLandingResult>;

  retireRepository(
    principal: Principal,
    partition: Partition,
    repository: RepositoryId,
  ): Promise<ProjectRepositoryRetirementResult>;
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
        landing: await boundRepositoryLanding(ports, partition, request),
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
  const seeded = false;
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
    landing: bound.landing,
    created: {
      account: context.installation.account,
      name: context.request.name,
      url: made.url,
    },
    seeded,
    ruleset,
  };
}

/**
 * One landing moved, behind the permit that binds: what a repository lands by
 * is the same administration as what a project binds, and a project this
 * caller may not administer is not there.
 */
async function setLanding(
  ports: RepositoryOnboardingPorts,
  principal: Principal,
  partition: Partition,
  repository: RepositoryId,
  expected: RepositoryLanding,
  landing: RepositoryLanding,
): Promise<ProjectRepositoryLandingResult> {
  const authority = await ports.access.authorize(
    principal,
    partition,
    "Administer",
  );
  if (authority === undefined) return { result: "NotFound" };
  const written = await ports.landing.setLanding({
    partition,
    repository,
    expected,
    landing,
  });
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

    setLanding: (principal, partition, repository, expected, landing) =>
      setLanding(ports, principal, partition, repository, expected, landing),

    retireRepository: (principal, partition, repository) =>
      retireRepository(ports, principal, partition, repository),
  };
}
