/**
 * What a run of `runner` found, did and stopped on, as values, and the
 * sentences each is printed as.
 *
 * Everything said of another program is this program's own words. The most
 * that is kept of what one printed is an excerpt already through the
 * redactor, held in a value that says it is one, and a line is flattened
 * where it is printed like every other. A stop is the shape every stop has:
 * what was found, what the person is told, and the condition the one command
 * its rule names may be run under. This module reaches nothing that runs,
 * because the report prints through it before anything else has been
 * evaluated.
 */

import type { ApiFailure } from "./apiRequest.ts";

/** The container engines the runner package runs its work in, the package's own default first. */
export const setupEngines = ["docker", "podman"] as const;

export type SetupEngine = (typeof setupEngines)[number];

/** How an engine answered this user: it did, it did not, or there is no such command. */
export interface SetupEngineAsked {
  readonly engine: SetupEngine;
  readonly answered: "Yes" | "No" | "Absent";
}

/** The things `runner` runs another program to do. */
export type SetupRunnerAct =
  "Install" | "Register" | "Check" | "Service" | "Reload" | "Start" | "Restart";

/** How a program that was run did not do what it was run for. */
export type SetupChildFailed =
  | { readonly how: "Unstarted" }
  | { readonly how: "Unended"; readonly secs: number }
  | { readonly how: "Exit"; readonly exit: number; readonly excerpt: string };

/** One thing a run found as it was or did, in the order it met them. */
export type SetupRunnerNote =
  | { readonly note: "Engine"; readonly engine: SetupEngine }
  | {
      readonly note: "Package" | "Installed";
      readonly command: string;
      readonly version: string | undefined;
    }
  | { readonly note: "Settings"; readonly path: string }
  | {
      readonly note: "SettingsWritten";
      readonly path: string;
      readonly engine: SetupEngine;
    }
  | { readonly note: "Login"; readonly path: string }
  | { readonly note: "Pool"; readonly path: string }
  | { readonly note: "PoolGone"; readonly path: string; readonly pool: string }
  | { readonly note: "Registered"; readonly path: string }
  /** `warned` is the first line of the check that passed with a warning, where one did. */
  | { readonly note: "Checked"; readonly warned: string | undefined }
  | { readonly note: "Unit" | "UnitWritten"; readonly unit: string }
  | { readonly note: "Linger" }
  | { readonly note: "LingerOn"; readonly read: boolean }
  | {
      readonly note: "Running" | "Started" | "Restarted";
      readonly unit: string;
    };

/**
 * What the runner package's own check looks at, by the names it prints them
 * under, each with what a failure of it means in this program's words.
 */
export const setupRunnerChecks = {
  "pool file": "this machine's registration could not be read",
  "runner configuration": "the runner's settings are not as it needs them",
  "runtime directory": "the runner has nowhere to keep what it runs with",
  "Claude token file": "the runner's Claude login is not as it needs it",
  "podman credential helpers": "podman would present logins of its own",
  "container engine": "the runner could not use the container engine",
  "job network": "the runner could not read its containers' network",
  "pool token":
    "chuggy's sign-in server did not take this machine's registration",
  plane: "chuggy did not answer this machine as a runner",
} as const;

export type SetupRunnerCheck = keyof typeof setupRunnerChecks;

/** A line of the check that is not `ok`, as the package prints one: its mark, the check's name, and what it found. */
const setupCheckLine = /^(FAIL|warn) +([^:]+): /u;

/** The first line the check printed aside under `mark`, with the check it is of where that is one this program knows. */
export function setupCheckFirst(
  aside: string,
  mark: "FAIL" | "warn",
):
  | { readonly check: SetupRunnerCheck | undefined; readonly line: string }
  | undefined {
  for (const line of aside.split("\n")) {
    const read = setupCheckLine.exec(line);
    if (read?.[1] !== mark) continue;
    const name = read[2] ?? "";
    const check = Object.keys(setupRunnerChecks).find(
      (known) => known === name,
    );
    return { check: check as SetupRunnerCheck | undefined, line };
  }
  return undefined;
}

/** A read of the site `runner` makes, by what it is of. */
export type SetupRunnerRead = "work" | "placement" | "pools";

