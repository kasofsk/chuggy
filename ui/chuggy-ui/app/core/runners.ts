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
  WorkerPoolTokenResponse,
} from "../../../../src/contract/responses.ts";
import {
  hostedRunsNotGrantedCode,
  placementRoutes,
} from "../../../../src/contract/rosters.ts";
import {
  workerPoolCapabilitySchema,
  workerPoolTokenCharsMax,
} from "../../../../src/contract/workerPool.ts";
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
  /** What a reader chooses it as: the machine it runs on. */
  readonly label: string;
  /** The program the package installs, which registers the machine. */
  readonly program: string;
  /** What a machine needs before the install, in one line. */
  readonly needs: string;
  /** The command that installs the package's current release. */
  readonly installCommand: string;
  /** Where the package says what is left to do after registering. */
  readonly guideAddress: string;
}

const runnerReleasePattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;

/**
 * Whether a runner's version is below the one chuggy pins for its package:
 * plain `major.minor.patch` releases compared part by part as numbers, and
 * anything else never behind.
 */
export function runnerOutdated(
  version: string,
  pinned: string | undefined,
): boolean {
  if (pinned === undefined) return false;
  const have = runnerReleasePattern.exec(version);
  const want = runnerReleasePattern.exec(pinned);
  if (have === null || want === null) return false;
  for (let part = 1; part <= 3; part++) {
    const behind = Number(have[part]) - Number(want[part]);
    if (behind !== 0) return behind < 0;
  }
  return false;
}

/** The packages a machine is made a runner with, an entry a package. */
export const runnerPackages = {
  linux: {
    label: "Linux",
    program: "chuggy-linux",
    needs: "Linux · Node 24 · Docker or Podman",
    installCommand:
      "npm i -g https://github.com/kasofsk/chuggy-linux/releases/latest/download/chuggy-linux.tgz",
    guideAddress: "https://github.com/kasofsk/chuggy-linux#configure",
  },
  darwin: {
    label: "Mac",
    program: "chuggy-darwin",
    needs: "macOS · Node 24 · Colima",
    installCommand:
      "npm i -g https://github.com/kasofsk/chuggy-darwin/releases/latest/download/chuggy-darwin.tgz",
    guideAddress: "https://github.com/kasofsk/chuggy-darwin#run",
  },
} as const satisfies Record<string, RunnerPackage>;

/** A package by the name the reader chooses it under. */
export type RunnerPackageName = keyof typeof runnerPackages;

/** The package chuggy setup installs, on the Linux machine it runs on. */
export const runnerPackageOffered: RunnerPackage = runnerPackages.linux;

/** What a reader asks a runner to declare beside its platforms. */
export interface RunnerAsk {
  readonly package: RunnerPackageName;
  /** Whether it runs work that pins no image on the machine itself. */
  readonly host: boolean;
  /** The capabilities it declares it meets, as the reader typed them. */
  readonly capabilities: readonly string[];
}

/** The ask a press makes where the reader chose nothing. */
export const runnerAskDefault: RunnerAsk = {
  package: "linux",
  host: false,
  capabilities: [],
};

/** What is wrong with a word that is not a capability, in a few words. */
function runnerCapabilityFault(capability: string): string {
  if (capability.length > workerPoolTokenCharsMax)
    return `at most ${String(workerPoolTokenCharsMax)} characters`;
  if (!/^[A-Za-z0-9]/u.test(capability)) return "start with a letter or digit";
  return "use letters, digits, _, : and -";
}

/**
 * The capabilities a reader typed, split on spaces and commas, or why they are
 * not: each must be a capability, none a platform, which the runner finds of
 * its machine, and none twice.
 */
export function runnerCapabilitiesTyped(
  typed: string,
): { readonly capabilities: readonly string[] } | { readonly refused: string } {
  const capabilities = typed.split(/[\s,]+/u).filter((word) => word !== "");
  for (const capability of capabilities) {
    if (!workerPoolCapabilitySchema.safeParse(capability).success)
      return {
        refused: `${capability} · ${runnerCapabilityFault(capability)}`,
      };
    if (capability.startsWith("Platform:"))
      return {
        refused: `${capability} is detected, not typed`,
      };
  }
  if (new Set(capabilities).size !== capabilities.length)
    return { refused: "A capability is listed twice" };
  return { capabilities };
}

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

/** Whose a registered machine is: one of the project's pools, or the reader's own. */
export type RunnerKind = "Pool" | "Personal";

/** What a reader's choices ask, or why they cannot be asked. */
export function runnerAskRead(
  chosen: RunnerPackageName,
  host: boolean,
  typed: string,
): { readonly ask: RunnerAsk } | { readonly refused: string } {
  const read = runnerCapabilitiesTyped(typed);
  if ("refused" in read) return read;
  return { ask: { package: chosen, host, capabilities: read.capabilities } };
}

/** The command that registers the machine a package was installed on, with this console and a minted token, as a pool's or as the reader's own, declaring what the reader asked. */
export function runnerRegisterCommand(
  installed: RunnerPackage,
  origin: string,
  token: string,
  kind: RunnerKind,
  ask: Pick<RunnerAsk, "host" | "capabilities"> = runnerAskDefault,
): string {
  const personal = kind === "Personal" ? " --personal" : "";
  const host = ask.host ? " --host" : "";
  const declared = ask.capabilities
    .map((capability) => ` --capability ${capability}`)
    .join("");
  return `${installed.program} register${personal} --api ${origin} --token=${token}${host}${declared}`;
}

/**
 * Where minting a registration token has got to: nothing pressed, the ask the
 * reader fills in with why the last was refused, the mint, and the steps the
 * token is handed over in with what the reader asked.
 */
export type RunnerMint =
  | { readonly mint: "Idle" }
  | { readonly mint: "Asking"; readonly reason?: string }
  | { readonly mint: "Minting" }
  | {
      readonly mint: "Minted";
      readonly minted: WorkerPoolTokenResponse;
      readonly ask: RunnerAsk;
    };

/** Where `Add runner` is drawn: in the panel's head, or under the line an empty roster is said in. */
export type RunnerAddPlace = "Head" | "Empty";

/**
 * Where a reader who may add a runner is drawn the control: under an empty
 * roster's line, where it is the one thing to do, and in the head otherwise.
 * Nowhere while the roster is unread, so it is not drawn in one place and then
 * the other, and nowhere under the ask or steps an empty roster's control
 * opened.
 */
export function runnerAddPlace(view: {
  readonly administers: boolean;
  readonly roster: PanelState<WorkerPoolsResponse>;
  readonly opened: boolean;
}): RunnerAddPlace | undefined {
  if (!view.administers || view.roster.state === "Pending") return undefined;
  if (view.roster.state !== "Ready" || view.roster.value.pools.length > 0)
    return "Head";
  return view.opened ? undefined : "Empty";
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
