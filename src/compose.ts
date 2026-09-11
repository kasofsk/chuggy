import { createHash, randomUUID } from "node:crypto";

import type pg from "pg";

import { artifactRootPrecondition } from "./adapters/artifacts/artifactRoot.ts";
import {
  artifactStore,
  type ArtifactStoreOptions,
} from "./adapters/artifacts/artifactStore.ts";
import {
  credentialFiles,
  credentialFilesPrecondition,
  forgeCredentialFiles,
  forgeCredentialFilesPrecondition,
  type CredentialFilesOptions,
  type ForgeCredentialFilesOptions,
} from "./adapters/credentials/credentialFiles.ts";
import { githubChangeProposals } from "./adapters/forge/githubChangeProposals.ts";
import { githubRepositoryHost } from "./adapters/forge/githubAddress.ts";
import {
  githubInstallationTokens,
  githubInstallationTokensOptions,
  githubInstallationTokensPrecondition,
} from "./adapters/forge/githubInstallationTokens.ts";
import {
  mintedRepositoryCredentials,
  mintedRepositoryTokens,
} from "./adapters/forge/mintedCredentials.ts";
import { postgresForgeInstallations } from "./adapters/postgres/forgeInstallation.ts";
import {
  forgeCredentialsByHost,
  repositoryCredentialsByHost,
} from "./interpreter/forgeCredentials.ts";
import {
  forgeBindingOf,
  type ChangeProposalForges,
  type ChangeProposalPort,
  type ForgeCredentialPort,
  type ForgeRepositoryBinding,
} from "./interpreter/changeProposal.ts";
import {
  gitAvailablePrecondition,
  gitScratchWritablePrecondition,
} from "./adapters/git/gitPrerequisites.ts";
import { gitPromotion } from "./adapters/git/gitPromotion.ts";
import { postgresOperationInbox } from "./adapters/postgres/operationInbox.ts";
import { postgresLeadInquiries } from "./adapters/postgres/leadInquiry.ts";
import { postgresNativeReads } from "./adapters/postgres/nativeReads.ts";
import { postgresAuthoring } from "./adapters/postgres/authoring.ts";
import { postgresProjectRepositoryBinding } from "./adapters/postgres/repositoryConfiguration.ts";
import {
  forgeCredentialMinting,
  type ForgeCredentialMinting,
} from "./interpreter/forgeCredentials.ts";
import {
  githubForgeId,
  portalForgeApp,
  type ForgeAppKey,
  type ForgeInstallationTokens,
  type ForgePermissionSet,
  type ForgeRepositoryTokens,
} from "./interpreter/forgeInstallation.ts";
import {
  repositoryOnboarding,
  type RepositoryConfigurationsPorts,
  type RepositoryCreationPorts,
  type RepositoryOnboarding,
  type RepositoryOnboardingForgeApp,
} from "./interpreter/repositoryOnboarding.ts";
import {
  postgresForgeInstallationClaims,
  postgresForgeInstallationRecording,
} from "./adapters/postgres/forgeInstallation.ts";
import {
  postgresProjectRepositoryBindings,
  postgresRepositoryBinding,
} from "./adapters/postgres/repositoryBinding.ts";
import { postgresNotifications } from "./adapters/postgres/notifications.ts";
import { postgresDispatchViews } from "./adapters/postgres/dispatchViews.ts";
import { postgresProjectInventory } from "./adapters/postgres/projectInventory.ts";
import {
  postgresSelectorProjectSettings,
  postgresSelectorRuntimeControl,
  postgresSelectorState,
} from "./adapters/postgres/selector.ts";
import { authorizedProjectInventory } from "./interpreter/projectInventory.ts";
import { postgresAgenticRefusalLedger } from "./adapters/postgres/agenticRefusal.ts";
import { postgresLeadMailbox } from "./adapters/postgres/leadMailbox.ts";
import type { LeadSessionMint } from "./interpreter/leadMailbox.ts";
import {
  leadSelectorPolicy,
  type LeadPolicyClock,
  type LeadPolicyConfig,
} from "./interpreter/leadPolicyHost.ts";
import {
  selectorPolicyHost,
  type SelectorHostDeadline,
} from "./interpreter/selectorPolicyHost.ts";
import {
  selectorRunOnce,
  type SelectorIdentityFactory,
  type SelectorRunResult,
  type SelectorRuntimeConfig,
  type SelectorRuntimeSource,
} from "./interpreter/selectorRuntime.ts";
import {
  selectorProjectSettingsAdministration,
  type SelectorProjectSettingsAdministration,
} from "./interpreter/selectorProjectSettings.ts";
import { postgresFinalizer } from "./adapters/postgres/finalizer.ts";
import { postgresTicketBrief } from "./adapters/postgres/ticketBrief.ts";
import {
  asFinalizationAttemptId,
  asInputBundleId,
  checkedFinalizerConfig,
  finalizerDefaults,
  type FinalizerConfig,
  type GitPromotionPort,
  type RepositoryCredentialPort,
} from "./interpreter/finalizer.ts";
import {
  asProjectArtifactId,
  type CanonicalFinalization,
  type FinalizerIdentityFactory,
} from "./interpreter/finalizerPreparation.ts";
import type { FinalizerService } from "./interpreter/finalizerRun.ts";
import type {
  FinalizerSettings,
  ForgeBindingFile,
  RepositoryCredentialFile,
} from "./interpreter/finalizerSettings.ts";
import type { RuntimePrecondition } from "./interpreter/serviceRuntime.ts";
import {
  silentFinalizerTelemetry,
  type FinalizerTelemetry,
} from "./interpreter/finalizerTelemetry.ts";
import { postgresProjectDecision } from "./adapters/postgres/projectDecision.ts";
import { postgresProjectDiscovery } from "./adapters/postgres/projectDiscovery.ts";
import { postgresProjectStore } from "./adapters/postgres/projectStore.ts";
import type { IdempotencyKeying } from "./adapters/postgres/keying.ts";
import type { OperationInbox } from "./interpreter/operationInbox.ts";
import {
  nativeWeb,
  type NativeLeadPorts,
  type NativeThreadPorts,
  type NativeWeb,
  type ProjectAccess,
  type ProjectInventory,
} from "./interpreter/nativeWeb.ts";
import type { ProjectDecision } from "./interpreter/projectDecision.ts";
import type { ProjectDiscovery } from "./interpreter/projectDiscovery.ts";
import type { ProjectStore } from "./interpreter/projectStore.ts";
import type { ExecutionBacklogGuard } from "./interpreter/schedulerContext.ts";
import { postgresOperationalReads } from "./adapters/postgres/operationalReads.ts";
import { postgresRunEvidenceReads } from "./adapters/postgres/runEvidence.ts";
import type { OutputContentPort } from "./interpreter/operationsView.ts";
import type { RunEvidenceContentPort } from "./interpreter/runEvidence.ts";
import type { SelectorOperationalContextRead } from "./interpreter/selectorOperationalContext.ts";
import type {
  RepositoryConfigurationSnapshotPort,
  RepositoryDefaultBranchPort,
} from "./interpreter/repositoryConfiguration.ts";
import {
  silentTicketServiceMetrics,
  ticketServiceDefaults,
  type TicketServiceConfig,
  type TicketServiceMetrics,
} from "./interpreter/ticketService.ts";