/** Why a run stopped short of a runner the site sees live. */
export type SetupRunnerStop =
  | { readonly stop: "Mac" }
  | {
      readonly stop: "Unread";
      readonly read: SetupRunnerRead;
      readonly outcome: ApiFailure["outcome"] | "Refused" | "Cut";
    }
  | { readonly stop: "NotAdmin" }
  | { readonly stop: "Serviceless"; readonly guide: string }
  | { readonly stop: "Engineless"; readonly asked: readonly SetupEngineAsked[] }
  | {
      readonly stop: "SettingsUnread" | "LoginMissing";
      readonly path: string;
      readonly guide: string;
    }
  | { readonly stop: "Npmless" }
  | { readonly stop: "Unwritten"; readonly path: string }
  | {
      readonly stop: "Act";
      readonly act: SetupRunnerAct;
      readonly failed: SetupChildFailed;
    }
  | {
      readonly stop: "Unseen";
      readonly act: SetupRunnerAct;
      readonly path: string;
    }
  | {
      readonly stop: "MintRefused";
      readonly outcome: ApiFailure["outcome"];
      /** How long a token nobody redeemed stays counted, at the longest. */
      readonly lapseMins: number;
    }
  | {
      readonly stop: "CheckFailed";
      readonly check: SetupRunnerCheck | undefined;
      readonly line: string;
    }
  | {
      readonly stop: "LingerAsks";
      readonly command: string;
      readonly excerpt: string;
    }
  | { readonly stop: "Inactive"; readonly unit: string; readonly state: string }
  | {
      readonly stop: "NotLive";
      readonly waitedSecs: number;
      readonly registered: boolean;
    };

/** How a run of `runner` ended: the site sees a runner live, the project needs none, or it stopped. */
export type SetupRunnerEnded =
  | { readonly ended: "Live" }
  | { readonly ended: "Hosted" }
  | { readonly ended: "Stopped"; readonly stop: SetupRunnerStop };

/** A stop as it is said, and what its rule names: this command again, or the checklist where this command could do nothing more. */
export interface SetupRunnerStopSaid {
  readonly found: string;
  readonly tell: string;
  readonly when: string;
  readonly again: "Runner" | "Status";
  /** What an agent is told besides, where a stop tempts it to do what it must not. */
  readonly rule?: string;
}

/** A note as its word and its text. */
export type SetupRunnerNoteSaid = readonly ["found" | "did", string];

function setupVersioned(program: string, version: string | undefined): string {
  return version === undefined ? program : `${program} ${version}`;
}

/** The program a command's path ends in, which is how the package is named. */
function setupProgramOf(command: string): string {
  return command.slice(command.lastIndexOf("/") + 1);
}

type SetupServiceNote = Extract<
  SetupRunnerNote,
  {
    readonly note:
      | "Unit"
      | "UnitWritten"
      | "Linger"
      | "LingerOn"
      | "Running"
      | "Started"
      | "Restarted";
  }
>;

function setupServiceNoteSaid(note: SetupServiceNote): SetupRunnerNoteSaid {
  switch (note.note) {
    case "Unit":
      return ["found", `the runner's service is installed: ${note.unit}`];
    case "UnitWritten":
      return ["did", `installed the runner's service, ${note.unit}`];
    case "Linger":
      return ["found", "your services keep running after you log out"];
    case "LingerOn":
      return [
        "did",
        note.read
          ? "set your services to keep running after you log out"
          : "set your services to keep running after you log out, not having learned whether they already did",
      ];
    case "Running":
      return ["found", `${note.unit} is enabled and running`];
    case "Started":
      return ["did", `started ${note.unit}, which also starts when you log in`];
    case "Restarted":
      return [
        "did",
        `restarted ${note.unit}, so it runs as it is now registered and installed`,
      ];
  }
}

