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
import type { HandoffConfigurationFault } from "./handoffConfiguration.ts";
import type { Authority } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import { assertNever } from "../domain/assertNever.ts";
import {
  asRepositoryConfigurationName,
  asRepositoryConfigurationPath,
  repositoryConfigurationDeclarationsMax,
  repositoryConfigurationFileCharsMax,
  repositoryConfigurationRoot,
  type RepositoryConfigurationName,
  type RepositoryConfigurationPath,
} from "./repositoryConfigurationIdentity.ts";
export * from "./repositoryConfigurationIdentity.ts";

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
  readonly configurationFault?:
    "ReleaseShapeInvalid" | TaskConfigurationFault | HandoffConfigurationFault;
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

export type RepositoryConfigurationsImported =
  | { readonly imported: "Imported" }
  | { readonly imported: "IdentityConflict" }
  | { readonly imported: "StaleBinding" };

export interface RepositoryConfigurationStore {
  importRepositoryConfigurations(input: {
    readonly partition: Partition;
    readonly binding: RepositoryBinding;
    readonly authority: Authority;
    readonly declarations: readonly RepositoryConfigurationDeclaration[];
  }): Promise<RepositoryConfigurationsImported>;
}

export interface ProjectRepositoryBindingRead {
  binding(partition: Partition): Promise<RepositoryBinding | undefined>;
}

export interface RepositoryConfigurationImportPorts {
  readonly bindings: ProjectRepositoryBindingRead;
  readonly snapshots: RepositoryConfigurationSnapshotPort;
  readonly store: RepositoryConfigurationStore;
}

export type RepositoryConfigurationImportOutcome =
  | { readonly result: "NotFound" }
  | { readonly result: "RepositoryAbsent" }
  | {
      readonly result: "SnapshotAbsent";
      readonly absent: "Commit" | "ConfigurationDirectory";
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
      readonly faults: readonly RepositoryConfigurationRefusal[];
    }
  | { readonly result: "IdentityConflict" }
  | { readonly result: "StaleBinding" }
  | { readonly result: "Imported" };

/** Imports the declarations at one exact repository commit under an already-resolved authority. */
export async function importRepositoryConfigurations(input: {
  readonly partition: Partition;
  readonly commit: GitObjectId;
  readonly authority: Authority;
  readonly ports: RepositoryConfigurationImportPorts;
}): Promise<RepositoryConfigurationImportOutcome> {
  const binding = await input.ports.bindings.binding(input.partition);
  if (binding === undefined) return { result: "RepositoryAbsent" };
  const snapshot = await input.ports.snapshots.snapshot({
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
      const readiness = repositoryConfigurationImportReadiness({
        repository: binding.repository,
        commit: input.commit,
        files: snapshot.files,
      });
      if (readiness.readiness === "Refused")
        return { result: "DeclarationsRefused", faults: readiness.faults };
      const imported = await input.ports.store.importRepositoryConfigurations({
        partition: input.partition,
        binding,
        authority: input.authority,
        declarations: readiness.declarations,
      });
      switch (imported.imported) {
        case "Imported":
          return { result: "Imported" };
        case "IdentityConflict":
          return { result: "IdentityConflict" };
        case "StaleBinding":
          return { result: "StaleBinding" };
        default:
          return assertNever(imported);
      }
    }
    default:
      return assertNever(snapshot);
  }
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
  const path = asRepositoryConfigurationPath(file.path);
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
  const name = asRepositoryConfigurationName(record["name"]);
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
