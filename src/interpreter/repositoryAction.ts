/**
 * Repository-declared actions, read from one exact commit before any of them is
 * stored.
 *
 * AN ACTION EXISTS BEFORE ANYTHING REPORTS IT, so a reader can see the one that
 * has not happened yet. The set is declared under `.chug/actions/` and imported
 * the way configurations are: one snapshot, refused whole or taken whole.
 *
 * THE REPOSITORY A DOCUMENT NAMES IS HELD TO THE PROJECT'S LIVE BINDINGS HERE,
 * where the refusal can name the document, rather than stored and refused by
 * whatever reads it later.
 *
 * TWO IMPORTS OF ONE COMMIT AGREE. A declaration carries its canonical bytes
 * and the digest of them, and both are functions of the document alone.
 */

import { createHash } from "node:crypto";

import { textCodePointsCount } from "../contract/http.ts";
import {
  repositoryActionDocumentSchema,
  type RepositoryActionDocument,
} from "../contract/repositoryAction.ts";
import { assertNever } from "../domain/assertNever.ts";
import {
  asRepositoryId,
  type GitObjectId,
  type RepositoryBinding,
  type RepositoryId,
} from "./finalizer.ts";
import type { Authority } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import type { ProjectRepositoryBindings } from "./repositoryBinding.ts";
import type {
  ProjectRepositoryBindingRead,
  RepositoryConfigurationFile,
  RepositoryConfigurationSnapshotRequest,
} from "./repositoryConfiguration.ts";

declare const repositoryActionIdBrand: unique symbol;
declare const canonicalRepositoryActionBrand: unique symbol;

/** The identity every report names an action by. */
export type RepositoryActionId = string & {
  readonly [repositoryActionIdBrand]: true;
};

/** One action document's canonical bytes, which its digest is taken over. */
export type CanonicalRepositoryAction = string & {
  readonly [canonicalRepositoryActionBrand]: true;
};

export const repositoryActionRoot = ".chug/actions/";
export const repositoryActionDeclarationsMax = 100;
export const repositoryActionPathCharsMax = 256;
export const repositoryActionFileCharsMax = 4_096;

/** What reading one commit's action directory found before its documents are interpreted. */
export type RepositoryActionSnapshotRead =
  | {
      readonly read: "Snapshot";
      readonly files: readonly RepositoryConfigurationFile[];
    }
  | {
      readonly read: "Absent";
      readonly absent: "Commit" | "ActionDirectory";
    }
  | {
      readonly read: "Unavailable";
      readonly unavailable: "Credential" | "Repository";
    }
  | {
      readonly read: "Refused";
      readonly refused: "Credential" | "Snapshot";
    };

/** Reads the action directory at exactly the commit the application pins. */
export interface RepositoryActionSnapshotPort {
  actions(
    request: RepositoryConfigurationSnapshotRequest,
  ): Promise<RepositoryActionSnapshotRead>;
}

/**
 * One declared action. `declaredIn` and `commit` are where the document was
 * read, and `repository` is the binding whose commits it acts on.
 */
export interface RepositoryActionDeclaration {
  readonly declaredIn: RepositoryId;
  readonly commit: GitObjectId;
  readonly path: string;
  readonly action: RepositoryActionId;
  readonly name: string;
  readonly repository: RepositoryId;
  readonly canonical: CanonicalRepositoryAction;
  readonly digest: string;
}

export type RepositoryActionFault =
  | "TooManyDeclarations"
  | "PathInvalid"
  | "SymlinkRefused"
  | "ContentTooLarge"
  | "DocumentUnreadable"
  | "DocumentInvalid"
  | "RepositoryUnbound"
  | "DuplicateAction"
  | "DuplicatePath";

export interface RepositoryActionRefusal {
  readonly path: string;
  readonly fault: RepositoryActionFault;
}

export type RepositoryActionImportReadiness =
  | {
      readonly readiness: "Ready";
      readonly declarations: readonly RepositoryActionDeclaration[];
    }
  | {
      readonly readiness: "Refused";
      readonly faults: readonly RepositoryActionRefusal[];
    };

