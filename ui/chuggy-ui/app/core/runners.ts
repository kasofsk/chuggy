/**
 * What the runner pages draw, derived: the words for where a project's work
 * and sessions run and what decided it, the draft a placement is chosen in,
 * what a refused write is drawn as, and the package a machine is made a runner with, from
 * the command that installs it to the one that registers the machine.
 */

import type {
  ExecutionPlacementResponse,
  SessionPlacementResponse,
} from "../../../../src/contract/responses.ts";
import { hostedRunsNotGrantedCode } from "../../../../src/contract/rosters.ts";
import {
  workerPoolCapabilitySchema,
  workerPoolTokenCharsMax,
} from "../../../../src/contract/workerPool.ts";
import type {
  LeadOffering,
  PlacementRoute,
  PlacementRouteSource,
  SessionRunnerStanding,
} from "../../../../src/contract/rosters.ts";
import type { ApiFailure } from "./apiRequest.ts";
import type { Copy, CopyOrData } from "./copy.ts";
import { failureWords } from "./failureWords.ts";

/** A runner package as the console hands it to a reader. */
export interface RunnerPackage {
  /** What a reader chooses it as: the machine it runs on. */
  readonly label: Copy;
  /** The program the package installs, which registers the machine. */
  readonly program: string;
  /** What a machine needs before the install, in one line. */
  readonly needs: Copy;
  /** The command that installs the release chuggy pins for the package. */
  readonly installCommand: string;
  /** Where the package says what is left to do after registering a runner. */
  readonly guideAddress: string;
  /** Where the package says what is left to do after registering a chat host. */
  readonly chatHostGuideAddress: string;
  /** How long the package's service manager waits before starting its runner again after an exit it restarts. */
  readonly restartIntervalSecs: number;
  /** The exit statuses the release pinned gives a meaning, each by what it means. */
  readonly exitsMeant: Readonly<Partial<Record<number, RunnerExitMeant>>>;
}

/**
 * What a runner's exit status means where its package gives it one: that no
 * restart would be answered differently, so it is not started again, or that
 * it installed a release of itself and is started again on it.
 */
export type RunnerExitMeant = "Unrestarted" | "Updated";

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
    label: { id: "runners-package-linux" },
    program: "chuggy-linux",
    needs: { id: "runners-package-needs-linux" },
    installCommand:
      "npm i -g https://github.com/kasofsk/chuggy-linux/releases/download/v0.55.0/chuggy-linux-0.55.0.tgz",
    guideAddress: "https://github.com/kasofsk/chuggy-linux#configure",
    chatHostGuideAddress: "https://github.com/kasofsk/chuggy-linux#a-chat-host",
    /** `RestartSec=` of the unit `serviceUnit` writes, in chuggy-linux's `systemdUnit.mjs`. */
    restartIntervalSecs: 10,
    exitsMeant: {
      /** `unrestartedExitStatus`, in chuggy-linux's `systemdUnit.mjs`. */
      3: "Unrestarted",
      /** `updatedExitStatus`, in chuggy-linux's `systemdUnit.mjs`. */
      75: "Updated",
    },
  },
  darwin: {
    label: { id: "runners-package-darwin" },
    program: "chuggy-darwin",
    needs: { id: "runners-package-needs-darwin" },
    installCommand:
      "npm i -g https://github.com/kasofsk/chuggy-darwin/releases/download/v0.25.0/chuggy-darwin-0.25.0.tgz",
    guideAddress: "https://github.com/kasofsk/chuggy-darwin#run",
    chatHostGuideAddress: "https://github.com/kasofsk/chuggy-darwin#chat-host",
    /** `restartIntervalSecs`, the agent's `ThrottleInterval`, in chuggy-darwin's `launchAgent.mjs`. */
    restartIntervalSecs: 10,
    exitsMeant: {
      /** The one exit launchd does not restart, as chuggy-darwin's `launchAgent.mjs` says in its header. */
      0: "Unrestarted",
      /** `updatedExitStatus`, in chuggy-darwin's `launchAgent.mjs`. */
      75: "Updated",
    },
  },
} as const satisfies Record<string, RunnerPackage>;

