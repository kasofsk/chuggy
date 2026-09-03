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
import { postgresNativeReads } from "./adapters/postgres/nativeReads.ts";
import { postgresAuthoring } from "./adapters/postgres/authoring.ts";
import { postgresProjectRepositoryBinding } from "./adapters/postgres/repositoryConfiguration.ts";
import { postgresNotifications } from "./adapters/postgres/notifications.ts";
import { postgresDispatchViews } from "./adapters/postgres/dispatchViews.ts";
import { postgresProjectInventory } from "./adapters/postgres/projectInventory.ts";
import {
  postgresSelectorProjectSettings,
  postgresSelectorProposalReviews,
  postgresSelectorRuntimeControl,
  postgresSelectorState,
} from "./adapters/postgres/selector.ts";
import { authorizedProjectInventory } from "./interpreter/projectInventory.ts";
import type {
  SelectorPolicyHost,
  SelectorRuntimeSettingsSource,
  SelectorStateStore,
} from "./interpreter/selector.ts";
import {
  selectorRunOnce,
  type SelectorIdentityFactory,
  type SelectorRunResult,
  type SelectorRuntimeConfig,
  type SelectorRuntimeSource,
} from "./interpreter/selectorRuntime.ts";
import {
  selectorRuntimeAdministration,
  type SelectorAdministrationAccess,
  type SelectorRuntimeAdministration,
} from "./interpreter/selectorAdmin.ts";
import {
  selectorProjectSettingsAdministration,
  type SelectorProjectSettingsAdministration,
} from "./interpreter/selectorProjectSettings.ts";
import {
  selectorProposalReviews,
  type SelectorProposalReviews,
} from "./interpreter/selectorReview.ts";
import {
  selectorPlanning,
  type SelectorPlanning,
} from "./interpreter/selectorPlanning.ts";
import { postgresFinalizer } from "./adapters/postgres/finalizer.ts";
import { postgresTicketBrief } from "./adapters/postgres/ticketBrief.ts";
import {
  asFinalizationAttemptId,
  asInputBundleId,
  checkedFinalizerConfig,
  finalizerDefaults,
  type FinalizerConfig,
  type GitPromotionPort,
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
import type { RepositoryConfigurationSnapshotPort } from "./interpreter/repositoryConfiguration.ts";
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

export interface SelectorService {
  readonly state: SelectorStateStore;
  readonly settings: SelectorRuntimeSettingsSource;
  readonly administration: SelectorRuntimeAdministration;
  readonly reviews: SelectorProposalReviews;
  readonly planning: SelectorPlanning;
}

export interface SelectorRuntimeService {
  runOnce(): Promise<SelectorRunResult>;
}

/** Wires the independently operated selector runtime to its owned persistence. */
export function composeSelectorRuntime(
  selectorPool: pg.Pool,
  source: SelectorRuntimeSource,
  policy: SelectorPolicyHost,
  identities: SelectorIdentityFactory,
  config?: SelectorRuntimeConfig,
): SelectorRuntimeService {
  const store = postgresSelectorState(selectorPool);
  const settings = postgresSelectorRuntimeControl(selectorPool);
  return {
    runOnce: () =>
      selectorRunOnce(store, source, policy, identities, settings, config),
  };
}

/** Wires selector-owned durability and project-authorized semantic history reads. */
export function composeSelectorService(
  selectorPool: pg.Pool,
  selectorControlPool: pg.Pool,
  selectorReviewPool: pg.Pool,
  access: ProjectAccess,
  administrationAccess: SelectorAdministrationAccess,
): SelectorService {
  const state = postgresSelectorState(selectorPool);
  return {
    state,
    settings: postgresSelectorRuntimeControl(selectorPool),
    administration: selectorRuntimeAdministration(
      administrationAccess,
      postgresSelectorRuntimeControl(selectorControlPool),
    ),
    reviews: selectorProposalReviews(
      access,
      postgresSelectorProposalReviews(selectorReviewPool),
    ),
    planning: selectorPlanning(access, state),
  };
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
  service(): FinalizerServiceRuntime;
}

/**
 * Wires a finalizer deployment's plain settings to the git, artifact and
 * credential ports it promotes through. The git port is built on demand,
 * because opening its scratch refuses what `git-available` and
 * `git-scratch-writable` are there to report.
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
  const credentials = credentialFiles(credentialOptions);
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
    ],
    service: () => ({
      forges: composeChangeProposalForges(
        settings.forges,
        forgeCredentialFiles(forgeOptions),
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
    }),
  };
}

/** Wires the authenticated web application to API-role PostgreSQL ports. */
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
