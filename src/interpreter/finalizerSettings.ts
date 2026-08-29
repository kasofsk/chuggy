/**
 * The whole plain-data configuration one finalizer deployment names, and the
 * parse that turns an environment record into it.
 *
 * NOTHING HERE READS AN ENVIRONMENT. The record is an argument, because the
 * process root is the only place in this tree that reads one; what this module
 * owns is which names a deployment answers and what each of them must be.
 *
 * A CREDENTIAL IS A PATH HERE AND NEVER A VALUE. A deployment names the file
 * each repository's credential stands in, so no secret is in this process's
 * environment, its arguments or its diagnostics, and the source reads one at
 * the moment a single remote act needs it.
 *
 * THE GIT CHILDREN INHERIT AN ALLOWLIST AND NOT THIS PROCESS'S ENVIRONMENT.
 * The finalizer's own environment carries its database URL, so a git child is
 * given the variables named below and nothing else.
 *
 * A BOUND THIS NAMES NO DEFAULT FOR IS ABSENT RATHER THAN GUESSED, so the
 * layer that owns each bound stays the one place its default is written.
 */

import {
  asForgeBindingId,
  asForgeCredentialReference,
  type ForgeBindingId,
  type ForgeCredentialReference,
} from "./changeProposal.ts";
import {
  asFinalizerOwnerId,
  asRepositoryId,
  checkedFinalizerConfig,
  finalizerDefaults,
  finalizerIdentityCharsMax,
  type FinalizerConfig,
  type FinalizerOwnerId,
  type RepositoryId,
} from "./finalizer.ts";
import { asRecoveryEpoch, type RecoveryEpoch } from "./projectStore.ts";
import type { ServiceRuntimeConfig } from "./serviceRuntime.ts";

/** An environment as this layer takes it: names to values, and never a global. */
export type FinalizerEnvironment = Readonly<Record<string, string | undefined>>;

/** One repository's credential, named as the file it stands in rather than as a value. */
export interface RepositoryCredentialFile {
  readonly repository: RepositoryId;
  readonly credentialReference?: string;
  readonly path: string;
}

/** The most repositories one finalizer deployment holds a credential for. */
export const repositoryCredentialFilesMax = 256;

/**
 * One forge this deployment may open a change proposal on: the repositories it
 * holds, the API it is asked through, and the file its own credential stands
 * in. The credential is a path here for the same reason a repository's is.
 */
export interface ForgeBindingFile {
  readonly forge: ForgeBindingId;
  readonly repositoryHost: string;
  readonly apiHost: string;
  readonly credentialReference: ForgeCredentialReference;
  readonly path: string;
}

/** The most forges one finalizer deployment opens change proposals on. */
export const forgeBindingFilesMax = 32;

/** The longest host one forge binding names, which is what a URL's authority may be. */
export const forgeHostCharsMax = 255;

/** The longest path one forge binding names its credential file at. */
export const forgePathCharsMax = 4_096;

/** What the git children of one deployment are composed with. */
export interface FinalizerGitSettings {
  readonly scratchDirectory: string;
  readonly commitName: string;
  readonly commitEmail: string;
  readonly environment: FinalizerEnvironment;
  readonly credentialUsername?: string;
  readonly localTimeoutSecsMax?: number;
  readonly remoteTimeoutSecsMax?: number;
  readonly promotionTimeoutSecsMax?: number;
}

/** Everything one finalizer process is configured with, all of it plain data. */
export interface FinalizerSettings {
  readonly databaseUrl: string;
  readonly owner: FinalizerOwnerId;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly artifactRoot: string;
  readonly git: FinalizerGitSettings;
  readonly credentials: readonly RepositoryCredentialFile[];
  readonly forges: readonly ForgeBindingFile[];
  readonly credentialBytesMax?: number;
  readonly runtime: ServiceRuntimeConfig;
  readonly finalizer: FinalizerConfig;
}

/** The pace and the drain a deployment gets when it names neither. */
export const finalizerRuntimeDefaults: ServiceRuntimeConfig = {
  idleIntervalMilliseconds: 1_000,
  shutdownDrainMilliseconds: 15_000,
};

/** The variables a git child inherits, this process's own environment being where its database URL is. */
export const finalizerGitEnvironmentNames: readonly string[] = [
  "GIT_SSL_CAINFO",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "NO_PROXY",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TMPDIR",
  "http_proxy",
  "https_proxy",
  "no_proxy",
];

