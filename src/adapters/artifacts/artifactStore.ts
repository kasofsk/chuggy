/**
 * Project-owned immutable artifact storage on a filesystem: what confirms a
 * sealed manifest, what hands a preparation the bytes it commits, and where a
 * finalization's own evidence is written.
 *
 * IT IS A FILESYSTEM AND NOT A CLOUD. The root is a composition-root option, as
 * a bare repository path is for the git adapter, so every behaviour this store
 * claims is exercised by a suite with no network and no service — and a
 * deployment that wants object storage answers the same three ports rather than
 * changing anything above them.
 *
 * IMMUTABILITY IS A MODE AND NOT A PROMISE. An object is stored read-only and a
 * stored object that is writable by anybody is reported `Mutable` rather than
 * confirmed, because an artifact that can still change is one no digest speaks
 * for. Writes land on a temporary name in the same directory and are renamed
 * into place, so a reader never sees a half-written object.
 *
 * A LINK IS NOT A STORED OBJECT. Metadata is read without following one and
 * bytes are opened refusing one, so a link planted where an object should be is
 * `NotDurable` rather than the mode, the size and the content of whatever it
 * points at.
 *
 * NEITHER IS A LINK ANYWHERE ABOVE IT. Refusing the last component says nothing
 * about the ones that led there, so the directory an object stands in is
 * resolved through every link on the way and required to be really inside the
 * project: a declared `a/b.txt` whose `a` is a link out of the tree is
 * `ForeignProject`, and the same resolution stands between a project-owned
 * write and the directory it lands in. That is what makes this store's
 * containment about the file that is there rather than about the name that
 * leads to it, for every component and not only the last.
 *
 * ARTIFACTS STAY OPAQUE. `verifyManifest` answers metadata alone — present,
 * that size, that digest, immutable, inside this project — and never reads an
 * artifact's meaning. `readHandoff` is the one call that yields bytes, and it
 * yields them only where they hash to the digest the caller pinned, which is
 * what makes unverified content unrepresentable rather than merely discouraged.
 *
 * AN OUTAGE IS NOT EVIDENCE ABOUT AN ARTIFACT. A path that is not there is a
 * missing artifact; anything else the filesystem refuses is `Unavailable` with
 * a retry interval, so an unreadable disk cannot fabricate a failed task or a
 * failed finalization.
 *
 * NOTHING HERE REACHES ANOTHER ADAPTER. It holds no database handle and calls
 * no git verb; the coordination between what a row says and what a candidate
 * needs belongs to the pass above both, which is where it is.
 */

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  link,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import {
  candidateBytesMax,
  candidateFilesMax,
  type CandidateFile,
} from "../../interpreter/finalizer.ts";
import type {
  HandoffContentPort,
  HandoffRead,
  HandoffRequest,
  ProjectArtifactPort,
  ProjectArtifactWrite,
  ProjectArtifactWritten,
} from "../../interpreter/finalizerPreparation.ts";
import {
  outputPreviewBytesMax,
  type OutputContentPort,
  type OutputContentRead,
} from "../../interpreter/operationsView.ts";
import {
  asArtifactDigest,
  asArtifactPath,
  type ArtifactFailure,
  type ArtifactRole,
  type ArtifactRow,
  type ArtifactSite,
  type ArtifactVerificationPort,
  type ArtifactsVerified,
  type ResultManifest,
} from "../../interpreter/resultManifest.ts";
import type {
  WorkerArtifactStored,
  WorkerArtifactUploadPort,
} from "../../interpreter/workerPlane.ts";
import {
  artifactAttemptFile,
  artifactOwnedFile,
  artifactProjectDirectory,
  artifactWithinProject,
} from "./artifactKey.ts";

/** Everything the store is composed with, each value an operational choice. */
export interface ArtifactStoreOptions {
  readonly root: string;
  readonly readArtifactsMax?: number;
  readonly readBytesMax?: number;
  readonly writeBytesMax?: number;
  readonly unavailableRetrySecs?: number;
  readonly storedFileMode?: number;
}

