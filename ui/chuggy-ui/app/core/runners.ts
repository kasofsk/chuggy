/**
 * What the Runners page draws, derived: the words for where a project's work
 * runs and what decided it, the draft a placement is chosen in, what a write
 * answered, and the one command a machine registers with.
 */

import type { ExecutionPlacementResponse } from "../../../../src/contract/responses.ts";
import {
  hostedRunsNotGrantedCode,
  placementRoutes,
} from "../../../../src/contract/rosters.ts";
import type {
  PlacementRoute,
  PlacementRouteSource,
} from "../../../../src/contract/rosters.ts";
import type { ApiResult } from "./apiRequest.ts";
import { panelReason } from "./freshness.ts";

/** The platforms a minted token lets a runner declare: the ones chuggy-linux runs on. */
export const runnerPlatforms = [
  "Platform:Linux:Amd64",
  "Platform:Linux:Arm64",
] as const;

/** How long a minted token stays redeemable, which is the time a reader has to paste it. */
export const runnerTokenLifetimeSecs = 3600;

export function runnerRouteLabel(route: PlacementRoute): string {
  switch (route) {
    case "InCluster":
      return "Hosted";
    case "Pool":
      return "Runners";
  }
}

export function runnerRouteSourceLabel(source: PlacementRouteSource): string {
  switch (source) {
    case "Override":
      return "Deployment";
    case "Project":
      return "Project";
    case "Default":
      return "Default";
  }
}

/** A capability as a reader says it: a platform's parts, and anything else as it is spelled. */
export function runnerCapabilityLabel(capability: string): string {
  const platform = /^Platform:(.+)$/u.exec(capability);
  return platform?.[1] === undefined
    ? capability
    : platform[1].replaceAll(":", " ");
}

/** The command the console hands a reader to run on the machine being added. */
export function runnerRegisterCommand(origin: string, token: string): string {
  return `chuggy-linux register --api ${origin} --token ${token}`;
}

export interface RunnersPlacementDraft {
  readonly work: PlacementRoute;
  readonly evaluation: PlacementRoute;
}

/** A kind's route where the reader may choose it, else the first route they may. */
function runnersPlacementSeeded(
  route: PlacementRoute,
  choices: readonly PlacementRoute[],
): PlacementRoute {
  return choices.includes(route) ? route : (choices[0] ?? route);
}

export function runnersPlacementDraft(
  placement: ExecutionPlacementResponse,
): RunnersPlacementDraft {
  return {
    work: runnersPlacementSeeded(placement.work.route, placement.choices),
    evaluation: runnersPlacementSeeded(
      placement.evaluation.route,
      placement.choices,
    ),
  };
}

/** Whether a draft names only routes the reader may choose, which is all a write is refused for. */
export function runnersPlacementSavable(
  draft: RunnersPlacementDraft,
  choices: readonly PlacementRoute[],
): boolean {
  return choices.includes(draft.work) && choices.includes(draft.evaluation);
}

/** The route a radio group answered, where it is one this wire knows. */
export function runnersPlacementRoute(
  value: string,
): PlacementRoute | undefined {
  return placementRoutes.find((route) => route === value);
}

export type RunnersPlacementSaved =
  | { readonly saved: "Idle" }
  | { readonly saved: "Writing" }
  | {
      readonly saved: "Written";
      readonly placement: ExecutionPlacementResponse;
    }
  | { readonly saved: "Unhosted" }
  | { readonly saved: "Failed"; readonly reason: string };

export function runnersPlacementAnswered(
  result: ApiResult<ExecutionPlacementResponse>,
): RunnersPlacementSaved {
  if (result.outcome === "Ok")
    return { saved: "Written", placement: result.value };
  if (result.outcome === "Rejected" && result.code === hostedRunsNotGrantedCode)
    return { saved: "Unhosted" };
  return { saved: "Failed", reason: panelReason(result) };
}
