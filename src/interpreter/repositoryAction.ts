/**
 * The actions a repository declares: what one commit's documents read as, and
 * the import that stores them through ports this module only declares.
 *
 * AN ACTION BELONGS TO THE REPOSITORY ITS DOCUMENT IS READ FROM, as a
 * configuration belongs to the repository it was imported from. A document
 * names no repository, so what one repository's tree declares never speaks for
 * another repository's commits.
 *
 * ONE REFUSED DOCUMENT REFUSES THE COMMIT, exactly as one refused configuration
 * declaration does, so a caller is never handed part of what a commit declares.
 *
 * WHAT A REPOSITORY DECLARES IS WHAT ITS NEWEST IMPORTED HEAD DECLARES. An
 * import replaces the set whole, so a document a head no longer holds is no
 * longer declared, and a tree holding no action directory declares nothing:
 * that is a set to store like any other and not a repository to pass over.
 *
 * AN IDENTITY IS THE PROJECT'S, exactly as written. Two repositories of one
 * project may not both declare one, so the repository that holds it keeps it
 * and the other's import is refused whole.
 */

import { actionDocumentSchema } from "../contract/actionDocument.ts";
import { assertNever } from "../domain/assertNever.ts";
import type {
  GitObjectId,
  RepositoryBinding,
  RepositoryId,
} from "./finalizer.ts";
import {
  isRepositoryDeclarationPath,
  repositoryDeclarationContent,
  repositoryDeclarationsMax,
  type RepositoryDeclarationFile,
} from "./repositoryDeclaration.ts";
import type {
  RepositoryDeclarationSnapshotRead,
  RepositoryDeclarationSnapshotRequest,
} from "./repositoryDeclarationSnapshot.ts";
import { taskConfigurationLineFault } from "./taskConfiguration.ts";

declare const repositoryActionIdBrand: unique symbol;
declare const repositoryActionNameBrand: unique symbol;
declare const repositoryActionPathBrand: unique symbol;

/** An action's identity, the same at every commit that declares it. */
export type RepositoryActionId = string & {
  readonly [repositoryActionIdBrand]: true;
};

/** What a reader is shown for an action: one printable line, as a ticket's title is. */
export type RepositoryActionName = string & {
  readonly [repositoryActionNameBrand]: true;
};

/** Where one action document sits in its tree: a JSON file directly in the action directory. */
export type RepositoryActionPath = string & {
  readonly [repositoryActionPathBrand]: true;
};

export const repositoryActionRoot = ".chug/actions/";

export interface RepositoryActionDeclaration {
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
  readonly path: RepositoryActionPath;
  readonly action: RepositoryActionId;
  readonly name: RepositoryActionName;
}

export type RepositoryActionFault =
  | "TooManyDeclarations"
  | "PathInvalid"
  | "SymlinkRefused"
  | "ContentTooLarge"
  | "DocumentUnreadable"
  | "DocumentInvalid"
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

function asRepositoryActionPath(
  value: string,
): RepositoryActionPath | undefined {
  return isRepositoryDeclarationPath(repositoryActionRoot, value)
    ? (value as RepositoryActionPath)
    : undefined;
}

/** Brands a name by the rule a ticket's title is branded by: something other than blanks, on a line that prints. */
function asRepositoryActionName(
  value: string,
): RepositoryActionName | undefined {
  return value.trim().length > 0 &&
    taskConfigurationLineFault(value) === undefined
    ? (value as RepositoryActionName)
    : undefined;
}

function repositoryActionDeclaration(
  file: RepositoryDeclarationFile,
  repository: RepositoryId,
  commit: GitObjectId,
): RepositoryActionDeclaration | RepositoryActionRefusal {
  const path = asRepositoryActionPath(file.path);
  if (path === undefined) return { path: file.path, fault: "PathInvalid" };
  const content = repositoryDeclarationContent(file);
  if (content.content === "Refused")
    return { path: file.path, fault: content.fault };
  const parsed = actionDocumentSchema.safeParse(content.document);
  if (!parsed.success) return { path: file.path, fault: "DocumentInvalid" };
  const name = asRepositoryActionName(parsed.data.name);
  if (name === undefined) return { path: file.path, fault: "DocumentInvalid" };
  return {
    repository,
    commit,
    path,
    action: parsed.data.action as RepositoryActionId,
    name,
  };
}

