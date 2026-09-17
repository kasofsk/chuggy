import { assertNever } from "../../domain/assertNever.ts";
import type {
  GitObjectId,
  RepositoryCredential,
  RepositoryCredentialPort,
  RepositoryId,
} from "../../interpreter/finalizer.ts";
import type { ProjectRepositoryBindingRead } from "../../interpreter/repositoryConfiguration.ts";
import type {
  TicketCatalogSnapshot,
  TicketCatalogSnapshotPort,
} from "../../interpreter/ticketCatalog.ts";
import {
  ticketCatalogDocumentBytesMax,
  ticketCatalogRoot,
} from "../../interpreter/ticketCatalog.ts";
import {
  scratchOpen,
  scratchRemoteArguments,
  scratchRun,
  type GitCommitIdentity,
} from "./gitScratch.ts";
import type { GitEnvironment, GitRan } from "./gitRun.ts";

export interface GitTicketCatalogOptions {
  readonly scratchDirectory: string;
  readonly identity: GitCommitIdentity;
  readonly environment: GitEnvironment;
  readonly credentials: RepositoryCredentialPort;
  readonly bindings: ProjectRepositoryBindingRead;
  readonly credentialUsername?: string;
  readonly localTimeoutSecsMax?: number;
  readonly remoteTimeoutSecsMax?: number;
}

/** A listing carries names alone, so one document's bound is ample for the whole tree. */
const gitTicketCatalogListingBytesMax = ticketCatalogDocumentBytesMax;

function gitTicketCatalogExited(
  ran: GitRan,
): ran is Extract<GitRan, { readonly ran: "Exited" }> {
  return ran.ran === "Exited" && ran.code === 0;
}

/**
 * Names a catalog read must never serve, even from inside the catalog
 * directory: a repository keeps credentials under these, and a caller who can
 * name a path is not thereby entitled to whatever a committer left there.
 */
const gitTicketCatalogDenied =
  /(^|\/)(\.git|secrets?|credentials?|\.env[^/]*|[^/]+\.(?:pem|key))(\/|$)/u;

function gitTicketCatalogPath(path: string): string {
  if (!path.startsWith(".chug/") || path.includes("\\") || path.startsWith("/"))
    throw new TypeError("catalog path must be inside .chug");
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    throw new TypeError("catalog path must be normalized");
  if (gitTicketCatalogDenied.test(path))
    throw new TypeError("catalog path names a file that is never served");
  return path;
}

async function gitTicketCatalogCredential(
  credentials: RepositoryCredentialPort,
  binding: NonNullable<
    Awaited<ReturnType<ProjectRepositoryBindingRead["binding"]>>
  >,
): Promise<RepositoryCredential | undefined | "Unavailable"> {
  const resolved = await credentials.credential(binding);
  switch (resolved.resolved) {
    case "Credential":
      return resolved.credential;
    case "Denied":
      return undefined;
    case "Unavailable":
      return "Unavailable";
    default:
      return assertNever(resolved);
  }
}

/** Reads catalog files only from the exact commit named by an authoring request. */
export function gitTicketCatalog(
  options: GitTicketCatalogOptions,
): TicketCatalogSnapshotPort {
  const scratch = scratchOpen({
    directory: options.scratchDirectory,
    identity: options.identity,
    environment: options.environment,
    credentialUsername: options.credentialUsername ?? "chuggy",
    localTimeoutSecsMax: options.localTimeoutSecsMax ?? 60,
    remoteTimeoutSecsMax: options.remoteTimeoutSecsMax ?? 300,
    promotionTimeoutSecsMax: options.remoteTimeoutSecsMax ?? 300,
  });
  return {
    snapshot: async (input) => {
      const binding = await options.bindings.binding(
        input.partition,
        input.repository,
      );
      if (binding === undefined) return undefined;
      const credential = await gitTicketCatalogCredential(
        options.credentials,
        binding,
      );
      if (credential === "Unavailable")
        throw new Error("ticket catalog credential unavailable");
      const repository = binding.repository;
      const fetched = await scratchRun(scratch, {
        repository,
        ...(credential === undefined ? {} : { credential }),
        timeoutSecsMax: scratch.options.remoteTimeoutSecsMax,
        argv: [
          "fetch",
          "--quiet",
          "--no-tags",
          ...scratchRemoteArguments(
            repository,
            `+${input.commit}:refs/chuggy/catalog/${input.commit}`,
          ),
        ],
      });
      if (!gitTicketCatalogExited(fetched)) return undefined;
      const pinned = { scratch, repository, commit: input.commit };
      return {
        repository,
        snapshot: gitTicketCatalogSnapshot(pinned),
        entries: () => gitTicketCatalogEntries(pinned),
      };
    },
  };
}

interface GitTicketCatalogPinned {
  readonly scratch: ReturnType<typeof scratchOpen>;
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
}

async function gitTicketCatalogEntries(
  pinned: GitTicketCatalogPinned,
): Promise<readonly string[]> {
  const listed = await scratchRun(pinned.scratch, {
    repository: pinned.repository,
    timeoutSecsMax: pinned.scratch.options.localTimeoutSecsMax,
    argv: [
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      pinned.commit,
      "--",
      ticketCatalogRoot,
    ],
    outputBytesMax: gitTicketCatalogListingBytesMax,
  });
  if (!gitTicketCatalogExited(listed))
    throw new TypeError("catalog listing is unavailable");
  return listed.stdout
    .split("\0")
    .filter(
      (path) =>
        path.startsWith(ticketCatalogRoot) &&
        !gitTicketCatalogDenied.test(path),
    )
    .map((path) => path.slice(ticketCatalogRoot.length));
}

function gitTicketCatalogSnapshot(
  pinned: GitTicketCatalogPinned,
): TicketCatalogSnapshot {
  return {
    read: async (path) => {
      const checked = gitTicketCatalogPath(path);
      const read = await scratchRun(pinned.scratch, {
        repository: pinned.repository,
        timeoutSecsMax: pinned.scratch.options.localTimeoutSecsMax,
        argv: ["show", `${pinned.commit}:${checked}`],
        outputBytesMax: ticketCatalogDocumentBytesMax + 1,
      });
      if (!gitTicketCatalogExited(read))
        throw new TypeError(`catalog file is unavailable: ${checked}`);
      if (Buffer.byteLength(read.stdout) > ticketCatalogDocumentBytesMax)
        throw new RangeError("catalog file exceeds size limit");
      return read.stdout;
    },
  };
}
