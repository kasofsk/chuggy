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
 *
 * WHERE THE CHANGE STARTED IS WALKED BACK, NOT STORED. A spawn's commit is a
 * work result of this ticket's own wherever a pass moved the source to it, and
 * that result names the commit its work started at; so the change's base is
 * the first commit, walking back, that no work result of the ticket produced.
 * That is the dispatch's commit, or the target's where a failed landing started
 * the change again. A commit two results claim, or a walk past its bound, names
 * no base, which a check reads as reason to run everything.
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
  /**
   * The distinct commits the ticket's work results that produced `commit`
   * started from, as many as `limit` of them: none where no work of the
   * ticket produced it. A result that reports the commit it started at as the
   * one it produced made nothing, and says nothing of where that commit came
   * from.
   */
  workResultBases(
    partition: Partition,
    ticket: number,
    commit: GitObjectId,
    limit: number,
  ): Promise<readonly GitObjectId[]>;
}

/** The most work results a change's base is walked back through before it is called unknown. */
export const changeBaseStepsMax = 256;

/**
 * The commit the ticket's change at `commit` started from: `commit` itself
 * where no work of the ticket produced it, and otherwise where the one work
 * result that did started, walked back. Nothing where two results claim one
 * commit or the walk does not end within its bound.
 */
async function executionChangeBase(
  history: Pick<ExecutionSourceHistoryPort, "workResultBases">,
  partition: Partition,
  ticket: number,
  commit: GitObjectId,
): Promise<GitObjectId | undefined> {
  let at = commit;
  for (let step = 0; step <= changeBaseStepsMax; step += 1) {
    const bases = await history.workResultBases(partition, ticket, at, 2);
    const [base, ...others] = bases;
    if (base === undefined) return at;
    if (others.length > 0) return undefined;
    at = base;
  }
  return undefined;
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
      const changeBase = await executionChangeBase(
        history,
        request.partition,
        request.ticket,
        row.commit,
      );
      return {
        repository: row.repository,
        target: {
          commit: row.commit,
          ...(row.ref === undefined ? {} : { ref: row.ref }),
        },
        manifests: work?.manifests ?? [],
        ...(changeBase === undefined ? {} : { changeBase }),
      } satisfies ExecutionSourceObservation;
    },
  };
}
