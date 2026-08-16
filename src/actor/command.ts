/**
 * The decision event: which decider, at which named picks — the vocabulary
 * `model/refinement.qnt` declares as `Cmd`, with its total dispatch onto the
 * domain's pure deciders (`execCmd`) and its enablement over an explicit
 * `Core` (`cmdEnabled`).
 *
 * `execCmd` IS BOTH THE ACTOR'S DECIDE STEP AND THE REPLAY STEP, which is what
 * keeps the two from drifting: the deciders are pure, so `(Core, picks)`
 * determines everything, and the picks are the only information a crash could
 * lose. `cmdEnabled` re-states each domain action's guard as a conjunction of
 * references — the enablement predicates in `src/domain/enablement.ts`, never
 * a copied expression — and its set-membership conjuncts come first so a
 * command naming a ticket the state does not hold is refused cleanly rather
 * than crashed on. The deciders assume their guards; only `cmdEnabled` is
 * total.
 *
 * The model carries `JArrive`'s deps as a set; here the payload is the array
 * the domain's `decideArrive` takes, and membership in `dependableIn` is the
 * whole of the model's `subseteq` conjunct.
 */

import { assertNever } from "../domain/assertNever.ts";
import {
  isValidProgram,
  projects,
  wrapUpChoices,
  type Config,
} from "../domain/config.ts";
import type { Core, Decision } from "../domain/core.ts";
import {
  decideArrive,
  decideCompleteDuplicate,
  decideDequeue,
  decideDispatch,
  decideEvalStageReduce,
  decideOpRetry,
  decideRelease,
  decideRevalFail,
  decideRevoke,
  decideTaskDone,
  decideWorkReduce,
  decideWrapUpResolve,
} from "../domain/deciders.ts";
import {
  canArriveIn,
  deliverableTaskIds,
  dependableIn,
  dispatchableIn,
  doneIn,
  draftsIn,
  holdingIn,
  readiesIn,
  reducibleEvalIn,
  reducibleWorkIn,
  retryablesIn,
  revocablesIn,
  taskPhaseIn,
  wrapUpOutcomes,
  wrapUpStartablesIn,
} from "../domain/enablement.ts";
import type { ProjectId, TaskId, TicketId } from "../domain/ids.ts";
import type { Stage } from "../domain/program.ts";
import type { Verdict } from "../domain/task.ts";
import {
  wrapUpEquals,
  type WrapUp,
  type WrapUpOutcome,
} from "../domain/wrapUp.ts";

/** One decision event per domain action, payload exactly the action's draws. */
export type Cmd =
  | {
      readonly cmd: "JArrive";
      readonly deps: readonly TicketId[];
      readonly program: readonly Stage[];
      readonly project: ProjectId;
      readonly wrapUp: WrapUp;
    }
  | { readonly cmd: "JRelease"; readonly ticket: TicketId }
  | { readonly cmd: "JRevoke"; readonly ticket: TicketId }
  | { readonly cmd: "JDispatch"; readonly ticket: TicketId }
  | {
      readonly cmd: "JTaskDone";
      readonly ticket: TicketId;
      readonly taskId: TaskId;
      readonly verdict: Verdict;
    }
  | { readonly cmd: "JWorkReduce"; readonly ticket: TicketId }
  | { readonly cmd: "JEvalReduce"; readonly ticket: TicketId }
  | {
      readonly cmd: "JDequeue";
      readonly ticket: TicketId;
      readonly moved: boolean;
    }
  | {
      readonly cmd: "JGateResolve";
      readonly ticket: TicketId;
      readonly outcome: WrapUpOutcome;
    }
  | { readonly cmd: "JCompleteDuplicate"; readonly ticket: TicketId }
  | { readonly cmd: "JRevalFail"; readonly ticket: TicketId }
  | { readonly cmd: "JOpRetry"; readonly ticket: TicketId };

/**
 * Every constructor tag, in the order the model's `Cmd` declares them. It
 * exists so a suite can hold this vocabulary against the model's rather than
 * restate it.
 */
export const cmdTags: readonly Cmd["cmd"][] = [
  "JArrive",
  "JRelease",
  "JRevoke",
  "JDispatch",
  "JTaskDone",
  "JWorkReduce",
  "JEvalReduce",
  "JDequeue",
  "JGateResolve",
  "JCompleteDuplicate",
  "JRevalFail",
  "JOpRetry",
];

/** An arrival at the given draws. */
export function jArrive(
  deps: readonly TicketId[],
  program: readonly Stage[],
  project: ProjectId,
  wrapUp: WrapUp,
): Cmd {
  return { cmd: "JArrive", deps, program, project, wrapUp };
}

export function jRelease(ticket: TicketId): Cmd {
  return { cmd: "JRelease", ticket };
}

export function jRevoke(ticket: TicketId): Cmd {
  return { cmd: "JRevoke", ticket };
}

