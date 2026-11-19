/**
 * A project's connectors as its administrator writes them, and the history of
 * those writes.
 *
 * Like a repository's landing, this is administration rather than journalled
 * project state. Every write is fenced on the revision its writer read, so two
 * administrators editing one connector cannot overwrite each other unseen.
 */

import {
  connectorChangesPageMax,
  type Connector,
} from "../contract/connectors.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { Authority } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import {
  repositoryReaderAuthority,
  repositorySettingsAuthority,
} from "./repositoryOnboarding.ts";

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

/** A project's connectors as a caller may read them. */
export type ProjectConnectorsListed =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly connectors: readonly ProjectConnectorStanding[];
    };

/** One write as a caller's: refused, or what the store's write came to. */
export type ProjectConnectorWritten =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Created" | "Changed";
      readonly standing: ProjectConnectorStanding;
    }
  | { readonly result: "Stale"; readonly standing?: number }
  | { readonly result: "LimitReached" };

/** One removal as a caller's: `Absent` where the project holds no connector of that name. */
export type ProjectConnectorRemoved =
  | { readonly result: "NotFound" | "Removed" | "Absent" }
  | { readonly result: "Stale"; readonly standing: number };

/** One page of a project's history as a caller may read it, with the cursor of the next where there may be one. */
export type ProjectConnectorHistoryRead =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly changes: readonly ProjectConnectorChange[];
      readonly next?: number;
    };

/**
 * A project's connectors for a caller. Whoever may read the project's
 * repositories reads them, and whoever may change a repository's settings
 * writes and removes them, each change recorded under the authority that
 * permit answered. A caller who may not is answered `NotFound`.
 */
export interface ProjectConnectorAdministration {
  listed(
    principal: Principal,
    partition: Partition,
  ): Promise<ProjectConnectorsListed>;
  written(
    principal: Principal,
    partition: Partition,
    write: {
      readonly connector: Connector;
      readonly expectedRevision?: number;
    },
  ): Promise<ProjectConnectorWritten>;
  removed(
    principal: Principal,
    partition: Partition,
    remove: { readonly name: string; readonly expectedRevision?: number },
  ): Promise<ProjectConnectorRemoved>;
  history(
    principal: Principal,
    partition: Partition,
    before?: number,
  ): Promise<ProjectConnectorHistoryRead>;
}

async function projectConnectorAdministrationWritten(
  input: ProjectConnectorAdministrationPorts,
  principal: Principal,
  partition: Partition,
  write: { readonly connector: Connector; readonly expectedRevision?: number },
): Promise<ProjectConnectorWritten> {
  const authority = await repositorySettingsAuthority(
    input.access,
    principal,
    partition,
  );
  if (authority === undefined) return { result: "NotFound" };
  const written = await input.store.write({ ...write, partition, authority });
  switch (written.outcome) {
    case "Created":
    case "Changed":
      return {
        result: written.outcome,
        standing: { connector: write.connector, revision: written.revision },
      };
    case "Stale":
      return written.standing === undefined
        ? { result: "Stale" }
        : { result: "Stale", standing: written.standing };
    case "LimitReached":
      return { result: "LimitReached" };
    case "ProjectAbsent":
      return { result: "NotFound" };
    default:
      return assertNever(written);
  }
}

async function projectConnectorAdministrationRemoved(
  input: ProjectConnectorAdministrationPorts,
  principal: Principal,
  partition: Partition,
  remove: { readonly name: string; readonly expectedRevision?: number },
): Promise<ProjectConnectorRemoved> {
  const authority = await repositorySettingsAuthority(
    input.access,
    principal,
    partition,
  );
  if (authority === undefined) return { result: "NotFound" };
  const removed = await input.store.remove({
    ...remove,
    partition,
    authority,
  });
  switch (removed.outcome) {
    case "Removed":
      return { result: "Removed" };
    case "Stale":
      return removed.standing === undefined
        ? { result: "Absent" }
        : { result: "Stale", standing: removed.standing };
    default:
      return assertNever(removed);
  }
}

async function projectConnectorAdministrationHistory(
  input: ProjectConnectorAdministrationPorts,
  principal: Principal,
  partition: Partition,
  before?: number,
): Promise<ProjectConnectorHistoryRead> {
  if (
    (await repositoryReaderAuthority(input.access, principal, partition)) ===
    undefined
  )
    return { result: "NotFound" };
  const changes = await input.store.changes(partition, before);
  const last = changes.at(-1);
  return changes.length < connectorChangesPageMax || last === undefined
    ? { result: "Found", changes }
    : { result: "Found", changes, next: last.change };
}

interface ProjectConnectorAdministrationPorts {
  readonly access: ProjectAccess;
  readonly store: ProjectConnectorStore;
}

export function projectConnectorAdministration(
  input: ProjectConnectorAdministrationPorts,
): ProjectConnectorAdministration {
  return {
    listed: async (principal, partition) =>
      (await repositoryReaderAuthority(input.access, principal, partition)) ===
      undefined
        ? { result: "NotFound" }
        : {
            result: "Found",
            connectors: await input.store.connectors(partition),
          },
    written: (principal, partition, write) =>
      projectConnectorAdministrationWritten(input, principal, partition, write),
    removed: (principal, partition, remove) =>
      projectConnectorAdministrationRemoved(
        input,
        principal,
        partition,
        remove,
      ),
    history: (principal, partition, before) =>
      projectConnectorAdministrationHistory(
        input,
        principal,
        partition,
        before,
      ),
  };
}
