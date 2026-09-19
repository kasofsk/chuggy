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
 */

import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { sessionStoreBatchesMax } from "../../contract/http.ts";
import type { BlobHolder } from "../../interpreter/blobStore.ts";
/**
 * The directory one session's own transcript stands in. It is keyed by the
 * session and never by the attempt that wrote it: an attempt-keyed object is
 * gone the moment its pod is reaped, which is the one thing a resumable session
 * exists to prevent.
 */
const artifactSessionDirectory = "session";

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
 * The directory holding every batch one holder wrote. A holder's kind names the
 * directory it stands in and each of its parts becomes a digest before it is
 * one, for the reason this module's header gives.
 */
export function artifactHolderRoot(
  projectDirectory: string,
  holder: BlobHolder,
): string {
  return resolve(
    projectDirectory,
    holder.kind,
    ...holder.parts.map((part) => artifactKeyOf(part)),
  );
}

/** The file one batch is stored as, refusing a number outside the bound it was given. */
export function artifactHolderFile(
  projectDirectory: string,
  holder: BlobHolder,
  batch: number,
  batchesMax: number,
): string {
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > batchesMax)
    throw new RangeError("a store batch is outside the holder's bound");
  return resolve(
    artifactHolderRoot(projectDirectory, holder),
    `${String(batch)}.jsonl`,
  );
}

/** The holder one session's stream is stored under, which is the spelling it has always had. */
export function artifactSessionHolder(
  session: string,
  stream: string,
): BlobHolder {
  return { kind: artifactSessionDirectory, parts: [session, stream] };
}

/** The directory holding every batch of one stream of one session's store. */
export function artifactSessionRoot(
  projectDirectory: string,
  session: string,
  stream: string,
): string {
  return artifactHolderRoot(
    projectDirectory,
    artifactSessionHolder(session, stream),
  );
}

/** The file one batch of one stream is stored as, refusing a number outside the store's bound. */
export function artifactSessionFile(
  projectDirectory: string,
  session: string,
  stream: string,
  batch: number,
): string {
  return artifactHolderFile(
    projectDirectory,
    artifactSessionHolder(session, stream),
    batch,
    sessionStoreBatchesMax,
  );
}
