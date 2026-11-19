/**
 * What a member's own runners are drawn as, derived: how a runner is told from
 * another, what it is running and how many wait in a project it serves,
 * whether one more may be registered, the projects they may be given, what the
 * server says a run of the reader's waits on of them and the pause holding
 * them, and what taking a member's runners off came to.
 *
 * WHETHER A RUN IS THE READER'S IS THE SERVER'S ANSWER. Nothing here decodes a
 * token, so a run says it is theirs by `mine`, and one whose read predates the
 * field is nobody's.
 */

import { personalRunnersMax } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  AgentPause,
  ExecutionSummary,
  PersonalRunnerResponse,
  TaskIdentity,
} from "../../../../src/contract/responses.ts";
import { personalRunnerPriorities } from "../../../../src/contract/rosters.ts";
import type {
  PersonalRunnerPriority,
  PersonalRunnerWait,
} from "../../../../src/contract/rosters.ts";
import type { ApiResult } from "./apiRequest.ts";
import type { Copy, CopyOrData } from "./copy.ts";
import { failureWords } from "./failureWords.ts";
import { memoryMibFigure, quantityFigureCopy } from "./figures.ts";
import { executionStarting } from "./ticketLedger.ts";

/** What a member is told where the workspace has not let them register one. */
export const myRunnerWithheld: Copy = { id: "runners-personal-withheld" };

/** What a project's priority among the reader's runners' others is called. */
export function myRunnerPriorityLabel(priority: PersonalRunnerPriority): Copy {
  switch (priority) {
    case "High":
      return { id: "runners-personal-project-priority-high" };
    case "Normal":
      return { id: "runners-personal-project-priority-normal" };
    case "Low":
      return { id: "runners-personal-project-priority-low" };
  }
}

/** What an attempt a runner holds runs: its cycle's work, or a stage of its evaluation. */
export function myRunnerHeldLabel(identity: TaskIdentity): Copy {
  switch (identity.type) {
    case "WorkTask":
      return {
        id: "runners-personal-running-work",
        args: { cycle: identity.value.cycle },
      };
    case "EvaluationTask":
      return {
        id: "runners-personal-running-evaluation",
        args: {
          stage: identity.value.stage,
          cycle: identity.value.workCycle,
        },
      };
  }
}

/** How many attempts wait in a project, marked where more wait than the read counted. */
export function myRunnerWaitingLabel(
  served: PersonalRunnerResponse["projects"][number],
): CopyOrData {
  return served.waitingTruncated
    ? {
        id: "runners-personal-project-waiting-more",
        args: { count: served.waiting },
      }
    : String(served.waiting);
}

/** The priority a menu answered, where it is one this wire knows. */
export function myRunnerPriorityChosen(
  value: string,
): PersonalRunnerPriority | undefined {
  return personalRunnerPriorities.find((each) => each === value);
}

/** The start of a runner's id where it ends in a UUID, which tells it from another of the reader's, and the whole id where it does not. */
export function myRunnerShort(id: string): string {
  return /([0-9a-f]{8})(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.exec(id)?.[1] ?? id;
}

/** The line a member's runners are listed under. */
export function myRunnersCountLine(count: number): Copy {
  return { id: "runners-personal-count", args: { count } };
}

/** Whether the reader holds fewer runners than a member may, none where they hold none. */
export function myRunnerRoom(
  runner: PersonalRunnerResponse | undefined,
): boolean {
  return (runner?.runners.length ?? 0) < personalRunnersMax;
}

/** What taking one of the reader's runners off does, said in its question: the last takes the projects with it. */
export function myRunnerRemovalLine(short: string, last: boolean): Copy {
  return last
    ? { id: "runners-personal-removal-last", args: { short } }
    : { id: "runners-personal-removal", args: { short } };
}

/** The tenant's projects the reader reads and their runners do not yet serve, in name order. */
export function myRunnerAddable(
  readable: readonly PartitionIdentity[],
  tenant: string,
  runner: PersonalRunnerResponse,
): readonly string[] {
  const served = new Set(runner.projects.map((each) => each.project));
  return readable
    .filter((each) => each.tenant === tenant && !served.has(each.project))
    .map((each) => each.project)
    .sort();
}

/** The projects the register panel's line may be made for: the one the page is framed in where it is, or else the tenant's the reader reads, in name order. */
export function myRunnerLineProjects(
  readable: readonly PartitionIdentity[],
  tenant: string,
  framed: string | undefined,
): readonly string[] {
  if (framed !== undefined) return [framed];
  return readable
    .filter((each) => each.tenant === tenant)
    .map((each) => each.project)
    .sort();
}

/** What a run of the reader's waits on of their runners, as the server answers it. */
export type RunnerWait = PersonalRunnerWait;

/**
 * What a run of the reader's, admitted but not begun, waits on of their own
 * runners, by the server's answer, which states the claims' terms and is
 * answered only for the reader's own run routed to runners. A queued run
 * waits on capacity rather than on a runner.
 */
export function runnerWait(
  execution: ExecutionSummary,
): RunnerWait | undefined {
  if (execution.mine !== true) return undefined;
  if (execution.status === "Queued" || !executionStarting(execution))
    return undefined;
  return execution.personalRunnerWait;
}

/** The pause the server answered holding every live runner of the reader's
 * a run waits on, said only where it waits on live ones. */
export function runnerWaitPause(
  execution: ExecutionSummary,
  wait: RunnerWait | undefined,
): AgentPause | undefined {
  return wait === "Live" ? execution.paused : undefined;
}

/** The memory the server answered the live runners of the reader's a run
 * waits on are short of, said only where it waits on live ones no pause holds. */
export function runnerWaitRoom(
  execution: ExecutionSummary,
): ExecutionSummary["personalRunnerRoom"] {
  const wait = runnerWait(execution);
  if (wait !== "Live" || runnerWaitPause(execution, wait) !== undefined)
    return undefined;
  return execution.personalRunnerRoom;
}

/**
 * What taking a member's runners off came to, in one line: taken off, none the
 * caller may take, or why it was refused. The server answers a caller it will
 * not let take them as one with none, so the line names both.
 */
export function memberRunnerRemoved(result: ApiResult<undefined>): CopyOrData {
  if (result.outcome === "Ok") return { id: "runners-member-removed" };
  if (result.outcome === "Absent") return { id: "runners-member-none" };
  return failureWords(result).word;
}

/** What a run of the reader's waits on: their personal runners. */
export const runnerWaitLine: Copy = { id: "runners-wait-waiting" };

/** How much memory the runners a run waits on have free and it needs. */
export function runnerWaitRoomLine(
  room: NonNullable<ExecutionSummary["personalRunnerRoom"]>,
): Copy {
  return {
    id: "runners-wait-room",
    args: {
      free: quantityFigureCopy(memoryMibFigure(room.freeMib)),
      needed: quantityFigureCopy(memoryMibFigure(room.neededMib)),
    },
  };
}

/** The state of the runners a run waits on, where it has one beside waiting. */
export function runnerWaitWord(wait: RunnerWait): Copy | undefined {
  switch (wait) {
    case "Live":
      return undefined;
    case "Offline":
      return { id: "runners-wait-offline" };
    case "Unable":
      return { id: "runners-wait-unable" };
  }
}
