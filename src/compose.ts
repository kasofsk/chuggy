import type { OwnerId, RecoveryEpoch } from "./interpreter/projectStore.ts";
import { createHash } from "node:crypto";

import type pg from "pg";
import { postgresTicketMachine } from "./adapters/postgres/ticketMachine.ts";
import {
  postgresTicketMachineInbox,
  postgresTicketMachineQueue,
} from "./adapters/postgres/ticketMachineInbox.ts";
import { postgresTicketExecution } from "./adapters/postgres/ticketExecution.ts";
import { postgresTicketFinalizer } from "./adapters/postgres/ticketFinalizer.ts";
import { postgresTicketContent } from "./adapters/postgres/ticketContent.ts";
import { ticketMachineTaskKey } from "./interpreter/ticketMachine.ts";
import {
  ticketFinalizerRegistration,
  ticketFinalizerDefaults,
  type TicketFinalizerConfig,
  type TicketFinalizerService,
} from "./interpreter/ticketFinalizer.ts";
import type { TicketMachineRuntime } from "./interpreter/ticketMachineRun.ts";

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
import { postgresLeadInquiries } from "./adapters/postgres/leadInquiry.ts";
import { postgresProjectRepositoryBinding } from "./adapters/postgres/repositoryConfiguration.ts";
import {
  forgeCredentialMinting,
  type ForgeCredentialMinting,
} from "./interpreter/forgeCredentials.ts";
import {
  githubForgeId,
  portalForgeApp,
  type ForgeApp,
  type ForgeAppKey,
  type ForgeInstallationTokens,
  type ForgePermissionSet,
  type ForgeRepositoryTokens,
} from "./interpreter/forgeInstallation.ts";
import {
  repositoryOnboarding,
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
  postgresProjectRepositoryLanding,
  postgresProjectRepositoryRetirement,
  postgresRepositoryBinding,
} from "./adapters/postgres/repositoryBinding.ts";
import { postgresProjectInventory } from "./adapters/postgres/projectInventory.ts";
import { authorizedProjectInventory } from "./interpreter/projectInventory.ts";
import {
  asCommitPermitId,
  asRepositoryId,
  type FinalizerOwnerId,
  type GitPromotionPort,
  type RepositoryCredentialPort,
} from "./interpreter/finalizer.ts";
import { asChangeProposalRequestIdentity } from "./interpreter/changeProposal.ts";
import type {
  FinalizerSettings,
  ForgeBindingFile,
  RepositoryCredentialFile,
} from "./interpreter/finalizerSettings.ts";
import type { RuntimePrecondition } from "./interpreter/serviceRuntime.ts";
import { postgresProjectStore } from "./adapters/postgres/projectStore.ts";
import {
  nativeWeb,
  type NativeLeadPorts,
  type NativeThreadPorts,
  type NativeWeb,
  type ProjectAccess,
} from "./interpreter/nativeWeb.ts";

/**
 * What one process resolves a repository's credential with: what it mints under
 * where it holds an app key, the files it falls back to, and how much it may
 * ask a mint for.
 */
export interface RepositoryCredentialComposition {
  readonly minting?: RepositoryCredentialMinting;
  readonly permissions: ForgePermissionSet;
  readonly sources: readonly RepositoryCredentialFile[];
  readonly credentialBytesMax?: number;
}

