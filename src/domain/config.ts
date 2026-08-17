/**
 * The constants a deployment is instantiated with, and the universes they
 * generate.
 *
 * The model declares these as module constants and instantiates a module per
 * configuration. Here they are a value passed in, for the reason
 * `model/measure.qnt` gives for passing `Bounds` explicitly: the deciders stay
 * pure functions usable at any configuration, needing no ambient state and no
 * module-level instantiation ceremony.
 */

import { asProjectId, type ProjectId } from "./ids.ts";
import { wExclusive, wNone, type WrapUp } from "./wrapUp.ts";
import type {
  Bounds,
  ReworkPolicy,
  RetryPricing,
  WrapUpPricing,
} from "./pricing.ts";
import type { Combinator, Stage } from "./program.ts";

/** One deployment's constants. */
export interface Config {
  readonly nTickets: number;
  readonly nTasks: number;
  readonly reworkPolicy: ReworkPolicy;
  readonly gas: number;
  readonly wrapUpPricing: WrapUpPricing;
  readonly opRetryPricing: RetryPricing;
  readonly maxStages: number;
  readonly nProjects: number;
}

/** What the measure needs, read off the configuration it is measuring. */
export function boundsOf(config: Config): Bounds {
  return {
    reworkPolicy: config.reworkPolicy,
    nTasks: config.nTasks,
    maxStages: config.maxStages,
    wrapUpPricing: config.wrapUpPricing,
  };
}

/** The project universe an arrival draws its target from. */
export function projects(config: Config): readonly ProjectId[] {
  const universe: ProjectId[] = [];
  for (let p = 1; p <= config.nProjects; p++) universe.push(asProjectId(p));
  return universe;
}

/**
 * Every authorable wrap-up kind. An arrival draws from exactly this set, so a
 * lease on a resource outside the universe cannot enter a reachable state —
 * the structural refusal `wrapUpWellFormed` then makes durable.
 */
export function wrapUpChoices(config: Config): readonly WrapUp[] {
  const choices: WrapUp[] = [wNone];
  for (let r = 1; r <= config.nProjects; r++) choices.push(wExclusive(r));
  return choices;
}

/** The stage vocabulary an author may draw from: any fan-out in range, either combinator. */
export function stageChoices(config: Config): readonly Stage[] {
  const combinators: readonly Combinator[] = ["CUnanimousPass", "CAnyPass"];
  const choices: Stage[] = [];
  for (let fanout = 1; fanout <= config.nTasks; fanout++) {
    for (const combinator of combinators) choices.push({ fanout, combinator });
  }
  return choices;
}

/**
 * The default program: one stage, full fan-out, unanimous pass. There is no
 * machine-wide combinator constant, because the combinator is data on the
 * ticket and a constant would be the machinery eval-is-data rules out.
 */
export function defaultProgram(config: Config): readonly Stage[] {
  return [{ fanout: config.nTasks, combinator: "CUnanimousPass" }];
}

/**
 * Whether a program is one an arrival may carry: non-empty, within the stage
 * bound, every fan-out in range. The model states this as a set an arrival
 * draws from, so no reachable state holds an ill-formed program and no decider
 * defends against one mid-flight.
 */
export function isValidProgram(
  config: Config,
  program: readonly Stage[],
): boolean {
  return (
    program.length >= 1 &&
    program.length <= config.maxStages &&
    program.every((s) => s.fanout >= 1 && s.fanout <= config.nTasks)
  );
}
