/**
 * `model/refinement.qnt`'s DECISION-EVENT VOCABULARY in TypeScript: the `Cmd`
 * type, `execCmd` — the total dispatch onto the shipped deciders — and
 * `cmdEnabled`, the same enablement re-stated over an explicit `Core`.
 *
 * WHY IT IS HERE AND NOT IN `src/domain/`. `domain.ts`'s header says where the
 * model's state-and-actions section goes: "its TypeScript home is the spine,
 * s3". A `Cmd` is exactly that section's content — a domain action's guard and
 * its nondet draws, reified. Quint expresses the draws as `nondet` binders
 * inside the action, so the model needs no data type for them until the
 * refinement layer wants to journal one; TypeScript has no `nondet`, so the
 * draws must be data before anything can replay them at all. That is why the
 * model's home for this type is `chuggy_refinement` and this file's home is the
 * layer above the domain rather than inside it.
 *
 * WHAT IT MUST NOT BECOME. This is the vocabulary the golden corpus decodes
 * into and the journal stores; it carries no journal, no cursor, no crash and
 * no fabric, exactly as `model/refinement.qnt`'s platform-capture note requires
 * of anything the domain machine can be driven by. `Entry` — seq, cmd, rec —
 * is `entry.ts`'s, beside the actor that appends one.
 *
 * THE ENCODING, beyond the seven decisions `measure.ts` and `domain.ts` argue
 * and this file inherits:
 *
 *  12. A CONSTRUCTOR WITH A BARE PAYLOAD BECOMES A TAGGED RECORD WITH A NAMED
 *      FIELD. The model writes `JRelease(int)`; the int is a ticket id, so the
 *      field is `ticket`. Where the model already names the payload's fields
 *      (`JTaskDone`, `JDequeue`, `JGateResolve`, `JArrive`) the names are its
 *      own, with one expansion: `prog` becomes `program`, which is what
 *      `decideArrive` already calls the same argument.
 *
 * THE GUARDS ARE REFERENCED, NEVER COPIED. Every conjunct of `cmdEnabled` is a
 * call to the definition the model's own arm names — the m6 audit rule, which
 * the model states at `cmdEnabled` itself ("nothing here is a copied
 * expression"). Two of them reach the shipped membership predicate rather than
 * the universe: `validPrograms.contains` is `isValidProgram` and
 * `wrapUpChoices.contains` is `isAuthorableWrapUp`, because those are the
 * questions `domain.ts` ships for asking membership of a set of records, and
 * asking any other way would be the restatement it forbids.
 */

import { assertNever, invariant } from "../domain/assert.ts";
import {
  canArriveIn,
  deliverableTaskIds,
  dependableIn,
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
  dispatchableIn,
  doneIn,
  draftsIn,
  holdingIn,
  isAuthorableWrapUp,
  isSubsetOf,
  isValidProgram,
  projects,
  readiesIn,
  reducibleEvalIn,
  reducibleWorkIn,
  retryablesIn,
  revocablesIn,
  taskPhaseIn,
  wrapUpOutcomes,
  wrapUpStartablesIn,
  type Config,
} from "../domain/domain.ts";
import type {
  Core,
  Decision,
  Stage,
  Verdict,
  WrapUp,
  WrapUpOutcome,
} from "../domain/measure.ts";

/**
 * `model/refinement.qnt` Cmd — THE DECISION EVENT: which decider, at which
 * named picks. One constructor per domain action, payload exactly that action's
 * nondet draws.
 *
 * `settle` has no constructor, by the model's own design: it is simulator
 * plumbing rather than a decision, and `refinement.qnt` journals no counterpart
 * to it. Its replay treatment is `replay.ts`'s.
 */
export type Cmd =
  | {
      readonly tag: "JArrive";
      readonly deps: ReadonlySet<number>;
      readonly program: readonly Stage[];
      readonly project: number;
      readonly wrapUp: WrapUp;
    }
  | { readonly tag: "JRelease"; readonly ticket: number }
  | { readonly tag: "JRevoke"; readonly ticket: number }
  | { readonly tag: "JDispatch"; readonly ticket: number }
  | {
      readonly tag: "JTaskDone";
      readonly ticket: number;
      readonly tid: number;
      readonly verdict: Verdict;
    }
  | { readonly tag: "JWorkReduce"; readonly ticket: number }
  | { readonly tag: "JEvalReduce"; readonly ticket: number }
  | {
      readonly tag: "JDequeue";
      readonly ticket: number;
      readonly moved: boolean;
    }
  | {
      readonly tag: "JGateResolve";
      readonly ticket: number;
      readonly out: WrapUpOutcome;
    }
  | { readonly tag: "JCompleteDuplicate"; readonly ticket: number }
  | { readonly tag: "JRevalFail"; readonly ticket: number }
  | { readonly tag: "JOpRetry"; readonly ticket: number };

/** Every `Cmd` constructor's tag, so a roster can be taken over the whole type. */
export type CmdTag = Cmd["tag"];

