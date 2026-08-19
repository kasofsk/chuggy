/**
 * The model's action roster and its draw sets, one entry per action of
 * `model/domain.qnt`'s `step`, in its order.
 *
 * EACH ENTRY MIRRORS ONE ACTION'S NONDET SITES AND NOTHING ELSE. `enabledIn` is
 * the action's guard and `drawIn` makes the action's own draws in the model's
 * textual order, every one a uniform pick from the set the model's `oneOf`
 * ranges over — the powerset draw is a fair coin per member, which is the same
 * distribution. `permitsIn` is membership in those same sets, which is what
 * lets a shrunk candidate be checked as a machine trace rather than replayed on
 * faith. Every set is referenced from `src/domain/enablement.ts`, never copied:
 * a copied guard drifts, and then a walk's claim to have taken a machine step
 * outlives the machine's willingness to take it.
 *
 * THE DRAWS TRAVEL AS THE CORPUS WIRES THEM. `drawnPicks` routes every pick
 * through the same ITF encoding a written counterexample carries and decodes it
 * back at the dispatch table, so the walk consumes byte-for-byte what a
 * replayed fixture will consume, and the encode and decode directions check
 * each other on every step taken.
 */

import {
  finalizationPricingChoices,
  finalizerChoices,
  isValidProgram,
  resumePricingChoices,
  reworkPolicyChoices,
  stageChoices,
  workFanoutChoices,
  type Config,
} from "../../src/domain/config.ts";
import {
  dependableIn,
  dispatchableIn,
  executionBlockedReasons,
  finalizationOutcomes,
  finalizingIn,
  outstandingTaskIdsIn,
  quietIn,
  readiesIn,
  reducibleEvalIn,
  reducibleWorkIn,
  releasableIdsIn,
  retryablesIn,
  revocablesIn,
  taskPhaseIn,
} from "../../src/domain/enablement.ts";
import type {
  Core,
  FinalizationOutcome,
  FinalizationPricing,
  Finalizer,
  Reason,
  RetryPricing,
  ReworkPolicy,
  Stage,
  Verdict,
} from "../../src/domain/generated/modelTypes.ts";
import { asTaskId, type TaskId, type TicketId } from "../../src/domain/ids.ts";
import { reworkBudget } from "../../src/domain/pricing.ts";
import type { Picks } from "../conformance/dispatch.ts";
import { decodeValue, encodeValue, type ItfValue } from "../itf/decode.ts";
import {
  encodeDeps,
  encodeInt,
  encodeNullaryTag,
  encodeProgram,
  encodeSumValue,
} from "../itf/vocabulary.ts";
import { pickFrom, subsetFrom, type Random } from "./random.ts";

/** One step's draws, in the domain's own vocabulary; absent means the action does not make that draw. */
export interface Drawn {
  readonly ticket?: TicketId;
  readonly deps?: readonly TicketId[];
  readonly program?: readonly Stage[];
  readonly workFanout?: number;
  readonly reworkPolicy?: ReworkPolicy;
  readonly finalizationPricing?: FinalizationPricing;
  readonly resumePricing?: RetryPricing;
  readonly finalizer?: Finalizer;
  readonly taskId?: TaskId;
  readonly verdict?: Verdict;
  readonly outcome?: FinalizationOutcome;
  readonly reason?: Reason;
}

/** One action of the machine, as the walk takes it. */
export interface WalkAction {
  readonly action: string;
  readonly enabledIn: (config: Config, core: Core) => boolean;
  readonly drawIn: (config: Config, core: Core, random: Random) => Drawn;
  readonly permitsIn: (config: Config, core: Core, drawn: Drawn) => boolean;
}

/** The verdict draw the completion event ranges over, as the model's `taskDone` writes it. */
const verdictDraws: readonly Verdict[] = ["Pass", "Fail"];

/**
 * Every well-formed authorable program, grown one stage at a time exactly as
 * the model folds `validPrograms`, so a pick here is a pick from that set.
 */
export function validProgramsIn(config: Config): readonly (readonly Stage[])[] {
  const stages = stageChoices(config);
  let grown: readonly (readonly Stage[])[] = [[]];
  const programs: (readonly Stage[])[] = [];
  for (let length = 1; length <= config.maxStages; length++) {
    grown = grown.flatMap((program) => stages.map((s) => [...program, s]));
    programs.push(...grown);
  }
  return programs;
}

