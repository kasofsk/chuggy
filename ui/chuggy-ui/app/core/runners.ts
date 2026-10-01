/**
 * What the Runners page draws, derived: the words for where a project's work
 * and sessions run and what decided it, the draft a placement is chosen in,
 * what a write answered, and the one command a machine registers with.
 */

import type {
  ExecutionPlacementResponse,
  SessionPlacementResponse,
} from "../../../../src/contract/responses.ts";
import {
  hostedRunsNotGrantedCode,
  placementRoutes,
} from "../../../../src/contract/rosters.ts";
import type {
  PlacementRoute,
  PlacementRouteSource,
  SessionRunnerStanding,
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

/** Whether the runners a session would run on are there, in one word. */
export function runnerStandingLabel(standing: SessionRunnerStanding): string {
  switch (standing) {
    case "Unregistered":
      return "None";
    case "Offline":
      return "Offline";
    case "Live":
      return "Live";
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
  return `chuggy-linux register --api ${origin} --token=${token}`;
}

/** Every kind's route, written as two placements: work and evaluation, and a
 * thread and the lead. */
export interface RunnersPlacementDraft {
  readonly work: PlacementRoute;
  readonly evaluation: PlacementRoute;
  readonly thread: PlacementRoute;
  readonly lead: PlacementRoute;
}

/** A kind's route where the reader may choose it, else the first route they may. */
function runnersPlacementSeeded(
  route: PlacementRoute,
  choices: readonly PlacementRoute[],
): PlacementRoute {
  return choices.includes(route) ? route : (choices[0] ?? route);
}

export function runnersPlacementDraft(
  execution: ExecutionPlacementResponse,
  session: SessionPlacementResponse,
): RunnersPlacementDraft {
  return {
    work: runnersPlacementSeeded(execution.work.route, execution.choices),
    evaluation: runnersPlacementSeeded(
      execution.evaluation.route,
      execution.choices,
    ),
    thread: runnersPlacementSeeded(session.thread.route, session.choices),
    lead: runnersPlacementSeeded(session.lead.route, session.choices),
  };
}

/** Whether a draft names only routes the reader may choose, each kind from its
 * own placement's choices, which is all a write is refused for. */
export function runnersPlacementSavable(
  draft: RunnersPlacementDraft,
  execution: readonly PlacementRoute[],
  session: readonly PlacementRoute[],
): boolean {
  return (
    execution.includes(draft.work) &&
    execution.includes(draft.evaluation) &&
    session.includes(draft.thread) &&
    session.includes(draft.lead)
  );
}

/** The route a radio group answered, where it is one this wire knows. */
export function runnersPlacementRoute(
  value: string,
): PlacementRoute | undefined {
  return placementRoutes.find((route) => route === value);
}

/** What one placement's write answered. */
export type RunnersPlacementAnswer<Placement> =
  | { readonly saved: "Written"; readonly placement: Placement }
  | { readonly saved: "Unhosted" }
  | { readonly saved: "Failed"; readonly reason: string };

/** Where a save of the section got to. */
export type RunnersPlacementSaved =
  | { readonly saved: "Idle" }
  | { readonly saved: "Writing" }
  | { readonly saved: "Written" }
  | { readonly saved: "Unhosted" }
  | { readonly saved: "Failed"; readonly reason: string };

export function runnersPlacementAnswered<Placement>(
  result: ApiResult<Placement>,
): RunnersPlacementAnswer<Placement> {
  if (result.outcome === "Ok")
    return { saved: "Written", placement: result.value };
  if (result.outcome === "Rejected" && result.code === hostedRunsNotGrantedCode)
    return { saved: "Unhosted" };
  return { saved: "Failed", reason: panelReason(result) };
}
