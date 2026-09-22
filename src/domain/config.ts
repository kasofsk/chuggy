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
  ReleasedTicket,
  StageDefinition,
  TaskDefinition,
} from "./generated/modelTypes.ts";
import { asTicketId, type TicketId } from "./ids.ts";
import { planValid } from "./evaluation.ts";
import { taskDefinitionValid } from "./task.ts";

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

/**
 * The definition an evaluator runs under, at model scope: a distinct positive
 * reference per slot, derived from the evaluator's own key, where the release
 * resolves that stage's configuration and folds the digests it stores.
 */
export function evaluatorTaskOf(key: number): TaskDefinition {
  return {
    workload: 4 * key - 3,
    inputs: 4 * key - 2,
    executionRequirements: 4 * key - 1,
    resultContract: 4 * key,
  };
}

/** One authored evaluator: a key, and the definition the release resolved for it. */
export function evaluatorOf(key: number): EvaluatorDefinition {
  return { key, task: evaluatorTaskOf(key) };
}

/** Every evaluator key the bound allows, ascending: the default plan's roster, and the longest a stage can list. */
export function everyEvaluator(config: Config): readonly EvaluatorDefinition[] {
  const roster: EvaluatorDefinition[] = [];
  for (let key = 1; key <= config.nTasks; key++) roster.push(evaluatorOf(key));
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

/** The default plan: one stage listing every evaluator the bound allows, which is what a ticket whose evaluators all share stage 0 runs as. */
export function defaultPlan(config: Config): readonly StageDefinition[] {
  return [{ key: 1, evaluators: everyEvaluator(config) }];
}

/**
 * Whether a plan is one a release may carry: non-empty, within the stage
 * bound, each stage keyed by its position and listing a non-empty roster of
 * distinct keys in range. This is the plan half of the release's rule below.
 */
export function isValidPlan(
  config: Config,
  stages: readonly StageDefinition[],
): boolean {
  return (
    stages.length >= 1 &&
    stages.length <= config.maxStages &&
    stages.every((stage, index) => {
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

/**
 * The references a release pins for one ticket, at model scope: one distinct
 * small positive int per slot, where the real release folds the digest of the
 * material each one names.
 */
export function releaseRef(id: number, slot: number): number {
  return 20 * id + slot;
}

/** The definition a release of this ticket carries, over the dependencies and the plan the author drew. */
export function releasedTicketOf(
  id: number,
  dependencies: ReadonlySet<number>,
  stages: readonly StageDefinition[],
): ReleasedTicket {
  return {
    id,
    content: releaseRef(id, 1),
    dependencies,
    workConfiguration: {
      workload: releaseRef(id, 2),
      inputs: releaseRef(id, 3),
      executionRequirements: releaseRef(id, 4),
      resultContract: releaseRef(id, 5),
    },
    evaluationPlan: { stages },
    finalizationConfiguration: releaseRef(id, 6),
  };
}

/**
 * The release's validity rule: the contract's own claims, a plan the protocol
 * will run, and then this deployment's bounds. A definition outside it is
 * refused at authoring time rather than defended against mid-flight.
 */
export function releasedTicketValid(
  config: Config,
  definition: ReleasedTicket,
): boolean {
  return (
    definition.id > 0 &&
    definition.content > 0 &&
    [...definition.dependencies].every((d) => d > 0) &&
    taskDefinitionValid(definition.workConfiguration) &&
    planValid(definition.evaluationPlan) &&
    definition.finalizationConfiguration > 0 &&
    isValidPlan(config, definition.evaluationPlan.stages)
  );
}

/**
 * The source references the application may observe, at model scope: two
 * disjoint bands, one a dispatch draws from and one a work result is accepted
 * at, so a number read back says which observation made it.
 */
export const aDispatchSource = 9;
export const anAcceptedSource = 11;
export const dispatchSources: readonly number[] = [
  aDispatchSource,
  aDispatchSource + 1,
];
export const acceptedSources: readonly number[] = [
  anAcceptedSource,
  anAcceptedSource + 1,
];
