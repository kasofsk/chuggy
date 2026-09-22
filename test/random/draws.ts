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
  isValidProgram,
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
  encodeDeps,
  encodeInt,
  encodeNullaryTag,
  encodeProgram,
  encodeTaskIdentity,
  encodeTaskTerminalReport,
} from "../itf/vocabulary.ts";
import { pickFrom, subsetFrom, type Random } from "./random.ts";

/** One step's draws, in the domain's own vocabulary; absent means the action does not make that draw. */
export interface Drawn {
  readonly ticket?: TicketId;
  readonly deps?: readonly TicketId[];
  readonly program?: readonly StageDefinition[];
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
 * Every well-formed authorable program, grown one stage at a time exactly as
 * the model folds `validPrograms`, so a pick here is a pick from that set.
 */
export function validProgramsIn(
  config: Config,
): readonly (readonly StageDefinition[])[] {
  const rosters = stageChoices(config);
  let grown: readonly (readonly StageDefinition[])[] = [[]];
  const programs: (readonly StageDefinition[])[] = [];
  for (let length = 1; length <= config.maxStages; length++) {
    grown = grown.flatMap((program) =>
      rosters.map((roster) => [
        ...program,
        { key: program.length + 1, evaluators: roster },
      ]),
    );
    programs.push(...grown);
  }
  return programs;
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
 * walk reach tickets authored differently from one another rather than a fleet
 * of identical ones.
 */
const releaseTicket: WalkAction = {
  action: "releaseTicket",
  enabledIn: (config, graph) => releasableIdsIn(config, graph).length > 0,
  drawIn: (config, graph, random) => ({
    ticket: pickFrom(random, releasableIdsIn(config, graph)),
    deps: subsetFrom(random, dependableIn(graph)),
    program: pickFrom(random, validProgramsIn(config)),
  }),
  permitsIn: (config, graph, drawn) => {
    const { ticket, deps, program } = drawn;
    if (ticket === undefined || deps === undefined || program === undefined) {
      return false;
    }
    return (
      releasableIdsIn(config, graph).includes(ticket) &&
      deps.every((d) => dependableIn(graph).includes(d)) &&
      new Set(deps).size === deps.length &&
      isValidProgram(config, program)
    );
  },
};

const dispatch: WalkAction = {
  action: "dispatch",
  enabledIn: (_config, graph) => readiesIn(graph).length > 0,
  drawIn: (_config, graph, random) => ({
    ticket: pickFrom(random, readiesIn(graph)),
  }),
  permitsIn: (_config, graph, drawn) =>
    drawn.ticket !== undefined && readiesIn(graph).includes(drawn.ticket),
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
      report: pickFrom(random, reportChoices(task)),
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
    deps_: opt(drawn.deps, (deps) => encodeDeps(new Set(deps))),
    j: opt(drawn.ticket, encodeInt),
    onFailure: opt(drawn.onFailure, encodeNullaryTag),
    out: opt(drawn.outcome, encodeNullaryTag),
    prog: opt(drawn.program, encodeProgram),
    report: opt(drawn.report, encodeTaskTerminalReport),
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
    deps: itf(wire["deps_"]),
    program: itf(wire["prog"]),
    onFailure: itf(wire["onFailure"]),
    task: itf(wire["task"]),
    report: itf(wire["report"]),
    outcome: itf(wire["out"]),
  };
}
