/**
 * One directory of a bound repository's tree, read at one commit, before any
 * repository or database I/O.
 *
 * A REPOSITORY IS READ ONLY WHERE THE PROJECT BINDS IT. The read is authorized
 * as the project's own is, and a repository the project does not name is
 * answered as one that does not exist, before anything is asked of git. A read
 * of an address the caller chose would have this server fetch it under the
 * credentials it holds, from inside its own network.
 *
 * THE ANSWER NAMES THE COMMIT IT WAS READ AT, which is the default branch's
 * head where the caller named none, so every later read of one walk can name
 * that commit and none drifts onto a newer one.
 *
 * ONE LEVEL IS READ AT A TIME, and at most `repositoryTreeEntriesAnsweredMax`
 * of its entries are answered; a directory holding more says it was cut short.
 * A symbolic link and a submodule are named as what they are, and neither is a
 * directory a read can descend into.
 *
 * NO ANSWER IS A FAILURE. A deployment with no scratch to read in, a remote
 * that could not be reached, a commit not held, and a path that is no
 * directory at that commit are each a read of their own.
 */

import {
  repositoryTreeDirectoryCharsMax,
  repositoryTreeEntriesAnsweredMax,
  textCodePointsCount,
} from "../contract/http.ts";
import { assertNever } from "../domain/assertNever.ts";
import {
  authorizedProjectValue,
  type AuthorizedResult,
} from "./authorizedProject.ts";
import type {
  GitObjectId,
  RepositoryBinding,
  RepositoryId,
} from "./finalizer.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import type {
  ProjectRepositoryBindingRead,
  RepositoryDefaultBranchPort,
} from "./repositoryConfiguration.ts";

declare const repositoryTreeDirectoryBrand: unique symbol;

/** A directory of a tree by its path from the root, which is the empty path. */
export type RepositoryTreeDirectory = string & {
  readonly [repositoryTreeDirectoryBrand]: true;
};

/**
 * Brands a directory path: segments joined by `/`, none empty, `.` or `..`,
 * and no control character anywhere. Each refusal is a path git would read as
 * something other than the one directory it names.
 */
export function asRepositoryTreeDirectory(
  value: string,
): RepositoryTreeDirectory {
  if (!value.isWellFormed() || /\p{Cc}/u.test(value))
    throw new RangeError("repository tree directory: a character is refused");
  if (textCodePointsCount(value) > repositoryTreeDirectoryCharsMax)
    throw new RangeError("repository tree directory: the path is too long");
  if (
    value !== "" &&
    value
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  )
    throw new RangeError("repository tree directory: a segment is refused");
  return value as RepositoryTreeDirectory;
}

/** The root of a tree. */
export const repositoryTreeRoot = asRepositoryTreeDirectory("");

/** One entry of a directory by its name there, a file saying whether it is executable. */
export type RepositoryTreeEntry =
  | {
      readonly name: string;
      readonly kind: "File";
      readonly executable: boolean;
    }
  | {
      readonly name: string;
      readonly kind: "Directory" | "Symlink" | "Submodule";
    };

/** One directory of one bound repository at one commit. */
export interface RepositoryTreeRequest {
  readonly repository: RepositoryBinding;
  readonly commit: GitObjectId;
  readonly directory: RepositoryTreeDirectory;
}

/**
 * What reading one directory at one commit found. `Commit` is a commit not
 * held, whether it could not be fetched or has not arrived yet, and
 * `Directory` is a path that is no directory at a commit held.
 */
export type RepositoryTreeRead =
  | {
      readonly read: "Listed";
      readonly entries: readonly RepositoryTreeEntry[];
      readonly truncated: boolean;
    }
  | { readonly read: "Absent"; readonly absent: "Commit" | "Directory" }
  | { readonly read: "Unavailable" };

/** Reads one directory of a repository's tree at exactly the commit asked. */
export interface RepositoryTreePort {
  list(request: RepositoryTreeRequest): Promise<RepositoryTreeRead>;
}

/** Where a tree is read from: nowhere, in a deployment with no scratch, or the head and the tree of a remote. */
export type RepositoryTreeSource =
  | { readonly readable: "Unconfigured" }
  | {
      readonly readable: "Scratch";
      readonly heads: RepositoryDefaultBranchPort;
      readonly trees: RepositoryTreePort;
    };

