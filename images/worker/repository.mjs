const askpass = "/usr/local/lib/chuggy/git-askpass.sh";

/** @typedef {{ url?: unknown, credential?: unknown, credentialUsername?: unknown }} WorkerRepositoryConfiguration */

/**
 * @param {unknown} value
 * @param {string} field
 * @param {string} repositoryId
 * @returns {string}
 */
function requiredText(value, field, repositoryId) {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`worker repository ${repositoryId} has no ${field}`);
  return value;
}

/** @param {string} value */
export function workerRepositories(value) {
  /** @type {unknown} */
  const parsed = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("worker repositories must be an object");
  return /** @type {Record<string, WorkerRepositoryConfiguration>} */ (parsed);
}

/**
 * The askpass environment one credential is presented to git through, whether
 * the value behind the file was mounted by the launcher or minted by the plane.
 *
 * @param {string} credentialFile
 * @param {string} credentialUsername
 */
export function workerCredentialEnvironment(
  credentialFile,
  credentialUsername,
) {
  return {
    ...process.env,
    CHUG_WORKER_GIT_CREDENTIAL_FILE: credentialFile,
    CHUG_WORKER_GIT_CREDENTIAL_USERNAME: credentialUsername,
    GIT_ASKPASS: askpass,
    GIT_TERMINAL_PROMPT: "0",
  };
}

/**
 * The configuration the site holds for one reference, which carries the remote
 * whichever credential ends up reaching it.
 *
 * @param {Record<string, WorkerRepositoryConfiguration>} repositories
 * @param {string} repositoryId
 * @returns {WorkerRepositoryConfiguration}
 */
function workerRepositoryConfiguration(repositories, repositoryId) {
  if (!Object.hasOwn(repositories, repositoryId))
    throw new Error(`no repository configuration for ${repositoryId}`);
  const configured = repositories[repositoryId];
  if (configured === null || typeof configured !== "object")
    throw new Error(`no repository configuration for ${repositoryId}`);
  return configured;
}

/**
 * @param {Record<string, WorkerRepositoryConfiguration>} repositories
 * @param {string} repositoryId
 */
export function workerRepositoryUrl(repositories, repositoryId) {
  return requiredText(
    workerRepositoryConfiguration(repositories, repositoryId).url,
    "URL",
    repositoryId,
  );
}

/**
 * @param {Record<string, WorkerRepositoryConfiguration>} repositories
 * @param {Record<string, unknown>} credentialFiles
 * @param {string} repositoryId
 */
export function workerRepository(repositories, credentialFiles, repositoryId) {
  const configured = workerRepositoryConfiguration(repositories, repositoryId);
  const repository = requiredText(configured.url, "URL", repositoryId);
  const credential = requiredText(
    configured.credential,
    "credential capability",
    repositoryId,
  );
  const credentialFile = requiredText(
    Object.hasOwn(credentialFiles, credential)
      ? credentialFiles[credential]
      : undefined,
    "credential file",
    repositoryId,
  );
  if (!credentialFile.startsWith("/"))
    throw new Error(
      `worker repository ${repositoryId} credential file is relative`,
    );
  const credentialUsername = requiredText(
    configured.credentialUsername,
    "credential username",
    repositoryId,
  );
  return {
    repository,
    credential,
    environment: workerCredentialEnvironment(
      credentialFile,
      credentialUsername,
    ),
  };
}