/** The shape most actions share: one ticket, drawn from one enablement set. */
function overTicketSet(
  action: string,
  setIn: (config: Config, core: Core) => readonly TicketId[],
): WalkAction {
  return {
    action,
    enabledIn: (config, core) => setIn(config, core).length > 0,
    drawIn: (config, core, random) => ({
      ticket: pickFrom(random, setIn(config, core)),
    }),
    permitsIn: (config, core, drawn) =>
      drawn.ticket !== undefined && setIn(config, core).includes(drawn.ticket),
  };
}

/**
 * Release draws every value it freezes onto the ticket, which is what makes a
 * walk reach tickets authored differently from one another rather than a fleet
 * of identical ones.
 */
const releaseTicket: WalkAction = {
  action: "releaseTicket",
  enabledIn: (config, core) => releasableIdsIn(config, core).length > 0,
  drawIn: (config, core, random) => ({
    ticket: pickFrom(random, releasableIdsIn(config, core)),
    deps: subsetFrom(random, dependableIn(core)),
    program: pickFrom(random, validProgramsIn(config)),
    workFanout: pickFrom(random, workFanoutChoices(config)),
    reworkPolicy: pickFrom(random, reworkPolicyChoices(config)),
    finalizationPricing: pickFrom(random, finalizationPricingChoices(config)),
    resumePricing: pickFrom(random, resumePricingChoices),
    finalizer: pickFrom(random, finalizerChoices),
  }),
  permitsIn: (config, core, drawn) => {
    const {
      ticket,
      deps,
      program,
      workFanout,
      reworkPolicy,
      finalizationPricing,
      resumePricing,
      finalizer,
    } = drawn;
    if (
      ticket === undefined ||
      deps === undefined ||
      program === undefined ||
      workFanout === undefined ||
      reworkPolicy === undefined ||
      finalizationPricing === undefined ||
      resumePricing === undefined ||
      finalizer === undefined
    ) {
      return false;
    }
    return (
      releasableIdsIn(config, core).includes(ticket) &&
      deps.every((d) => dependableIn(core).includes(d)) &&
      new Set(deps).size === deps.length &&
      isValidProgram(config, program) &&
      workFanoutChoices(config).includes(workFanout) &&
      reworkBudget(reworkPolicy) <= reworkBudget(config.reworkPolicy) &&
      finalizationPricingChoices(config).some((choice) =>
        choice === "DeadlineOnly"
          ? finalizationPricing === "DeadlineOnly"
          : finalizationPricing !== "DeadlineOnly" &&
            finalizationPricing.value === choice.value,
      ) &&
      resumePricingChoices.includes(resumePricing) &&
      finalizerChoices.includes(finalizer)
    );
  },
};

const dispatch: WalkAction = {
  action: "dispatch",
  enabledIn: (_config, core) => readiesIn(core).length > 0,
  drawIn: (_config, core, random) => ({
    ticket: pickFrom(random, readiesIn(core)),
  }),
  permitsIn: (_config, core, drawn) =>
    drawn.ticket !== undefined &&
    readiesIn(core).includes(drawn.ticket) &&
    dispatchableIn(core, drawn.ticket),
};

/** Tickets with a task the fabric could still report on — the set `tid` is drawn from. */
function reportableIn(core: Core): readonly TicketId[] {
  return taskPhaseIn(core).filter(
    (j) => outstandingTaskIdsIn(core, j).length > 0,
  );
}

const taskDone: WalkAction = {
  action: "taskDone",
  enabledIn: (_config, core) => reportableIn(core).length > 0,
  drawIn: (_config, core, random) => {
    const ticket = pickFrom(random, reportableIn(core));
    return {
      ticket,
      taskId: asTaskId(pickFrom(random, outstandingTaskIdsIn(core, ticket))),
      verdict: pickFrom(random, verdictDraws),
    };
  },
  permitsIn: (_config, core, drawn) =>
    drawn.ticket !== undefined &&
    drawn.taskId !== undefined &&
    drawn.verdict !== undefined &&
    reportableIn(core).includes(drawn.ticket) &&
    outstandingTaskIdsIn(core, drawn.ticket).includes(drawn.taskId),
};

