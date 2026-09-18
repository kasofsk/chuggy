import type {
  ContentRef,
  EvaluatorKey,
  StageKey,
  TicketId,
} from "../domain/chuggernaut/task.js";
import type { ReleasedTicket } from "../domain/chuggernaut/ticket.js";
import type { ExecutionProfile } from "./executionProfile.ts";
import type { GitObjectId, RepositoryId } from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";

export interface TicketContentStore {
  put(mediaType: string, content: string): Promise<ContentRef>;
  read(
    reference: ContentRef,
  ): Promise<
    { readonly mediaType: string; readonly content: string } | undefined
  >;
}

export const ticketCatalogDocumentBytesMax = 65_536;

/** Every catalog path lives under this directory, which authored references omit. */
export const ticketCatalogRoot = ".chug/";

/** A reference longer than this names nothing a repository or a writer can hold. */
export const ticketCatalogReferenceBytesMax = 512;

/**
 * Names a catalog read must never serve, even from inside the catalog
 * directory: a repository keeps credentials under these, and a caller who can
 * name a path is not thereby entitled to whatever a committer left there. A
 * runtime fragment is held to the same list, because the merged view cannot be
 * safer than its weakest side and a writer must not reach round the deny-list
 * by putting the file in the database instead.
 */
const ticketCatalogDenied =
  /(^|\/)(\.git|secrets?|credentials?|\.env[^/]*|[^/]+\.(?:pem|key))(\/|$)/u;

/** Why this reference names nothing the catalog serves, or nothing when it is well formed. */
export function ticketCatalogReferenceRefusal(
  reference: string,
): string | undefined {
  if (
    reference.length === 0 ||
    reference.length > ticketCatalogReferenceBytesMax
  )
    return `catalog reference must be between one and ${String(ticketCatalogReferenceBytesMax)} characters`;
  if (reference.includes("\\") || reference.startsWith("/"))
    return "catalog reference must be a relative slash-separated path";
  if (
    reference
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  )
    return "catalog reference must be normalized";
  if (/\p{Cc}/u.test(reference))
    return "catalog reference must not hold control characters";
  if (ticketCatalogDenied.test(reference))
    return "catalog reference names a file that is never served";
  return undefined;
}

/**
 * Where an entry came from. A repository tree is authoritative and a runtime
 * fragment is additive, so the origin is what tells a reader which of the two
 * answered and therefore what editing it would take.
 */
export type TicketCatalogOrigin = "Git" | "Runtime";

export interface TicketCatalogEntry {
  readonly path: string;
  readonly origin: TicketCatalogOrigin;
}

/**
 * The catalog fragments one project holds durably rather than in its
 * repository, keyed by the same authored reference a document names.
 */
export interface TicketCatalogFragments {
  paths(partition: Partition): Promise<readonly string[]>;
  read(partition: Partition, reference: string): Promise<string | undefined>;
  write(
    partition: Partition,
    reference: string,
    content: string,
  ): Promise<void>;
  /** True when a fragment was there to remove, so a caller can be told it was not. */
  remove(partition: Partition, reference: string): Promise<boolean>;
}

/** All catalog reads must come from the same immutable repository revision. */
export interface TicketCatalogSource {
  readonly repository: string;
  readonly reworkLimit: number;
  readonly executionProfiles: ReadonlyMap<string, ExecutionProfile>;
  readonly cloudProject: string | undefined;
  read(path: string): Promise<string>;
}

/** One immutable repository tree, already pinned before authoring begins. */
export interface TicketCatalogSnapshot {
  read(path: string): Promise<string>;
}

export interface TicketCatalogSnapshotRead {
  readonly repository: string;
  readonly snapshot: TicketCatalogSnapshot;
  /** The catalog paths this view holds, so an author can be offered what exists. */
  entries(): Promise<readonly TicketCatalogEntry[]>;
}

/** Which repository a request works against, and where that repository stands. */
export interface TicketCatalogTip {
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
}

/** Resolves a project binding at one exact commit into an immutable catalog tree. */
export interface TicketCatalogSnapshotPort {
  snapshot(input: {
    readonly partition: Partition;
    readonly repository?: RepositoryId;
    readonly commit: GitObjectId;
  }): Promise<TicketCatalogSnapshotRead | undefined>;
  /**
   * Where the bound repository's own HEAD stands, read from the remote rather
   * than remembered. A caller naming no repository gets the binding
   * `ProjectRepositoryBindingRead` already elects, which is the project's
   * oldest live one; an unbound project resolves to nothing.
   */
  tip(input: {
    readonly partition: Partition;
    readonly repository?: RepositoryId;
  }): Promise<TicketCatalogTip | undefined>;
}

export interface TicketCatalogRelease {
  readonly definition: ReleasedTicket;
  readonly stageNames: ReadonlyMap<StageKey, string>;
  readonly evaluatorNames: ReadonlyMap<EvaluatorKey, string>;
  readonly reworkLimit: number | null;
  readonly reworkLimitDeclared: boolean;
}

export interface TicketCatalog {
  release(ticket: TicketId, source: string): Promise<TicketCatalogRelease>;
}
