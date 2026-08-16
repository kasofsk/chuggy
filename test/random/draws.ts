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

import type { Config } from "../../src/domain/config.ts";
import {
  isValidProgram,
  projects,
  stageChoices,
  wrapUpChoices,
} from "../../src/domain/config.ts";
import type { Core } from "../../src/domain/core.ts";
import {
  canArriveIn,
  deliverableTaskIds,
  dependableIn,
  dispatchableIn,
  doneIn,
  draftsIn,
  holdingIn,
  quietIn,
  readiesIn,
  reducibleEvalIn,
  reducibleWorkIn,
  retryablesIn,
  revocablesIn,
  taskPhaseIn,
  wrapUpOutcomes,
  wrapUpStartablesIn,
} from "../../src/domain/enablement.ts";
import type { ProjectId, TaskId, TicketId } from "../../src/domain/ids.ts";
import type { Stage } from "../../src/domain/program.ts";
import type { Verdict } from "../../src/domain/task.ts";
import { wrapUpEquals } from "../../src/domain/wrapUp.ts";
import type { WrapUp, WrapUpOutcome } from "../../src/domain/wrapUp.ts";
import type { Picks } from "../conformance/dispatch.ts";
import { decodeValue, type ItfValue } from "../itf/decode.ts";
import {
  decodeVerdict,
  decodeWrapUpOutcome,
  encodeDeps,
  encodeInt,
  encodeProgram,
  encodeVerdict,
  encodeWrapUp,
  encodeWrapUpOutcome,
} from "../itf/vocabulary.ts";
import { pickFrom, subsetFrom, type Random } from "./random.ts";

/** One step's draws, in the domain's own vocabulary; absent means the action does not make that draw. */
export interface Drawn {
  readonly ticket?: TicketId;
  readonly deps?: readonly TicketId[];
  readonly program?: readonly Stage[];
  readonly project?: ProjectId;
  readonly wrapUp?: WrapUp;
  readonly taskId?: TaskId;
  readonly verdict?: Verdict;
  readonly moved?: boolean;
  readonly outcome?: WrapUpOutcome;
}

/** One action of the machine, as the walk takes it. */
export interface WalkAction {
  readonly action: string;
  readonly enabledIn: (config: Config, core: Core) => boolean;
  readonly drawIn: (config: Config, core: Core, random: Random) => Drawn;
  readonly permitsIn: (config: Config, core: Core, drawn: Drawn) => boolean;
}

/** The verdict draw the completion event ranges over, as the model's `taskDone` writes it. */
const verdictDraws: readonly Verdict[] = ["VPass", "VFail"];

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

const arrive: WalkAction = {
  action: "arrive",
  enabledIn: (config, core) => canArriveIn(config, core),
  drawIn: (config, core, random) => ({
    deps: subsetFrom(random, dependableIn(core)),
    program: pickFrom(random, validProgramsIn(config)),
    project: pickFrom(random, projects(config)),
    wrapUp: pickFrom(random, wrapUpChoices(config)),
  }),
  permitsIn: (config, core, drawn) => {
    const { deps, program, project, wrapUp } = drawn;
    if (
      deps === undefined ||
      program === undefined ||
      project === undefined ||
      wrapUp === undefined
    ) {
      return false;
    }
    return (
      deps.every((d) => dependableIn(core).includes(d)) &&
      isValidProgram(config, program) &&
      projects(config).includes(project) &&
      wrapUpChoices(config).some((choice) => wrapUpEquals(choice, wrapUp))
    );
  },
};

const dispatch: WalkAction = {
  action: "dispatch",
  enabledIn: (config, core) => readiesIn(core).length > 0,
  drawIn: (config, core, random) => ({
    ticket: pickFrom(random, readiesIn(core)),
  }),
  permitsIn: (config, core, drawn) =>
    drawn.ticket !== undefined &&
    readiesIn(core).includes(drawn.ticket) &&
    dispatchableIn(core, drawn.ticket),
};

