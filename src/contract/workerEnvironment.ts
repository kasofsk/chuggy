/** The names a pod's image reads its environment by, and where it writes a credential the plane minted. */

/** The two variables the image selects its mode by; it refuses a pod launched with both or with neither. */
export const workerTaskVariable = "CHUG_WORKER_TASK";
export const sessionTaskVariable = "CHUG_SESSION_TASK";

/** Where each credential the grant named was mounted, which both pods read alike. */
export const workerCredentialFilesVariable = "CHUG_WORKER_CREDENTIAL_FILES";

/** The writable directory a pod does its work in. */
export const workerWorkspaceVariable = "CHUG_WORKER_WORKSPACE";

/** The site's map of the repositories a pod may reach, which a deployment supplies rather than a launcher. */
export const workerRepositoriesVariable = "CHUG_WORKER_REPOSITORIES";

/** The environment variable a placed worker reaches its own PostgreSQL by. */
export const workerDatabaseUrlVariable = "CHUG_WORKER_DATABASE_URL";

/** The environment variable naming the model a session's runtime is opened against. */
export const sessionModelVariable = "CHUG_SESSION_MODEL";

/** The agent runtime's own variable for the directory it writes its local copy to. */
export const sessionConfigDirectoryVariable = "CLAUDE_CONFIG_DIR";

/**
 * Where an image writes a credential the worker plane minted for it. It is
 * fixed rather than configured, because the image and the launcher have to name
 * one path and nothing either reads would tell it the other had moved.
 */
export const mintedCredentialDirectory = "/var/run/chuggy/minted";
