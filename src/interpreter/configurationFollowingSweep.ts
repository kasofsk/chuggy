/**
 * The importer's sweep over the Pending tickets that follow their
 * configuration's newest revision, after a binding's import at its head.
 *
 * THE HEAD DECIDES WHO IS ASKED, NOT WHAT THIS RUN WROTE. A ticket is a
 * candidate where it holds a revision of a name the head declares and not the
 * head's own, so a head imported by an earlier run or another path is
 * followed exactly as one this run imported.
 *
 * ONLY A MOVE WRITES. A ticket answered `Current`, `Trimmed` or `Held` is left
 * as it stands and asked again by the next run, so nothing has to remember an
 * answer; the verdict is memoized for this run alone, per revision and per
 * everything of the ticket the verdict reads.
 *
 * A TICKET'S FAILURE IS NOT THE RUN'S END. A move refused, or one whose door
 * raised, is reported on its own line and the sweep goes on to the next. A
 * binding whose candidates could not be read is reported the same way.
 *
 * EVERYTHING IS BOUNDED: the tickets one run reads, the moves it offers, and
 * the time it may take, past which it stops and says so.
 */

import type { ConfigurationOverrides } from "../contract/configurationOverrides.ts";
import type { ConfigurationSelection } from "../contract/configurationSelection.ts";
import type { ReleaseAuthoringProgram } from "../contract/authoring.ts";
import { assertNever } from "../domain/assertNever.ts";
import type { TicketId } from "../domain/ids.ts";
import type {
  CanonicalConfiguration,
  ConfigurationRevisionId,
  ReleaseAuthoring,
  ReleaseConfigurationFault,
} from "./authoring.ts";
import {
  configurationFollowingVerdict,
  type ConfigurationFollowingVerdict,
} from "./configurationFollowing.ts";
import type { GitObjectId, RepositoryId } from "./finalizer.ts";
import type { OperationId } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import type { DraftBrief } from "./ticketBrief.ts";

/** The most tickets one run reads, across every binding it sweeps. */
export const configurationFollowingTicketsReadMax = 2_000;

/** The most moves one run offers, across every binding it sweeps. */
export const configurationFollowingMovesMax = 200;

/** The most tickets one read of candidates answers. */
export const configurationFollowingPageTicketsMax = 100;

/** One binding imported at its head by this run, which is the only kind swept. */
export interface ConfigurationFollowingBinding {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly commit: GitObjectId;
}

/** One Pending ticket following its newest revision, as its last release or update froze it. */
export interface ConfigurationFollowingCandidate {
  readonly ticket: TicketId;
  /** The ticket's revision, which a move expects. */
  readonly revision: number;
  readonly held: ConfigurationRevisionId;
  /** The revision the head declares under the held revision's name. */
  readonly head: ConfigurationRevisionId;
  readonly brief: DraftBrief | undefined;
  readonly overrides: ConfigurationOverrides | undefined;
  readonly selection: ConfigurationSelection | undefined;
  readonly authoring: ReleaseAuthoring;
}

/** One page of candidates, and the canonical of each distinct revision it names. */
export interface ConfigurationFollowingCandidates {
  readonly candidates: readonly ConfigurationFollowingCandidate[];
  readonly canonicals: ReadonlyMap<
    ConfigurationRevisionId,
    CanonicalConfiguration
  >;
}

/** A move of one ticket onto the head's revision under its default program. */
export interface ConfigurationFollowingMove {
  readonly partition: Partition;
  readonly ticket: TicketId;
  readonly expectedRevision: number;
  readonly configuration: ConfigurationRevisionId;
  readonly program: ReleaseAuthoringProgram;
}

/** Every answer the move door returns that leaves the ticket where it was. */
export const configurationFollowingMoveRefusals = [
  "Stale",
  "NotDraft",
  "NotFound",
  "RepositoryNotBound",
  "LandingUnbranched",
  "ConfigurationNotFound",
  "Backpressure",
  "Unavailable",
  "NotAdmitted",
  "InvalidCommand",
  "IdempotencyConflict",
  "Original",
] as const;
export type ConfigurationFollowingMoveRefusal =
  (typeof configurationFollowingMoveRefusals)[number];

export type ConfigurationFollowingMoved =
  | { readonly moved: "Accepted"; readonly operation: OperationId }
  | {
      readonly moved: "Refused";
      readonly answer: ConfigurationFollowingMoveRefusal;
    };

export interface ConfigurationFollowingPort {
  /** The candidates of one binding after the ticket `after`, ticket order, at most `max`. */
  candidates(query: {
    readonly binding: ConfigurationFollowingBinding;
    readonly after: number;
    readonly max: number;
  }): Promise<ConfigurationFollowingCandidates>;
  move(move: ConfigurationFollowingMove): Promise<ConfigurationFollowingMoved>;
}