export function setupRunnerNoteSaid(
  note: SetupRunnerNote,
  project: string,
): SetupRunnerNoteSaid {
  switch (note.note) {
    case "Engine":
      return ["found", `${note.engine} answers you without a password`];
    case "Package":
      return [
        "found",
        `the runner package is installed: ${setupVersioned(setupProgramOf(note.command), note.version)}, at ${note.command}`,
      ];
    case "Installed":
      return [
        "did",
        `installed the runner package, ${setupVersioned(setupProgramOf(note.command), note.version)}, at ${note.command}`,
      ];
    case "Settings":
      return ["found", `the runner's settings are in ${note.path}`];
    case "SettingsWritten":
      return [
        "did",
        `wrote the runner's settings to ${note.path}: its guide's own, with ${note.engine} as the engine`,
      ];
    case "Login":
      return ["found", `the runner's Claude login is in ${note.path}`];
    case "Pool":
      return [
        "found",
        `this machine is registered as a runner of ${project}, in ${note.path}`,
      ];
    case "PoolGone":
      return [
        "found",
        `${note.path} registered this machine as ${note.pool}, and the site lists no runner of ${project} by that name`,
      ];
    case "Registered":
      return [
        "did",
        `registered this machine as a runner of ${project}, in ${note.path}`,
      ];
    case "Checked":
      return [
        "found",
        note.warned === undefined
          ? "the runner's own check passed"
          : `the runner's own check passed, with a warning: ${note.warned}`,
      ];
    case "Unit":
    case "UnitWritten":
    case "Linger":
    case "LingerOn":
    case "Running":
    case "Started":
    case "Restarted":
      return setupServiceNoteSaid(note);
  }
}

const setupUnchanged = "so nothing was changed on this machine";

/** Why a Mac is not a machine a runner is put on, said wherever one is met. */
export const setupMacNone = "chuggy has no runner for a Mac yet";
const setupTryAgain = "if the person asks to try again";

const setupEngineNames: Readonly<Record<SetupEngine, string>> = {
  docker: "Docker",
  podman: "Podman",
};

/** Which engines did not answer, as a sentence says it: the one the runner is set to use, or each the package runs on. */
export function setupEnginesNone(asked: readonly SetupEngineAsked[]): string {
  const names = asked.map(({ engine }) => setupEngineNames[engine]);
  return names.length < 2
    ? `${names.join("")}, the engine the runner is set to use, did not answer`
    : `neither ${names.join(" nor ")} answered`;
}

/** What taking a password would mend and this program does not do. */
export const setupEngineNeedsPassword =
  "Installing a container engine, or letting your user reach one, takes a password, and chuggy setup never takes one.";

function setupEnginelessSaid(
  asked: readonly SetupEngineAsked[],
): SetupRunnerStopSaid {
  const found = asked
    .map(({ engine, answered }) =>
      answered === "Absent"
        ? `${engine} is not installed`
        : `${engine} did not answer you without a password`,
    )
    .join("; ");
  return {
    found,
    tell: `A runner does its work in containers, and ${setupEnginesNone(asked)} on this machine without a password, ${setupUnchanged}. ${setupEngineNeedsPassword} Tell me once one answers you.`,
    when: "once the person says a container engine answers them on this machine",
    again: "Runner",
  };
}

const setupReadsSaid: Readonly<Record<SetupRunnerRead, string>> = {
  work: "where its work runs",
  placement: "how its runners stand",
  pools: "which runners it has",
};

function setupUnreadSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "Unread" }>,
  project: string,
): SetupRunnerStopSaid {
  const what = setupReadsSaid[stop.read];
  if (stop.outcome === "Refused")
    return {
      found: `the site does not show you ${project} or ${what}`,
      tell: `The chuggy site does not show you what a runner for ${project} is set up from, ${setupUnchanged}. An admin of the workspace can see it, or can give you the access to. Tell me if your access changes.`,
      when: "if the person says their access has changed",
      again: "Runner",
    };
  return {
    found: `the site did not say of ${project} ${what} (${stop.outcome})`,
    tell: "The chuggy site did not answer everything I asked it, so the runner is not set up yet. What was done before stays done. Tell me if you want me to try again.",
    when: setupTryAgain,
    again: "Runner",
  };
}

const setupActs: Readonly<Record<SetupRunnerAct, string>> = {
  Install: "installing the runner package",
  Register: "registering this machine",
  Check: "the runner's own check",
  Service: "installing the runner's service",
  Reload: "reloading your services",
  Start: "starting the runner's service",
  Restart: "restarting the runner's service",
};

function setupFailedSaid(failed: SetupChildFailed): string {
  switch (failed.how) {
    case "Unstarted":
      return "could not be started";
    case "Unended":
      return `did not end within ${String(failed.secs)} s and was stopped`;
    case "Exit":
      return failed.excerpt === ""
        ? `ended with exit ${String(failed.exit)} and said nothing`
        : `ended with exit ${String(failed.exit)}, saying: ${failed.excerpt}`;
  }
}

