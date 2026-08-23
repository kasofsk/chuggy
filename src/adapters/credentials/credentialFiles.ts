/**
 * The runtime source behind `RepositoryCredentialPort`: one file per
 * repository, named by the composition and read at the moment one act needs it.
 *
 * A VALUE IS NEVER HELD AND NEVER SAID. Nothing here keeps a credential in a
 * field, puts one in an argument or names one in a diagnostic — the resolutions
 * this port answers with carry a variant and no message, so a source that could
 * not be read cannot quote what it failed to read.
 *
 * A DENIAL IS THE COMPOSITION'S AND AN OUTAGE IS THE FILESYSTEM'S. A repository
 * this deployment names no file for is `Denied`, because that answer is settled
 * for as long as the process runs; a named file that cannot be opened, is
 * empty, or holds more than a credential may be is `Unavailable`, because every
 * one of those is a mount that may still arrive.
 *
 * THE READ IS BOUNDED AND IS ONE READ. A file is read once into a buffer a byte
 * wider than a credential may be, so a device standing where a secret should be
 * cannot be drawn on and a file that grew past its bound is refused rather than
 * truncated into a different credential.
 */

import { open } from "node:fs/promises";

import {
  asRepositoryCredential,
  type CredentialResolved,
  type RepositoryCredentialPort,
  type RepositoryId,
} from "../../interpreter/finalizer.ts";
import type { RepositoryCredentialFile } from "../../interpreter/finalizerSettings.ts";
import type { RuntimePrecondition } from "../../interpreter/serviceRuntime.ts";

/** Everything this source is composed with, the files being the only place a value lives. */
export interface CredentialFilesOptions {
  readonly sources: readonly RepositoryCredentialFile[];
  readonly credentialBytesMax?: number;
}

/** The bound one file is read under when a deployment names none. */
export const credentialFilesDefaults = { credentialBytesMax: 4_096 } as const;

/** Where each repository's credential stands, and how much of one file may be read. */
interface CredentialFilesState {
  readonly paths: ReadonlyMap<RepositoryId, string>;
  readonly credentialBytesMax: number;
}

/** Reads one file's whole credential, every way of failing to being an outage rather than an answer. */
async function credentialFilesRead(
  path: string,
  bytesMax: number,
): Promise<CredentialResolved> {
  const handle = await open(path, "r").catch(() => undefined);
  if (handle === undefined) return { resolved: "Unavailable" };
  try {
    const buffer = Buffer.alloc(bytesMax + 1);
    const read = await handle.read(buffer, 0, buffer.length, 0);
    if (read.bytesRead > bytesMax) return { resolved: "Unavailable" };
    const value = buffer.subarray(0, read.bytesRead).toString("utf8").trim();
    return {
      resolved: "Credential",
      credential: asRepositoryCredential(value),
    };
  } catch {
    return { resolved: "Unavailable" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Refuses at construction a mapping that would answer one repository two ways. */
function credentialFilesState(
  options: CredentialFilesOptions,
): CredentialFilesState {
  const paths = new Map<RepositoryId, string>();
  for (const source of options.sources) {
    if (paths.has(source.repository))
      throw new RangeError(
        "repository credentials: a repository names two files",
      );
    paths.set(source.repository, source.path);
  }
  return {
    paths,
    credentialBytesMax:
      options.credentialBytesMax ?? credentialFilesDefaults.credentialBytesMax,
  };
}

/** The credential source over its options, a repository it names no file for being denied. */
export function credentialFiles(
  options: CredentialFilesOptions,
): RepositoryCredentialPort {
  const own = credentialFilesState(options);
  return {
    credential: (repository): Promise<CredentialResolved> => {
      const path = own.paths.get(repository.repository);
      if (path === undefined) return Promise.resolve({ resolved: "Denied" });
      return credentialFilesRead(path, own.credentialBytesMax);
    },
  };
}

/** Requires every credential this deployment names to be readable before it is asked for one. */
export function credentialFilesPrecondition(
  options: CredentialFilesOptions,
): RuntimePrecondition {
  const own = credentialFilesState(options);
  return {
    name: "repository-credentials-available",
    check: async (signal) => {
      for (const path of own.paths.values()) {
        signal.throwIfAborted();
        const resolved = await credentialFilesRead(
          path,
          own.credentialBytesMax,
        );
        if (resolved.resolved !== "Credential") return false;
      }
      return true;
    },
  };
}