export interface TicketService {
  readonly inbox: OperationInbox;
  readonly discovery: ProjectDiscovery;
  readonly decisions: ProjectDecision;
  readonly projects: ProjectStore;
}

export interface SelectorRuntimeService {
  runOnce(): Promise<SelectorRunResult>;
}

/**
 * Wires the independently operated selector runtime to its owned persistence
 * and to the lead whose turn each decision is. The policy is built here rather
 * than passed in, because every door it opens is on the pool this function
 * already holds and a caller handed the host would need that pool to build it.
 */
export function composeSelectorRuntime(
  selectorPool: pg.Pool,
  source: SelectorRuntimeSource,
  lead: SelectorLeadRuntime,
  identities: SelectorIdentityFactory,
  config?: SelectorRuntimeConfig,
): SelectorRuntimeService {
  const store = postgresSelectorState(selectorPool);
  const settings = postgresSelectorRuntimeControl(selectorPool);
  const refusals = postgresAgenticRefusalLedger(selectorPool);
  const policy = selectorPolicyHost(
    leadSelectorPolicy(
      postgresLeadMailbox(selectorPool),
      store,
      lead.sessions,
      lead.clock,
      lead.policy,
    ),
    lead.deadline,
    { controlDeadlineMs: lead.controlDeadlineMs },
  );
  return {
    runOnce: () =>
      selectorRunOnce(
        refusals,
        store,
        source,
        policy,
        identities,
        settings,
        config,
      ),
  };
}