/** A package by the name the reader chooses it under. */
export type RunnerPackageName = keyof typeof runnerPackages;

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
function runnerCapabilityFault(capability: string): Copy {
  if (capability.length > workerPoolTokenCharsMax)
    return {
      id: "runners-capability-too-long",
      args: { chars: workerPoolTokenCharsMax },
    };
  if (!/^[A-Za-z0-9]/u.test(capability))
    return { id: "runners-capability-start" };
  return { id: "runners-capability-characters" };
}

/**
 * The capabilities a reader typed, split on spaces and commas, or why they are
 * not: each must be a capability, none a platform, which the runner finds of
 * its machine, and none twice.
 */
export function runnerCapabilitiesTyped(
  typed: string,
): { readonly capabilities: readonly string[] } | { readonly refused: Copy } {
  const capabilities = typed.split(/[\s,]+/u).filter((word) => word !== "");
  for (const capability of capabilities) {
    if (!workerPoolCapabilitySchema.safeParse(capability).success)
      return {
        refused: {
          id: "runners-capability-refused",
          args: { capability, fault: runnerCapabilityFault(capability) },
        },
      };
    if (capability.startsWith("Platform:"))
      return {
        refused: { id: "runners-capability-detected", args: { capability } },
      };
  }
  if (new Set(capabilities).size !== capabilities.length)
    return { refused: { id: "runners-capability-twice" } };
  return { capabilities };
}

/** How long a minted token stays redeemable, which is the time a reader has to paste it. */
export const runnerTokenLifetimeSecs = 3600;

export function runnerRouteLabel(route: PlacementRoute): Copy {
  switch (route) {
    case "InCluster":
      return { id: "runners-route-hosted" };
    case "Pool":
      return { id: "runners-route-pool" };
  }
}

export function runnerRouteSourceLabel(source: PlacementRouteSource): Copy {
  switch (source) {
    case "Override":
      return { id: "runners-source-override" };
    case "Project":
      return { id: "runners-source-project" };
    case "Default":
      return { id: "runners-source-default" };
  }
}

/** Whether the runners a session would run on are there, in one word. */
export function runnerStandingLabel(standing: SessionRunnerStanding): Copy {
  switch (standing) {
    case "Unregistered":
      return { id: "runners-standing-none" };
    case "Offline":
      return { id: "runners-standing-offline" };
    case "Live":
      return { id: "runners-standing-live" };
  }
}

/** A capability as a reader says it: a platform's parts, and anything else as it is spelled. */
export function runnerCapabilityLabel(capability: string): string {
  const platform = /^Platform:(.+)$/u.exec(capability);
  return platform?.[1] === undefined
    ? capability
    : platform[1].replaceAll(":", " ");
}

/** Whose a registered machine is: one of the project's pools, one of the reader's own runners, or the reader's chat host. */
export type RunnerKind = "Pool" | "Personal" | "ChatHost";

/** Where a package says what is left to do once a machine is registered as `kind`. */
export function runnerGuideAddress(
  offered: RunnerPackage,
  kind: RunnerKind,
): string {
  switch (kind) {
    case "Pool":
    case "Personal":
      return offered.guideAddress;
    case "ChatHost":
      return offered.chatHostGuideAddress;
  }
}

/** What a reader's choices ask, or why they cannot be asked. */
export function runnerAskRead(
  chosen: RunnerPackageName,
  host: boolean,
  typed: string,
): { readonly ask: RunnerAsk } | { readonly refused: Copy } {
  const read = runnerCapabilitiesTyped(typed);
  if ("refused" in read) return read;
  return { ask: { package: chosen, host, capabilities: read.capabilities } };
}