const setupPickedUp =
  "What was done before it stays done, and running again picks up from there. Tell me if you want me to try again.";

function setupActSaid(act: SetupRunnerAct, found: string): SetupRunnerStopSaid {
  const said = setupActs[act];
  return {
    found: `${said} ${found}`,
    tell: `${said.charAt(0).toUpperCase()}${said.slice(1)} did not work, so the runner is not set up yet. ${setupPickedUp}`,
    when: setupTryAgain,
    again: "Runner",
  };
}

function setupMintSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "MintRefused" }>,
  project: string,
): SetupRunnerStopSaid {
  const found = `the site made no registration token for ${project} (${stop.outcome})`;
  if (stop.outcome === "Absent")
    return {
      found,
      tell: `The chuggy site would not make a registration for ${project}: that takes an admin of it. The runner package is on this machine and nothing is registered. Tell me once you are an admin of ${project}.`,
      when: `once the person says they are an admin of ${project}`,
      again: "Runner",
    };
  if (stop.outcome === "Conflict")
    return {
      found,
      tell: `chuggy already holds as many unused registrations for ${project} as it keeps at once, so it made no more. Each lapses by itself within ${String(stop.lapseMins)} minutes of being made. Tell me when you want me to try again.`,
      when: setupTryAgain,
      again: "Runner",
    };
  return {
    found,
    tell: `The chuggy site did not make a registration for ${project}, so this machine is not registered yet. ${setupPickedUp}`,
    when: setupTryAgain,
    again: "Runner",
  };
}

function setupMachineSaid(
  stop: Extract<
    SetupRunnerStop,
    {
      readonly stop:
        | "Mac"
        | "Serviceless"
        | "SettingsUnread"
        | "LoginMissing"
        | "Npmless"
        | "Unwritten";
    }
  >,
): SetupRunnerStopSaid {
  switch (stop.stop) {
    case "Mac":
      return {
        found: "this machine is a Mac, and chuggy's runner runs on Linux",
        tell: `${setupMacNone}, and chuggy setup cannot set one up here, ${setupUnchanged}. The work on your tickets needs a runner on a Linux machine. Tell me once one is running there.`,
        when: "once the person says a runner is running on another machine",
        again: "Status",
      };
    case "Serviceless":
      return {
        found: "this machine's user services did not answer systemctl --user",
        tell: `chuggy setup runs the runner as a service of yours, and this machine's user services did not answer, ${setupUnchanged}. The runner's guide says how it is run by hand: ${stop.guide}. Tell me if you want me to try again.`,
        when: setupTryAgain,
        again: "Runner",
      };
    case "SettingsUnread":
      return {
        found: `${stop.path} is there and does not read as the runner's settings`,
        tell: `The runner's settings file, ${stop.path}, is there, and chuggy setup could not read from it which engine and which Claude login the runner uses, ${setupUnchanged}. The runner's guide says what the file holds: ${stop.guide}. Tell me once it is mended.`,
        when: `once the person says ${stop.path} is mended`,
        again: "Runner",
      };
    case "LoginMissing":
      return {
        found: `the runner has no Claude login on this machine: nothing is at ${stop.path}`,
        tell: `The runner needs a Claude login of its own on this machine, in ${stop.path}, and chuggy setup cannot make that yet, ${setupUnchanged}. The runner's guide says how it is made by hand: ${stop.guide}. Tell me once it is there.`,
        when: "once the person says the runner's Claude login is on this machine",
        again: "Runner",
        rule: "Never make, read or print a Claude login yourself: it is a secret, and one made from this conversation would be shown in it.",
      };
    case "Npmless":
      return {
        found: "the runner package is not installed, and npm did not answer",
        tell: `The runner package is installed with npm, and npm did not answer on this machine, ${setupUnchanged}. npm comes with Node. Tell me once npm runs here.`,
        when: "once the person says npm runs on this machine",
        again: "Runner",
      };
    case "Unwritten":
      return {
        found: `chuggy setup could not make ${stop.path}`,
        tell: `chuggy setup could not write the runner's settings to ${stop.path} on this machine, so the runner is not set up yet. ${setupPickedUp}`,
        when: `once ${stop.path} can be made`,
        again: "Runner",
      };
  }
}

