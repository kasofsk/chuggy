/** Repository-declared configurations before any repository or database I/O. */

import {
  asConfigurationRevisionId,
  canonicalConfigurationOf,
  releaseConfigurationReadiness,
  type CanonicalConfiguration,
  type ConfigurationRevisionId,
  type ReleaseConfiguration,
} from "./authoring.ts";
import type {
  GitObjectId,
  RepositoryBinding,
  RepositoryId,
} from "./finalizer.ts";
import type { TaskConfigurationFault } from "./taskConfiguration.ts";

declare const repositoryConfigurationNameBrand: unique symbol;
declare const repositoryConfigurationPathBrand: unique symbol;

export type RepositoryConfigurationName = string & {
  readonly [repositoryConfigurationNameBrand]: true;
};

export type RepositoryConfigurationPath = string & {
  readonly [repositoryConfigurationPathBrand]: true;
};

export const repositoryConfigurationDeclarationsMax = 100;
export const repositoryConfigurationNameCharsMax = 128;
export const repositoryConfigurationPathCharsMax = 256;
export const repositoryConfigurationFileCharsMax = 65_536;
export const repositoryConfigurationRoot = ".chug/configurations/";

export interface RepositoryConfigurationFile {
  readonly path: string;
  readonly kind: "File" | "Symlink";
  readonly content: string;
}

/** One immutable repository view the application asks an outer adapter to read. */
export interface RepositoryConfigurationSnapshotRequest {
  readonly repository: RepositoryBinding;
  readonly commit: GitObjectId;
}

/** What reading an immutable repository view found before its declarations are interpreted. */
export type RepositoryConfigurationSnapshotRead =
  | {
      readonly read: "Snapshot";
      readonly files: readonly RepositoryConfigurationFile[];
    }
  | {
      readonly read: "Absent";
      readonly absent: "Commit" | "ConfigurationDirectory";
    }
  | {
      readonly read: "Unavailable";
      readonly unavailable: "Credential" | "Repository";
    }
  | {
      readonly read: "Refused";
      readonly refused: "Credential" | "Snapshot";
    };

/** Reads repository configuration bytes at exactly the commit the application pins. */
export interface RepositoryConfigurationSnapshotPort {
  snapshot(
    request: RepositoryConfigurationSnapshotRequest,
  ): Promise<RepositoryConfigurationSnapshotRead>;
}

export interface RepositoryConfigurationDeclaration {
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
  readonly name: RepositoryConfigurationName;
  readonly path: RepositoryConfigurationPath;
  readonly revision: ConfigurationRevisionId;
  readonly canonical: CanonicalConfiguration;
  readonly configuration: ReleaseConfiguration;
}

export type RepositoryConfigurationFault =
  | "TooManyDeclarations"
  | "PathInvalid"
  | "SymlinkRefused"
  | "ContentTooLarge"
  | "DocumentUnreadable"
  | "EnvelopeInvalid"
  | "NameInvalid"
  | "ConfigurationInvalid"
  | "DuplicateName"
  | "DuplicatePath";

export interface RepositoryConfigurationRefusal {
  readonly path: string;
  readonly fault: RepositoryConfigurationFault;
  readonly configurationFault?: "ReleaseShapeInvalid" | TaskConfigurationFault;
}

export type RepositoryConfigurationImportReadiness =
  | {
      readonly readiness: "Ready";
      readonly declarations: readonly RepositoryConfigurationDeclaration[];
    }
  | {
      readonly readiness: "Refused";
      readonly faults: readonly RepositoryConfigurationRefusal[];
    };

function repositoryConfigurationName(
  value: unknown,
): RepositoryConfigurationName | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= repositoryConfigurationNameCharsMax &&
    value.isWellFormed() &&
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(value)
    ? (value as RepositoryConfigurationName)
    : undefined;
}

function repositoryConfigurationPath(
  value: string,
): RepositoryConfigurationPath | undefined {
  if (
    value.length === 0 ||
    value.length > repositoryConfigurationPathCharsMax ||
    !value.isWellFormed() ||
    value.includes("\\") ||
    value.includes("\0")
  )
    return undefined;
  const relative = value.slice(repositoryConfigurationRoot.length);
  return value.startsWith(repositoryConfigurationRoot) &&
    relative.endsWith(".json") &&
    relative.length > ".json".length &&
    !relative.slice(0, -".json".length).includes("/")
    ? (value as RepositoryConfigurationPath)
    : undefined;
}

function repositoryConfigurationRevision(
  commit: GitObjectId,
  name: RepositoryConfigurationName,
): ConfigurationRevisionId {
  return asConfigurationRevisionId(`repository:${commit}:${name}`);
}

function repositoryConfigurationEnvelope(
  file: RepositoryConfigurationFile,
  repository: RepositoryId,
  commit: GitObjectId,
): RepositoryConfigurationDeclaration | RepositoryConfigurationRefusal {
  const path = repositoryConfigurationPath(file.path);
  if (path === undefined) return { path: file.path, fault: "PathInvalid" };
  if (file.kind === "Symlink")
    return { path: file.path, fault: "SymlinkRefused" };
  if (file.content.length > repositoryConfigurationFileCharsMax)
    return { path: file.path, fault: "ContentTooLarge" };
  let value: unknown;
  try {
    value = JSON.parse(file.content);
  } catch {
    return { path: file.path, fault: "DocumentUnreadable" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { path: file.path, fault: "EnvelopeInvalid" };
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "configuration,name,version" ||
    record["version"] !== 1
  )
    return { path: file.path, fault: "EnvelopeInvalid" };
  const name = repositoryConfigurationName(record["name"]);
  if (name === undefined) return { path: file.path, fault: "NameInvalid" };
  let canonical: CanonicalConfiguration;
  try {
    canonical = canonicalConfigurationOf(record["configuration"]);
  } catch {
    return { path: file.path, fault: "ConfigurationInvalid" };
  }
  const readiness = releaseConfigurationReadiness(canonical);
  if (readiness.readiness === "Incomplete")
    return {
      path: file.path,
      fault: "ConfigurationInvalid",
      configurationFault: readiness.fault,
    };
  return {
    repository,
    commit,
    name,
    path,
    revision: repositoryConfigurationRevision(commit, name),
    canonical,
    configuration: readiness.configuration,
  };
}

/** Parses one bounded repository snapshot atomically into ready declarations or refusals. */
export function repositoryConfigurationImportReadiness(input: {
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
  readonly files: readonly RepositoryConfigurationFile[];
}): RepositoryConfigurationImportReadiness {
  if (input.files.length > repositoryConfigurationDeclarationsMax)
    return {
      readiness: "Refused",
      faults: [
        { path: repositoryConfigurationRoot, fault: "TooManyDeclarations" },
      ],
    };
  const declarations: RepositoryConfigurationDeclaration[] = [];
  const faults: RepositoryConfigurationRefusal[] = [];
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const file of input.files) {
    if (paths.has(file.path)) {
      faults.push({ path: file.path, fault: "DuplicatePath" });
      continue;
    }
    paths.add(file.path);
    const parsed = repositoryConfigurationEnvelope(
      file,
      input.repository,
      input.commit,
    );
    if ("fault" in parsed) {
      faults.push(parsed);
      continue;
    }
    if (names.has(parsed.name)) {
      faults.push({ path: file.path, fault: "DuplicateName" });
      continue;
    }
    names.add(parsed.name);
    declarations.push(parsed);
  }
  return faults.length === 0
    ? { readiness: "Ready", declarations }
    : { readiness: "Refused", faults };
}
