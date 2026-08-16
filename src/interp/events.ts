/**
 * THE INBOUND SURFACES — what the desk, the authoring surface and the world
 * report, and the translation of a report into a candidate command.
 *
 * THIS IS THE OTHER HALF OF THE PORT BOUNDARY. `ports.ts` is what a decision
 * asks of the world; this is what the world says back. The asymmetry between
 * them is the design rather than an accident: outbound is a total routing table
 * over a closed effect vocabulary, and inbound is a total translation into a
 * closed command vocabulary — with nothing in either that resembles a decision.
 *
 * THE TRANSLATORS DECIDE NOTHING, AND `commandFor` IS ONE SWITCH WITH NO
 * CONDITIONALS IN ITS ARMS. Whether a command is enabled is `cmdEnabled`'s
 * question, asked by the actor at the state the actor holds; whether the
 * resulting decision does anything is a decider's. A surface that filtered its
 * own events would be a second writer with worse information: it would be
 * deciding against a view it does not have, and the events it dropped would be
 * exactly the duplicates and stale reports the machine is built to absorb.
 *
 * ==========================================================================
 * AT-LEAST-ONCE IS THE CONTRACT, SO THE SURFACE CARRIES NO MEMORY
 * ==========================================================================
 *
 * Nothing here remembers what it has already delivered. A completion may arrive
 * twice, and a completion may arrive for a task the machine retired several
 * decisions ago; both translate into the same candidate command as a first
 * delivery would, and the machine absorbs them in two places, neither of which
 * is here:
 *
 *   - THE JOURNAL'S DEDUP BY ENABLEMENT. `commit` refuses a command the state
 *     does not enable, so a stale gate resolution for a ticket that has already
 *     landed journals nothing and emits nothing — the row never exists.
 *   - THE DECIDER'S ABSORBING ARM. Where the command IS enabled,
 *     `decideTaskDone` answers a duplicate or stale task completion with a
 *     state-identical no-op (first write wins, and task ids are unique across a
 *     ticket's whole history), and `decideCompleteDuplicate` answers a
 *     re-delivered landing confirmation the same way. Both journal a row with
 *     no transitions and no effects, so nothing reaches the world a second time.
 *
 * ==========================================================================
 * WHAT IS AN EVENT HERE, AND WHAT IS NOT
 * ==========================================================================
 *
 * Seven of the twelve commands have a surface. Four come from the desk and the
 * authoring surface — a ticket arrives, its author releases it, somebody
 * revokes it, an operator retries a parked one — and three are the world
 * reporting that something it was running has ended: a task, a gate, a landing.
 *
 * THE OTHER FIVE HAVE NO EVENT, and each for its own reason rather than by
 * oversight:
 *
 *   - `JDispatch` is the dispatcher's agency. Which ready ticket to start is a
 *     choice the machine makes first-class, not a report anyone hands it.
 *   - `JWorkReduce` and `JEvalReduce` are the actor observing its OWN memory: a
 *     task set is fully resolved, which is derived from state the actor already
 *     holds. A surface reporting it would be reporting a fact back to the thing
 *     that derived it, and would be a second place for it to be wrong.
 *   - `JDequeue` turns on whether the project's lease is free, and that is a
 *     read of another ticket's state — a global decision, and a second writer if
 *     a surface made it. The environment contributes only the `moved` draw,
 *     which `domain.ts` calls the environment's invalidated choice at
 *     `decideDequeue`; either way it is a pick INSIDE the decision rather than
 *     a report of one, and the timing is the actor's.
 *   - `JRevalFail` has no surface in this slice, said plainly rather than
 *     designed around — and it is the one of the five that plausibly owes one
 *     later. `model/domain.qnt` describes it as "the world changed under a
 *     ticket before it ever ran (static config no longer valid)", which is a
 *     report if anything in this tree is. Nothing in this tree produces one
 *     yet, and an event type with no producer is a contract nobody implements,
 *     so the omission is recorded here rather than filled with a guess.
 */

import { assertNever } from "../domain/assert.ts";
import type { Config } from "../domain/domain.ts";
import type {
  Stage,
  Verdict,
  WrapUp,
  WrapUpOutcome,
} from "../domain/measure.ts";
import { commit, type DurableState } from "../spine/actor.ts";
import type { Cmd } from "../spine/cmd.ts";
import type { JournalStore } from "../spine/journal-store.ts";