const taskDone: WalkAction = {
  action: "taskDone",
  enabledIn: (config, core) => taskPhaseIn(core).length > 0,
  drawIn: (config, core, random) => {
    const ticket = pickFrom(random, taskPhaseIn(core));
    return {
      ticket,
      taskId: pickFrom(random, deliverableTaskIds(core, ticket)),
      verdict: pickFrom(random, verdictDraws),
    };
  },
  permitsIn: (config, core, drawn) =>
    drawn.ticket !== undefined &&
    drawn.taskId !== undefined &&
    drawn.verdict !== undefined &&
    taskPhaseIn(core).includes(drawn.ticket) &&
    deliverableTaskIds(core, drawn.ticket).includes(drawn.taskId),
};

const wrapUpStart: WalkAction = {
  action: "wrapUpStart",
  enabledIn: (config, core) => wrapUpStartablesIn(core).length > 0,
  drawIn: (config, core, random) => ({
    ticket: pickFrom(random, wrapUpStartablesIn(core)),
    moved: random.coin(),
  }),
  permitsIn: (config, core, drawn) =>
    drawn.ticket !== undefined &&
    drawn.moved !== undefined &&
    wrapUpStartablesIn(core).includes(drawn.ticket),
};

const wrapUpResolve: WalkAction = {
  action: "wrapUpResolve",
  enabledIn: (config, core) => holdingIn(core).length > 0,
  drawIn: (config, core, random) => ({
    ticket: pickFrom(random, holdingIn(core)),
    outcome: pickFrom(random, wrapUpOutcomes(true)),
  }),
  permitsIn: (config, core, drawn) =>
    drawn.ticket !== undefined &&
    drawn.outcome !== undefined &&
    holdingIn(core).includes(drawn.ticket) &&
    wrapUpOutcomes(true).includes(drawn.outcome),
};

const settle: WalkAction = {
  action: "settle",
  enabledIn: (config, core) => quietIn(config, core),
  drawIn: () => ({}),
  permitsIn: () => true,
};

/** The roster, in `step`'s order; the suite holds it against the model's own. */
export const walkActions: readonly WalkAction[] = [
  arrive,
  overTicketSet("release", (config, core) => draftsIn(core)),
  overTicketSet("revoke", (config, core) => revocablesIn(core)),
  dispatch,
  taskDone,
  overTicketSet("workReduce", (config, core) => reducibleWorkIn(core)),
  overTicketSet("evalReduce", (config, core) => reducibleEvalIn(core)),
  wrapUpStart,
  wrapUpResolve,
  overTicketSet("completeDuplicate", (config, core) => doneIn(core)),
  overTicketSet("revalFail", (config, core) => readiesIn(core)),
  overTicketSet("opRetry", retryablesIn),
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
    deps_: opt(drawn.deps, encodeDeps),
    j: opt(drawn.ticket, encodeInt),
    moved: drawn.moved,
    out: opt(drawn.outcome, encodeWrapUpOutcome),
    prog: opt(drawn.program, encodeProgram),
    project_: opt(drawn.project, encodeInt),
    tid: opt(drawn.taskId, encodeInt),
    v: opt(drawn.verdict, encodeVerdict),
    wrapUp_: opt(drawn.wrapUp, encodeWrapUp),
  };
}

/** The same draws as the dispatch table takes them, decoded off their own wire encoding. */
export function drawnPicks(drawn: Drawn): Picks {
  const wire = drawnWire(drawn);
  const itf = (value: unknown): ItfValue | undefined =>
    value === undefined ? undefined : decodeValue(value);
  return {
    ticket: itf(wire["j"]),
    deps: itf(wire["deps_"]),
    program: itf(wire["prog"]),
    project: itf(wire["project_"]),
    wrapUp: itf(wire["wrapUp_"]),
    taskId: itf(wire["tid"]),
    verdict: itf(wire["v"]),
    moved: itf(wire["moved"]),
    outcome: itf(wire["out"]),
    decodeVerdict,
    decodeWrapUpOutcome,
  };
}
