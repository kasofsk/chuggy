/**
 * The names a pod's image reads its environment by, what the two it resolves a
 * repository from carry, and where it writes a credential the plane minted.
 */

import { z } from "zod";

/** The two variables the image selects its mode by; it refuses a pod launched with both or with neither. */
export const workerTaskVariable = "CHUG_WORKER_TASK";
export const sessionTaskVariable = "CHUG_SESSION_TASK";

/** Where each credential the grant named was mounted, which both pods read alike. */
export const workerCredentialFilesVariable = "CHUG_WORKER_CREDENTIAL_FILES";

/** The writable directory a pod does its work in. */
export const workerWorkspaceVariable = "CHUG_WORKER_WORKSPACE";

/** The site's map of the repositories a pod may reach, which a deployment supplies rather than a launcher. */
export const workerRepositoriesVariable = "CHUG_WORKER_REPOSITORIES";

/**
 * What `CHUG_WORKER_CREDENTIAL_FILES` carries for a pod whose grant names
 * `credentials`: each of them and no other, keyed by that name, at the absolute
 * path the site mounted it.
 */
export function workerCredentialFilesSchema(credentials: readonly string[]) {
  return z.strictObject(
    Object.fromEntries(
      credentials.map((credential) => [credential, z.string().startsWith("/")]),
    ),
  );
}

/**
 * What `CHUG_WORKER_REPOSITORIES` carries, keyed by repository: the remote a pod
 * clones in place of the repository's own identity, the credential it presents
 * there by the name a grant gives it, and the username it presents it under.
 */
export const workerRepositoriesSchema = z.record(
  z.string(),
  z.strictObject({
    url: z.string().min(1).exactOptional(),
    credential: z.string().min(1).exactOptional(),
    credentialUsername: z.string().min(1).exactOptional(),
  }),
);

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
