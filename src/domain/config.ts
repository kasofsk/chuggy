/**
 * The constants a deployment is instantiated with, and the universes they
 * generate.
 *
 * The model declares these as module constants and instantiates a module per
 * configuration. Here they are a value passed in, so the deciders stay pure
 * functions usable at any configuration, needing no ambient state and no
 * module-level instantiation ceremony.
 *
 * The universes below are what a release draws from, which is why an
 * ill-formed ticket cannot enter a reachable state and no decider defends
 * against one mid-flight.
 */

import type { Stage } from "./generated/modelTypes.ts";
import { asTicketId, type TicketId } from "./ids.ts";

/** One deployment's constants. */
export interface Config {
  readonly nTickets: number;
  readonly nTasks: number;
  readonly maxStages: number;
}

/**
 * The ids a release may claim, deliberately wider than the fleet bound: the
 * gap is what puts sparse and numerically reversed dependency edges into
 * reachable states rather than leaving them untested.
 */
export function ticketIdUniverse(config: Config): readonly TicketId[] {
  const universe: TicketId[] = [];
  for (let j = 1; j <= config.nTickets * 2; j++) universe.push(asTicketId(j));
  return universe;
}

/** The work-set widths a release may author. */
export function workFanoutChoices(config: Config): readonly number[] {
  const choices: number[] = [];
  for (let n = 1; n <= config.nTasks; n++) choices.push(n);
  return choices;
}

/** The stage vocabulary an author may draw from: any fan-out in range. */
export function stageChoices(config: Config): readonly Stage[] {
  const choices: Stage[] = [];
  for (let fanout = 1; fanout <= config.nTasks; fanout++)
    choices.push({ fanout });
  return choices;
}

/** The default program: one stage at full fan-out, which every evaluator sharing stage 0 behaves as. */
export function defaultProgram(config: Config): readonly Stage[] {
  return [{ fanout: config.nTasks }];
}

/**
 * Whether a program is one a release may carry: non-empty, within the stage
 * bound, every fan-out in range.
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