/** The bounds and the mode a deployment gets when it names none. */
export const artifactStoreDefaults = {
  readArtifactsMax: candidateFilesMax,
  readBytesMax: candidateBytesMax,
  writeBytesMax: 4_194_304,
  unavailableRetrySecs: 30,
  storedFileMode: 0o440,
} as const;

/** The three ports one store answers, which is one boundary and not three deployments. */
export type ArtifactStore = ArtifactVerificationPort &
  HandoffContentPort &
  ProjectArtifactPort &
  OutputContentPort &
  WorkerArtifactUploadPort;

/** The most bytes one read of a stored object draws at a time. */
const artifactStoreChunkBytes = 65_536;

/** The permission bits whose absence is what this store means by immutable. */
const artifactStoreWritableBits = 0o222;

/** How a stored object is opened: to be read, and never through a link standing where it should be. */
const artifactStoreReadFlags = constants.O_RDONLY | constants.O_NOFOLLOW;

/** What the store holds across calls, resolved once so no call re-reads its own options. */
interface ArtifactStoreState {
  readonly root: string;
  readonly readArtifactsMax: number;
  readonly readBytesMax: number;
  readonly writeBytesMax: number;
  readonly unavailableRetrySecs: number;
  readonly storedFileMode: number;
}

/** What one stored object is, an absent one kept apart from a filesystem that would not answer. */
type ArtifactStoreEntry =
  | { readonly entry: "Object"; readonly bytes: number; readonly mode: number }
  | { readonly entry: "Rejected"; readonly failure: ArtifactFailure }
  | { readonly entry: "Unavailable" };

/** What confirming one stored object found, its bytes carried where the caller asked for them. */
type ArtifactStoreConfirmed =
  | { readonly confirmed: "Object"; readonly content?: Uint8Array }
  | { readonly confirmed: "Rejected"; readonly failure: ArtifactFailure }
  | { readonly confirmed: "Unavailable" };

/**
 * Whether a caught filesystem error is an absent object or a storage the caller
 * must retry. A path leading through something that is not a directory names no
 * object either, and neither does one whose links lead in a circle — both are
 * structures a worker leaves behind rather than disk faults that pass.
 */