/** Reads one commit's action documents atomically into ready declarations or refusals. */
export function repositoryActionImportReadiness(input: {
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
  readonly files: readonly RepositoryDeclarationFile[];
}): RepositoryActionImportReadiness {
  if (input.files.length > repositoryDeclarationsMax)
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
    const parsed = repositoryActionDeclaration(
      file,
      input.repository,
      input.commit,
    );
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

/** Reads the action documents a repository's tree holds at exactly the commit named. */
export interface RepositoryActionSnapshotPort {
  actionSnapshot(
    request: RepositoryDeclarationSnapshotRequest,
  ): Promise<RepositoryDeclarationSnapshotRead>;
}

/**
 * What storing one commit's declarations came to. `IdentityConflict` is an
 * identity another repository of the project holds, and `StaleBinding` a
 * binding that is no longer the one the caller read; neither changes a row.
 */
export type RepositoryActionsImported =
  | { readonly imported: "Imported" }
  | { readonly imported: "IdentityConflict" }
  | { readonly imported: "StaleBinding" };

export interface RepositoryActionStore {
  /** Replaces what one bound repository declares with one commit's declarations, wholly or not at all. */
  importRepositoryActions(input: {
    readonly binding: RepositoryBinding;
    readonly commit: GitObjectId;
    readonly declarations: readonly RepositoryActionDeclaration[];
  }): Promise<RepositoryActionsImported>;
}

export interface RepositoryActionImportPorts {
  readonly actionSnapshots: RepositoryActionSnapshotPort;
  readonly actionStore: RepositoryActionStore;
}

export type RepositoryActionImportOutcome =
  | { readonly result: "CommitAbsent" }
  | {
      readonly result: "Unavailable";
      readonly unavailable: "Credential" | "Repository";
    }
  | { readonly result: "SnapshotRefused" }
  | {
      readonly result: "DeclarationsRefused";
      readonly faults: readonly RepositoryActionRefusal[];
    }
  | { readonly result: "IdentityConflict" }
  | { readonly result: "StaleBinding" }
  | { readonly result: "Imported"; readonly declarations: number };

/** Replaces what one bound repository declares with what its tree declares at one exact commit. */
export async function importRepositoryActions(input: {
  readonly binding: RepositoryBinding;
  readonly commit: GitObjectId;
  readonly ports: RepositoryActionImportPorts;
}): Promise<RepositoryActionImportOutcome> {
  const snapshot = await input.ports.actionSnapshots.actionSnapshot({
    repository: input.binding,
    commit: input.commit,
  });
  switch (snapshot.read) {
    case "Absent":
      return { result: "CommitAbsent" };
    case "Unavailable":
      return { result: "Unavailable", unavailable: snapshot.unavailable };
    case "Refused":
      return { result: "SnapshotRefused" };
    case "Snapshot":
      return importRepositoryActionsStored(input, snapshot.files);
    default:
      return assertNever(snapshot);
  }
}

/** One snapshot's files, stored where every one of them is read and nowhere otherwise. */
async function importRepositoryActionsStored(
  input: Parameters<typeof importRepositoryActions>[0],
  files: readonly RepositoryDeclarationFile[],
): Promise<RepositoryActionImportOutcome> {
  const readiness = repositoryActionImportReadiness({
    repository: input.binding.repository,
    commit: input.commit,
    files,
  });
  if (readiness.readiness === "Refused")
    return { result: "DeclarationsRefused", faults: readiness.faults };
  const { imported } = await input.ports.actionStore.importRepositoryActions({
    binding: input.binding,
    commit: input.commit,
    declarations: readiness.declarations,
  });
  return imported === "Imported"
    ? { result: "Imported", declarations: readiness.declarations.length }
    : { result: imported };
}
