/**
 * The names a pod's image reads its environment by, what the two it resolves a
 * repository from carry, and where it writes a credential the plane minted.
 *
 * And how a job's container is started where its site hands it a runtime,
 * whatever image the job names: chuggy's own tree mounted read-only, whose
 * check runs in the job's image before the worker does. Each of
 * `workerImageFaults` is named for what an image lacks, so an attempt ended
 * under one tells the person and the agent reading it what to change rather
 * than only that it failed.
 */

import { z } from "zod";

/** The two variables the image selects its mode by; it refuses a pod launched with both or with neither. */
export const workerTaskVariable = "CHUG_WORKER_TASK";
export const sessionTaskVariable = "CHUG_SESSION_TASK";

/** Where each credential the grant named was mounted, which both pods read alike. */
export const workerCredentialFilesVariable = "CHUG_WORKER_CREDENTIAL_FILES";

/**
 * The variables a credential the plane holds as a file may be written under in
 * a job's environment: a name ending `_FILE`, and none in the prefixes chuggy,
 * its agent runtime and git read their own settings from.
 */
export const heldCredentialVariablePattern = /^[A-Z][A-Z0-9_]*_FILE$/u;
export const heldCredentialVariablePrefixesReserved = [
  "CHUG_",
  "CLAUDE_",
  "GIT_",
] as const;

/** Whether `variable` is one a held credential may be written under. */
export function isHeldCredentialVariable(variable: string): boolean {
  return (
    heldCredentialVariablePattern.test(variable) &&
    !heldCredentialVariablePrefixesReserved.some((prefix) =>
      variable.startsWith(prefix),
    )
  );
}

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

/** Where a job's container finds chuggy's runtime, mounted there read-only whatever image the job names. */
export const workerRuntimeDirectory = "/opt/chuggy";

/**
 * Where a job's or a session's container works, whatever image it names, and
 * where the repository it works on is checked out there. Each is fixed rather
 * than configured, since an image may build against the checkout and nothing
 * it reads would tell it a launcher had moved one.
 */
export const workerWorkspaceDirectory = "/workspace";
export const workerRepositoryDirectory =
  `${workerWorkspaceDirectory}/repository` as const;

/**
 * What a job's container runs in place of its image's own entrypoint: the
 * runtime's check of the image, which starts the worker once the image passes
 * it and otherwise exits with the status of the fault it found.
 */
export const workerJobCommand = [
  "/bin/sh",
  `${workerRuntimeDirectory}/check.sh`,
] as const;

/**
 * Why the image a job named cannot run it, in the order a job meets each: it
 * is pulled, its shell starts the check, the runtime's binaries load against
 * its system libraries, and git, a writable home, a writable workspace and a
 * writable temporary directory are there. The site tells the first two from
 * the pull and the start failing, and the check tells the rest by
 * `workerImageFaultStatuses`.
 */
export const workerImageFaults = [
  "ImageUnpullable",
  "ImageLacksShell",
  "ImageLibcUnsupported",
  "ImageLacksGit",
  "ImageHomeUnwritable",
  "ImageWorkspaceUnwritable",
  "ImageTmpUnwritable",
] as const;
export type WorkerImageFault = (typeof workerImageFaults)[number];

/**
 * The status the runtime's check exits with for each fault it finds itself,
 * none of them one a shell gives a script that failed, a command it could not
 * start or one a signal killed.
 */
export const workerImageFaultStatuses = {
  ImageLibcUnsupported: 81,
  ImageLacksGit: 82,
  ImageHomeUnwritable: 83,
  ImageWorkspaceUnwritable: 84,
  ImageTmpUnwritable: 85,
} as const satisfies Readonly<Partial<Record<WorkerImageFault, number>>>;