/**
 * `model/refinement.qnt` execCmd — the total dispatch onto the shipped
 * deciders, and THE replay step.
 *
 * THE `JDequeue` ARM ROUTES THROUGH `decideDequeue`, which is what makes the
 * dispatch total onto thirteen deciders from twelve constructors: the routing
 * rule — moved to the gate, quiet straight to the wrap-up's resolution — is
 * machine semantics the model hoists into a decider of its own, and its header
 * records the mutant that made the hoist necessary. Naming either route here
 * instead would be that copied route.
 *
 * IT TAKES THE CONFIG THE MODEL TAKES AS MODULE CONSTS. Quint instantiates
 * `chuggy_domain` per const assignment and `execCmd` reads the instance's
 * deciders; TypeScript has no instances, so the config travels as
 * `domain.ts`'s explicit `Config` — encoding decision 5, one level further out.
 */
export function execCmd(cfg: Config, c: Core, cmd: Cmd): Decision {
  switch (cmd.tag) {
    case "JArrive":
      return decideArrive(
        cfg,
        c,
        cmd.deps,
        cmd.program,
        cmd.project,
        cmd.wrapUp,
      );
    case "JRelease":
      return decideRelease(c, cmd.ticket);
    case "JRevoke":
      return decideRevoke(c, cmd.ticket);
    case "JDispatch":
      return decideDispatch(cfg, c, cmd.ticket);
    case "JTaskDone":
      return decideTaskDone(c, cmd.ticket, cmd.tid, cmd.verdict);
    case "JWorkReduce":
      return decideWorkReduce(c, cmd.ticket);
    case "JEvalReduce":
      return decideEvalStageReduce(cfg, c, cmd.ticket);
    case "JDequeue":
      return decideDequeue(cfg, c, cmd.ticket, cmd.moved);
    case "JGateResolve":
      return decideWrapUpResolve(cfg, c, cmd.ticket, cmd.out, true);
    case "JCompleteDuplicate":
      return decideCompleteDuplicate(c, cmd.ticket);
    case "JRevalFail":
      return decideRevalFail(c, cmd.ticket);
    case "JOpRetry":
      return decideOpRetry(cfg, c, cmd.ticket);
    default:
      return assertNever(cmd, "unhandled Cmd");
  }
}

/**
 * `model/refinement.qnt` cmdEnabled — the decision's enablement at an explicit
 * `Core`: per constructor, exactly the domain action's guard plus its draw-set
 * memberships.
 *
 * IT IS TOTAL, AND THE CONJUNCT ORDER IS WHAT MAKES IT SO. `ticketAt` asserts
 * on an id the fleet does not hold, so every arm that reads a ticket sits
 * behind a membership test that fails first for an absent id: `JDispatch` asks
 * `readiesIn` before `dispatchableIn`, `JTaskDone` asks `taskPhaseIn` before
 * `deliverableTaskIds`, and both are the model's own order. That totality is
 * load-bearing rather than incidental — `journalLegalOn` checks enablement
 * BEFORE running the decider precisely so that a tampered journal is REFUSED
 * rather than crashed on, and the replayer answers the same way.
 *
 * THE `JOpRetry` ARM STATES `retryablesIn`, WHICH IS STRICTLY MORE THAN THE
 * SHIPPED DECIDER'S GUARD. `decideOpRetry` asserts `retryableIn` minus the
 * no-modeled-resume arm, because the model answers that case with a guarded
 * no-op it reproduces; enablement is the machine's question and the machine
 * draws from `retryableEscalated`. Reading the guard off the decider would
 * admit a decision the machine cannot take.
 */
export function cmdEnabled(cfg: Config, c: Core, cmd: Cmd): boolean {
  switch (cmd.tag) {
    case "JArrive":
      return (
        canArriveIn(cfg, c) &&
        isSubsetOf(cmd.deps, dependableIn(c)) &&
        isValidProgram(cfg, cmd.program) &&
        projects(cfg).has(cmd.project) &&
        isAuthorableWrapUp(cfg, cmd.wrapUp)
      );
    case "JRelease":
      return draftsIn(c).has(cmd.ticket);
    case "JRevoke":
      return revocablesIn(c).has(cmd.ticket);
    case "JDispatch":
      return readiesIn(c).has(cmd.ticket) && dispatchableIn(c, cmd.ticket);
    case "JTaskDone":
      return (
        taskPhaseIn(c).has(cmd.ticket) &&
        deliverableTaskIds(c, cmd.ticket).has(cmd.tid)
      );
    case "JWorkReduce":
      return reducibleWorkIn(c).has(cmd.ticket);
    case "JEvalReduce":
      return reducibleEvalIn(c).has(cmd.ticket);
    case "JDequeue":
      return wrapUpStartablesIn(c).has(cmd.ticket);
    case "JGateResolve":
      return holdingIn(c).has(cmd.ticket) && wrapUpOutcomes(true).has(cmd.out);
    case "JCompleteDuplicate":
      return doneIn(c).has(cmd.ticket);
    case "JRevalFail":
      return readiesIn(c).has(cmd.ticket);
    case "JOpRetry":
      return retryablesIn(cfg, c).has(cmd.ticket);
    default:
      return assertNever(cmd, "unhandled Cmd");
  }
}

