/**
 * What a ticket's dependencies delivered, as each job of the ticket is told it.
 *
 * WHAT A DEPENDENCY DELIVERED IS DERIVED AND STABLE. `depArtifacts` names the
 * work result each dependency's latest instance accepted, and a ticket is
 * dispatched only once every dependency is `Done`, which is absorbing, so the
 * result, the source it was produced at, the brief its ticket was released
 * with and the landing that finished it read the same at every briefing. The
 * dispatch pins the results its bundle names, and every later briefing of the
 * ticket reads that bundle.
 *
 * WHERE A DEPENDENCY'S CHANGE IS, IS ITS LANDING'S ANSWER. A success that
 * landed a commit is where it landed, through its pull request where one was
 * merged; a success that left only a pull request is that request's head; and
 * a ticket whose landing recorded no success is the commit its accepted work
 * produced, which landed nowhere.
 *
 * WHETHER THAT CHANGE IS IN THE HISTORY THE TICKET'S WORK BEGAN AT IS ASKED
 * ONCE, AT DISPATCH, AND PINNED. It is the one fact here a briefing cannot
 * derive, since the scheduler that composes one holds no repository. The
 * dispatch asks it of the commit it observed, for each dependency whose result
 * was produced in the ticket's own repository, and pins the commits found to
 * be in that history and found not to be; a commit the ancestry could not
 * answer for is pinned as neither. The answer is about two immutable commits,
 * so it is true for every job the ticket runs, and a briefing names the commit
 * it is about.
 */

import { assertNever } from "../domain/assertNever.ts";
import type { TicketId } from "../domain/ids.ts";
import { nativeHttpDraftDependenciesMax } from "../contract/http.ts";
import type { ChangeProposalStatus } from "./changeProposal.ts";
import type { CommitAncestry, CommitAncestryPort } from "./commitAncestry.ts";
import type { DispatchSource } from "./executionSource.ts";
import type { GitObjectId, GitRefName, RepositoryId } from "./finalizer.ts";
import type { DependencyPins } from "./projectDecision.ts";
import type { Partition } from "./projectStore.ts";
import type { ProjectRepositoryBindingRead } from "./repositoryConfiguration.ts";
import type { ResultManifestId } from "./resultManifest.ts";
import type { ExecutionId } from "./schedulerIdentity.ts";
import type { TicketBriefPort } from "./ticketBrief.ts";
import {
  ticketLandingProposal,
  ticketLandingState,
  type TicketLandingRecord,
  type TicketLandingsStore,
} from "./ticketLandings.ts";

/** The most dependencies one ticket names, which is as many as a draft may. */
export const dependencyDeliveriesMax = nativeHttpDraftDependenciesMax;

/** One dependency's accepted work result: its manifest, and where it was produced where it was produced anywhere. */
export interface DependencyResult {
  readonly manifest: ResultManifestId;
  readonly repository?: RepositoryId;
  readonly commit?: GitObjectId;
  readonly ref?: GitRefName;
}

/** The accepted work result of one dependency, as its journal names it: by the fold of its digest. */
export interface DependencyAccepted {
  readonly dependency: TicketId;
  readonly result: number;
}

export interface DependencyResultPort {
  /** The passing work result of `dependency` whose digest folds to `result`, or nothing where its rows hold none. */
  accepted(
    partition: Partition,
    dependency: TicketId,
    result: number,
  ): Promise<DependencyResult | undefined>;
}

/** A dependency's pull request, as much of it as a briefing names. */
export interface DependencyProposal {
  readonly url?: string;
  readonly headRef: string;
  readonly headCommit: GitObjectId;
  readonly baseRef: string;
  readonly status?: ChangeProposalStatus;
  /** The head the forge merged, where it is not the head that was evaluated. */
  readonly mergedHead?: GitObjectId;
}