export function jDispatch(ticket: TicketId): Cmd {
  return { cmd: "JDispatch", ticket };
}

/** A task-completion delivery, duplicate or not: the domain absorbs, the journal records. */
export function jTaskDone(
  ticket: TicketId,
  taskId: TaskId,
  verdict: Verdict,
): Cmd {
  return { cmd: "JTaskDone", ticket, taskId, verdict };
}

export function jWorkReduce(ticket: TicketId): Cmd {
  return { cmd: "JWorkReduce", ticket };
}

export function jEvalReduce(ticket: TicketId): Cmd {
  return { cmd: "JEvalReduce", ticket };
}

/** The wrap-up dequeue at the environment's invalidation choice. */
export function jDequeue(ticket: TicketId, moved: boolean): Cmd {
  return { cmd: "JDequeue", ticket, moved };
}

/** The gated resolution at the environment's drawn outcome. */
export function jGateResolve(ticket: TicketId, outcome: WrapUpOutcome): Cmd {
  return { cmd: "JGateResolve", ticket, outcome };
}

export function jCompleteDuplicate(ticket: TicketId): Cmd {
  return { cmd: "JCompleteDuplicate", ticket };
}

export function jRevalFail(ticket: TicketId): Cmd {
  return { cmd: "JRevalFail", ticket };
}

export function jOpRetry(ticket: TicketId): Cmd {
  return { cmd: "JOpRetry", ticket };
}

/** Total dispatch onto the domain's pure deciders: the decide step and the replay step, one function. */
export function execCmd(config: Config, core: Core, cmd: Cmd): Decision {
  switch (cmd.cmd) {
    case "JArrive":
      return decideArrive(
        config,
        core,
        cmd.deps,
        cmd.program,
        cmd.project,
        cmd.wrapUp,
      );
    case "JRelease":
      return decideRelease(core, cmd.ticket);
    case "JRevoke":
      return decideRevoke(core, cmd.ticket);
    case "JDispatch":
      return decideDispatch(config, core, cmd.ticket);
    case "JTaskDone":
      return decideTaskDone(core, cmd.ticket, cmd.taskId, cmd.verdict);
    case "JWorkReduce":
      return decideWorkReduce(core, cmd.ticket);
    case "JEvalReduce":
      return decideEvalStageReduce(config, core, cmd.ticket);
    case "JDequeue":
      return decideDequeue(config, core, cmd.ticket, cmd.moved);
    case "JGateResolve":
      return decideWrapUpResolve(config, core, cmd.ticket, cmd.outcome, true);
    case "JCompleteDuplicate":
      return decideCompleteDuplicate(core, cmd.ticket);
    case "JRevalFail":
      return decideRevalFail(core, cmd.ticket);
    case "JOpRetry":
      return decideOpRetry(config, core, cmd.ticket);
    default:
      return assertNever(cmd);
  }
}

/**
 * The decision's enablement at an explicit `Core`: per constructor, the domain
 * action's guard plus draw-set membership, each conjunct a reference to the
 * predicate the domain action reads.
 */
export function cmdEnabled(config: Config, core: Core, cmd: Cmd): boolean {
  switch (cmd.cmd) {
    case "JArrive":
      return (
        canArriveIn(config, core) &&
        cmd.deps.every((dep) => dependableIn(core).includes(dep)) &&
        isValidProgram(config, cmd.program) &&
        projects(config).includes(cmd.project) &&
        wrapUpChoices(config).some((choice) => wrapUpEquals(choice, cmd.wrapUp))
      );
    case "JRelease":
      return draftsIn(core).includes(cmd.ticket);
    case "JRevoke":
      return revocablesIn(core).includes(cmd.ticket);
    case "JDispatch":
      return (
        readiesIn(core).includes(cmd.ticket) && dispatchableIn(core, cmd.ticket)
      );
    case "JTaskDone":
      return (
        taskPhaseIn(core).includes(cmd.ticket) &&
        deliverableTaskIds(core, cmd.ticket).includes(cmd.taskId)
      );
    case "JWorkReduce":
      return reducibleWorkIn(core).includes(cmd.ticket);
    case "JEvalReduce":
      return reducibleEvalIn(core).includes(cmd.ticket);
    case "JDequeue":
      return wrapUpStartablesIn(core).includes(cmd.ticket);
    case "JGateResolve":
      return (
        holdingIn(core).includes(cmd.ticket) &&
        wrapUpOutcomes(true).includes(cmd.outcome)
      );
    case "JCompleteDuplicate":
      return doneIn(core).includes(cmd.ticket);
    case "JRevalFail":
      return readiesIn(core).includes(cmd.ticket);
    case "JOpRetry":
      return retryablesIn(config, core).includes(cmd.ticket);
    default:
      return assertNever(cmd);
  }
}