/**
 * WHAT AN OUTSIDE SURFACE REPORTS. One constructor per report, payload exactly
 * what the reporter knows.
 *
 * The names are the reporter's vocabulary, not the machine's: a fabric knows it
 * ran a task and the task ended, it does not know the word `JTaskDone`. That is
 * the whole reason the translation below exists — the two vocabularies are
 * allowed to differ, and the one place they meet is a switch.
 */
export type ExternalEvent =
  /** The authoring surface: somebody has authored a ticket. */
  | {
      readonly tag: "TicketAuthored";
      readonly deps: ReadonlySet<number>;
      readonly program: readonly Stage[];
      readonly project: number;
      readonly wrapUp: WrapUp;
    }
  /** The authoring surface: the author has released a draft. */
  | { readonly tag: "TicketReleased"; readonly ticket: number }
  /** The desk or the authoring surface: somebody has withdrawn a ticket. */
  | { readonly tag: "TicketRevoked"; readonly ticket: number }
  /** The desk: an operator has retried a parked ticket. */
  | { readonly tag: "OperatorRetried"; readonly ticket: number }
  /** The fabric: a run it started has ended, with a verdict. */
  | {
      readonly tag: "TaskEnded";
      readonly ticket: number;
      readonly task: number;
      readonly verdict: Verdict;
    }
  /** The landing surface: a wrap-up step has finished, with an outcome. */
  | {
      readonly tag: "GateResolved";
      readonly ticket: number;
      readonly outcome: WrapUpOutcome;
    }
  /** The landing surface: a ticket's diff is landed. */
  | { readonly tag: "LandingConfirmed"; readonly ticket: number };

/**
 * The CANDIDATE command an event asks for — a translation and nothing else.
 *
 * "Candidate" is the load-bearing word. This says what the reporter is asking
 * the machine to consider; whether the machine will consider it is
 * `cmdEnabled`'s answer at the state the actor holds, and whether considering
 * it changes anything is the decider's. Nothing here is allowed to anticipate
 * either.
 *
 * `JCompleteDuplicate` is what a landing confirmation translates to, and the
 * name is the model's rather than this file's: the machine has one command for
 * "a landing I already performed has been confirmed again", because the only
 * confirmation the world can send is one the machine has already recorded — the
 * decision that landed the ticket is what asked for the landing in the first
 * place.
 */
export function commandFor(event: ExternalEvent): Cmd {
  switch (event.tag) {
    case "TicketAuthored":
      return {
        tag: "JArrive",
        deps: event.deps,
        program: event.program,
        project: event.project,
        wrapUp: event.wrapUp,
      };
    case "TicketReleased":
      return { tag: "JRelease", ticket: event.ticket };
    case "TicketRevoked":
      return { tag: "JRevoke", ticket: event.ticket };
    case "OperatorRetried":
      return { tag: "JOpRetry", ticket: event.ticket };
    case "TaskEnded":
      return {
        tag: "JTaskDone",
        ticket: event.ticket,
        tid: event.task,
        verdict: event.verdict,
      };
    case "GateResolved":
      return { tag: "JGateResolve", ticket: event.ticket, out: event.outcome };
    case "LandingConfirmed":
      return { tag: "JCompleteDuplicate", ticket: event.ticket };
    default:
      return assertNever(event, "unhandled external event");
  }
}

/**
 * Hand an event to the single writer, and get back the state it wrote — or
 * `undefined` if the machine would not have it.
 *
 * A REFUSAL IS THE DESIGN, NOT AN ERROR. A stale report for a ticket that has
 * moved on is refused here, nothing is journaled, and nothing reaches the
 * world; that is the journal's dedup by enablement, and it is the first of the
 * two absorbers the header names. Answering rather than throwing is `actor.ts`'s
 * rule for every action it ships and it is the same rule: a refused decision is
 * a verdict.
 *
 * IT ADDS NOTHING TO `commit`. Translate, then hand over. It exists so that the
 * two halves are never spelled apart at a call site, which is how a surface
 * eventually grows a conditional between them.
 */
export function submitEvent(
  cfg: Config,
  store: JournalStore,
  s: DurableState,
  event: ExternalEvent,
): DurableState | undefined {
  return commit(cfg, store, s, commandFor(event));
}