/** Where a dependency's change is. */
export type DependencyChange =
  | {
      readonly change: "Landed";
      readonly commit: GitObjectId;
      readonly ref: string;
      readonly proposal?: DependencyProposal;
    }
  | { readonly change: "Proposed"; readonly proposal: DependencyProposal }
  | {
      readonly change: "Committed";
      readonly commit: GitObjectId;
      readonly ref?: GitRefName;
    }
  | { readonly change: "Unsourced" };

/** The part of a landing's pull request a briefing names, its link kept only where a report could carry it. */
function dependencyChangeProposal(
  landing: TicketLandingRecord,
): DependencyProposal | undefined {
  if (landing.proposal === undefined) return undefined;
  const { url, headRef, headCommit, baseRef, status, mergedHead } =
    ticketLandingProposal(landing.proposal);
  return {
    ...(url === undefined ? {} : { url }),
    headRef,
    headCommit,
    baseRef,
    ...(status === undefined ? {} : { status }),
    ...(mergedHead === undefined ? {} : { mergedHead }),
  };
}

/** Where a dependency's change is, read from its newest landing and the result that landing was of. */
export function dependencyChange(
  result: DependencyResult,
  landing: TicketLandingRecord | undefined,
): DependencyChange {
  if (landing?.request === "Fulfilled" && landing.concluded === "Succeeded") {
    const standing = ticketLandingState(landing);
    const proposal = dependencyChangeProposal(landing);
    if (standing.state === "Landed") {
      const ref = proposal?.baseRef ?? landing.attempt?.targetRef;
      if (ref === undefined)
        throw new Error(
          "dependency delivery: a landing at a commit names no ref it landed on",
        );
      return {
        change: "Landed",
        commit: standing.landedCommit,
        ref,
        ...(proposal === undefined ? {} : { proposal }),
      };
    }
    if (proposal !== undefined) return { change: "Proposed", proposal };
  }
  if (result.commit === undefined) return { change: "Unsourced" };
  return {
    change: "Committed",
    commit: result.commit,
    ...(result.ref === undefined ? {} : { ref: result.ref }),
  };
}

/** The commit a change is at, which is the one whose ancestry is asked; nothing for a change no repository holds. */
export function dependencyChangeCommit(
  change: DependencyChange,
): GitObjectId | undefined {
  switch (change.change) {
    case "Landed":
    case "Committed":
      return change.commit;
    case "Proposed":
      return change.proposal.headCommit;
    case "Unsourced":
      return undefined;
    default:
      return assertNever(change);
  }
}

/** A dependency's newest landing, which for a ticket that is done is the one that finished it. */
async function dependencyLandingNewest(
  landings: TicketLandingsStore,
  partition: Partition,
  dependency: TicketId,
): Promise<TicketLandingRecord | undefined> {
  return (await landings.landings(partition, dependency, 1))?.at(-1);
}

/** Everything a dispatch reads to pin its ticket's dependencies. */
export interface DependencyPinningPorts {
  readonly results: DependencyResultPort;
  readonly landings: TicketLandingsStore;
  readonly bindings: ProjectRepositoryBindingRead;
  readonly ancestry: CommitAncestryPort;
}

export interface DependencyPinningPort {
  /** The pins of `accepted`, asked against the source a dispatch observed. */
  pins(input: {
    readonly partition: Partition;
    readonly source: DispatchSource;
    readonly accepted: readonly DependencyAccepted[];
  }): Promise<DependencyPins>;
}

/**
 * Each commit's ancestry against the dispatched commit, asked at once. An ask
 * that raised found nothing out, which is what `Unknown` already says.
 */