const databaseUrlVariable = "CHUG_FINALIZER_DATABASE_URL";
const ownerVariable = "CHUG_FINALIZER_OWNER";
const recoveryEpochVariable = "CHUG_FINALIZER_RECOVERY_EPOCH";
const artifactRootVariable = "CHUG_FINALIZER_ARTIFACT_ROOT";
const credentialSourcesVariable = "CHUG_FINALIZER_CREDENTIAL_SOURCES";
const forgeBindingsVariable = "CHUG_FINALIZER_FORGE_BINDINGS";
const credentialBytesVariable = "CHUG_FINALIZER_CREDENTIAL_BYTES_MAX";
const gitScratchRootVariable = "CHUG_FINALIZER_GIT_SCRATCH_ROOT";
const gitCommitNameVariable = "CHUG_FINALIZER_GIT_COMMIT_NAME";
const gitCommitEmailVariable = "CHUG_FINALIZER_GIT_COMMIT_EMAIL";
const gitCredentialUsernameVariable = "CHUG_FINALIZER_GIT_CREDENTIAL_USERNAME";
const gitLocalTimeoutVariable = "CHUG_FINALIZER_GIT_LOCAL_TIMEOUT_SECS_MAX";
const gitRemoteTimeoutVariable = "CHUG_FINALIZER_GIT_REMOTE_TIMEOUT_SECS_MAX";
const gitPromotionTimeoutVariable =
  "CHUG_FINALIZER_GIT_PROMOTION_TIMEOUT_SECS_MAX";
const idleIntervalVariable = "CHUG_FINALIZER_IDLE_INTERVAL_MS";
const shutdownDrainVariable = "CHUG_FINALIZER_SHUTDOWN_DRAIN_MS";
const requestClaimLeaseVariable = "CHUG_FINALIZER_REQUEST_CLAIM_LEASE_SECS";
const requestsPerPassVariable = "CHUG_FINALIZER_REQUESTS_PER_PASS_MAX";
const preparationRestartsVariable = "CHUG_FINALIZER_PREPARATION_RESTARTS_MAX";
const preparationsPerPassVariable = "CHUG_FINALIZER_PREPARATIONS_PER_PASS_MAX";
const promotionsPerPassVariable = "CHUG_FINALIZER_PROMOTIONS_PER_PASS_MAX";
const reconciliationsPerPassVariable =
  "CHUG_FINALIZER_RECONCILIATIONS_PER_PASS_MAX";
const heldPermitsPerPassVariable = "CHUG_FINALIZER_HELD_PERMITS_PER_PASS_MAX";
const proposalsPerPassVariable = "CHUG_FINALIZER_PROPOSALS_PER_PASS_MAX";
const proposalCreationsVariable = "CHUG_FINALIZER_PROPOSAL_CREATIONS_MAX";
const proposalReconciliationsVariable =
  "CHUG_FINALIZER_PROPOSAL_RECONCILIATIONS_MAX";

/** The one shape a deployment may not leave to a default. */
function finalizerSettingsRequired(
  environment: FinalizerEnvironment,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

/** A bound a deployment may name, its absence leaving the default to whoever owns it. */
function finalizerSettingsBound(
  environment: FinalizerEnvironment,
  name: string,
): number | undefined {
  const value = environment[name];
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/u.test(value))
    throw new RangeError(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError(`${name} is too big`);
  return parsed;
}

/** The same bound where this layer is the one that owns its default. */
function finalizerSettingsBoundOr(
  environment: FinalizerEnvironment,
  name: string,
  fallback: number,
): number {
  return finalizerSettingsBound(environment, name) ?? fallback;
}

/** One declared credential file, refusing an entry that names neither a repository nor a path. */
function finalizerSettingsCredentialFile(
  entry: unknown,
  variable: string = credentialSourcesVariable,
): RepositoryCredentialFile {
  if (typeof entry !== "object" || entry === null)
    throw new Error(`${variable} has an invalid entry`);
  const fields = entry as Readonly<Record<string, unknown>>;
  const path = fields["path"];
  if (
    typeof fields["repository"] !== "string" ||
    typeof path !== "string" ||
    path.length === 0
  )
    throw new Error(`${variable} has an invalid entry`);
  const credentialReference = fields["credentialReference"];
  if (
    credentialReference !== undefined &&
    (typeof credentialReference !== "string" ||
      credentialReference.length === 0)
  )
    throw new Error(`${variable} has an invalid entry`);
  return {
    repository: asRepositoryId(fields["repository"]),
    ...(credentialReference === undefined ? {} : { credentialReference }),
    path,
  };
}

/** Parses one bounded repository-to-credential-file mapping without reading its files. */
export function repositoryCredentialFilesOf(
  encoded: string,
  variable: string,
): readonly RepositoryCredentialFile[] {
  const parsed: unknown = JSON.parse(encoded);
  if (!Array.isArray(parsed)) throw new Error(`${variable} must be an array`);
  if (parsed.length === 0 || parsed.length > repositoryCredentialFilesMax)
    throw new RangeError(
      `${variable} names ${String(parsed.length)} repositories, past the ${String(repositoryCredentialFilesMax)} one deployment holds`,
    );
  const files = parsed.map((entry) =>
    finalizerSettingsCredentialFile(entry, variable),
  );
  const identities = new Set(
    files.map((file) =>
      JSON.stringify([
        file.repository,
        file.credentialReference ?? file.repository,
      ]),
    ),
  );
  if (identities.size !== files.length)
    throw new Error(`${variable} names a credential twice`);
  return files;
}

/** One declared string field, refusing an entry that leaves it out or empties it. */
function finalizerSettingsField(
  fields: Readonly<Record<string, unknown>>,
  name: string,
  charsMax: number,
): string {
  const value = fields[name];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > charsMax
  )
    throw new Error(`${forgeBindingsVariable} has an invalid entry`);
  return value;
}

