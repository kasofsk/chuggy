/**
 * A repository's declared actions, read at one commit and held to the
 * project's bindings before anything stores them.
 *
 * THE SET EXISTS BEFORE ANY REPORT DOES, because the row a status board most
 * needs is the action that has not happened yet, and an action that came into
 * being on its first report would leave that row invisible.
 *
 * THE REPOSITORY A DOCUMENT NAMES IS HELD TO THE PROJECT'S LIVE BINDINGS HERE,
 * where a refusal can name the document, rather than stored and refused by
 * whatever reads it later with no path to point at.
 *
 * ONE REFUSED DOCUMENT REFUSES THE COMMIT, exactly as one refused configuration
 * declaration does, so a store never holds part of what a commit declares.
 */

import {
  actionDocumentSchema,
  type ActionDocument,
} from "../contract/actionDocument.ts";
import { textCodePointsCount } from "../contract/http.ts";
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

export const repositoryActionRoot = ".chug/actions/";
export const repositoryActionDeclarationsMax = 100;
export const repositoryActionPathCharsMax = 256;
export const repositoryActionFileCharsMax = 65_536;

declare const canonicalActionBrand: unique symbol;
declare const repositoryActionRevisionBrand: unique symbol;

/** One action document's canonical bytes, which its content digest is taken over. */
export type CanonicalAction = string & {
  readonly [canonicalActionBrand]: true;
};

/** Where one commit's declaration of one action is addressed, the same for every import of that commit. */
export type RepositoryActionRevision = string & {
  readonly [repositoryActionRevisionBrand]: true;
};

export interface RepositoryActionDeclaration {
  /** The repository the document was read from, which is not always the one it acts on. */
  readonly source: RepositoryId;
  readonly commit: GitObjectId;
  readonly path: string;
  readonly action: string;
  readonly name: string;
  readonly repository: RepositoryId;
  readonly revision: RepositoryActionRevision;
  readonly canonical: CanonicalAction;
}

/** What reading the action directory at one commit found, before any document is interpreted. */
export type RepositoryActionSnapshotRead =
  | {
      readonly read: "Snapshot";
      readonly files: readonly RepositoryConfigurationFile[];
    }
  | { readonly read: "Absent"; readonly absent: "Commit" | "ActionDirectory" }
  | {
      readonly read: "Unavailable";
      readonly unavailable: "Credential" | "Repository";
    }
  | {
      readonly read: "Refused";
      readonly refused: "Credential" | "Snapshot";
    };

/** Reads `.chug/actions/` at exactly the commit the application pins. */
export interface RepositoryActionSnapshotPort {
  actionSnapshot(
    request: RepositoryConfigurationSnapshotRequest,
  ): Promise<RepositoryActionSnapshotRead>;
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

/** What storing one commit's actions came to, `IdentityConflict` being a revision already stored with other bytes. */
export type RepositoryActionsImported =
  | { readonly imported: "Imported" }
  | { readonly imported: "IdentityConflict" }
  | { readonly imported: "StaleBinding" };

/**
 * A project's declared actions. Every method names its partition, and no
 * method reads or writes across two of them.
 */
export interface RepositoryActionStore {
  importRepositoryActions(input: {
    readonly partition: Partition;
    readonly binding: RepositoryBinding;
    readonly authority: Authority;
    readonly declarations: readonly RepositoryActionDeclaration[];
  }): Promise<RepositoryActionsImported>;

  repositoryActions(
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

/** The canonical bytes of one parsed document: its keys in code-unit order, and nothing the schema does not admit. */
function canonicalActionOf(document: ActionDocument): CanonicalAction {
  return JSON.stringify({
    action: document.action,
    name: document.name,
    repository: document.repository,
    version: document.version,
  }) as CanonicalAction;
}

function repositoryActionPathIsValid(value: string): boolean {
  const relative = value.slice(repositoryActionRoot.length);
  return (
    textCodePointsCount(value) <= repositoryActionPathCharsMax &&
    value.isWellFormed() &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.startsWith(repositoryActionRoot) &&
    relative.endsWith(".json") &&
    relative.length > ".json".length &&
    !relative.slice(0, -".json".length).includes("/")
  );
}

function repositoryActionDocument(
  file: RepositoryConfigurationFile,
): ActionDocument | RepositoryActionRefusal {
  if (!repositoryActionPathIsValid(file.path))
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
  const parsed = actionDocumentSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : { path: file.path, fault: "DocumentInvalid" };
}

function repositoryActionDeclaration(
  file: RepositoryConfigurationFile,
  input: {
    readonly repository: RepositoryId;
    readonly commit: GitObjectId;
    readonly bound: ReadonlySet<RepositoryId>;
  },
): RepositoryActionDeclaration | RepositoryActionRefusal {
  const document = repositoryActionDocument(file);
  if ("fault" in document) return document;
  const repository = asRepositoryId(document.repository);
  if (!input.bound.has(repository))
    return { path: file.path, fault: "RepositoryUnbound" };
  return {
    source: input.repository,
    commit: input.commit,
    path: file.path,
    action: document.action,
    name: document.name,
    repository,
    revision:
      `repository:${input.commit}:${document.action}` as RepositoryActionRevision,
    canonical: canonicalActionOf(document),
  };
}

/**
 * Parses one bounded snapshot atomically into ready declarations or refusals.
 * `bound` is every repository the project binds and has not retired.
 */
export function repositoryActionImportReadiness(input: {
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
  readonly files: readonly RepositoryConfigurationFile[];
  readonly bound: ReadonlySet<RepositoryId>;
}): RepositoryActionImportReadiness {
  if (input.files.length > repositoryActionDeclarationsMax)
    return {
      readiness: "Refused",
      faults: [{ path: repositoryActionRoot, fault: "TooManyDeclarations" }],
    };
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
    const parsed = repositoryActionDeclaration(file, input);
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
    readonly authority: Authority;
    readonly ports: RepositoryActionImportPorts;
  },
  binding: RepositoryBinding,
  declarations: readonly RepositoryActionDeclaration[],
): Promise<RepositoryActionImportOutcome> {
  const imported = await input.ports.store.importRepositoryActions({
    partition: input.partition,
    binding,
    authority: input.authority,
    declarations,
  });
  switch (imported.imported) {
    case "Imported":
      return { result: "Imported", declarations: declarations.length };
    case "IdentityConflict":
      return { result: "IdentityConflict" };
    case "StaleBinding":
      return { result: "StaleBinding" };
    default:
      return assertNever(imported);
  }
}

/** Imports the actions one repository declares at one exact commit under an already-resolved authority. */
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
  const snapshot = await input.ports.snapshots.actionSnapshot({
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
      const bound = await input.ports.bindings.bindings(input.partition);
      const readiness = repositoryActionImportReadiness({
        repository: binding.repository,
        commit: input.commit,
        files: snapshot.files,
        bound: new Set(
          bound
            .filter((each) => each.retiredAt === undefined)
            .map((each) => each.repository),
        ),
      });
      if (readiness.readiness === "Refused")
        return { result: "DeclarationsRefused", faults: readiness.faults };
      return importRepositoryActionsStored(
        input,
        binding,
        readiness.declarations,
      );
    }
    default:
      return assertNever(snapshot);
  }
}