/** What became of one ticket a run reports: every answer but `Current` and `Trimmed`, which leave nothing to say. */
export type ConfigurationFollowed =
  | { readonly followed: "Moved"; readonly operation: OperationId }
  | { readonly followed: "Held"; readonly fault: ReleaseConfigurationFault }
  | {
      readonly followed: "Refused";
      readonly answer: ConfigurationFollowingMoveRefusal;
    }
  | { readonly followed: "Failed" };

export interface ConfigurationFollowingReported {
  readonly binding: ConfigurationFollowingBinding;
  /** The ticket, absent where the binding's candidates could not be read. */
  readonly ticket?: TicketId;
  readonly head?: ConfigurationRevisionId;
  readonly followed: ConfigurationFollowed;
}

/** Why a run stopped before it had swept every binding. */
export type ConfigurationFollowingStop = "Deadline" | "TicketsRead" | "Moves";

export interface ConfigurationFollowingRun {
  readonly reported: readonly ConfigurationFollowingReported[];
  readonly stopped?: ConfigurationFollowingStop;
}

interface ConfigurationFollowingState {
  readonly port: ConfigurationFollowingPort;
  readonly now: () => number;
  readonly deadlineAtMs: number;
  readonly reported: ConfigurationFollowingReported[];
  readonly verdicts: Map<string, ConfigurationFollowingVerdict>;
  readonly canonicals: Map<ConfigurationRevisionId, CanonicalConfiguration>;
  ticketsRead: number;
  moves: number;
}

/** The stop the run has reached before its next door call, where it has reached one. */
function configurationFollowingStopped(
  state: ConfigurationFollowingState,
  door: "Candidates" | "Move",
): ConfigurationFollowingStop | undefined {
  if (state.now() >= state.deadlineAtMs) return "Deadline";
  if (door === "Candidates")
    return state.ticketsRead >= configurationFollowingTicketsReadMax
      ? "TicketsRead"
      : undefined;
  return state.moves >= configurationFollowingMovesMax ? "Moves" : undefined;
}

/** Everything of one candidate its verdict reads, as one key. */
function configurationFollowingVerdictKey(
  candidate: ConfigurationFollowingCandidate,
): string {
  return JSON.stringify([
    candidate.held,
    candidate.head,
    candidate.selection ?? null,
    candidate.overrides ?? null,
    candidate.authoring.prog,
    candidate.brief?.repository ?? null,
    (candidate.brief?.checks.length ?? 0) > 0,
  ]);
}

/** One candidate's verdict, from this run's memo where an equal candidate was judged already. */
function configurationFollowingCandidateVerdict(
  state: ConfigurationFollowingState,
  binding: ConfigurationFollowingBinding,
  candidate: ConfigurationFollowingCandidate,
): ConfigurationFollowingVerdict {
  const key = configurationFollowingVerdictKey(candidate);
  const known = state.verdicts.get(key);
  if (known !== undefined) return known;
  const held = state.canonicals.get(candidate.held);
  const head = state.canonicals.get(candidate.head);
  if (held === undefined || head === undefined)
    throw new Error(
      "configuration following: a candidate's revision was not read",
    );
  const verdict = configurationFollowingVerdict({
    held,
    head,
    brief: candidate.brief,
    overrides: candidate.overrides,
    selection: candidate.selection,
    program: candidate.authoring.prog,
    dependencies: candidate.authoring.deps,
    repository: binding.repository,
  });
  state.verdicts.set(key, verdict);
  return verdict;
}

/** Offers one move, answering what became of the ticket; a door that raised fails the ticket alone. */
async function configurationFollowingMove(
  state: ConfigurationFollowingState,
  binding: ConfigurationFollowingBinding,
  candidate: ConfigurationFollowingCandidate,
  program: ReleaseAuthoringProgram,
): Promise<ConfigurationFollowed> {
  state.moves += 1;
  try {
    const moved = await state.port.move({
      partition: binding.partition,
      ticket: candidate.ticket,
      expectedRevision: candidate.revision,
      configuration: candidate.head,
      program,
    });
    return moved.moved === "Accepted"
      ? { followed: "Moved", operation: moved.operation }
      : { followed: "Refused", answer: moved.answer };
  } catch {
    return { followed: "Failed" };
  }
}

