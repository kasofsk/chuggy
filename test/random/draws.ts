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
  dispatchSources,
  isValidPlan,
  stageChoices,
  type Config,
} from "../../src/domain/config.ts";
import {
  dependableIn,
  finalizationOutcomes,
  finalizationOutcomeEnabled,
  finalizingIn,
  outstandingTasksIn,
  completableIn,
  quietIn,
  readiesIn,
  reducibleWorkIn,
  releasableIdsIn,
  retryablesIn,
  revocablesIn,
} from "../../src/domain/enablement.ts";
import { reportChoices } from "../../src/domain/deciders.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import {
  evaluationFailureDispositionTags,
  type TicketGraph,
  type EvaluationFailureDisposition,
  type FinalizationOutcome,
  type StageDefinition,
  type TaskIdentity,
  type TaskTerminalReport,
} from "../../src/domain/generated/modelTypes.ts";
import { taskIdentityEquals } from "../../src/domain/task.ts";
import { type TicketId } from "../../src/domain/ids.ts";
import type { Picks } from "../conformance/dispatch.ts";
import { decodeValue, encodeValue, type ItfValue } from "../itf/decode.ts";
import {
  encodeDependencies,
  encodeInt,
  encodeNullaryTag,
  encodePlanStages,
  encodeTaskIdentity,
  encodeTaskTerminalReport,
} from "../itf/vocabulary.ts";
import { pickFrom, subsetFrom, type Random } from "./random.ts";

/** One step's draws, in the domain's own vocabulary; absent means the action does not make that draw. */
export interface Drawn {
  readonly ticket?: TicketId;
  readonly dependencies?: readonly TicketId[];
  readonly stages?: readonly StageDefinition[];
  readonly source?: number;
  readonly onFailure?: EvaluationFailureDisposition;
  readonly task?: TaskIdentity;
  readonly report?: TaskTerminalReport;
  readonly outcome?: FinalizationOutcome;
}

/** One action of the machine, as the walk takes it. */
export interface WalkAction {
  readonly action: string;
  readonly enabledIn: (config: Config, graph: TicketGraph) => boolean;
  readonly drawIn: (
    config: Config,
    graph: TicketGraph,
    random: Random,
  ) => Drawn;
  readonly permitsIn: (
    config: Config,
    graph: TicketGraph,
    drawn: Drawn,
  ) => boolean;
}

/**
 * Every well-formed authorable plan, grown one stage at a time exactly as the
 * model folds `validPlans`, so a pick here is a pick from that set.
 */
export function validPlansIn(
  config: Config,
): readonly (readonly StageDefinition[])[] {
  const rosters = stageChoices(config);
  let grown: readonly (readonly StageDefinition[])[] = [[]];
  const plans: (readonly StageDefinition[])[] = [];
  for (let length = 1; length <= config.maxStages; length++) {
    grown = grown.flatMap((plan) =>
      rosters.map((roster) => [
        ...plan,
        { key: plan.length + 1, evaluators: roster },
      ]),
    );
    plans.push(...grown);
  }
  return plans;
}

/** The shape most actions share: one ticket, drawn from one enablement set. */
function overTicketSet(
  action: string,
  setIn: (config: Config, graph: TicketGraph) => readonly TicketId[],
): WalkAction {
  return {
    action,
    enabledIn: (config, graph) => setIn(config, graph).length > 0,
    drawIn: (config, graph, random) => ({
      ticket: pickFrom(random, setIn(config, graph)),
    }),
    permitsIn: (config, graph, drawn) =>
      drawn.ticket !== undefined && setIn(config, graph).includes(drawn.ticket),
  };
}

/**
 * Release draws every value it freezes onto the ticket, which is what makes a
 * walk reach tickets released differently from one another rather than a fleet
 * of identical ones.
 */
const releaseTicket: WalkAction = {
  action: "releaseTicket",
  enabledIn: (config, graph) => releasableIdsIn(config, graph).length > 0,
  drawIn: (config, graph, random) => ({
    ticket: pickFrom(random, releasableIdsIn(config, graph)),
    dependencies: subsetFrom(random, dependableIn(graph)),
    stages: pickFrom(random, validPlansIn(config)),
  }),
  permitsIn: (config, graph, drawn) => {
    const { ticket, dependencies, stages } = drawn;
    if (
      ticket === undefined ||
      dependencies === undefined ||
      stages === undefined
    ) {
      return false;
    }
    return (
      releasableIdsIn(config, graph).includes(ticket) &&
      dependencies.every((d) => dependableIn(graph).includes(d)) &&
      new Set(dependencies).size === dependencies.length &&
      isValidPlan(config, stages)
    );
  },
};