export type RepositoryActionsImported =
  | { readonly imported: "Imported" }
  | { readonly imported: "IdentityConflict" }
  | { readonly imported: "StaleBinding" };

/** Where a project's declared actions are kept and read, one partition at a time. */
export interface RepositoryActionStore {
  importRepositoryActions(input: {
    readonly partition: Partition;
    readonly binding: RepositoryBinding;
    readonly authority: Authority;
    readonly declarations: readonly RepositoryActionDeclaration[];
  }): Promise<RepositoryActionsImported>;
  actions(
    partition: Partition,
  ): Promise<readonly RepositoryActionDeclaration[]>;
}

export interface RepositoryActionImportPorts {
  readonly binding: ProjectRepositoryBindingRead;
  readonly bindings: ProjectRepositoryBindings;
  readonly snapshots: RepositoryActionSnapshotPort;
  readonly store: RepositoryActionStore;
}

export type RepositoryActionImportOutcome =
  | { readonly result: "RepositoryAbsent" }
  | {
      readonly result: "SnapshotAbsent";
      readonly absent: "Commit" | "ActionDirectory";
    }
  | {
      readonly result: "Unavailable";
      readonly unavailable: "Credential" | "Repository";
    }
  | {
      readonly result: "SnapshotRefused";
      readonly refused: "Credential" | "Snapshot";
    }
  | {
      readonly result: "DeclarationsRefused";
      readonly faults: readonly RepositoryActionRefusal[];
    }
  | { readonly result: "IdentityConflict" }
  | { readonly result: "StaleBinding" }
  | { readonly result: "Imported"; readonly declarations: number };

/** Whether a tree path is a direct JSON child of the action directory. */
export function isRepositoryActionPath(value: string): boolean {
  if (
    value.length === 0 ||
    textCodePointsCount(value) > repositoryActionPathCharsMax ||
    !value.isWellFormed() ||
    value.includes("\\") ||
    value.includes("\0") ||
    !value.startsWith(repositoryActionRoot)
  )
    return false;
  const relative = value.slice(repositoryActionRoot.length);
  return (
    relative.endsWith(".json") &&
    relative.length > ".json".length &&
    !relative.slice(0, -".json".length).includes("/")
  );
}

/** The document's bytes with its keys in one order, so equal documents are equal text. */
export function canonicalRepositoryActionOf(
  document: RepositoryActionDocument,
): CanonicalRepositoryAction {
  return JSON.stringify({
    action: document.action,
    name: document.name,
    repository: document.repository,
    version: document.version,
  }) as CanonicalRepositoryAction;
}

/** The content address of one canonical action document. */
export function repositoryActionDigest(
  canonical: CanonicalRepositoryAction,
): string {
  return createHash("sha256").update(canonical).digest("hex");
}

function repositoryActionDocument(
  file: RepositoryConfigurationFile,
): RepositoryActionDocument | RepositoryActionRefusal {
  if (!isRepositoryActionPath(file.path))
    return { path: file.path, fault: "PathInvalid" };
  if (file.kind === "Symlink")
    return { path: file.path, fault: "SymlinkRefused" };
  if (textCodePointsCount(file.content) > repositoryActionFileCharsMax)
    return { path: file.path, fault: "ContentTooLarge" };
  let value: unknown;
  try {
    value = JSON.parse(file.content);
  } catch {
    return { path: file.path, fault: "DocumentUnreadable" };
  }
  const parsed = repositoryActionDocumentSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : { path: file.path, fault: "DocumentInvalid" };
}

function repositoryActionDeclaration(
  file: RepositoryConfigurationFile,
  input: {
    readonly declaredIn: RepositoryId;
    readonly commit: GitObjectId;
    readonly bound: ReadonlySet<string>;
  },
): RepositoryActionDeclaration | RepositoryActionRefusal {
  const document = repositoryActionDocument(file);
  if ("fault" in document) return document;
  if (!input.bound.has(document.repository))
    return { path: file.path, fault: "RepositoryUnbound" };
  const canonical = canonicalRepositoryActionOf(document);
  return {
    declaredIn: input.declaredIn,
    commit: input.commit,
    path: file.path,
    action: document.action as RepositoryActionId,
    name: document.name,
    repository: asRepositoryId(document.repository),
    canonical,
    digest: repositoryActionDigest(canonical),
  };
}

