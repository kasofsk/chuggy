/**
 * The runtime source behind `RepositoryCredentialPort` and `ForgeCredentialPort`:
 * one file per credential, named by the composition and read at the moment one
 * act needs it.
 *
 * A REMOTE'S AUTHORITY AND A FORGE'S ARE DIFFERENT SECRETS AND ONE SOURCE. What
 * pushes a branch and what opens a proposal about it are separate credentials
 * with separate scopes, so they are separate files and separate ports — but the
 * reading is the same bounded read either way, and a second copy of it would be
 * a second place for a byte bound to be got wrong.
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
  asForgeCredential,
  type ForgeCredential,
  type ForgeCredentialPort,
} from "../../interpreter/changeProposal.ts";
import {
  asRepositoryCredential,
  type CredentialResolved,
  type RepositoryCredential,
  type RepositoryCredentialPort,
} from "../../interpreter/finalizer.ts";
import type {
  ForgeBindingFile,
  RepositoryCredentialFile,
} from "../../interpreter/finalizerSettings.ts";
import type { RuntimePrecondition } from "../../interpreter/serviceRuntime.ts";

/** Everything this source is composed with, the files being the only place a value lives. */
export interface CredentialFilesOptions {
  readonly sources: readonly RepositoryCredentialFile[];
  readonly credentialBytesMax?: number;
}

/** The same, over the forges a deployment opens change proposals on. */
export interface ForgeCredentialFilesOptions {
  readonly bindings: readonly ForgeBindingFile[];
  readonly credentialBytesMax?: number;
}

/** What resolving one file found, in the shape every credential port answers with. */
type CredentialFileResolved<Credential> =
  | { readonly resolved: "Credential"; readonly credential: Credential }
  | { readonly resolved: "Denied" }
  | { readonly resolved: "Unavailable" };

/** The bound one file is read under when a deployment names none. */
export const credentialFilesDefaults = { credentialBytesMax: 4_096 } as const;

/**
 * Where each credential stands, how much of one file may be read, and the brand
 * it is read as — so a precondition holds a file to the bound the port will,
 * rather than to a wider one that would pass a file the port then refuses.
 */
interface CredentialFilesState<Credential> {
  readonly paths: ReadonlyMap<string, string>;
  readonly credentialBytesMax: number;
  readonly brand: (value: string) => Credential;
}

function credentialFilesIdentity(
  repository: string,
  credentialReference: string | undefined,
): string {
  return JSON.stringify([repository, credentialReference ?? repository]);
}

/** Reads one file's whole credential, every way of failing being an outage rather than an answer. */
async function credentialFilesRead<Credential>(
  path: string,
  bytesMax: number,
  brand: (value: string) => Credential,
): Promise<CredentialFileResolved<Credential>> {
  const handle = await open(path, "r").catch(() => undefined);
  if (handle === undefined) return { resolved: "Unavailable" };
  try {
    const buffer = Buffer.alloc(bytesMax + 1);
    const read = await handle.read(buffer, 0, buffer.length, 0);
    if (read.bytesRead > bytesMax) return { resolved: "Unavailable" };
    const value = buffer.subarray(0, read.bytesRead).toString("utf8").trim();
    return { resolved: "Credential", credential: brand(value) };
  } catch {
    return { resolved: "Unavailable" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Refuses at construction a mapping that would answer one repository two ways. */
function credentialFilesState(
  options: CredentialFilesOptions,
): CredentialFilesState<RepositoryCredential> {
  const paths = new Map<string, string>();
  for (const source of options.sources) {
    const identity = credentialFilesIdentity(
      source.repository,
      source.credentialReference,
    );
    if (paths.has(identity))
      throw new RangeError(
        source.credentialReference === undefined
          ? "repository credentials: a repository names two files"
          : "repository credentials: a credential names two files",
      );
    paths.set(identity, source.path);
  }
  return {
    paths,
    credentialBytesMax:
      options.credentialBytesMax ?? credentialFilesDefaults.credentialBytesMax,
    brand: asRepositoryCredential,
  };
}

/** The credential source over its options, a repository it names no file for being denied. */
export function credentialFiles(
  options: CredentialFilesOptions,
): RepositoryCredentialPort {
  const own = credentialFilesState(options);
  return {
    credential: (repository): Promise<CredentialResolved> => {
      const path = own.paths.get(
        credentialFilesIdentity(
          repository.repository,
          repository.credentialReference,
        ),
      );
      if (path === undefined) return Promise.resolve({ resolved: "Denied" });
      return credentialFilesRead(path, own.credentialBytesMax, own.brand);
    },
  };
}

/** Where each forge's own credential stands, keyed by the reference a binding names it under. */
function forgeCredentialFilesState(
  options: ForgeCredentialFilesOptions,
): CredentialFilesState<ForgeCredential> {
  const paths = new Map<string, string>();
  for (const binding of options.bindings) {
    if (paths.has(binding.credentialReference))
      throw new RangeError("forge credentials: a credential names two files");
    paths.set(binding.credentialReference, binding.path);
  }
  return {
    paths,
    credentialBytesMax:
      options.credentialBytesMax ?? credentialFilesDefaults.credentialBytesMax,
    brand: asForgeCredential,
  };
}

/** The forge credential source, a binding this deployment names no file for being denied. */
export function forgeCredentialFiles(
  options: ForgeCredentialFilesOptions,
): ForgeCredentialPort {
  const own = forgeCredentialFilesState(options);
  return {
    credential: (binding) => {
      const path = own.paths.get(binding.credential);
      if (path === undefined) return Promise.resolve({ resolved: "Denied" });
      return credentialFilesRead(path, own.credentialBytesMax, own.brand);
    },
  };
}

/** Whether every file the named state holds is readable as the credential it is for. */
async function credentialFilesReadable<Credential>(
  own: CredentialFilesState<Credential>,
  signal: AbortSignal,
): Promise<boolean> {
  for (const path of own.paths.values()) {
    signal.throwIfAborted();
    const resolved = await credentialFilesRead(
      path,
      own.credentialBytesMax,
      own.brand,
    );
    if (resolved.resolved !== "Credential") return false;
  }
  return true;
}

/** Requires every credential this deployment names to be readable before it is asked for one. */
export function credentialFilesPrecondition(
  options: CredentialFilesOptions,
): RuntimePrecondition {
  const own = credentialFilesState(options);
  return {
    name: "repository-credentials-available",
    check: (signal) => credentialFilesReadable(own, signal),
  };
}

/** The same of every forge credential, so a deployment missing one says so before it runs. */
export function forgeCredentialFilesPrecondition(
  options: ForgeCredentialFilesOptions,
): RuntimePrecondition {
  const own = forgeCredentialFilesState(options);
  return {
    name: "forge-credentials-available",
    check: (signal) => credentialFilesReadable(own, signal),
  };
}
