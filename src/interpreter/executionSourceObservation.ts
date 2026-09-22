/**
 * What a ticket's work is observed against at dispatch: the binding of the
 * repository the ticket's brief names, narrowed by the branch that brief says
 * its work happens on, which is the more specific of the two and therefore the
 * last word. Where that work lands is the brief's separate answer and the
 * finalizer's to read.
 *
 * A BRIEF NAMING NO REPOSITORY IS DISPATCHED AT THE RESERVED REFERENCE. Such a
 * ticket runs nothing against a remote, so there is no commit to fold and no
 * outage to report: the reference says so, the row beside it carries no
 * repository, and every later spawn reads the same nothing.
 *
 * A BRANCH THE REMOTE DOES NOT HOLD YET IS WHERE THE WORK STARTS, NOT A FAILED
 * OBSERVATION. The base is the binding's own target, exactly as it is for a
 * brief naming no branch at all, and the source still names the ticket's
 * branch — which the finalizer's first promotion creates where the brief lands
 * its work there.
 *
 * AND NOTHING BUT THE DISPATCH ASKS THE REMOTE. Every later spawn reads the row
 * the dispatch or an accepted work result wrote, so a rework runs at the commit
 * that was judged rather than at whatever the branch holds by then.
 */

import {
  repositoryTargetObserved,
  type GitObjectId,
  type GitPromotionPort,
  type GitRefName,
  type RepositoryId,
} from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import type { ProjectRepositoryBindingRead } from "./repositoryConfiguration.ts";
import { digestFold, type ResultManifestId } from "./resultManifest.ts";
import {
  unsourcedTicketReference,
  type ExecutionSourceObservation,
  type ExecutionSourceObservationPort,
} from "./executionSource.ts";

/**
 * What the ticket's latest work spawn produced: the manifests it terminalized,
 * in the order its tasks were minted. The commit they were produced at is the
 * ticket's own source and is read beside them rather than from here.
 */
export interface WorkSourceHistory {
  readonly manifests: readonly ResultManifestId[];
}

/** One source a ticket has run at, as the row keyed by its reference holds it. */
export interface TicketSourceRow {
  readonly repository?: RepositoryId;
  readonly commit?: GitObjectId;
  readonly ref?: GitRefName;
}

export interface ExecutionSourceHistoryPort {
  workSource(partition: Partition, ticket: number): Promise<WorkSourceHistory>;
  ticketSource(
    partition: Partition,
    ticket: number,
    source: number,
  ): Promise<TicketSourceRow | undefined>;
}

export function executionSourceObservation(
  bindings: ProjectRepositoryBindingRead,
  git: Pick<GitPromotionPort, "observeTarget">,
  history: ExecutionSourceHistoryPort,
): ExecutionSourceObservationPort {
  return {
    observe: async (request) => {
      if (request.repository === undefined)
        return {
          observed: "Source",
          source: { reference: unsourcedTicketReference },
        };
      const bound = await bindings.binding(
        request.partition,
        request.repository,
      );
      if (bound === undefined)
        return { observed: "Unreadable", evidence: "RefUnreadable" };
      const observed = await repositoryTargetObserved(git, bound, request.ref);
      if (observed.observed !== "Target") return observed;
      return {
        observed: "Source",
        source: {
          reference: digestFold(observed.target.commit),
          repository: bound.repository,
          commit: observed.target.commit,
          ...(observed.target.ref === undefined
            ? {}
            : { ref: observed.target.ref }),
        },
      };
    },
    spawnSource: async (request) => {
      const row = await history.ticketSource(
        request.partition,
        request.ticket,
        request.source,
      );
      if (row?.repository === undefined || row.commit === undefined)
        return undefined;
      const work =
        request.kind === "Evaluation"
          ? await history.workSource(request.partition, request.ticket)
          : undefined;
      return {
        repository: row.repository,
        target: {
          commit: row.commit,
          ...(row.ref === undefined ? {} : { ref: row.ref }),
        },
        manifests: work?.manifests ?? [],
      } satisfies ExecutionSourceObservation;
    },
  };
}