async function dependencyPinningAncestries(
  ports: DependencyPinningPorts,
  partition: Partition,
  repository: RepositoryId,
  tip: GitObjectId,
  commits: readonly GitObjectId[],
): Promise<readonly (readonly [GitObjectId, CommitAncestry])[]> {
  if (commits.length === 0) return [];
  const binding = await ports.bindings.binding(partition, repository);
  if (binding === undefined) return [];
  return Promise.all(
    commits.map(async (candidate) => {
      const ancestry = await ports.ancestry
        .ancestry({ repository: binding, candidate, tip })
        .catch((): CommitAncestry => "Unknown");
      return [candidate, ancestry] as const;
    }),
  );
}

async function dependencyPinningOf(
  ports: DependencyPinningPorts,
  partition: Partition,
  source: DispatchSource,
  accepted: readonly DependencyAccepted[],
): Promise<DependencyPins> {
  if (accepted.length > dependencyDeliveriesMax)
    throw new RangeError(
      "dependency delivery: a ticket names more dependencies than a draft may",
    );
  const results: ResultManifestId[] = [];
  const asked = new Set<GitObjectId>();
  for (const { dependency, result } of accepted) {
    const found = await ports.results.accepted(partition, dependency, result);
    if (found === undefined)
      throw new Error(
        "dependency delivery: a dependency's accepted result is not one its rows hold",
      );
    results.push(found.manifest);
    if (
      source.repository === undefined ||
      found.repository !== source.repository
    )
      continue;
    const commit = dependencyChangeCommit(
      dependencyChange(
        found,
        await dependencyLandingNewest(ports.landings, partition, dependency),
      ),
    );
    if (commit !== undefined) asked.add(commit);
  }
  const answered =
    source.repository === undefined || source.commit === undefined
      ? []
      : await dependencyPinningAncestries(
          ports,
          partition,
          source.repository,
          source.commit,
          [...asked],
        );
  return {
    results,
    ancestors: answered.flatMap(([commit, ancestry]) =>
      ancestry === "Ancestor" ? [commit] : [],
    ),
    nonAncestors: answered.flatMap(([commit, ancestry]) =>
      ancestry === "NotAncestor" ? [commit] : [],
    ),
  };
}

/** Composes what a dispatch pins of its ticket's dependencies from the reads it makes and the one question it asks. */
export function dependencyPinning(
  ports: DependencyPinningPorts,
): DependencyPinningPort {
  return {
    pins: ({ partition, source, accepted }) =>
      dependencyPinningOf(ports, partition, source, accepted),
  };
}

/** One result a dispatch pinned, read back with whose it is and what its work reported. */
export interface DependencyPinnedResult extends DependencyResult {
  readonly dependency: TicketId;
  readonly report?: string;
}

/**
 * What the dispatch of an execution's ticket pinned of its dependencies: the
 * repository and commit it observed, whether this execution starts at that
 * commit, the results, and the commits the observed one was found to descend
 * from and found not to.
 */
export interface DependencyPinned {
  readonly repository?: RepositoryId;
  readonly began?: GitObjectId;
  readonly startsAtBegan: boolean;
  readonly results: readonly DependencyPinnedResult[];
  readonly ancestors: readonly GitObjectId[];
  readonly nonAncestors: readonly GitObjectId[];
}

/** What reading the pins found, an outage kept apart from a ticket with no dependency. */
export type DependencyPinnedRead =
  | { readonly read: "Pinned"; readonly pinned: DependencyPinned }
  | { readonly read: "Unavailable" };

export interface DependencyPinnedPort {
  pinned(
    partition: Partition,
    execution: ExecutionId,
  ): Promise<DependencyPinnedRead>;
}

/** A dependency's repository, and whether it is the one this ticket's own work is in. */
export interface DependencyRepository {
  readonly repository: RepositoryId;
  readonly own: boolean;
}

/** What was found of whether a change's commit is in the history the ticket's work began at. */
export interface DependencyHistory {
  readonly commit: GitObjectId;
  readonly began: GitObjectId;
  /** Whether the job being briefed starts at `began` itself. */
  readonly startsAtBegan: boolean;
  readonly ancestry: CommitAncestry;
}

