import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type {
  BlobObject,
  BlobRead,
  BlobReadPort,
  BlobStored,
  BlobWritePort,
} from "../../interpreter/blobStore.ts";
import type {
  SessionStoreReadPort,
  SessionStoreWritePort,
} from "../../interpreter/sessionStore.ts";
import {
  artifactHolderFile,
  artifactHolderRoot,
  artifactProjectDirectory,
  artifactSessionHolder,
} from "./artifactKey.ts";
import { sessionStoreBatchesMax } from "../../contract/http.ts";

export interface ArtifactStoreOptions {
  readonly root: string;
  readonly writeBytesMax?: number;
  readonly unavailableRetrySecs?: number;
  readonly storedFileMode?: number;
  readonly batchesMax?: number;
}

export const artifactStoreDefaults = {
  writeBytesMax: 4_194_304,
  unavailableRetrySecs: 30,
  storedFileMode: 0o440,
} as const;

export type ArtifactStore = BlobWritePort & BlobReadPort;

interface StoreState {
  readonly root: string;
  readonly writeBytesMax: number;
  readonly unavailableRetrySecs: number;
  readonly storedFileMode: number;
  readonly batchesMax: number;
}

function missing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function hasLinkedDirectory(
  root: string,
  directory: string,
): Promise<boolean> {
  const remainder = relative(resolve(root), resolve(directory));
  if (
    remainder === "" ||
    remainder.startsWith(`..${sep}`) ||
    remainder === ".."
  )
    return remainder !== "";
  let current = resolve(root);
  for (const component of remainder.split(sep)) {
    current = resolve(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) return true;
    } catch (error: unknown) {
      if (missing(error)) return false;
      throw error;
    }
  }
  return false;
}

async function bytesAt(file: string): Promise<Uint8Array | undefined> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    return await handle.readFile();
  } catch (error: unknown) {
    if (missing(error)) return undefined;
    throw error;
  } finally {
    await handle?.close();
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

async function storeBlob(
  state: StoreState,
  input: BlobObject & { readonly content: Uint8Array },
): Promise<BlobStored> {
  if (input.content.byteLength > state.writeBytesMax)
    return { stored: "Refused", reason: "QuotaExceeded" };
  const project = artifactProjectDirectory(
    state.root,
    input.partition.tenant,
    input.partition.project,
  );
  const stream = artifactHolderRoot(project, input.holder);
  const file = artifactHolderFile(
    project,
    input.holder,
    input.batch,
    state.batchesMax,
  );
  const pending = `${stream}.upload-pending/${randomUUID()}`;
  const unavailable = {
    stored: "Unavailable",
    retryAfterSeconds: state.unavailableRetrySecs,
  } as const;
  try {
    if (await hasLinkedDirectory(state.root, stream)) return unavailable;
    const existing = await bytesAt(file);
    if (existing !== undefined)
      return sameBytes(existing, input.content)
        ? { stored: "Stored" }
        : { stored: "Conflict" };
    await mkdir(dirname(file), { recursive: true });
    await mkdir(dirname(pending), { recursive: true });
    if (await hasLinkedDirectory(state.root, stream)) return unavailable;
    await writeFile(pending, input.content, {
      mode: state.storedFileMode,
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    });
    await chmod(pending, state.storedFileMode);
    try {
      await link(pending, file);
      return { stored: "Stored" };
    } catch (error: unknown) {
      const landed = await bytesAt(file);
      if (landed === undefined) throw error;
      return sameBytes(landed, input.content)
        ? { stored: "Stored" }
        : { stored: "Conflict" };
    }
  } catch {
    return unavailable;
  } finally {
    await rm(pending, { force: true }).catch(() => undefined);
  }
}

async function readBlob(
  state: StoreState,
  object: BlobObject,
): Promise<BlobRead> {
  const project = artifactProjectDirectory(
    state.root,
    object.partition.tenant,
    object.partition.project,
  );
  const stream = artifactHolderRoot(project, object.holder);
  const file = artifactHolderFile(
    project,
    object.holder,
    object.batch,
    state.batchesMax,
  );
  try {
    if (await hasLinkedDirectory(state.root, stream))
      return { read: "NotFound" };
    const metadata = await lstat(file);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      (metadata.mode & 0o222) !== 0
    )
      return { read: "Corrupt" };
    const content = await bytesAt(file);
    if (content === undefined) return { read: "NotFound" };
    try {
      return {
        read: "Content",
        content: new TextDecoder("utf-8", { fatal: true }).decode(content),
      };
    } catch {
      return { read: "Corrupt" };
    }
  } catch (error: unknown) {
    return missing(error)
      ? { read: "NotFound" }
      : { read: "Unavailable", retryAfterSeconds: state.unavailableRetrySecs };
  }
}

export function artifactStore(options: ArtifactStoreOptions): ArtifactStore {
  const state: StoreState = {
    root: options.root,
    writeBytesMax: options.writeBytesMax ?? artifactStoreDefaults.writeBytesMax,
    unavailableRetrySecs:
      options.unavailableRetrySecs ??
      artifactStoreDefaults.unavailableRetrySecs,
    storedFileMode:
      options.storedFileMode ?? artifactStoreDefaults.storedFileMode,
    batchesMax: options.batchesMax ?? sessionStoreBatchesMax,
  };
  for (const [name, value] of [
    ["writeBytesMax", state.writeBytesMax],
    ["unavailableRetrySecs", state.unavailableRetrySecs],
  ] as const)
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError(
        `artifact store: ${name} must be a positive safe integer`,
      );
  if ((state.storedFileMode & 0o222) !== 0)
    throw new RangeError(
      "artifact store: a stored object may not be written after it is stored",
    );
  return {
    storeBlob: (input) => storeBlob(state, input),
    readBlob: (object) => readBlob(state, object),
  };
}

/**
 * The session's own spelling of this store, which is the one every session call
 * site already holds. The paths are the holder's, so what was stored before
 * this port existed is still where it was.
 */
export function sessionArtifactStore(
  store: ArtifactStore,
): SessionStoreWritePort & SessionStoreReadPort {
  return {
    storeBatch: ({ partition, session, stream, batch, content }) =>
      store.storeBlob({
        partition,
        holder: artifactSessionHolder(session, stream),
        batch,
        content,
      }),
    readBatch: ({ partition, session, stream, batch }) =>
      store.readBlob({
        partition,
        holder: artifactSessionHolder(session, stream),
        batch,
      }),
  };
}