/** The host a URL's authority may be, refusing anything a URL would not read as one. */
function finalizerSettingsHost(
  fields: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = finalizerSettingsField(fields, name, forgeHostCharsMax);
  const url = new URL(`https://${value}`);
  if (url.host !== value || url.pathname !== "/")
    throw new Error(`${forgeBindingsVariable} has an invalid entry`);
  return value;
}

/**
 * One declared forge binding, refusing an entry that names no forge, host,
 * credential or path. Both hosts are named or the entry is refused, the
 * repositories a forge holds and the API it is asked through being one forge:
 * an entry naming only the first would have its credential sent to whatever API
 * the adapter composed for it defaults to.
 */
function finalizerSettingsForgeBinding(entry: unknown): ForgeBindingFile {
  if (typeof entry !== "object" || entry === null)
    throw new Error(`${forgeBindingsVariable} has an invalid entry`);
  const fields = entry as Readonly<Record<string, unknown>>;
  if (fields["apiHost"] === undefined) {
    throw new Error(
      `${forgeBindingsVariable} names a repository host without the API host that forge is asked through`,
    );
  }
  return {
    forge: asForgeBindingId(
      finalizerSettingsField(fields, "forge", finalizerIdentityCharsMax),
    ),
    repositoryHost: finalizerSettingsHost(fields, "repositoryHost"),
    apiHost: finalizerSettingsHost(fields, "apiHost"),
    credentialReference: asForgeCredentialReference(
      finalizerSettingsField(
        fields,
        "credentialReference",
        finalizerIdentityCharsMax,
      ),
    ),
    path: finalizerSettingsField(fields, "path", forgePathCharsMax),
  };
}

/**
 * Every forge this deployment opens change proposals on, each host bound once.
 * A deployment naming none opens none, which is what a finalizer that lands
 * every ticket by pushing needs to say.
 */
export function forgeBindingFilesOf(
  encoded: string,
  variable: string,
): readonly ForgeBindingFile[] {
  const parsed: unknown = JSON.parse(encoded);
  if (!Array.isArray(parsed)) throw new Error(`${variable} must be an array`);
  if (parsed.length > forgeBindingFilesMax)
    throw new RangeError(
      `${variable} names ${String(parsed.length)} forges, past the ${String(forgeBindingFilesMax)} one deployment opens proposals on`,
    );
  const bindings = parsed.map(finalizerSettingsForgeBinding);
  for (const named of ["forge", "repositoryHost"] as const) {
    if (
      new Set(bindings.map((binding) => binding[named])).size !==
      bindings.length
    )
      throw new Error(`${variable} names a ${named} twice`);
  }
  return bindings;
}

/** Every repository this deployment holds a credential for, each named once. */
function finalizerSettingsCredentials(
  environment: FinalizerEnvironment,
): readonly RepositoryCredentialFile[] {
  return repositoryCredentialFilesOf(
    finalizerSettingsRequired(environment, credentialSourcesVariable),
    credentialSourcesVariable,
  );
}

/** Every forge this deployment opens proposals on, and none where it names no bindings. */
function finalizerSettingsForges(
  environment: FinalizerEnvironment,
): readonly ForgeBindingFile[] {
  const encoded = environment[forgeBindingsVariable];
  return encoded === undefined || encoded.length === 0
    ? []
    : forgeBindingFilesOf(encoded, forgeBindingsVariable);
}

/** The variables a git child is given, taken from this process's own by name. */
function finalizerSettingsGitEnvironment(
  environment: FinalizerEnvironment,
): FinalizerEnvironment {
  return Object.fromEntries(
    finalizerGitEnvironmentNames
      .filter((name) => environment[name] !== undefined)
      .map((name) => [name, environment[name]]),
  );
}