/** The command that registers the machine a package was installed on, with this console and a minted token, as a pool's, as the reader's own or as their chat host, declaring what the reader asked. */
export function runnerRegisterCommand(
  installed: RunnerPackage,
  origin: string,
  token: string,
  kind: RunnerKind,
  ask: Pick<RunnerAsk, "host" | "capabilities"> = runnerAskDefault,
): string {
  const personal = kind === "Personal" ? " --personal" : "";
  const chat = kind === "ChatHost" ? " --chat" : "";
  const host = ask.host ? " --host" : "";
  const declared = ask.capabilities
    .map((capability) => ` --capability ${capability}`)
    .join("");
  return `${installed.program} register${personal} --api ${origin} --token=${token}${chat}${host}${declared}`;
}

/** Where the lead runs and as which offering: its route, and whether it is
 * the members' own or the subsidized lead. */
export interface RunnersLeadPlacement {
  readonly route: PlacementRoute;
  readonly offering: LeadOffering;
}

/** Every kind's route, the lead's with its offering, written as two
 * placements: work and evaluation, and a thread and the lead. The lead is held
 * as read and never moved here; the session placement's write still names it. */
export interface RunnersPlacementDraft {
  readonly work: PlacementRoute;
  readonly evaluation: PlacementRoute;
  readonly thread: PlacementRoute;
  readonly lead: RunnersLeadPlacement;
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
    lead: { route: session.lead.route, offering: session.leadOffering },
  };
}

/** The kinds the reader has chosen a route for since opening the editor, which
 * never include the lead. */
export type RunnersPlacementMoves = Partial<
  Omit<RunnersPlacementDraft, "lead">
>;

/** Each kind the reader moved where they moved it, and every other kind as the
 * newest read says, so a move made since the editor opened is kept. */
export function runnersPlacementMoved(
  read: RunnersPlacementDraft,
  moves: RunnersPlacementMoves,
): RunnersPlacementDraft {
  return { ...read, ...moves };
}

/** One choice a kind draws, and whether the reader may choose it. */
export interface RunnersPlacementOption {
  readonly choice: PlacementRoute;
  readonly choosable: boolean;
}

/** The choices the reader may make, after the one the kind was read on where
 * it is not among them, which is drawn as standing and kept until another is
 * chosen. */
export function runnersPlacementOptions(
  read: PlacementRoute,
  choices: readonly PlacementRoute[],
): readonly RunnersPlacementOption[] {
  const offered = choices.map((choice) => ({ choice, choosable: true }));
  return choices.includes(read)
    ? offered
    : [{ choice: read, choosable: false }, ...offered];
}

/** What a save writes: each placement only where one of its own kinds differs
 * from the read, since a write names both its kinds, and the session's with
 * the lead as read and its offering always named, since one left out is the
 * row's stored offering rather than the one read. */
export interface RunnersPlacementWrites {
  readonly execution:
    | { readonly work: PlacementRoute; readonly evaluation: PlacementRoute }
    | undefined;
  readonly session:
    | {
        readonly thread: PlacementRoute;
        readonly lead: PlacementRoute;
        readonly leadOffering: LeadOffering;
      }
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
      draft.thread === read.thread
        ? undefined
        : {
            thread: draft.thread,
            lead: read.lead.route,
            leadOffering: read.lead.offering,
          },
  };
}

/** Whether a placement's write was refused for the hosted grant, which the
 * section draws apart from any other refusal. */
export function runnersPlacementUnhosted(failure: ApiFailure): boolean {
  return (
    failure.outcome === "Rejected" && failure.code === hostedRunsNotGrantedCode
  );
}

/** The line a refused placement's write leaves in the section. */
export function runnersPlacementRefusal(failure: ApiFailure): CopyOrData {
  return runnersPlacementUnhosted(failure)
    ? { id: "runners-placement-unhosted" }
    : failureWords(failure).word;
}
