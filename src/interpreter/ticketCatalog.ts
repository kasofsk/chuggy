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
  /** The catalog paths the commit holds, so an author can be offered what exists. */
  entries(): Promise<readonly string[]>;
}

/** Resolves a project binding at one exact commit into an immutable catalog tree. */
export interface TicketCatalogSnapshotPort {
  snapshot(input: {
    readonly partition: Partition;
    readonly repository?: RepositoryId;
    readonly commit: GitObjectId;
  }): Promise<TicketCatalogSnapshotRead | undefined>;
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