/** One candidate judged and, where it moves, moved; the stop the run reached where it reached one first. */
async function configurationFollowingCandidate(
  state: ConfigurationFollowingState,
  binding: ConfigurationFollowingBinding,
  candidate: ConfigurationFollowingCandidate,
): Promise<ConfigurationFollowingStop | undefined> {
  let verdict: ConfigurationFollowingVerdict;
  try {
    verdict = configurationFollowingCandidateVerdict(state, binding, candidate);
  } catch {
    state.reported.push({
      binding,
      ticket: candidate.ticket,
      head: candidate.head,
      followed: { followed: "Failed" },
    });
    return undefined;
  }
  switch (verdict.verdict) {
    case "Current":
    case "Trimmed":
      return undefined;
    case "Held":
      state.reported.push({
        binding,
        ticket: candidate.ticket,
        head: candidate.head,
        followed: { followed: "Held", fault: verdict.fault },
      });
      return undefined;
    case "Moves": {
      const stopped = configurationFollowingStopped(state, "Move");
      if (stopped !== undefined) return stopped;
      state.reported.push({
        binding,
        ticket: candidate.ticket,
        head: candidate.head,
        followed: await configurationFollowingMove(
          state,
          binding,
          candidate,
          verdict.program,
        ),
      });
      return undefined;
    }
    default:
      return assertNever(verdict);
  }
}

/** One page of a binding's candidates, or the binding's failure where the read raised. */
async function configurationFollowingPage(
  state: ConfigurationFollowingState,
  binding: ConfigurationFollowingBinding,
  after: number,
): Promise<ConfigurationFollowingCandidates | undefined> {
  try {
    const page = await state.port.candidates({
      binding,
      after,
      max: Math.min(
        configurationFollowingPageTicketsMax,
        configurationFollowingTicketsReadMax - state.ticketsRead,
      ),
    });
    for (const [revision, canonical] of page.canonicals)
      state.canonicals.set(revision, canonical);
    return page;
  } catch {
    state.reported.push({ binding, followed: { followed: "Failed" } });
    return undefined;
  }
}

/** Every candidate of one binding, page by page; the stop the run reached where it reached one. */
async function configurationFollowingBinding(
  state: ConfigurationFollowingState,
  binding: ConfigurationFollowingBinding,
): Promise<ConfigurationFollowingStop | undefined> {
  let after = 0;
  for (;;) {
    const stopped = configurationFollowingStopped(state, "Candidates");
    if (stopped !== undefined) return stopped;
    const page = await configurationFollowingPage(state, binding, after);
    if (page === undefined) return undefined;
    state.ticketsRead += page.candidates.length;
    for (const candidate of page.candidates) {
      if (candidate.ticket <= after)
        throw new Error(
          "configuration following: candidates came out of order",
        );
      after = candidate.ticket;
      const reached = await configurationFollowingCandidate(
        state,
        binding,
        candidate,
      );
      if (reached !== undefined) return reached;
    }
    if (page.candidates.length < configurationFollowingPageTicketsMax)
      return undefined;
  }
}

/**
 * Sweeps each binding in turn, stopping where the run reaches its deadline,
 * its read bound or its move bound. `now` and `deadlineAtMs` are one clock's.
 */
export async function followConfigurations(input: {
  readonly bindings: readonly ConfigurationFollowingBinding[];
  readonly port: ConfigurationFollowingPort;
  readonly now: () => number;
  readonly deadlineAtMs: number;
}): Promise<ConfigurationFollowingRun> {
  const state: ConfigurationFollowingState = {
    port: input.port,
    now: input.now,
    deadlineAtMs: input.deadlineAtMs,
    reported: [],
    verdicts: new Map(),
    canonicals: new Map(),
    ticketsRead: 0,
    moves: 0,
  };
  for (const binding of input.bindings) {
    const stopped = await configurationFollowingBinding(state, binding);
    if (stopped !== undefined) return { reported: state.reported, stopped };
  }
  return { reported: state.reported };
}

/** One reported ticket's words. */
function configurationFollowedWords(followed: ConfigurationFollowed): string {
  switch (followed.followed) {
    case "Moved":
      return `moved as operation ${followed.operation}`;
    case "Held":
      return `held: ${followed.fault}`;
    case "Refused":
      return `refused: ${followed.answer}`;
    case "Failed":
      return "failed";
    default:
      return assertNever(followed);
  }
}

/** What a run reports: a line per ticket it moved, held, was refused or failed on, then where it stopped short. */
export function configurationFollowingReport(
  run: ConfigurationFollowingRun,
): readonly { readonly line: string; readonly failed: boolean }[] {
  return [
    ...run.reported.map((reported) => {
      const where = `${reported.binding.partition.tenant}/${reported.binding.partition.project} ${reported.binding.repository}`;
      const what =
        reported.ticket === undefined
          ? "following"
          : `ticket ${String(reported.ticket)} following ${String(reported.head)}`;
      return {
        line: `${where} ${what} ${configurationFollowedWords(reported.followed)}`,
        failed: reported.followed.followed === "Failed",
      };
    }),
    ...(run.stopped === undefined
      ? []
      : [
          {
            line: `configuration following stopped short: ${run.stopped}`,
            failed: false,
          },
        ]),
  ];
}
