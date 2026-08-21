/**
 * Where one artifact's bytes live under the store's root, and the containment
 * check that says a resolved path is still inside the project it was written
 * under.
 *
 * AN OPAQUE IDENTITY IS NOT SAFE IN A PATH. A tenant, a project, an execution
 * and an attempt are opaque text this tree never interprets, so each becomes a
 * digest before it is a directory — the same device `../git/gitScratch.ts` uses
 * for a repository identity, and for the same reason: a separator, a dot
 * segment or a name longer than a filesystem component would otherwise pick the
 * directory.
 *
 * A DECLARED PATH IS KEPT AS ITSELF, because it is what the worker stored the
 * object under and a rewritten one would name a key nobody wrote.
 * `../../interpreter/resultManifest.ts` has already refused every shape that
 * could climb out of the tree, and the resolution below is what proves the
 * refusal held rather than assuming it.
 */

import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";

import {
  artifactPathRejection,
  type ArtifactPath,
} from "../../interpreter/resultManifest.ts";

/** The directory one attempt's own immutable outputs stand in. */
const artifactAttemptDirectory = "attempt";

/** The directory a project's own finalization evidence stands in. */
const artifactOwnedDirectory = "artifact";

/** The digest an opaque identity is given before it becomes a directory. */
export function artifactKeyOf(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** The directory one project's artifacts live under, which every other key is resolved inside. */
export function artifactProjectDirectory(
  root: string,
  tenant: string,
  project: string,
): string {
  return resolve(root, artifactKeyOf(tenant), artifactKeyOf(project));
}

/**
 * The file one project-owned artifact is stored as. Its identity is opaque, so
 * it is a digest here like every other identity.
 */
export function artifactOwnedFile(
  projectDirectory: string,
  artifact: string,
): string {
  return resolve(
    projectDirectory,
    artifactOwnedDirectory,
    artifactKeyOf(artifact),
  );
}

/** Whether one resolved path is still inside the project directory it was resolved from. */
export function artifactWithinProject(
  projectDirectory: string,
  file: string,
): boolean {
  return file.startsWith(`${projectDirectory}${sep}`);
}

/**
 * The file one declared artifact of one attempt is stored as, or nothing where
 * the declared path is not one this store will resolve.
 */
export function artifactAttemptFile(
  projectDirectory: string,
  execution: string,
  attempt: string,
  path: ArtifactPath,
): string | undefined {
  if (artifactPathRejection(path) !== undefined) return undefined;
  const file = resolve(
    projectDirectory,
    artifactAttemptDirectory,
    artifactKeyOf(execution),
    artifactKeyOf(attempt),
    path,
  );
  return artifactWithinProject(projectDirectory, file) ? file : undefined;
}