/**
 * Parses one bounded snapshot atomically into ready declarations or refusals.
 * `bound` is every repository the project binds and has not retired.
 */
export function repositoryActionImportReadiness(input: {
  readonly declaredIn: RepositoryId;
  readonly commit: GitObjectId;
  readonly bound: readonly RepositoryId[];
  readonly files: readonly RepositoryConfigurationFile[];
}): RepositoryActionImportReadiness {
  if (input.files.length > repositoryActionDeclarationsMax)
    return {
      readiness: "Refused",
      faults: [{ path: repositoryActionRoot, fault: "TooManyDeclarations" }],
    };
  const context = { ...input, bound: new Set<string>(input.bound) };
  const declarations: RepositoryActionDeclaration[] = [];
  const faults: RepositoryActionRefusal[] = [];
  const actions = new Set<string>();
  const paths = new Set<string>();
  for (const file of input.files) {
    if (paths.has(file.path)) {
      faults.push({ path: file.path, fault: "DuplicatePath" });
      continue;
    }
    paths.add(file.path);
    const parsed = repositoryActionDeclaration(file, context);
    if ("fault" in parsed) {
      faults.push(parsed);
      continue;
    }
    if (actions.has(parsed.action)) {
      faults.push({ path: file.path, fault: "DuplicateAction" });
      continue;
    }
    actions.add(parsed.action);
    declarations.push(parsed);
  }
  return faults.length === 0
    ? { readiness: "Ready", declarations }
    : { readiness: "Refused", faults };
}

async function importRepositoryActionsStored(
  input: {
    readonly partition: Partition;
    readonly binding: RepositoryBinding;
    readonly authority: Authority;
    readonly declarations: readonly RepositoryActionDeclaration[];
  },
  store: RepositoryActionStore,
): Promise<RepositoryActionImportOutcome> {
  const imported = await store.importRepositoryActions(input);
  switch (imported.imported) {
    case "Imported":
      return { result: "Imported", declarations: input.declarations.length };
    case "IdentityConflict":
      return { result: "IdentityConflict" };
    case "StaleBinding":
      return { result: "StaleBinding" };
    default:
      return assertNever(imported);
  }
}

/** Imports the action declarations at one exact repository commit under an already-resolved authority. */
export async function importRepositoryActions(input: {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
  readonly authority: Authority;
  readonly ports: RepositoryActionImportPorts;
}): Promise<RepositoryActionImportOutcome> {
  const binding = await input.ports.binding.binding(
    input.partition,
    input.repository,
  );
  if (binding === undefined) return { result: "RepositoryAbsent" };
  const snapshot = await input.ports.snapshots.actions({
    repository: binding,
    commit: input.commit,
  });
  switch (snapshot.read) {
    case "Absent":
      return { result: "SnapshotAbsent", absent: snapshot.absent };
    case "Unavailable":
      return { result: "Unavailable", unavailable: snapshot.unavailable };
    case "Refused":
      return { result: "SnapshotRefused", refused: snapshot.refused };
    case "Snapshot": {
      const bound = (await input.ports.bindings.bindings(input.partition))
        .filter((each) => each.retiredAt === undefined)
        .map((each) => each.repository);
      const readiness = repositoryActionImportReadiness({
        declaredIn: binding.repository,
        commit: input.commit,
        bound,
        files: snapshot.files,
      });
      if (readiness.readiness === "Refused")
        return { result: "DeclarationsRefused", faults: readiness.faults };
      return importRepositoryActionsStored(
        {
          partition: input.partition,
          binding,
          authority: input.authority,
          declarations: readiness.declarations,
        },
        input.ports.store,
      );
    }
    default:
      return assertNever(snapshot);
  }
}
