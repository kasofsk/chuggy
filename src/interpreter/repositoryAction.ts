/**
 * The actions one commit of a repository declares, read from files already in
 * hand: nothing here reaches a repository or a database.
 *
 * AN ACTION BELONGS TO THE REPOSITORY ITS DOCUMENT IS READ FROM, as a
 * configuration belongs to the repository it was imported from. A document
 * names no repository, so what one repository's tree declares never speaks for
 * another repository's commits.
 *
 * ONE REFUSED DOCUMENT REFUSES THE COMMIT, exactly as one refused configuration
 * declaration does, so a caller is never handed part of what a commit declares.
 */

import { actionDocumentSchema } from "../contract/actionDocument.ts";
import type { GitObjectId, RepositoryId } from "./finalizer.ts";
import {
  isRepositoryDeclarationPath,
  repositoryDeclarationContent,
  repositoryDeclarationsMax,
  type RepositoryDeclarationFile,
} from "./repositoryDeclaration.ts";
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
