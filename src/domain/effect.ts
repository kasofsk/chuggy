/**
 * The effect vocabulary: what a decision asks the world to do, as a closed set
 * of constructors rather than the strings the model emits.
 *
 * THEY ARE NULLARY, AND THAT IS THE MODEL'S DECISION RATHER THAN A SHORTCUT.
 * `model/measure.qnt` says the project cannot ride the effect strings because
 * there are no dynamic strings at this grain, which is why the step record
 * carries the attribution structurally instead. Giving these constructors
 * payloads would be a change to the domain vocabulary and to `StepRecord`, so
 * it is a model commit first and not something an implementation may take on
 * its own.
 *
 * They are hand-written rather than generated because the model types an
 * effect list as `List[str]`: the vocabulary is what the deciders emit, not a
 * declared type the API boundary can carry.
 *
 * What follows from that is the interpreter's signature one layer out: an
 * effect names what to do and carries no subject, so no port call can be
 * formed from the effect list alone, and the subject is read off the record
 * positionally.
 */

import { assertNever } from "./assertNever.ts";

/** The closed effects, one per string the model emits. */
export type Effect =
  | "SpawnWorkTasks"
  | "SpawnEvalTasks"
  | "RunFinalizer"
  | "PublishHandoff"
  | "OpenHumanTask"
  | "CancelTicketWork";

/**
 * Every effect, in the order this file declares them. It exists so a suite can
 * iterate the vocabulary rather than restate it, which is how a constructor
 * added without a test goes unnoticed.
 */
export const allEffects: readonly Effect[] = [
  "SpawnWorkTasks",
  "SpawnEvalTasks",
  "RunFinalizer",
  "PublishHandoff",
  "OpenHumanTask",
  "CancelTicketWork",
];

/**
 * Renders a constructor back to the string the model emits. This is the only
 * place the trace comparison meets the vocabulary.
 */
export function effectLabel(effect: Effect): string {
  switch (effect) {
    case "SpawnWorkTasks":
      return "SpawnWorkTasks";
    case "SpawnEvalTasks":
      return "SpawnEvalTasks";
    case "RunFinalizer":
      return "RunFinalizer";
    case "PublishHandoff":
      return "PublishHandoff";
    case "OpenHumanTask":
      return "OpenHumanTask";
    case "CancelTicketWork":
      return "CancelTicketWork";
    default:
      return assertNever(effect);
  }
}

/** Reads a model-emitted string back into a constructor, refusing anything else. */
export function effectFromLabel(label: string): Effect {
  const found = allEffects.find((effect) => effectLabel(effect) === label);
  if (found === undefined) {
    throw new Error(`effect: ${label} is not one of this machine's effects`);
  }
  return found;
}
