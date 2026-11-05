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
 * AND NOTHING BUT THE DISPATCH OBSERVES A REF. Every later spawn reads the row
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
 *
 * EXCEPT WHERE THE LATEST FAILED LANDING NAMED THE BASE ITS PROPOSAL FAILED ON.
 * Its rework is told to bring that base in, so a commit holding it holds the
 * base's own commits too, and a change read from the walked-back base would
 * claim them. That base is the change's base wherever the spawn's commit is
 * answered to descend from it — two immutable commits, so the answer cannot go
 * stale — and the walked-back one stays where the answer is no or unknown.
 */

import {
  repositoryTargetObserved,
  type GitObjectId,
  type GitPromotionPort,
  type GitRefName,
  type RepositoryId,
} from "./finalizer.ts";
import type { CommitAncestry, CommitAncestryPort } from "./commitAncestry.ts";
import type { CommitTreePort } from "./commitTree.ts";
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
  /**
   * The commit of the base the ticket's latest failed landing — the attempt
   * its latest rework was sent back for — named its proposal as failing on:
   * none where it named none, or the ticket was never sent back.
   */
  failedLandingBase(
    partition: Partition,
    ticket: number,
  ): Promise<GitObjectId | undefined>;
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

/**
 * The base the ticket's latest failed landing named, where the spawn's commit
 * is answered to descend from it, and otherwise the walked-back one. A port
 * that cannot work at all answers nothing, as an unknown does.
 */
async function executionSourceChangeBase(
  bindings: ProjectRepositoryBindingRead,
  ancestry: CommitAncestryPort,
  history: ExecutionSourceHistoryPort,
  request: { readonly partition: Partition; readonly ticket: number },
  row: { readonly repository: RepositoryId; readonly commit: GitObjectId },
): Promise<GitObjectId | undefined> {
  const walked = await executionChangeBase(
    history,
    request.partition,
    request.ticket,
    row.commit,
  );
  const landed = await history.failedLandingBase(
    request.partition,
    request.ticket,
  );
  if (landed === undefined || landed === walked) return walked;
  const repository = await bindings.binding(request.partition, row.repository);
  if (repository === undefined) return walked;
  const answer = await ancestry
    .ancestry({ repository, candidate: landed, tip: row.commit })
    .catch((): CommitAncestry => "Unknown");
  return answer === "Ancestor" ? landed : walked;
}

/**
 * The tree an evaluation of `commit` must be run against, or nothing where the
 * binding is gone or the port could not read it. A port that cannot work at all
 * answers nothing, as an unknown does.
 */
async function executionExpectedTree(
  bindings: ProjectRepositoryBindingRead,
  trees: Partial<CommitTreePort>,
  request: { readonly partition: Partition; readonly kind: string },
  row: { readonly repository: RepositoryId; readonly commit: GitObjectId },
): Promise<GitObjectId | undefined> {
  if (request.kind !== "Evaluation" || trees.tree === undefined)
    return undefined;
  const repository = await bindings.binding(request.partition, row.repository);
  if (repository === undefined) return undefined;
  return trees
    .tree({ repository, commit: row.commit })
    .catch((): undefined => undefined);
}

async function executionSourceObserved(
  bindings: ProjectRepositoryBindingRead,
  git: Pick<GitPromotionPort, "observeTarget">,
  request: Parameters<ExecutionSourceObservationPort["observe"]>[0],
): ReturnType<ExecutionSourceObservationPort["observe"]> {
  if (request.repository === undefined)
    return {
      observed: "Source",
      source: { reference: unsourcedTicketReference },
    };
  const bound = await bindings.binding(request.partition, request.repository);
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
}

export function executionSourceObservation(
  bindings: ProjectRepositoryBindingRead,
  git: Pick<GitPromotionPort, "observeTarget">,
  history: ExecutionSourceHistoryPort,
  ancestry: CommitAncestryPort & Partial<CommitTreePort>,
): ExecutionSourceObservationPort {
  return {
    observe: (request) => executionSourceObserved(bindings, git, request),
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
      const at = { repository: row.repository, commit: row.commit };
      const changeBase = await executionSourceChangeBase(
        bindings,
        ancestry,
        history,
        request,
        at,
      );
      const expectedTree = await executionExpectedTree(
        bindings,
        ancestry,
        request,
        at,
      );
      return {
        repository: row.repository,
        target: {
          commit: row.commit,
          ...(row.ref === undefined ? {} : { ref: row.ref }),
        },
        manifests: work?.manifests ?? [],
        ...(changeBase === undefined ? {} : { changeBase }),
        ...(expectedTree === undefined ? {} : { expectedTree }),
      } satisfies ExecutionSourceObservation;
    },
  };
}
