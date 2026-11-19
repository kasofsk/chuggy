/**
 * A project's connectors as its administrator writes them, and the history of
 * those writes.
 *
 * Like a repository's landing, this is administration rather than journalled
 * project state. Every write is fenced on the revision its writer read, so two
 * administrators editing one connector cannot overwrite each other unseen.
 */

import type { Connector } from "../contract/connectors.ts";
import type { Authority } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";

/** One connector as it stands, with the revision a write against it names. */
export interface ProjectConnectorStanding {
  readonly connector: Connector;
  readonly revision: number;
}

/** One connector of a project by its name, which is all a job's credential asks of one. */
export interface ProjectConnectorRead {
  connector(
    partition: Partition,
    name: string,
  ): Promise<ProjectConnectorStanding | undefined>;
}

/**
 * One connector written: a create where `expectedRevision` is absent, a
 * replace of the revision named where it is present.
 */
export interface ProjectConnectorWriteCommand {
  readonly partition: Partition;
  readonly connector: Connector;
  readonly expectedRevision?: number;
  readonly authority: Authority;
}

/**
 * What a write came to: `Stale` where its expected revision is not the one
 * standing, answering the one that stands, absent where none does, and
 * `LimitReached` where it creates into a project holding `connectorsProjectMax`.
 */
export type ProjectConnectorWriteOutcome =
  | { readonly outcome: "Created"; readonly revision: number }
  | { readonly outcome: "Changed"; readonly revision: number }
  | { readonly outcome: "Stale"; readonly standing?: number }
  | { readonly outcome: "LimitReached" }
  | { readonly outcome: "ProjectAbsent" };

/** One connector removed against the revision its writer read; absent is answered as stale. */
export interface ProjectConnectorRemoveCommand {
  readonly partition: Partition;
  readonly name: string;
  readonly expectedRevision?: number;
  readonly authority: Authority;
}

/** What a removal came to, `Stale` as a write's. */
export type ProjectConnectorRemoveOutcome =
  | { readonly outcome: "Removed"; readonly revision: number }
  | { readonly outcome: "Stale"; readonly standing?: number };

/** One change of a project's connectors, `change` ordering them and paging past them. */
export type ProjectConnectorChange =
  | {
      readonly change: number;
      readonly changedAt: string;
      readonly authority: Authority;
      readonly action: "Created" | "Changed";
      readonly connector: Connector;
    }
  | {
      readonly change: number;
      readonly changedAt: string;
      readonly authority: Authority;
      readonly action: "Removed";
      readonly name: string;
    };

/** A project's connectors, read, written and removed, and their history. */
export interface ProjectConnectorStore extends ProjectConnectorRead {
  /** Every connector of the project, ordered by name. */
  connectors(
    partition: Partition,
  ): Promise<readonly ProjectConnectorStanding[]>;

  write(
    command: ProjectConnectorWriteCommand,
  ): Promise<ProjectConnectorWriteOutcome>;

  remove(
    command: ProjectConnectorRemoveCommand,
  ): Promise<ProjectConnectorRemoveOutcome>;

  /**
   * One page of the project's changes, newest first, of those older than
   * `before` where it is named; a page shorter than `connectorChangesPageMax`
   * is the last.
   */
  changes(
    partition: Partition,
    before?: number,
  ): Promise<readonly ProjectConnectorChange[]>;
}