function setupServiceSaid(
  stop: Extract<
    SetupRunnerStop,
    { readonly stop: "LingerAsks" | "Inactive" | "NotLive" | "CheckFailed" }
  >,
  project: string,
): SetupRunnerStopSaid {
  switch (stop.stop) {
    case "CheckFailed": {
      const meant =
        stop.check === undefined
          ? "the runner's own check did not pass"
          : setupRunnerChecks[stop.check];
      return {
        found: `${meant}; the runner's own check said: ${stop.line}`,
        tell: `The runner is installed and registered on this machine, and its own check did not pass: ${meant}. What it said is: ${stop.line}. Tell me once that is mended, or if you want me to try again.`,
        when: "once the person says it is mended or asks to try again",
        again: "Runner",
      };
    }
    case "LingerAsks":
      return {
        found: `your services stop when you log out, and chuggy setup could not change that${stop.excerpt === "" ? "" : `: loginctl said ${stop.excerpt}`}`,
        tell: `The runner is installed and registered on this machine. For it to keep running after you log out, one command is yours to run, because it may ask for your password and chuggy setup never takes one. In a terminal of your own, run ${stop.command} and tell me once you have.`,
        when: "once the person says they have run it",
        again: "Runner",
      };
    case "Inactive":
      return {
        found: `${stop.unit} was started and is ${stop.state === "" ? "not running" : stop.state}`,
        tell: `The runner's service was started and is not running, so the runner is not set up yet. ${setupPickedUp}`,
        when: setupTryAgain,
        again: "Runner",
      };
    case "NotLive":
      return {
        found: stop.registered
          ? `the runner's service is running, and after ${String(stop.waitedSecs)} s the site still sees no runner of ${project} live`
          : `the runner's service is running, and after ${String(stop.waitedSecs)} s the site lists no runner of ${project}`,
        tell: "The runner is installed, registered and started on this machine, and the chuggy site does not see it live yet. It can take a little longer. Tell me when you want me to look again.",
        when: "if the person asks to look again",
        again: "Runner",
      };
  }
}

/** A stop as it is said of a project named `project`, workspace first. */
export function setupRunnerStopSaid(
  stop: SetupRunnerStop,
  project: string,
): SetupRunnerStopSaid {
  switch (stop.stop) {
    case "Mac":
    case "Serviceless":
    case "SettingsUnread":
    case "LoginMissing":
    case "Npmless":
    case "Unwritten":
      return setupMachineSaid(stop);
    case "Unread":
      return setupUnreadSaid(stop, project);
    case "NotAdmin":
      return {
        found: `the site says you are not an admin of ${project}`,
        tell: `Putting a runner on a project takes an admin of it, and the chuggy site says you are not one of ${project}, ${setupUnchanged}. Ask an admin to make you one. Tell me once you are.`,
        when: `once the person says they are an admin of ${project}`,
        again: "Runner",
      };
    case "Engineless":
      return setupEnginelessSaid(stop.asked);
    case "Act":
      return setupActSaid(stop.act, setupFailedSaid(stop.failed));
    case "Unseen":
      return setupActSaid(
        stop.act,
        `ended well, and what it makes is not at ${stop.path}`,
      );
    case "MintRefused":
      return setupMintSaid(stop, project);
    case "CheckFailed":
    case "LingerAsks":
    case "Inactive":
    case "NotLive":
      return setupServiceSaid(stop, project);
  }
}

/** Zero where a stop waits on the person, one where something failed, two where the program cannot do this here. */
export function setupRunnerStopExit(stop: SetupRunnerStop): 0 | 1 | 2 {
  switch (stop.stop) {
    case "Mac":
      return 2;
    case "NotAdmin":
    case "Serviceless":
    case "Engineless":
    case "LoginMissing":
    case "Npmless":
    case "LingerAsks":
      return 0;
    case "Unread":
      return stop.outcome === "Refused" ? 0 : 1;
    case "SettingsUnread":
    case "Unwritten":
    case "Act":
    case "Unseen":
    case "MintRefused":
    case "CheckFailed":
    case "Inactive":
    case "NotLive":
      return 1;
  }
}