function artifactStoreMissing(refused: unknown): boolean {
  if (typeof refused !== "object" || refused === null) return false;
  const code = (refused as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

/**
 * Why the directory one object stands in is not one this store reads or writes,
 * or nothing when it is. Both sides are resolved through their links, so a
 * project reached by a link is still its own directory and a component of a
 * declared path that leads out of the tree is refused as what it is.
 */
async function artifactStoreDirectoryRejection(
  projectDirectory: string,
  file: string,
): Promise<ArtifactStoreEntry | undefined> {
  try {
    const project = await realpath(projectDirectory);
    const directory = await realpath(dirname(file));
    return artifactWithinProject(project, directory)
      ? undefined
      : { entry: "Rejected", failure: "ForeignProject" };
  } catch (refused: unknown) {
    return artifactStoreMissing(refused)
      ? { entry: "Rejected", failure: "Missing" }
      : { entry: "Unavailable" };
  }
}

/** What stands at one path, or the reason nothing about the object can be said. */
async function artifactStoreEntryOf(
  projectDirectory: string,
  file: string,
): Promise<ArtifactStoreEntry> {
  const outside = await artifactStoreDirectoryRejection(projectDirectory, file);
  if (outside !== undefined) return outside;
  try {
    const found = await lstat(file);
    if (!found.isFile()) {
      return { entry: "Rejected", failure: "NotDurable" };
    }
    return { entry: "Object", bytes: found.size, mode: found.mode };
  } catch (refused: unknown) {
    return artifactStoreMissing(refused)
      ? { entry: "Rejected", failure: "Missing" }
      : { entry: "Unavailable" };
  }
}

/** The digest of one stored object, read in bounded chunks so a large one is never held whole. */
async function artifactStoreDigestOf(
  file: string,
  bytes: number,
): Promise<string | undefined> {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(artifactStoreChunkBytes);
  let handle;
  try {
    handle = await open(file, artifactStoreReadFlags);
    for (let read = 0; read < bytes;) {
      const drawn = await handle.read(chunk, 0, chunk.byteLength, read);
      if (drawn.bytesRead === 0) return undefined;
      hash.update(chunk.subarray(0, drawn.bytesRead));
      read += drawn.bytesRead;
    }
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
  return hash.digest("hex");
}

/** The whole of one stored object, or nothing where it could not be opened as the object it is. */
async function artifactStoreBytesOf(file: string): Promise<Buffer | undefined> {
  let handle;
  try {
    handle = await open(file, artifactStoreReadFlags);
    return await handle.readFile();
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

/** Confirms one declared artifact against what is stored, and yields its bytes only once it has. */
async function artifactStoreConfirm(
  projectDirectory: string,
  file: string | undefined,
  row: ArtifactRow,
  wanted: boolean,
): Promise<ArtifactStoreConfirmed> {
  if (file === undefined) {
    return { confirmed: "Rejected", failure: "ForeignProject" };
  }
  const entry = await artifactStoreEntryOf(projectDirectory, file);
  if (entry.entry === "Unavailable") return { confirmed: "Unavailable" };
  if (entry.entry === "Rejected") {
    return { confirmed: "Rejected", failure: entry.failure };
  }
  if (entry.bytes !== row.bytes) {
    return { confirmed: "Rejected", failure: "ByteCountMismatch" };
  }
  if ((entry.mode & artifactStoreWritableBits) !== 0) {
    return { confirmed: "Rejected", failure: "Mutable" };
  }
  if (!wanted) {
    const digest = await artifactStoreDigestOf(file, entry.bytes);
    if (digest === undefined) return { confirmed: "Unavailable" };
    return digest === row.digest
      ? { confirmed: "Object" }
      : { confirmed: "Rejected", failure: "DigestMismatch" };
  }
  const content = await artifactStoreBytesOf(file);
  if (content === undefined) return { confirmed: "Unavailable" };
  const digest = createHash("sha256").update(content).digest("hex");
  return digest === row.digest
    ? { confirmed: "Object", content }
    : { confirmed: "Rejected", failure: "DigestMismatch" };
}

/** Confirms every artifact one sealed manifest declares, stopping at the first that fails. */
async function artifactStoreVerify(
  own: ArtifactStoreState,
  manifest: ResultManifest,
): Promise<ArtifactsVerified> {
  const directory = artifactProjectDirectory(
    own.root,
    manifest.binding.partition.tenant,
    manifest.binding.partition.project,
  );
  const roles: readonly (readonly [ArtifactRole, readonly ArtifactRow[]])[] = [
    ["Handoff", manifest.handoffs],
    ["Diagnostic", manifest.diagnostics],
  ];
  for (const [role, rows] of roles) {
    for (const [index, row] of rows.entries()) {
      const at: ArtifactSite = { role, index };
      const confirmed = await artifactStoreConfirm(
        directory,
        artifactAttemptFile(
          directory,
          manifest.binding.execution,
          manifest.binding.attempt,
          row.path,
        ),
        row,
        false,
      );
      if (confirmed.confirmed === "Unavailable") {
        return {
          verified: "Unavailable",
          retryAfterSeconds: own.unavailableRetrySecs,
        };
      }
      if (confirmed.confirmed === "Rejected") {
        return { verified: "Rejected", failure: confirmed.failure, at };
      }
    }
  }
  return { verified: "Verified" };
}

/** Refuses a request past the ceilings this store answers within, before any object is opened. */
function artifactStoreAssertRead(
  own: ArtifactStoreState,
  request: HandoffRequest,
): void {
  const artifacts = request.artifacts;
  if (artifacts.length > own.readArtifactsMax) {
    throw new RangeError(
      `artifact store: ${String(artifacts.length)} artifacts is past the most one read returns`,
    );
  }
  const bytes = artifacts.reduce((total, each) => total + each.bytes, 0);
  if (bytes > own.readBytesMax) {
    throw new RangeError(
      `artifact store: ${String(bytes)} bytes is past the most one read returns`,
    );
  }
}

/** Hands back the bytes of every named handoff, and nothing at all where one of them fails. */
async function artifactStoreRead(
  own: ArtifactStoreState,
  request: HandoffRequest,
): Promise<HandoffRead> {
  artifactStoreAssertRead(own, request);
  const directory = artifactProjectDirectory(
    own.root,
    request.partition.tenant,
    request.partition.project,
  );
  const files: CandidateFile[] = [];
  for (const [index, artifact] of request.artifacts.entries()) {
    const confirmed = await artifactStoreConfirm(
      directory,
      artifactAttemptFile(
        directory,
        artifact.execution,
        artifact.attempt,
        artifact.path,
      ),
      artifact,
      true,
    );
    if (confirmed.confirmed === "Unavailable") {
      return {
        read: "Unavailable",
        retryAfterSeconds: own.unavailableRetrySecs,
      };
    }
    if (confirmed.confirmed === "Rejected") {
      return {
        read: "Rejected",
        failure: confirmed.failure,
        at: { role: "Handoff", index },
      };
    }
    if (confirmed.content === undefined) {
      throw new Error("artifact store: a confirmed read carried no bytes");
    }
    files.push({ path: artifact.path, content: confirmed.content });
  }
  return { read: "Files", files };
}

/** Drops a half-written object, which cannot itself become the reason a write failed. */
async function artifactStoreDiscard(pending: string): Promise<void> {
  try {
    await rm(pending, { force: true });
  } catch {
    return;
  }
}

/** Writes one project-owned artifact read-only under a temporary name, then renames it into place. */
async function artifactStoreWrite(
  own: ArtifactStoreState,
  write: ProjectArtifactWrite,
): Promise<ProjectArtifactWritten> {
  if (write.content.byteLength > own.writeBytesMax) {
    throw new RangeError(
      `artifact store: ${String(write.content.byteLength)} bytes is past the most one artifact is`,
    );
  }
  const directory = artifactProjectDirectory(
    own.root,
    write.partition.tenant,
    write.partition.project,
  );
  const file = artifactOwnedFile(directory, write.artifact);
  const pending = `${file}.${randomUUID()}`;
  const unavailable = {
    written: "Unavailable",
    retryAfterSeconds: own.unavailableRetrySecs,
  } as const;
  try {
    await mkdir(dirname(file), { recursive: true });
    if (
      (await artifactStoreDirectoryRejection(directory, file)) !== undefined
    ) {
      return unavailable;
    }
    await writeFile(pending, write.content, {
      mode: own.storedFileMode,
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    });
    await chmod(pending, own.storedFileMode);
    await rename(pending, file);
  } catch {
    await artifactStoreDiscard(pending);
    return unavailable;
  }
  return {
    written: "Artifact",
    digest: asArtifactDigest(
      createHash("sha256").update(write.content).digest("hex"),
    ),
  };
}

async function artifactStoreAttemptWrite(
  own: ArtifactStoreState,
  input: Parameters<WorkerArtifactUploadPort["store"]>[0],
): Promise<WorkerArtifactStored> {
  if (input.content.byteLength > own.writeBytesMax)
    throw new RangeError("artifact store: worker upload is past the byte bound");
  const directory = artifactProjectDirectory(
    own.root,
    input.authority.partition.tenant,
    input.authority.partition.project,
  );
  const path = asArtifactPath(input.path);
  const file = artifactAttemptFile(
    directory,
    input.authority.execution,
    input.authority.attempt,
    path,
  );
  if (file === undefined) return { stored: "Conflict" };
  const pending = `${file}.${randomUUID()}`;
  try {
    await mkdir(dirname(file), { recursive: true });
    if ((await artifactStoreDirectoryRejection(directory, file)) !== undefined)
      return { stored: "Unavailable", retryAfterSeconds: own.unavailableRetrySecs };
    await writeFile(pending, input.content, {
      mode: own.storedFileMode,
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    });
    await chmod(pending, own.storedFileMode);
    await link(pending, file);
    await artifactStoreDiscard(pending);
    return { stored: "Stored" };
  } catch (refused: unknown) {
    await artifactStoreDiscard(pending);
    if (
      typeof refused === "object" &&
      refused !== null &&
      (refused as { code?: unknown }).code === "EEXIST"
    ) {
      const expected = createHash("sha256").update(input.content).digest("hex");
      const found = await artifactStoreEntryOf(directory, file);
      if (found.entry !== "Object" || found.bytes !== input.content.byteLength)
        return { stored: "Conflict" };
      const digest = await artifactStoreDigestOf(file, found.bytes);
      return digest === expected ? { stored: "Stored" } : { stored: "Conflict" };
    }
    return { stored: "Unavailable", retryAfterSeconds: own.unavailableRetrySecs };
  }
}

async function artifactStoreOutput(
  own: ArtifactStoreState,
  input: Parameters<OutputContentPort["read"]>[0],
): Promise<OutputContentRead> {
  const output = input.artifact.output;
  if (output === undefined) return { read: "NotFound" };
  if (input.artifact.bytes > outputPreviewBytesMax)
    return { read: "TooLarge", bytes: input.artifact.bytes };
  const directory = artifactProjectDirectory(
    own.root,
    input.partition.tenant,
    input.partition.project,
  );
  const confirmed = await artifactStoreConfirm(
    directory,
    artifactAttemptFile(
      directory,
      input.execution,
      input.attempt,
      input.artifact.path,
    ),
    input.artifact,
    true,
  );
  if (confirmed.confirmed === "Unavailable")
    return {
      read: "Unavailable",
      retryAfterSeconds: own.unavailableRetrySecs,
    };
  if (confirmed.confirmed === "Rejected")
    return confirmed.failure === "Missing" ||
      confirmed.failure === "ForeignProject"
      ? { read: "NotFound" }
      : { read: "Corrupt" };
  if (confirmed.content === undefined) return { read: "Corrupt" };
  try {
    return {
      read: "Content",
      mediaType: output.mediaType,
      renderer: output.renderer,
      content: new TextDecoder("utf-8", { fatal: true }).decode(
        confirmed.content,
      ),
      ...(output.schema === undefined ? {} : { schema: output.schema }),
    };
  } catch {
    return { read: "Corrupt" };
  }
}

/** The store over its options, refusing at construction what no later call could work around. */
export function artifactStore(options: ArtifactStoreOptions): ArtifactStore {
  const own: ArtifactStoreState = {
    root: options.root,
    readArtifactsMax:
      options.readArtifactsMax ?? artifactStoreDefaults.readArtifactsMax,
    readBytesMax: options.readBytesMax ?? artifactStoreDefaults.readBytesMax,
    writeBytesMax: options.writeBytesMax ?? artifactStoreDefaults.writeBytesMax,
    unavailableRetrySecs:
      options.unavailableRetrySecs ??
      artifactStoreDefaults.unavailableRetrySecs,
    storedFileMode:
      options.storedFileMode ?? artifactStoreDefaults.storedFileMode,
  };
  for (const [name, bound] of [
    ["readArtifactsMax", own.readArtifactsMax],
    ["readBytesMax", own.readBytesMax],
    ["writeBytesMax", own.writeBytesMax],
    ["unavailableRetrySecs", own.unavailableRetrySecs],
  ] as const) {
    if (!Number.isSafeInteger(bound) || bound <= 0) {
      throw new RangeError(
        `artifact store: ${name} must be a positive safe integer`,
      );
    }
  }
  if ((own.storedFileMode & artifactStoreWritableBits) !== 0) {
    throw new RangeError(
      "artifact store: a stored object may not be written after it is stored",
    );
  }
  return {
    verifyManifest: (manifest) => artifactStoreVerify(own, manifest),
    readHandoff: (request) => artifactStoreRead(own, request),
    writeArtifact: (write) => artifactStoreWrite(own, write),
    store: (input) => artifactStoreAttemptWrite(own, input),
    read: (input) => artifactStoreOutput(own, input),
  };
}
