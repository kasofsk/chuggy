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
 * @param {Record<string, WorkerRepositoryConfiguration>} repositories
 * @param {Record<string, unknown>} credentialFiles
 * @param {string} repositoryId
 */
export function workerRepository(repositories, credentialFiles, repositoryId) {
  if (!Object.hasOwn(repositories, repositoryId))
    throw new Error(`no repository configuration for ${repositoryId}`);
  const configured = repositories[repositoryId];
  if (configured === null || typeof configured !== "object")
    throw new Error(`no repository configuration for ${repositoryId}`);
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
    environment: {
      ...process.env,
      CHUG_WORKER_GIT_CREDENTIAL_FILE: credentialFile,
      CHUG_WORKER_GIT_CREDENTIAL_USERNAME: credentialUsername,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
    },
  };
}