/** The minting half of one process's credentials, absent where it holds no app key. */
export interface RepositoryCredentialMinting {
  readonly installationTokens: ForgeInstallationTokens;
  readonly tokens: ForgeRepositoryTokens;
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
 * What a process mints with, over the pool it owns and the key it holds. The
 * permission is not here: one process mints under one key for several acts, and
 * each act's composition is what says how much it may ask for.
 */
export function composeForgeRepositoryMinting(
  pool: pg.Pool,
  forge: ForgeAppKey | undefined,
  app: ForgeApp = portalForgeApp,
): RepositoryCredentialMinting | undefined {
  if (forge === undefined) return undefined;
  const installationTokens = githubInstallationTokens(
    githubInstallationTokensOptions(forge),
  );
  return {
    installationTokens,
    tokens: mintedRepositoryTokens({
      forge: githubForgeId,
      app,
      repositoryHost: githubRepositoryHost,
      installations: postgresForgeInstallations(pool),
      tokens: installationTokens,
    }),
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
): RepositoryCredentialPort {
  const files = credentialFiles(repositoryCredentialFileOptions(composition));
  const minting = composition.minting;
  if (minting === undefined) return files;
  return repositoryCredentialsByHost(
    [
      {
        repositoryHost: githubRepositoryHost,
        credentials: mintedRepositoryCredentials({
          tokens: minting.tokens,
          permissions: composition.permissions,
        }),
      },
    ],
    files,
  );
}

/** What the finalizer asks a forge for to promote: it pushes a branch and reads nothing else. */
export function composeFinalizerRepositoryCredentials(
  options: CredentialFilesOptions,
  minting: RepositoryCredentialMinting | undefined,
): RepositoryCredentialPort {
  return composeRepositoryCredentials({
    ...(minting === undefined ? {} : { minting }),
    permissions: "write",
    ...options,
  });
}

/**
 * What the API asks a forge for: it proves a binding and reads a repository's
 * declarations, and opens nothing and pushes nothing under its own credential.
 */
export function composeApiRepositoryCredentials(
  options: CredentialFilesOptions,
  minting: RepositoryCredentialMinting | undefined,
): RepositoryCredentialPort {
  return composeRepositoryCredentials({
    ...(minting === undefined ? {} : { minting }),
    permissions: "read",
    ...options,
  });
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
 * against, and the two doors 089 grants the API. THE APPS ARE OPTIONAL AND THE
 * REST IS NOT: a deployment naming no app key still binds and still lists what
 * a project binds, and has nothing to say about installations, which is what
 * `NotConfigured` is.
 */
export interface RepositoryOnboardingComposition {
  readonly apiPool: pg.Pool;
  readonly access: ProjectAccess;
  readonly credentials: RepositoryCredentialPort;
  readonly forgeApps: readonly RepositoryOnboardingForgeApp[];
  readonly creation?: RepositoryCreationPorts;
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
    landing: postgresProjectRepositoryLanding(composition.apiPool),
    retirement: postgresProjectRepositoryRetirement(composition.apiPool),
    ...(composition.creation === undefined
      ? {}
      : { creation: composition.creation }),
  });
}

/** What a finalizer deployment answers its own ports with, none of it read from an environment. */
export interface FinalizerServiceRuntime {
  readonly git: GitPromotionPort;
  readonly forges: ChangeProposalForges;
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

/**
 * Wires the finalizer's durable authority to its finalizer-role credentials, the
 * Git port its caller composes, the brief its target is narrowed by and one
 * project-owned artifact store, which is where a credential and a storage root
 * are answered from and never the environment.
 */
export function composeFinalizerService(
  finalizerPool: pg.Pool,
  runtime: FinalizerServiceRuntime,
  owner: FinalizerOwnerId,
  recoveryEpoch: RecoveryEpoch,
  config: TicketFinalizerConfig = ticketFinalizerDefaults,
): TicketFinalizerService {
  const store = postgresTicketFinalizer(finalizerPool);
  const inbox = postgresTicketMachineInbox(finalizerPool);
  return {
    owner,
    recoveryEpoch,
    leaseMs: config.requestClaimLeaseSecs * 1000,
    store,
    git: runtime.git,
    contents: (partition) => postgresTicketContent(finalizerPool, partition),
    bindings: postgresProjectRepositoryBinding(finalizerPool),
    forges: {
      binding: (repository) =>
        runtime.forges.bindingOf(asRepositoryId(repository)),
      proposal: (forge) => runtime.forges.selector.select(forge as never),
    },
    inbox: {
      submit: async (partition, identity, command) => {
        const answer = await inbox.submit(partition, {
          identity,
          origin: "Finalizer",
          command,
          authorization: {
            principal: owner,
            authorizedOperation: "ReportFinalizationResult",
            authorityKind: "Service",
            authoritySubject: owner,
            policyRevision: "ticket-finalizer-v1",
          },
        });
        return (
          answer.accepted === "Accepted" ||
          answer.accepted === "AlreadyAccepted"
        );
      },
    },
    bounds: {
      publication: {
        creationsMax: config.proposalCreationsMax,
        reconciliationsMax: config.proposalReconciliationsMax,
      },
      merging: {
        mergesMax: config.proposalMergesMax,
        readingsMax: config.proposalMergeReadingsMax,
      },
    },
    identities: (claim) => {
      const digest = createHash("sha256")
        .update(
          `${claim.partition.tenant}\0${claim.partition.project}\0${claim.identity}`,
        )
        .digest("hex");
      return {
        request: asChangeProposalRequestIdentity(digest),
        permit: asCommitPermitId(digest),
      };
    },
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
export function composeFinalizerForgeCredentials(
  options: ForgeCredentialFilesOptions,
  minting: RepositoryCredentialMinting | undefined,
): ForgeCredentialPort {
  const files = forgeCredentialFiles(options);
  if (minting === undefined) return files;
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
    service: (pool) =>
      finalizerServiceRuntime(
        settings,
        composeForgeRepositoryMinting(pool, settings.forge),
        credentialOptions,
        forgeOptions,
      ),
  };
}

/** The ports one finalizer promotes and proposes through, over what it mints and mounts. */
function finalizerServiceRuntime(
  settings: FinalizerSettings,
  minting: RepositoryCredentialMinting | undefined,
  credentialOptions: CredentialFilesOptions,
  forgeOptions: ForgeCredentialFilesOptions,
): FinalizerServiceRuntime {
  const git = settings.git;
  const credentials = composeFinalizerRepositoryCredentials(
    credentialOptions,
    minting,
  );
  return {
    forges: composeChangeProposalForges(
      settings.forges,
      composeFinalizerForgeCredentials(forgeOptions, minting),
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
  access: ProjectAccess,
  leads: NativeLeadPorts,
  threads: NativeThreadPorts,
): NativeWeb {
  return nativeWeb(
    access,
    authorizedProjectInventory(access, postgresProjectInventory(apiPool)),
    leads,
    threads,
    postgresLeadInquiries(apiPool),
  );
}

export function composeTicketMachineRuntime(
  pool: pg.Pool,
  owner: OwnerId,
): TicketMachineRuntime {
  const execution = postgresTicketExecution(pool);
  return {
    projects: postgresProjectStore(pool),
    store: postgresTicketMachine(pool),
    inbox: postgresTicketMachineInbox(pool),
    queue: postgresTicketMachineQueue(pool),
    owner,
    effects: {
      execute: (partition, identity, obligation) =>
        execution.execute(
          partition,
          identity,
          ticketMachineTaskKey(obligation.task.task),
          obligation.task,
        ),
      cancel: (partition, identity, obligation) =>
        execution.cancel(
          partition,
          identity,
          ticketMachineTaskKey(obligation.task),
        ),
      ...ticketFinalizerRegistration(postgresTicketFinalizer(pool)),
    },
  };
}