/** What the git adapter is composed with, each bound it owns a default for left absent. */
function finalizerSettingsGit(
  environment: FinalizerEnvironment,
): FinalizerGitSettings {
  const credentialUsername = environment[gitCredentialUsernameVariable];
  const local = finalizerSettingsBound(environment, gitLocalTimeoutVariable);
  const remote = finalizerSettingsBound(environment, gitRemoteTimeoutVariable);
  const promotion = finalizerSettingsBound(
    environment,
    gitPromotionTimeoutVariable,
  );
  return {
    scratchDirectory: finalizerSettingsRequired(
      environment,
      gitScratchRootVariable,
    ),
    commitName: finalizerSettingsRequired(environment, gitCommitNameVariable),
    commitEmail: finalizerSettingsRequired(environment, gitCommitEmailVariable),
    environment: finalizerSettingsGitEnvironment(environment),
    ...(credentialUsername === undefined ? {} : { credentialUsername }),
    ...(local === undefined ? {} : { localTimeoutSecsMax: local }),
    ...(remote === undefined ? {} : { remoteTimeoutSecsMax: remote }),
    ...(promotion === undefined ? {} : { promotionTimeoutSecsMax: promotion }),
  };
}

/** Every pass bound the finalizer decides under, defaulted from the layer that declares them. */
function finalizerSettingsFinalizer(
  environment: FinalizerEnvironment,
): FinalizerConfig {
  return checkedFinalizerConfig({
    requestClaimLeaseSecs: finalizerSettingsBoundOr(
      environment,
      requestClaimLeaseVariable,
      finalizerDefaults.requestClaimLeaseSecs,
    ),
    requestsPerPassMax: finalizerSettingsBoundOr(
      environment,
      requestsPerPassVariable,
      finalizerDefaults.requestsPerPassMax,
    ),
    preparationRestartsMax: finalizerSettingsBoundOr(
      environment,
      preparationRestartsVariable,
      finalizerDefaults.preparationRestartsMax,
    ),
    preparationsPerPassMax: finalizerSettingsBoundOr(
      environment,
      preparationsPerPassVariable,
      finalizerDefaults.preparationsPerPassMax,
    ),
    promotionsPerPassMax: finalizerSettingsBoundOr(
      environment,
      promotionsPerPassVariable,
      finalizerDefaults.promotionsPerPassMax,
    ),
    reconciliationsPerPassMax: finalizerSettingsBoundOr(
      environment,
      reconciliationsPerPassVariable,
      finalizerDefaults.reconciliationsPerPassMax,
    ),
    heldPermitsPerPassMax: finalizerSettingsBoundOr(
      environment,
      heldPermitsPerPassVariable,
      finalizerDefaults.heldPermitsPerPassMax,
    ),
    proposalsPerPassMax: finalizerSettingsBoundOr(
      environment,
      proposalsPerPassVariable,
      finalizerDefaults.proposalsPerPassMax,
    ),
    proposalCreationsMax: finalizerSettingsBoundOr(
      environment,
      proposalCreationsVariable,
      finalizerDefaults.proposalCreationsMax,
    ),
    proposalReconciliationsMax: finalizerSettingsBoundOr(
      environment,
      proposalReconciliationsVariable,
      finalizerDefaults.proposalReconciliationsMax,
    ),
  });
}

/** Parses one deployment's whole finalizer configuration out of a plain environment record. */
export function finalizerSettingsOf(
  environment: FinalizerEnvironment,
): FinalizerSettings {
  const credentialBytesMax = finalizerSettingsBound(
    environment,
    credentialBytesVariable,
  );
  return {
    databaseUrl: finalizerSettingsRequired(environment, databaseUrlVariable),
    owner: asFinalizerOwnerId(
      finalizerSettingsRequired(environment, ownerVariable),
    ),
    recoveryEpoch: asRecoveryEpoch(
      finalizerSettingsRequired(environment, recoveryEpochVariable),
    ),
    artifactRoot: finalizerSettingsRequired(environment, artifactRootVariable),
    git: finalizerSettingsGit(environment),
    credentials: finalizerSettingsCredentials(environment),
    forges: finalizerSettingsForges(environment),
    ...(credentialBytesMax === undefined ? {} : { credentialBytesMax }),
    runtime: {
      idleIntervalMilliseconds: finalizerSettingsBoundOr(
        environment,
        idleIntervalVariable,
        finalizerRuntimeDefaults.idleIntervalMilliseconds,
      ),
      shutdownDrainMilliseconds: finalizerSettingsBoundOr(
        environment,
        shutdownDrainVariable,
        finalizerRuntimeDefaults.shutdownDrainMilliseconds,
      ),
    },
    finalizer: finalizerSettingsFinalizer(environment),
  };
}
