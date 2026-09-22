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

import type {
  EvaluatorDefinition,
  StageDefinition,
} from "./generated/modelTypes.ts";
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

/** Every evaluator key the bound allows, ascending: the default program's roster, and the longest a stage can list. */
export function everyEvaluator(config: Config): readonly EvaluatorDefinition[] {
  const roster: EvaluatorDefinition[] = [];
  for (let key = 1; key <= config.nTasks; key++) roster.push({ key });
  return roster;
}

/**
 * The stage rosters an author may draw from: every non-empty ascending list of
 * distinct keys in range, grown one key at a time. Keys are authored names
 * rather than positions, so a sparse roster is a choice like any other.
 */
export function stageChoices(
  config: Config,
): readonly (readonly EvaluatorDefinition[])[] {
  let grown: (readonly EvaluatorDefinition[])[] = [[]];
  for (const entry of everyEvaluator(config))
    grown = [...grown, ...grown.map((roster) => [...roster, entry])];
  return grown.filter((roster) => roster.length >= 1);
}

/** The default program: one stage listing every evaluator the bound allows, which is what a ticket whose evaluators all share stage 0 runs as. */
export function defaultProgram(config: Config): readonly StageDefinition[] {
  return [{ key: 1, evaluators: everyEvaluator(config) }];
}

/**
 * Whether a program is one a release may carry: non-empty, within the stage
 * bound, each stage keyed by its position and listing a non-empty roster of
 * distinct keys in range.
 */
export function isValidProgram(
  config: Config,
  program: readonly StageDefinition[],
): boolean {
  return (
    program.length >= 1 &&
    program.length <= config.maxStages &&
    program.every((stage, index) => {
      const keys = stage.evaluators.map((e) => e.key);
      return (
        stage.key === index + 1 &&
        keys.length >= 1 &&
        new Set(keys).size === keys.length &&
        keys.every((key) => key >= 1 && key <= config.nTasks)
      );
    })
  );
}
