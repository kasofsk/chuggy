import { assertNever } from "../../domain/assertNever.ts";
import type {
  RepositoryCredential,
  RepositoryCredentialPort,
} from "../../interpreter/finalizer.ts";
import type { ProjectRepositoryBindingRead } from "../../interpreter/repositoryConfiguration.ts";
import type {
  TicketCatalogSnapshot,
  TicketCatalogSnapshotPort,
} from "../../interpreter/ticketCatalog.ts";
import { ticketCatalogDocumentBytesMax } from "../../interpreter/ticketCatalog.ts";
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

function gitTicketCatalogExited(
  ran: GitRan,
): ran is Extract<GitRan, { readonly ran: "Exited" }> {
  return ran.ran === "Exited" && ran.code === 0;
}

function gitTicketCatalogPath(path: string): string {
  if (!path.startsWith(".chug/") || path.includes("\\") || path.startsWith("/"))
    throw new TypeError("catalog path must be inside .chug");
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    throw new TypeError("catalog path must be normalized");
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
      const snapshot: TicketCatalogSnapshot = {
        read: async (path) => {
          const checked = gitTicketCatalogPath(path);
          const read = await scratchRun(scratch, {
            repository,
            timeoutSecsMax: scratch.options.localTimeoutSecsMax,
            argv: ["show", `${input.commit}:${checked}`],
            outputBytesMax: ticketCatalogDocumentBytesMax + 1,
          });
          if (!gitTicketCatalogExited(read))
            throw new TypeError(`catalog file is unavailable: ${checked}`);
          if (Buffer.byteLength(read.stdout) > ticketCatalogDocumentBytesMax)
            throw new RangeError("catalog file exceeds size limit");
          return read.stdout;
        },
      };
      return { repository, snapshot };
    },
  };
}