/**
 * The dispatch draws the ticket and the source the work is to be done at:
 * the source is the selector's own choice, so the walk chooses it as freely as
 * the machine does rather than deriving it from the ticket it picked.
 */
const dispatch: WalkAction = {
  action: "dispatch",
  enabledIn: (_config, graph) => readiesIn(graph).length > 0,
  drawIn: (_config, graph, random) => ({
    ticket: pickFrom(random, readiesIn(graph)),
    source: pickFrom(random, dispatchSources),
  }),
  permitsIn: (_config, graph, drawn) =>
    drawn.ticket !== undefined &&
    drawn.source !== undefined &&
    readiesIn(graph).includes(drawn.ticket) &&
    dispatchSources.includes(drawn.source),
};

/**
 * The completion draws what the task came back with, from the set that task's
 * own kind admits, and the disposition a failing stage would be taken on —
 * which it draws unconditionally, exactly as the model does, because whether
 * this completion concludes a failing stage is not something the draw knows.
 */
const taskDone: WalkAction = {
  action: "taskDone",
  enabledIn: (_config, graph) => completableIn(graph).length > 0,
  drawIn: (_config, graph, random) => {
    const ticket = pickFrom(random, completableIn(graph));
    const task = pickFrom(random, outstandingTasksIn(graph, ticket));
    return {
      ticket,
      task,
      report: pickFrom(random, reportChoices(ticketAt(graph, ticket), task)),
      onFailure: pickFrom(random, evaluationFailureDispositionTags),
    };
  },
  permitsIn: (_config, graph, drawn) => {
    const task = drawn.task;
    return (
      drawn.ticket !== undefined &&
      task !== undefined &&
      drawn.report !== undefined &&
      drawn.onFailure !== undefined &&
      completableIn(graph).includes(drawn.ticket) &&
      outstandingTasksIn(graph, drawn.ticket).some((live) =>
        taskIdentityEquals(live, task),
      ) &&
      evaluationFailureDispositionTags.includes(drawn.onFailure)
    );
  },
};

const finalizationResult: WalkAction = {
  action: "finalizationResult",
  enabledIn: (_config, graph) => finalizingIn(graph).length > 0,
  drawIn: (_config, graph, random) => {
    const ticket = pickFrom(random, finalizingIn(graph));
    return {
      ticket,
      outcome: pickFrom(
        random,
        finalizationOutcomes.filter((outcome) =>
          finalizationOutcomeEnabled(graph, ticket, outcome),
        ),
      ),
    };
  },
  permitsIn: (_config, graph, drawn) =>
    drawn.ticket !== undefined &&
    drawn.outcome !== undefined &&
    finalizingIn(graph).includes(drawn.ticket) &&
    finalizationOutcomes.includes(drawn.outcome) &&
    finalizationOutcomeEnabled(graph, drawn.ticket, drawn.outcome),
};

const settle: WalkAction = {
  action: "settle",
  enabledIn: (config, graph) => quietIn(config, graph),
  drawIn: () => ({}),
  permitsIn: () => true,
};

/** The roster, in `step`'s order; the suite holds it against the model's own. */
export const walkActions: readonly WalkAction[] = [
  releaseTicket,
  overTicketSet("revoke", (_config, graph) => revocablesIn(graph)),
  dispatch,
  taskDone,
  overTicketSet("workReduce", (_config, graph) => reducibleWorkIn(graph)),
  finalizationResult,
  overTicketSet("resumeTicket", (_config, graph) => retryablesIn(graph)),
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
    dependencies_: opt(drawn.dependencies, (ids) =>
      encodeDependencies(new Set(ids)),
    ),
    j: opt(drawn.ticket, encodeInt),
    onFailure: opt(drawn.onFailure, encodeNullaryTag),
    out: opt(drawn.outcome, encodeNullaryTag),
    report: opt(drawn.report, encodeTaskTerminalReport),
    source: opt(drawn.source, encodeInt),
    stages: opt(drawn.stages, encodePlanStages),
    task: opt(drawn.task, encodeTaskIdentity),
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
    dependencies: itf(wire["dependencies_"]),
    stages: itf(wire["stages"]),
    source: itf(wire["source"]),
    onFailure: itf(wire["onFailure"]),
    task: itf(wire["task"]),
    report: itf(wire["report"]),
    outcome: itf(wire["out"]),
  };
}