/** What the selector process answers the lead host's own ports with. */
export interface SelectorLeadRuntime {
  readonly sessions: LeadSessionMint;
  readonly clock: LeadPolicyClock;
  readonly deadline: SelectorHostDeadline;
  readonly policy: LeadPolicyConfig;
  readonly controlDeadlineMs: number;
}

/**
 * Wires a project's own selector settings to API-role credentials and the
 * project membership that bounds them. The installation defaults stay the
 * selector control role's, so a project administrator overrides for their own
 * project and cannot move what every other project inherits.
 */
export function composeSelectorProjectSettings(
  apiPool: pg.Pool,
  access: ProjectAccess,
): SelectorProjectSettingsAdministration {
  return selectorProjectSettingsAdministration(
    access,
    postgresSelectorProjectSettings(apiPool),
  );
}

/**
 * What one process resolves a repository's credential with: the app key it
 * mints under where it holds one, the files it falls back to, and the tenant
 * side of every mint, which is the binding's own partition.
 */
export interface RepositoryCredentialComposition {
  readonly pool: pg.Pool;
  readonly forge?: ForgeAppKey;
  readonly permissions: ForgePermissionSet;
  readonly sources: readonly RepositoryCredentialFile[];
  readonly credentialBytesMax?: number;
}

/** The minting half of one process's credentials, absent where it holds no app key. */
export interface RepositoryCredentialMinting {
  readonly installationTokens: ForgeInstallationTokens;
  readonly tokens: ForgeRepositoryTokens;
}

/** Where a repository's credential comes from in one process, and what it mints with. */
export interface RepositoryCredentialSource {
  readonly credentials: RepositoryCredentialPort;
  readonly minting?: RepositoryCredentialMinting;
}

/** The files half of one process's credentials, which is what a precondition holds to a path. */
export function repositoryCredentialFileOptions(
  composition: RepositoryCredentialComposition,
): CredentialFilesOptions {
  return {
    sources: composition.sources,
    ...(composition.credentialBytesMax === undefined
      ? {}
      : { credentialBytesMax: composition.credentialBytesMax }),
  };
}

/**
 * The credential source every process that mints for itself composes: the
 * minting source for the host its portal key covers, and the mounted files for
 * every other repository. It is one function because the four control-plane
 * processes each hold the same key for the same forge, and four wirings of it
 * would be four answers to which repositories a deployment can still reach
 * through a file.
 */
export function composeRepositoryCredentials(
  composition: RepositoryCredentialComposition,
): RepositoryCredentialSource {
  const files = credentialFiles(repositoryCredentialFileOptions(composition));
  if (composition.forge === undefined) return { credentials: files };
  const installationTokens = githubInstallationTokens(
    githubInstallationTokensOptions(composition.forge),
  );
  const tokens = mintedRepositoryTokens({
    forge: githubForgeId,
    app: portalForgeApp,
    repositoryHost: githubRepositoryHost,
    installations: postgresForgeInstallations(composition.pool),
    tokens: installationTokens,
  });
  return {
    credentials: repositoryCredentialsByHost(
      [
        {
          repositoryHost: githubRepositoryHost,
          credentials: mintedRepositoryCredentials({
            tokens,
            permissions: composition.permissions,
          }),
        },
      ],
      files,
    ),
    minting: { installationTokens, tokens },
  };
}

/**
 * The minting service the API answers its credential route with: `Execute` on
 * the project, then the project's own binding for the repository named, then
 * one token for that repository alone.
 */
export function composeForgeCredentialMinting(
  apiPool: pg.Pool,
  access: ProjectAccess,
  tokens: ForgeRepositoryTokens,
): ForgeCredentialMinting {
  return forgeCredentialMinting(
    access,
    postgresProjectRepositoryBinding(apiPool),
    tokens,
  );
}

