/**
 * How a ticket finishes, what it produced, and what a resolved landing
 * attempt records about itself.
 *
 * `WrapUpObs` is where an environment choice reaches the observable record,
 * and the discipline that governs it is stated at `model/measure.qnt`: an
 * environment choice is a named nondeterministic event, drawn fresh at every
 * attempt and carried on the step record, never a flag stored on state. What
 * enforces it here is the same thing that enforces it there — neither `Ticket`
 * nor `Core` has a field for one, so storing a choice would mean adding a
 * field rather than setting one.
 */

import type { ProjectId } from "./ids.ts";

/** How a ticket finishes: externally during work, or by taking a lease on a resource. */
export type WrapUp =
  | { readonly wrapUp: "WNone" }
  | { readonly wrapUp: "WExclusive"; readonly resource: number };

/** What the ticket produced. Its only modeled property is distinctness. */
export type ArtifactMark =
  | { readonly artifact: "ANone" }
  | { readonly artifact: "ASome"; readonly mark: number };

/** How a landing attempt resolved. Failure is drawable only on an invalidated artifact. */
export type WrapUpOutcome = "WOk" | "WFailed";

/** The landing-boundary observation: attribution and the environment's per-attempt choice. */
export type WrapUpObs =
  | { readonly landing: "WONone" }
  | {
      readonly landing: "WOAttempt";
      readonly project: ProjectId;
      readonly invalidated: boolean;
    };

export const wNone: WrapUp = { wrapUp: "WNone" };

/** A ticket that needs a lease on `resource` before its wrap-up may run. */
export function wExclusive(resource: number): WrapUp {
  return { wrapUp: "WExclusive", resource };
}

export const aNone: ArtifactMark = { artifact: "ANone" };

/** A produced artifact, identified and otherwise opaque. */
export function aSome(mark: number): ArtifactMark {
  return { artifact: "ASome", mark };
}

export const woNone: WrapUpObs = { landing: "WONone" };

/** A step that resolved a landing attempt for `project`. */
export function woAttempt(project: ProjectId, invalidated: boolean): WrapUpObs {
  return { landing: "WOAttempt", project, invalidated };
}
