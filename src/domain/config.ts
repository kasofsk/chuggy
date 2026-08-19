/**
 * The constants a deployment is instantiated with, and the universes they
 * generate.
 *
 * The model declares these as module constants and instantiates a module per
 * configuration. Here they are a value passed in, for the reason
 * `model/measure.qnt` gives for passing `Bounds` explicitly: the deciders stay
 * pure functions usable at any configuration, needing no ambient state and no
 * module-level instantiation ceremony.
 *
 * The universes below are what a release draws from, which is why an
 * ill-formed ticket cannot enter a reachable state and no decider defends
 * against one mid-flight.
 */

import type {
  FinalizationPricing,
  Finalizer,
  ReworkPolicy,
  RetryPricing,
  Stage,
} from "./generated/modelTypes.ts";
import { asTicketId, type TicketId } from "./ids.ts";
import {
  budgeted,
  finalizationBudget,
  reworkBudget,
  reworkBudgetOf,
  type Bounds,
} from "./pricing.ts";

/** One deployment's constants. */
export interface Config {
  readonly nTickets: number;
  readonly nTasks: number;
  readonly reworkPolicy: ReworkPolicy;
  readonly gas: number;
  readonly finalizationPricing: FinalizationPricing;
  readonly maxStages: number;
}

/** What the measure needs, read off the configuration it is measuring. */
export function boundsOf(config: Config): Bounds {
  return {
    reworkPolicy: config.reworkPolicy,
    nTasks: config.nTasks,
    maxStages: config.maxStages,
    finalizationPricing: config.finalizationPricing,
  };
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

/** Both finish kinds. A ticket authored with no finalizer completes out of evaluation. */
export const finalizerChoices: readonly Finalizer[] = [
  "NoFinalizer",
  "ManagedFinalizer",
];

/** The work-set widths a release may author. */
export function workFanoutChoices(config: Config): readonly number[] {
  const choices: number[] = [];
  for (let n = 1; n <= config.nTasks; n++) choices.push(n);
  return choices;
}

/** Every rework grant up to the instance's, so a ticket may be authored poorer than its fleet. */
export function reworkPolicyChoices(config: Config): readonly ReworkPolicy[] {
  const choices: ReworkPolicy[] = [];
  for (let n = 0; n <= reworkBudget(config.reworkPolicy); n++)
    choices.push(reworkBudgetOf(n));
  return choices;
}

/** Every finalization pricing up to the instance's, plus the unbudgeted branch. */
export function finalizationPricingChoices(
  config: Config,
): readonly FinalizationPricing[] {
  const choices: FinalizationPricing[] = ["DeadlineOnly"];
  for (let n = 0; n <= finalizationBudget(config.finalizationPricing); n++)
    choices.push(budgeted(n));
  return choices;
}

/** Both resume pricings. `RetryFree` reproduces a known livelock by configuration. */
export const resumePricingChoices: readonly RetryPricing[] = [
  "RetryCharged",
  "RetryFree",
];

/** The stage vocabulary an author may draw from: any fan-out in range, either combinator. */
export function stageChoices(config: Config): readonly Stage[] {
  const choices: Stage[] = [];
  for (let fanout = 1; fanout <= config.nTasks; fanout++) {
    choices.push({ fanout, combinator: "UnanimousPass" });
    choices.push({ fanout, combinator: "AnyPass" });
  }
  return choices;
}

/**
 * The default program: one stage, full fan-out, unanimous pass. There is no
 * machine-wide combinator constant, because the combinator is data on the
 * ticket and a constant would be the machinery eval-is-data rules out.
 */
export function defaultProgram(config: Config): readonly Stage[] {
  return [{ fanout: config.nTasks, combinator: "UnanimousPass" }];
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
