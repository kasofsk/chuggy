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
  asFinalizerOwnerId,
  asRepositoryId,
  checkedFinalizerConfig,
  finalizerDefaults,
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
  readonly path: string;
}

/** The most repositories one finalizer deployment holds a credential for. */
export const repositoryCredentialFilesMax = 256;

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
): RepositoryCredentialFile {
  if (typeof entry !== "object" || entry === null)
    throw new Error(`${credentialSourcesVariable} has an invalid entry`);
  const fields = entry as Readonly<Record<string, unknown>>;
  const path = fields["path"];
  if (
    typeof fields["repository"] !== "string" ||
    typeof path !== "string" ||
    path.length === 0
  )
    throw new Error(`${credentialSourcesVariable} has an invalid entry`);
  return { repository: asRepositoryId(fields["repository"]), path };
}

/** Every repository this deployment holds a credential for, each named once. */
function finalizerSettingsCredentials(
  environment: FinalizerEnvironment,
): readonly RepositoryCredentialFile[] {
  const parsed: unknown = JSON.parse(
    finalizerSettingsRequired(environment, credentialSourcesVariable),
  );
  if (!Array.isArray(parsed))
    throw new Error(`${credentialSourcesVariable} must be an array`);
  if (parsed.length === 0 || parsed.length > repositoryCredentialFilesMax)
    throw new RangeError(
      `${credentialSourcesVariable} names ${String(parsed.length)} repositories, past the ${String(repositoryCredentialFilesMax)} one deployment holds`,
    );
  const files = parsed.map(finalizerSettingsCredentialFile);
  const repositories = new Set(files.map((file) => file.repository));
  if (repositories.size !== files.length)
    throw new Error(`${credentialSourcesVariable} names a repository twice`);
  return files;
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