/**
 * Every decider `execCmd` reaches for this command.
 *
 * A PROJECTION OF THE DISPATCH ABOVE, and the only place in SHIPPED code that
 * names a decider as data — the qualifier matters, because two suites and a
 * gate name them too, and a claim a `grep` refutes is a claim a reader stops
 * believing. `src/tools/verify.ts` holds `shippedDeciders` against the model's
 * own `pure def decide*`, and `cmd.test.ts` pins this table tag by tag; both
 * are checking layers, which is the class this exclusivity is stated against.
 * What the claim is FOR is that nothing else in the machine dispatches on a
 * decider's name, so a decider renamed is a rename here and nowhere else. It exists for one obligation — the golden corpus must
 * cover every shipped decider, and a corpus step names a `Cmd` rather than the
 * function it called — so what it must get right is exactly what `execCmd`
 * does, including that `JDequeue` reaches `decideDequeue` AND the route that
 * decider picks. The arms are therefore listed beside `execCmd`'s, and the
 * suite pins the pair together: every tag answers a non-empty roster, and the
 * union over the whole `Cmd` type is the shipped roster exactly.
 */
export function decidersReached(cmd: Cmd): readonly string[] {
  switch (cmd.tag) {
    case "JArrive":
      return ["decideArrive"];
    case "JRelease":
      return ["decideRelease"];
    case "JRevoke":
      return ["decideRevoke"];
    case "JDispatch":
      return ["decideDispatch"];
    case "JTaskDone":
      return ["decideTaskDone"];
    case "JWorkReduce":
      return ["decideWorkReduce"];
    case "JEvalReduce":
      return ["decideEvalStageReduce"];
    case "JDequeue":
      return cmd.moved
        ? ["decideDequeue", "decideWrapUpStart"]
        : ["decideDequeue", "decideWrapUpResolve"];
    case "JGateResolve":
      return ["decideWrapUpResolve"];
    case "JCompleteDuplicate":
      return ["decideCompleteDuplicate"];
    case "JRevalFail":
      return ["decideRevalFail"];
    case "JOpRetry":
      return ["decideOpRetry"];
    default:
      return assertNever(cmd, "unhandled Cmd");
  }
}

/**
 * The thirteen deciders `model/domain.qnt` ships, as the roster the corpus owes
 * a step each. Read off the model's `pure def decide` definitions, in the order
 * that file defines them.
 */
export const shippedDeciders: readonly string[] = [
  "decideArrive",
  "decideRelease",
  "decideRevoke",
  "decideDispatch",
  "decideTaskDone",
  "decideWorkReduce",
  "decideEvalStageReduce",
  "decideWrapUpStart",
  "decideDequeue",
  "decideWrapUpResolve",
  "decideCompleteDuplicate",
  "decideRevalFail",
  "decideOpRetry",
];

/**
 * The absorbing pick class for a duplicate task completion at this state: every
 * ticket that can receive a completion event, every task id it has ever issued
 * that is NOT live and running, both verdicts.
 *
 * THIS IS THE REPLAY TREATMENT FOR A STUTTER STEP, and it is stronger than
 * replaying the one pick the trace lost. A `task-done-duplicate` step records
 * no transition and moves no state, so no pair of trace states carries the pick
 * that produced it; what the step DOES claim is that the decision absorbed, and
 * that claim is checkable against every pick that could have produced this
 * label from this state rather than against one guess. Bounded by the fleet
 * times the ticket's own id history times the verdict pair.
 *
 * A pick is in the class exactly when `decideTaskDone` finds no live running
 * task under that id — which is the condition the decider itself branches on,
 * asked here through the same live task set it reads.
 */
export function taskDoneAbsorbingClass(c: Core): readonly Cmd[] {
  const picks: Cmd[] = [];
  for (const ticket of taskPhaseIn(c)) {
    const jb = c.tickets.get(ticket);
    invariant(
      jb !== undefined,
      `taskDoneAbsorbingClass: ticket ${String(ticket)} left the fleet mid-walk`,
    );
    for (const tid of deliverableTaskIds(c, ticket)) {
      if (jb.tasks.some((t) => t.id === tid && t.state.tag === "TSRunning")) {
        continue;
      }
      picks.push({ tag: "JTaskDone", ticket, tid, verdict: "VPass" });
      picks.push({ tag: "JTaskDone", ticket, tid, verdict: "VFail" });
    }
  }
  return picks;
}

/**
 * The absorbing pick class for a duplicate completion delivery: every Done
 * ticket. `taskDoneAbsorbingClass`'s argument, for the other stutter label —
 * and here the class is the decider's whole enablement set, since every landed
 * ticket absorbs a re-delivered completion.
 */
export function completeDuplicateAbsorbingClass(c: Core): readonly Cmd[] {
  const picks: Cmd[] = [];
  for (const ticket of doneIn(c)) {
    picks.push({ tag: "JCompleteDuplicate", ticket });
  }
  return picks;
}