/**
 * The onboarding service the API answers its onboarding routes with: the
 * relation authority for every question of standing, one forge half per app
 * this deployment holds a key for, the credential source a binding is proved
 * against, and the two doors 085 grants the API. THE APPS ARE OPTIONAL AND THE
 * REST IS NOT: a deployment naming no app key still binds and still lists what
 * a project binds, and has nothing to say about installations, which is what
 * `NotConfigured` is.
 */
export interface RepositoryOnboardingComposition {
  readonly apiPool: pg.Pool;
  readonly access: ProjectAccess;
  readonly credentials: RepositoryCredentialPort;
  readonly forgeApps: readonly RepositoryOnboardingForgeApp[];
  /**
   * The repository reads a bind's configuration step takes, which is one
   * adapter answering both: a deployment with no scratch has neither, and a
   * bind reports that step as deferred rather than refusing.
   */
  readonly repositories?: RepositoryConfigurationSnapshotPort &
    RepositoryDefaultBranchPort;
  readonly bootstrapImage?: string;
  readonly creation?: RepositoryCreationPorts;
}

/** The configuration step's own half, over the one adapter that reads a repository. */
function composeRepositoryConfigurations(
  composition: RepositoryOnboardingComposition,
  repositories: RepositoryConfigurationSnapshotPort &
    RepositoryDefaultBranchPort,
): RepositoryConfigurationsPorts {
  const authoring = postgresAuthoring(composition.apiPool);
  return {
    heads: repositories,
    imports: {
      bindings: postgresProjectRepositoryBinding(composition.apiPool),
      snapshots: repositories,
      store: authoring,
    },
    authoring,
    ...(composition.bootstrapImage === undefined
      ? {}
      : { bootstrapImage: composition.bootstrapImage }),
  };
}

export function composeRepositoryOnboarding(
  composition: RepositoryOnboardingComposition,
): RepositoryOnboarding {
  return repositoryOnboarding({
    access: composition.access,
    forgeApps: composition.forgeApps,
    credentials: composition.credentials,
    recording: postgresForgeInstallationRecording(composition.apiPool),
    claims: postgresForgeInstallationClaims(composition.apiPool),
    bindings: postgresProjectRepositoryBindings(composition.apiPool),
    binding: postgresRepositoryBinding(composition.apiPool),
    ...(composition.repositories === undefined
      ? {}
      : {
          configurations: composeRepositoryConfigurations(
            composition,
            composition.repositories,
          ),
        }),
    ...(composition.creation === undefined
      ? {}
      : { creation: composition.creation }),
  });
}

/** What a finalizer deployment answers its own ports with, none of it read from an environment. */
export interface FinalizerServiceRuntime {
  readonly git: GitPromotionPort;
  readonly forges: ChangeProposalForges;
  readonly artifactRoot: string;
  readonly artifacts?: ArtifactStoreOptions;
}

/**
 * The forges one deployment opens change proposals on: every adapter is built
 * here from the binding that named it, so the interpreter selects one by its
 * forge identity and constructs none, and a deployment binding none answers
 * every repository with no binding, which is the denial a proposal holds under.
 * A binding names itself rather than its provider, so every one it does bind is
 * answered by the one adapter this tree has.
 */
export function composeChangeProposalForges(
  bindings: readonly ForgeBindingFile[],
  credentials: ForgeCredentialPort,
): ChangeProposalForges {
  const adapters = new Map<string, ChangeProposalPort>(
    bindings.map((binding) => [
      binding.forge,
      githubChangeProposals({
        credentials,
        fetch,
        hosts: {
          apiHost: binding.apiHost,
          repositoryHost: binding.repositoryHost,
        },
      }),
    ]),
  );
  const repositories: readonly ForgeRepositoryBinding[] = bindings.map(
    (binding) => ({
      binding: {
        forge: binding.forge,
        credential: binding.credentialReference,
      },
      repositoryHost: binding.repositoryHost,
    }),
  );
  return {
    selector: { select: (forge) => adapters.get(forge) },
    bindingOf: (repository) => forgeBindingOf(repositories, repository),
  };
}