const finalizationResult: WalkAction = {
  action: "finalizationResult",
  enabledIn: (_config, core) => finalizingIn(core).length > 0,
  drawIn: (_config, core, random) => ({
    ticket: pickFrom(random, finalizingIn(core)),
    outcome: pickFrom(random, finalizationOutcomes),
  }),
  permitsIn: (_config, core, drawn) =>
    drawn.ticket !== undefined &&
    drawn.outcome !== undefined &&
    finalizingIn(core).includes(drawn.ticket) &&
    finalizationOutcomes.includes(drawn.outcome),
};

const executionBlocked: WalkAction = {
  action: "executionBlocked",
  enabledIn: (_config, core) => taskPhaseIn(core).length > 0,
  drawIn: (_config, core, random) => ({
    ticket: pickFrom(random, taskPhaseIn(core)),
    reason: pickFrom(random, executionBlockedReasons),
  }),
  permitsIn: (_config, core, drawn) =>
    drawn.ticket !== undefined &&
    drawn.reason !== undefined &&
    taskPhaseIn(core).includes(drawn.ticket) &&
    executionBlockedReasons.includes(drawn.reason),
};

const settle: WalkAction = {
  action: "settle",
  enabledIn: (config, core) => quietIn(config, core),
  drawIn: () => ({}),
  permitsIn: () => true,
};

/** The roster, in `step`'s order; the suite holds it against the model's own. */
export const walkActions: readonly WalkAction[] = [
  releaseTicket,
  overTicketSet("revoke", (_config, core) => revocablesIn(core)),
  dispatch,
  taskDone,
  overTicketSet("workReduce", (_config, core) => reducibleWorkIn(core)),
  overTicketSet("evalReduce", (_config, core) => reducibleEvalIn(core)),
  finalizationResult,
  executionBlocked,
  overTicketSet("resumeTicket", (_config, core) => retryablesIn(core)),
  settle,
];

/** The roster entry for an action name, refusing a name the machine has not got. */
export function walkActionOf(action: string): WalkAction {
  const found = walkActions.find((entry) => entry.action === action);
  if (found === undefined) {
    throw new Error(`draws: ${action} is not an action of this machine`);
  }
  return found;
}

/**
 * The draws under the names and encodings `mbt::nondetPicks` wires them with,
 * absent draws as `undefined`. This is what a written counterexample carries.
 */
export function drawnWire(drawn: Drawn): Readonly<Record<string, unknown>> {
  const opt = <T>(
    value: T | undefined,
    encode: (inner: T) => unknown,
  ): unknown => (value === undefined ? undefined : encode(value));
  return {
    deps_: opt(drawn.deps, (deps) => encodeDeps(new Set(deps))),
    finalizationPricing_: opt(drawn.finalizationPricing, (pricing) =>
      encodeSumValue(pricing, encodeInt),
    ),
    finalizer_: opt(drawn.finalizer, encodeNullaryTag),
    j: opt(drawn.ticket, encodeInt),
    out: opt(drawn.outcome, encodeNullaryTag),
    prog: opt(drawn.program, encodeProgram),
    resumePricing_: opt(drawn.resumePricing, encodeNullaryTag),
    reworkPolicy_: opt(drawn.reworkPolicy, (policy) =>
      encodeSumValue(policy, encodeInt),
    ),
    tid: opt(drawn.taskId, encodeInt),
    v: opt(drawn.verdict, encodeNullaryTag),
    why: opt(drawn.reason, encodeNullaryTag),
    workFanout_: opt(drawn.workFanout, encodeInt),
  };
}

/** The same draws as the dispatch table takes them, decoded off their own wire encoding. */
export function drawnPicks(drawn: Drawn): Picks {
  const wire = drawnWire(drawn);
  const itf = (value: unknown): ItfValue | undefined =>
    value === undefined
      ? undefined
      : decodeValue(encodeValue(value as ItfValue));
  return {
    ticket: itf(wire["j"]),
    deps: itf(wire["deps_"]),
    program: itf(wire["prog"]),
    workFanout: itf(wire["workFanout_"]),
    reworkPolicy: itf(wire["reworkPolicy_"]),
    finalizationPricing: itf(wire["finalizationPricing_"]),
    resumePricing: itf(wire["resumePricing_"]),
    finalizer: itf(wire["finalizer_"]),
    taskId: itf(wire["tid"]),
    verdict: itf(wire["v"]),
    outcome: itf(wire["out"]),
    reason: itf(wire["why"]),
  };
}
