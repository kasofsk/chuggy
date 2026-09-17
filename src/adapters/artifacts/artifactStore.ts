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
  SessionStoreObject,
  SessionStoreRead,
  SessionStoreReadPort,
  SessionStoreStored,
  SessionStoreWritePort,
} from "../../interpreter/sessionStore.ts";
import {
  artifactProjectDirectory,
  artifactSessionFile,
  artifactSessionRoot,
} from "./artifactKey.ts";

export interface ArtifactStoreOptions {
  readonly root: string;
  readonly writeBytesMax?: number;
  readonly unavailableRetrySecs?: number;
  readonly storedFileMode?: number;
}

export const artifactStoreDefaults = {
  writeBytesMax: 4_194_304,
  unavailableRetrySecs: 30,
  storedFileMode: 0o440,
} as const;

export type ArtifactStore = SessionStoreWritePort & SessionStoreReadPort;

interface StoreState {
  readonly root: string;
  readonly writeBytesMax: number;
  readonly unavailableRetrySecs: number;
  readonly storedFileMode: number;
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

async function storeBatch(
  state: StoreState,
  input: SessionStoreObject & { readonly content: Uint8Array },
): Promise<SessionStoreStored> {
  if (input.content.byteLength > state.writeBytesMax)
    return { stored: "Refused", reason: "QuotaExceeded" };
  const project = artifactProjectDirectory(
    state.root,
    input.partition.tenant,
    input.partition.project,
  );
  const stream = artifactSessionRoot(project, input.session, input.stream);
  const file = artifactSessionFile(
    project,
    input.session,
    input.stream,
    input.batch,
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

async function readBatch(
  state: StoreState,
  object: SessionStoreObject,
): Promise<SessionStoreRead> {
  const project = artifactProjectDirectory(
    state.root,
    object.partition.tenant,
    object.partition.project,
  );
  const stream = artifactSessionRoot(project, object.session, object.stream);
  const file = artifactSessionFile(
    project,
    object.session,
    object.stream,
    object.batch,
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
    storeBatch: (input) => storeBatch(state, input),
    readBatch: (object) => readBatch(state, object),
  };
}