/** The identities one preparation mints, which the layer below may not draw for itself. */
function finalizerIdentities(): FinalizerIdentityFactory {
  return {
    next: () => ({
      attempt: asFinalizationAttemptId(`attempt-${randomUUID()}`),
      bundle: asInputBundleId(`bundle-${randomUUID()}`),
      conflict: asProjectArtifactId(`conflict-${randomUUID()}`),
    }),
  };
}

/** The hash the finalizer's canonical bytes are digested under. */
function finalizerDigestOf(canonical: CanonicalFinalization): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Wires the finalizer's durable authority to its finalizer-role credentials, the
 * Git port its caller composes, the brief its target is narrowed by and one
 * project-owned artifact store, which is where a credential and a storage root
 * are answered from and never the environment.
 */
export function composeFinalizerService(
  finalizerPool: pg.Pool,
  runtime: FinalizerServiceRuntime,
  config: FinalizerConfig = finalizerDefaults,
  metrics: FinalizerTelemetry = silentFinalizerTelemetry,
): FinalizerService {
  const artifacts = artifactStore({
    ...runtime.artifacts,
    root: runtime.artifactRoot,
  });
  return {
    store: postgresFinalizer(finalizerPool),
    git: runtime.git,
    forges: runtime.forges,
    ticketBriefs: postgresTicketBrief(finalizerPool),
    handoffs: artifacts,
    artifacts,
    identities: finalizerIdentities(),
    digestOf: finalizerDigestOf,
    config: checkedFinalizerConfig(config),
    metrics,
  };
}

/** What one finalizer deployment must find before it runs, and the ports it finds it through. */
export interface FinalizerRuntimeComposition {
  readonly preconditions: readonly RuntimePrecondition[];
  readonly service: (pool: pg.Pool) => FinalizerServiceRuntime;
}

/**
 * The credential the pull-request path presents: one minted to propose for the
 * host this deployment's app key covers, and the file each binding names for
 * every other. A deployment holding no key composes the files alone, which is
 * what it composed before it minted anything.
 */
function composeFinalizerForgeCredentials(
  settings: FinalizerSettings,
  options: ForgeCredentialFilesOptions,
  minting: RepositoryCredentialMinting | undefined,
): ForgeCredentialPort {
  const files = forgeCredentialFiles(options);
  if (settings.forge === undefined || minting === undefined) return files;
  return forgeCredentialsByHost(
    [
      {
        repositoryHost: githubRepositoryHost,
        tokens: minting.tokens,
        permissions: "propose",
      },
    ],
    files,
  );
}

/**
 * Wires a finalizer deployment's plain settings to the git, artifact and
 * credential ports it promotes through. Both the git port and the pool the
 * minting source reads a claim on are the service's arguments rather than the
 * composition's: opening a scratch refuses what `git-available` and
 * `git-scratch-writable` are there to report, and the pool is the process
 * root's to own.
 */
export function composeFinalizerRuntime(
  settings: FinalizerSettings,
): FinalizerRuntimeComposition {
  const credentialOptions: CredentialFilesOptions = {
    sources: settings.credentials,
    ...(settings.credentialBytesMax === undefined
      ? {}
      : { credentialBytesMax: settings.credentialBytesMax }),
  };
  const forgeOptions: ForgeCredentialFilesOptions = {
    bindings: settings.forges,
    ...(settings.credentialBytesMax === undefined
      ? {}
      : { credentialBytesMax: settings.credentialBytesMax }),
  };
  const git = settings.git;
  return {
    preconditions: [
      gitAvailablePrecondition(git.environment),
      gitScratchWritablePrecondition(git.scratchDirectory),
      artifactRootPrecondition(settings.artifactRoot),
      credentialFilesPrecondition(credentialOptions),
      forgeCredentialFilesPrecondition(forgeOptions),
      ...(settings.forge === undefined
        ? []
        : [
            githubInstallationTokensPrecondition(
              githubInstallationTokensOptions(settings.forge),
            ),
          ]),
    ],
    service: (pool) => {
      const source = composeRepositoryCredentials({
        pool,
        ...(settings.forge === undefined ? {} : { forge: settings.forge }),
        permissions: "write",
        sources: settings.credentials,
        ...(settings.credentialBytesMax === undefined
          ? {}
          : { credentialBytesMax: settings.credentialBytesMax }),
      });
      return finalizerServiceRuntime(settings, source, forgeOptions);
    },
  };
}

