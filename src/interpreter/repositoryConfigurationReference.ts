/**
 * The repository files a catalog names by path, and the catalog with what an
 * import read of them stored inline.
 *
 * A REFERENCE IS RESOLVED AT THE COMMIT THAT NAMES IT. A catalog's workload may
 * be the path of a JSON file holding it, and an agent workload's prompt the
 * path of a file holding its text; the import reads each at the commit it
 * imports, and the configuration it stores holds the workload inline and the
 * text beside its path. A commit can be rewritten, so nothing past the import
 * could recover what the path held.
 *
 * A WORKLOAD FILE IS THE ONLY REFERENCED FILE THAT NAMES ANOTHER, by its
 * prompt's path, so what a catalog names is known once its workload files are
 * read, and a prompt file names nothing.
 */

import {
  configurationReferencePathSchema,
  workloadConfigurationVersion,
} from "../contract/configurationDocument.ts";
import { textCodePointsCount } from "../contract/http.ts";
import { assertNever } from "../domain/assertNever.ts";
import { repositoryDeclarationFileCharsMax } from "./repositoryDeclaration.ts";

/** The most distinct files one import reads by reference, across every configuration it declares. */
export const repositoryConfigurationReferencesMax = 256;

/** One file a catalog names, as its reader found it at the commit imported. */
export type RepositoryConfigurationReferenced =
  | {
      readonly path: string;
      readonly found: "File";
      readonly content: string;
    }
  | {
      readonly path: string;
      readonly found: "Symlink" | "Absent" | "TooLarge";
    };

/** Why a reference could not be stored inline: the fault, and the path it names. */
export interface RepositoryConfigurationReferenceRefusal {
  readonly reference: string;
  readonly fault:
    | "ReferenceAbsent"
    | "SymlinkRefused"
    | "ContentTooLarge"
    | "DocumentUnreadable";
}

type RepositoryConfigurationReferencedFiles = ReadonlyMap<
  string,
  RepositoryConfigurationReferenced
>;

/** A JSON object as a record, and anything else as none. */
function repositoryConfigurationRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A value that is a path a catalog may name, and anything else as none. */
function repositoryConfigurationReferencePath(
  value: unknown,
): string | undefined {
  return configurationReferencePathSchema.safeParse(value).success
    ? (value as string)
    : undefined;
}

/** A workload file's JSON as read, or why it could not be. */
function repositoryConfigurationReferencedDocument(
  file: RepositoryConfigurationReferenced,
  reference: string,
): { readonly document: unknown } | RepositoryConfigurationReferenceRefusal {
  const text = repositoryConfigurationReferencedText(file, reference);
  if ("fault" in text) return text;
  try {
    return { document: JSON.parse(text.text) };
  } catch {
    return { reference, fault: "DocumentUnreadable" };
  }
}

/** A referenced file's text, or why it holds none an import may store. */
function repositoryConfigurationReferencedText(
  file: RepositoryConfigurationReferenced,
  reference: string,
): { readonly text: string } | RepositoryConfigurationReferenceRefusal {
  switch (file.found) {
    case "File":
      return textCodePointsCount(file.content) >
        repositoryDeclarationFileCharsMax
        ? { reference, fault: "ContentTooLarge" }
        : { text: file.content };
    case "Symlink":
      return { reference, fault: "SymlinkRefused" };
    case "TooLarge":
      return { reference, fault: "ContentTooLarge" };
    case "Absent":
      return { reference, fault: "ReferenceAbsent" };
    default:
      return assertNever(file);
  }
}

/** Each workload a catalog holds as it stands once the files read so far are stored inline. */
function repositoryConfigurationWorkloads(
  workloads: Readonly<Record<string, unknown>>,
  referenced: RepositoryConfigurationReferencedFiles,
): readonly { readonly name: string; readonly workload: unknown }[] {
  return Object.entries(workloads).map(([name, entry]) => {
    const path = repositoryConfigurationReferencePath(entry);
    const file = path === undefined ? undefined : referenced.get(path);
    if (path === undefined || file === undefined)
      return { name, workload: entry };
    const read = repositoryConfigurationReferencedDocument(file, path);
    return { name, workload: "document" in read ? read.document : entry };
  });
}

/** A version 2 configuration's workloads map, and none for anything else. */
function repositoryConfigurationCatalogWorkloads(
  configuration: unknown,
): Readonly<Record<string, unknown>> | undefined {
  const catalog = repositoryConfigurationRecord(configuration);
  if (catalog?.["version"] !== workloadConfigurationVersion) return undefined;
  return repositoryConfigurationRecord(catalog["workloads"]);
}

/** The path one workload's prompt names, and none where it names no valid one. */
function repositoryConfigurationPromptPath(
  workload: unknown,
): string | undefined {
  const prompt = repositoryConfigurationRecord(
    repositoryConfigurationRecord(workload)?.["prompt"],
  );
  return repositoryConfigurationReferencePath(prompt?.["path"]);
}

/**
 * Every path one configuration names that an import reads, given the files it
 * has read so far: its workload files, and the prompt files of every workload
 * it holds inline or has read.
 */
export function repositoryConfigurationReferences(
  configuration: unknown,
  referenced: RepositoryConfigurationReferencedFiles,
): readonly string[] {
  const workloads = repositoryConfigurationCatalogWorkloads(configuration);
  if (workloads === undefined) return [];
  const paths = new Set<string>();
  for (const entry of Object.values(workloads)) {
    const path = repositoryConfigurationReferencePath(entry);
    if (path !== undefined) paths.add(path);
  }
  for (const { workload } of repositoryConfigurationWorkloads(
    workloads,
    referenced,
  )) {
    const path = repositoryConfigurationPromptPath(workload);
    if (path !== undefined) paths.add(path);
  }
  return [...paths];
}

/** One workload with its prompt's text replaced by what the file it names held. */
function repositoryConfigurationPromptResolved(
  workload: unknown,
  referenced: RepositoryConfigurationReferencedFiles,
): { readonly workload: unknown } | RepositoryConfigurationReferenceRefusal {
  const path = repositoryConfigurationPromptPath(workload);
  if (path === undefined) return { workload };
  const file = referenced.get(path) ?? { path, found: "Absent" };
  const text = repositoryConfigurationReferencedText(file, path);
  if ("fault" in text) return text;
  const record = repositoryConfigurationRecord(workload) ?? {};
  return { workload: { ...record, prompt: { path, text: text.text } } };
}

/**
 * One configuration with every file it names stored inline, or the first
 * reference that could not be. A prompt naming a path holds what that file
 * held, whatever text it was written with.
 */
export function repositoryConfigurationResolved(
  configuration: unknown,
  referenced: RepositoryConfigurationReferencedFiles,
):
  | { readonly configuration: unknown }
  | RepositoryConfigurationReferenceRefusal {
  const workloads = repositoryConfigurationCatalogWorkloads(configuration);
  if (workloads === undefined) return { configuration };
  const resolved: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(workloads)) {
    const path = repositoryConfigurationReferencePath(entry);
    const read =
      path === undefined
        ? { document: entry }
        : repositoryConfigurationReferencedDocument(
            referenced.get(path) ?? { path, found: "Absent" },
            path,
          );
    if ("fault" in read) return read;
    const workload = repositoryConfigurationPromptResolved(
      read.document,
      referenced,
    );
    if ("fault" in workload) return workload;
    resolved[name] = workload.workload;
  }
  return {
    configuration: {
      ...repositoryConfigurationRecord(configuration),
      workloads: resolved,
    },
  };
}
