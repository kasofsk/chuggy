/**
 * What the Runners page draws, derived: the words for where a project's work
 * and sessions run and what decided it, the draft a placement is chosen in,
 * what a write answered, and the package a machine is made a runner with, from
 * the command that installs it to the one that registers the machine.
 */

import type {
  ExecutionPlacementResponse,
  SessionPlacementResponse,
  WorkerPoolsResponse,
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
import type { PanelState } from "./freshness.ts";

/** A runner package as the console hands it to a reader. */
export interface RunnerPackage {
  /** The program the package installs, which registers the machine. */
  readonly program: string;
  /** The platforms a token minted for it lets a runner declare: the ones it runs on. */
  readonly platforms: readonly string[];
  /** What a machine needs before the install, in one line. */
  readonly needs: string;
  /** The command that installs the package's current release. */
  readonly installCommand: string;
  /** Where the package says what is left to do after registering. */
  readonly guideAddress: string;
}

/** The packages a machine is made a runner with, an entry a package. */
export const runnerPackages = {
  linux: {
    program: "chuggy-linux",
    platforms: ["Platform:Linux:Amd64", "Platform:Linux:Arm64"],
    needs: "Linux · Node 24 · Docker or Podman",
    installCommand:
      "npm i -g https://github.com/kasofsk/chuggy-linux/releases/latest/download/chuggy-linux.tgz",
    guideAddress: "https://github.com/kasofsk/chuggy-linux#configure",
  },
} as const satisfies Record<string, RunnerPackage>;

/** The package `Add runner` hands over, which is the one the console offers. */
export const runnerPackageOffered: RunnerPackage = runnerPackages.linux;

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

/** The command that registers the machine a package was installed on, with this console and a minted token. */
export function runnerRegisterCommand(
  installed: RunnerPackage,
  origin: string,
  token: string,
): string {
  return `${installed.program} register --api ${origin} --token=${token}`;
}

/** Where `Add runner` is drawn: in the panel's head, or under the line an empty roster is said in. */
export type RunnerAddPlace = "Head" | "Empty";

/**
 * Where a reader who may add a runner is drawn the control: under an empty
 * roster's line, where it is the one thing to do, and in the head otherwise.
 * Nowhere while the roster is unread, so it is not drawn in one place and then
 * the other, and nowhere under the steps an empty roster's control opened.
 */
export function runnerAddPlace(view: {
  readonly administers: boolean;
  readonly roster: PanelState<WorkerPoolsResponse>;
  readonly stepsDrawn: boolean;
}): RunnerAddPlace | undefined {
  if (!view.administers || view.roster.state === "Pending") return undefined;
  if (view.roster.state !== "Ready" || view.roster.value.pools.length > 0)
    return "Head";
  return view.stepsDrawn ? undefined : "Empty";
}

/** Every kind's route, written as two placements: work and evaluation, and a
 * thread and the lead. */
export interface RunnersPlacementDraft {
  readonly work: PlacementRoute;
  readonly evaluation: PlacementRoute;
  readonly thread: PlacementRoute;
  readonly lead: PlacementRoute;
}

/** Every kind's route as read, which a save is told apart from. */
export function runnersPlacementDraft(
  execution: ExecutionPlacementResponse,
  session: SessionPlacementResponse,
): RunnersPlacementDraft {
  return {
    work: execution.work.route,
    evaluation: execution.evaluation.route,
    thread: session.thread.route,
    lead: session.lead.route,
  };
}

/** The kinds the reader has chosen a route for since opening the editor. */
export type RunnersPlacementMoves = Partial<RunnersPlacementDraft>;

/** Each kind the reader moved where they moved it, and every other kind as the
 * newest read says, so a move made since the editor opened is kept. */
export function runnersPlacementMoved(
  read: RunnersPlacementDraft,
  moves: RunnersPlacementMoves,
): RunnersPlacementDraft {
  return { ...read, ...moves };
}

/** One route a kind's choice draws, and whether the reader may choose it. */
export interface RunnersPlacementOption {
  readonly route: PlacementRoute;
  readonly choosable: boolean;
}

/** The routes the reader may choose, after the one the kind was read on where
 * it is not among them, which is drawn as standing and kept until another is
 * chosen. */
export function runnersPlacementOptions(
  read: PlacementRoute,
  choices: readonly PlacementRoute[],
): readonly RunnersPlacementOption[] {
  const offered = choices.map((route) => ({ route, choosable: true }));
  return choices.includes(read)
    ? offered
    : [{ route: read, choosable: false }, ...offered];
}

/** What a save writes: each placement only where one of its own kinds differs
 * from the read, since a write names both its kinds. */
export interface RunnersPlacementWrites {
  readonly execution:
    | { readonly work: PlacementRoute; readonly evaluation: PlacementRoute }
    | undefined;
  readonly session:
    | { readonly thread: PlacementRoute; readonly lead: PlacementRoute }
    | undefined;
}

export function runnersPlacementWrites(
  read: RunnersPlacementDraft,
  draft: RunnersPlacementDraft,
): RunnersPlacementWrites {
  return {
    execution:
      draft.work === read.work && draft.evaluation === read.evaluation
        ? undefined
        : { work: draft.work, evaluation: draft.evaluation },
    session:
      draft.thread === read.thread && draft.lead === read.lead
        ? undefined
        : { thread: draft.thread, lead: draft.lead },
  };
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

/** Where a save of the section got to, and with a refusal, whether the
 * placement written before it landed, since that one stands. */
export type RunnersPlacementSaved =
  | { readonly saved: "Idle" }
  | { readonly saved: "Writing" }
  | { readonly saved: "Written" }
  | { readonly saved: "Unhosted"; readonly landed: boolean }
  | {
      readonly saved: "Failed";
      readonly reason: string;
      readonly landed: boolean;
    };

export function runnersPlacementAnswered<Placement>(
  result: ApiResult<Placement>,
): RunnersPlacementAnswer<Placement> {
  if (result.outcome === "Ok")
    return { saved: "Written", placement: result.value };
  if (result.outcome === "Rejected" && result.code === hostedRunsNotGrantedCode)
    return { saved: "Unhosted" };
  return { saved: "Failed", reason: panelReason(result) };
}