/** One dependency's delivery, as a briefing renders it. */
export interface DependencyDelivery {
  readonly dependency: TicketId;
  readonly title?: string;
  readonly repository?: DependencyRepository;
  readonly change: DependencyChange;
  /** Present where the dispatch asked, which is where the change's commit is in this ticket's own repository. */
  readonly history?: DependencyHistory;
  readonly report?: string;
}

/** What reading the deliveries found, an outage kept apart from a ticket with no dependency. */
export type DependencyDeliveriesRead =
  | {
      readonly read: "Deliveries";
      readonly deliveries: readonly DependencyDelivery[];
    }
  | { readonly read: "Unavailable" };

export interface DependencyDeliveriesPort {
  deliveries(
    partition: Partition,
    execution: ExecutionId,
  ): Promise<DependencyDeliveriesRead>;
}

/** Everything a briefing reads to tell a job what its ticket's dependencies delivered. */
export interface DependencyDeliveriesPorts {
  readonly pinned: DependencyPinnedPort;
  readonly landings: TicketLandingsStore;
  readonly briefs: TicketBriefPort;
}

/**
 * One delivery derived from what the dispatch pinned and what the dependency's
 * rows hold. The history is present exactly where the dispatch asked, so a
 * commit the dispatch pinned as neither is one it could not find out about.
 */
function dependencyDeliveriesReadOne(
  pinned: DependencyPinned,
  result: DependencyPinnedResult,
  landing: TicketLandingRecord | undefined,
  title: string | undefined,
): DependencyDelivery {
  const change = dependencyChange(result, landing);
  const commit = dependencyChangeCommit(change);
  const own =
    result.repository !== undefined && result.repository === pinned.repository;
  const ancestry: CommitAncestry =
    commit === undefined
      ? "Unknown"
      : pinned.ancestors.includes(commit)
        ? "Ancestor"
        : pinned.nonAncestors.includes(commit)
          ? "NotAncestor"
          : "Unknown";
  return {
    dependency: result.dependency,
    ...(title === undefined ? {} : { title }),
    ...(result.repository === undefined
      ? {}
      : { repository: { repository: result.repository, own } }),
    change,
    ...(own && commit !== undefined && pinned.began !== undefined
      ? {
          history: {
            commit,
            began: pinned.began,
            startsAtBegan: pinned.startsAtBegan,
            ancestry,
          },
        }
      : {}),
    ...(result.report === undefined ? {} : { report: result.report }),
  };
}

/**
 * Derives every delivery from the pins and each dependency's landing and
 * brief, a raise from either reaching the scheduler as one from the ticket's
 * own brief does.
 */
async function dependencyDeliveriesReadOf(
  ports: DependencyDeliveriesPorts,
  partition: Partition,
  execution: ExecutionId,
): Promise<DependencyDeliveriesRead> {
  const read = await ports.pinned.pinned(partition, execution);
  if (read.read === "Unavailable") return read;
  const gathered: {
    readonly result: DependencyPinnedResult;
    readonly landing: TicketLandingRecord | undefined;
    readonly title: string | undefined;
  }[] = [];
  for (const result of read.pinned.results) {
    gathered.push({
      result,
      landing: await dependencyLandingNewest(
        ports.landings,
        partition,
        result.dependency,
      ),
      title: (await ports.briefs.brief(partition, result.dependency))?.title,
    });
  }
  return {
    read: "Deliveries",
    deliveries: gathered.map(({ result, landing, title }) =>
      dependencyDeliveriesReadOne(read.pinned, result, landing, title),
    ),
  };
}

/** Composes what a briefing is told of a ticket's dependencies from the pins and the rows they name. */
export function dependencyDeliveriesRead(
  ports: DependencyDeliveriesPorts,
): DependencyDeliveriesPort {
  return {
    deliveries: (partition, execution) =>
      dependencyDeliveriesReadOf(ports, partition, execution),
  };
}