/** What a caller asks for: a repository by its identity, a directory, and a commit where it names one. */
export interface RepositoryTreeQuery {
  readonly repository: RepositoryId;
  readonly directory: RepositoryTreeDirectory;
  readonly commit?: GitObjectId;
}

/** What one read answers: the directory's entries at the commit resolved, or which way there was no answer. */
export type RepositoryTreeListing =
  | {
      readonly read: "Listed";
      readonly commit: GitObjectId;
      readonly directory: RepositoryTreeDirectory;
      readonly entries: readonly RepositoryTreeEntry[];
      readonly truncated: boolean;
    }
  | { readonly read: "Absent"; readonly absent: "Commit" | "Directory" }
  | {
      readonly read: "Unavailable";
      readonly unavailable: "Scratch" | "Repository";
    };

export interface RepositoryTreeReads {
  /** Answers `NotFound` for a project the caller may not read and for a repository the project does not bind. */
  read(
    principal: Principal,
    partition: Partition,
    query: RepositoryTreeQuery,
  ): Promise<AuthorizedResult<RepositoryTreeListing>>;
}

export interface RepositoryTreePorts {
  readonly access: ProjectAccess;
  readonly bindings: ProjectRepositoryBindingRead;
  readonly source: RepositoryTreeSource;
}

/** The project's own binding of exactly the repository named, and nothing for any other. */
async function repositoryTreeBinding(
  bindings: ProjectRepositoryBindingRead,
  partition: Partition,
  repository: RepositoryId,
): Promise<RepositoryBinding | undefined> {
  const binding = await bindings.binding(partition, repository);
  if (binding === undefined) return undefined;
  if (
    binding.repository !== repository ||
    binding.partition.tenant !== partition.tenant ||
    binding.partition.project !== partition.project
  )
    return undefined;
  return binding;
}

/** The commit a query is read at: the one it names, else where the default branch points now. */
async function repositoryTreeCommit(
  heads: RepositoryDefaultBranchPort,
  binding: RepositoryBinding,
  query: RepositoryTreeQuery,
): Promise<GitObjectId | Exclude<RepositoryTreeListing, { read: "Listed" }>> {
  if (query.commit !== undefined) return query.commit;
  const head = await heads.defaultBranch(binding);
  switch (head.read) {
    case "Branch":
      return head.commit;
    case "Absent":
      return { read: "Absent", absent: "Commit" };
    case "Unavailable":
      return { read: "Unavailable", unavailable: "Repository" };
    default:
      return assertNever(head);
  }
}

/** One directory of a bound repository read from a source that has a scratch. */
async function repositoryTreeListed(
  source: Extract<RepositoryTreeSource, { readable: "Scratch" }>,
  binding: RepositoryBinding,
  query: RepositoryTreeQuery,
): Promise<RepositoryTreeListing> {
  const commit = await repositoryTreeCommit(source.heads, binding, query);
  if (typeof commit !== "string") return commit;
  const directory = query.directory;
  const read = await source.trees.list({
    repository: binding,
    commit,
    directory,
  });
  switch (read.read) {
    case "Listed":
      if (read.entries.length > repositoryTreeEntriesAnsweredMax)
        throw new RangeError("repository tree: more entries than one answers");
      return { ...read, commit, directory };
    case "Absent":
      return read;
    case "Unavailable":
      return { read: "Unavailable", unavailable: "Repository" };
    default:
      return assertNever(read);
  }
}

async function repositoryTreeRead(
  ports: RepositoryTreePorts,
  partition: Partition,
  query: RepositoryTreeQuery,
): Promise<RepositoryTreeListing | undefined> {
  const binding = await repositoryTreeBinding(
    ports.bindings,
    partition,
    query.repository,
  );
  if (binding === undefined) return undefined;
  const { source } = ports;
  switch (source.readable) {
    case "Unconfigured":
      return { read: "Unavailable", unavailable: "Scratch" };
    case "Scratch":
      return repositoryTreeListed(source, binding, query);
    default:
      return assertNever(source);
  }
}

export function repositoryTreeReads(
  ports: RepositoryTreePorts,
): RepositoryTreeReads {
  const authorized = authorizedProjectValue(
    ports.access,
    (partition, query: RepositoryTreeQuery) =>
      repositoryTreeRead(ports, partition, query),
  );
  return {
    read: async (principal, partition, query) => {
      const found = await authorized(principal, partition, query);
      return found.result === "Authorized" && found.value !== undefined
        ? { result: "Authorized", value: found.value }
        : { result: "NotFound" };
    },
  };
}
