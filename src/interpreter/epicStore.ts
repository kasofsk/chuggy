/**
 * What the boundary asks of a project's epics store: the door an epic is saved
 * through and the reads of its list, its view, its history and its graph.
 */

import type { EpicHistoryQuery, EpicListQuery } from "../contract/epics.ts";
import type {
  EpicCommand,
  EpicOutcome,
  EpicProgress,
  EpicStatus,
  EpicVisibility,
} from "../domain/epics.ts";
import type { Phase } from "../domain/phase.ts";
import type { Partition } from "./projectStore.ts";

/** Who saved an epic, as the journal's other authorities are named. */
export interface EpicActor {
  readonly kind: string;
  readonly subject: string;
}

/** An epic as a ticket names it. */
export interface EpicReference {
  readonly number: number;
  readonly title: string;
  readonly visibility: EpicVisibility;
}

/** An epic as a list and a view carry it, with the figures derived from its members. */
export interface EpicSummary extends EpicReference {
  readonly revision: number;
  readonly summary?: string;
  readonly progress: EpicProgress;
  readonly status: EpicStatus;
  /** Tickets outside the epic a Pending member depends on that are not Done, at most a page of the lowest, ascending. */
  readonly waitingOnOutside: readonly number[];
}

export interface EpicView extends EpicSummary {
  readonly description: string;
  readonly tickets: readonly number[];
}

export interface EpicListPage {
  readonly epics: readonly EpicSummary[];
  /** The `after` the next page resumes from, where one follows. */
  readonly nextAfter?: number;
}

export interface EpicRevision {
  readonly revision: number;
  readonly changedAt: string;
  readonly actor: EpicActor;
  readonly title: string;
}

export interface EpicHistoryPage {
  readonly revisions: readonly EpicRevision[];
  readonly nextAfter?: number;
}

export interface EpicGraphNode {
  readonly ticket: number;
  readonly title?: string;
  /** Absent for a member that is a draft not yet released. */
  readonly phase?: Phase;
  /** False for a ticket outside the epic that a member depends on. */
  readonly member: boolean;
}

/** `from` is a dependency and `to` the member that depends on it. */
export interface EpicGraph {
  readonly nodes: readonly EpicGraphNode[];
  readonly edges: readonly { readonly from: number; readonly to: number }[];
}

export interface EpicStore {
  readonly save: (
    partition: Partition,
    command: EpicCommand,
    actor: EpicActor,
  ) => Promise<EpicOutcome>;
  readonly list: (
    partition: Partition,
    query: EpicListQuery,
  ) => Promise<EpicListPage>;
  readonly view: (
    partition: Partition,
    epic: number,
  ) => Promise<EpicView | undefined>;
  readonly history: (
    partition: Partition,
    epic: number,
    query: EpicHistoryQuery,
  ) => Promise<EpicHistoryPage | undefined>;
  readonly graph: (
    partition: Partition,
    epic: number,
  ) => Promise<EpicGraph | undefined>;
}