/** The ports one finalizer promotes and proposes through, over the credentials it resolved. */
function finalizerServiceRuntime(
  settings: FinalizerSettings,
  source: RepositoryCredentialSource,
  forgeOptions: ForgeCredentialFilesOptions,
): FinalizerServiceRuntime {
  const git = settings.git;
  const credentials = source.credentials;
  return {
    forges: composeChangeProposalForges(
      settings.forges,
      composeFinalizerForgeCredentials(settings, forgeOptions, source.minting),
    ),
    git: gitPromotion({
      scratchDirectory: git.scratchDirectory,
      identity: { name: git.commitName, email: git.commitEmail },
      environment: git.environment,
      credentials,
      ...(git.credentialUsername === undefined
        ? {}
        : { credentialUsername: git.credentialUsername }),
      ...(git.localTimeoutSecsMax === undefined
        ? {}
        : { localTimeoutSecsMax: git.localTimeoutSecsMax }),
      ...(git.remoteTimeoutSecsMax === undefined
        ? {}
        : { remoteTimeoutSecsMax: git.remoteTimeoutSecsMax }),
      ...(git.promotionTimeoutSecsMax === undefined
        ? {}
        : { promotionTimeoutSecsMax: git.promotionTimeoutSecsMax }),
    }),
    artifactRoot: settings.artifactRoot,
  };
}

/**
 * Wires the authenticated web application to API-role PostgreSQL ports.
 *
 * THE INQUIRY STORE IS COMPOSED HERE AND IS NOT A PARAMETER, which the lead's
 * and the thread's bundles are: those carry an artifact volume and a credential
 * slot a deployment must choose, this one is the API pool and nothing else, and
 * a bundle with nothing to choose is a line no case can refute and a root can
 * forget — a forgotten one costing three routes that raise in a deployment
 * while every gate stays green, so there is no composing this without it.
 */
export function composeNativeWeb(
  apiPool: pg.Pool,
  keying: IdempotencyKeying,
  access: ProjectAccess,
  backlog: ExecutionBacklogGuard,
  config: TicketServiceConfig = ticketServiceDefaults,
  metrics: TicketServiceMetrics = silentTicketServiceMetrics,
  inventory?: ProjectInventory,
  outputContents?: OutputContentPort & RunEvidenceContentPort,
  selectorContexts?: SelectorOperationalContextRead,
  repositoryConfigurationSnapshots?: RepositoryConfigurationSnapshotPort,
  leads?: NativeLeadPorts,
  threads?: NativeThreadPorts,
): NativeWeb {
  const inbox = postgresOperationInbox(apiPool, keying, config, metrics);
  const authoring = postgresAuthoring(apiPool);
  return nativeWeb(
    access,
    postgresNativeReads(apiPool),
    inbox,
    authoring,
    postgresNotifications(apiPool),
    backlog,
    postgresDispatchViews(apiPool),
    inventory ??
      authorizedProjectInventory(access, postgresProjectInventory(apiPool)),
    postgresOperationalReads(apiPool),
    outputContents,
    selectorContexts,
    repositoryConfigurationSnapshots === undefined
      ? undefined
      : {
          bindings: postgresProjectRepositoryBinding(apiPool),
          snapshots: repositoryConfigurationSnapshots,
          store: authoring,
        },
    postgresRunEvidenceReads(apiPool),
    outputContents,
    leads,
    threads,
    postgresLeadInquiries(apiPool),
  );
}

/** Wires the ticket-service contracts to separate API and writer credentials. */
export function composeTicketService(
  apiPool: pg.Pool,
  writerPool: pg.Pool,
  keying: IdempotencyKeying,
  config: TicketServiceConfig = ticketServiceDefaults,
  metrics: TicketServiceMetrics = silentTicketServiceMetrics,
): TicketService {
  return {
    inbox: postgresOperationInbox(apiPool, keying, config, metrics),
    discovery: postgresProjectDiscovery(writerPool, metrics),
    decisions: postgresProjectDecision(writerPool, metrics),
    projects: postgresProjectStore(writerPool),
  };
}
