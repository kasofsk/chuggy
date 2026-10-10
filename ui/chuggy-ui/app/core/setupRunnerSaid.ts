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

/** The one user of a machine the package takes docker from, by number: the package's own, copied here because no command of it says it. */
export const setupJobUser = "1000";

/** What leaves a user the package bars from docker with no engine: the runner's settings set it to use docker, or none are written and podman did not answer. */
export type SetupDockerBarred =
  | { readonly barred: "Named"; readonly settings: string }
  | { readonly barred: "Podmanless"; readonly answered: "No" | "Absent" };

/** The things `runner` runs another program to do. */
export type SetupRunnerAct =
  "Install" | "Register" | "Check" | "Service" | "Reload" | "Start" | "Restart";

/**
 * What the runner package's `register` says where it refuses, by the words of
 * each that are the same every time and in the order it can meet them, each
 * with what it means in this program's words.
 */
export const setupRegisterRefusals = {
  "a Linux pool runs on":
    "the runner package does not run on this machine's kind of processor",
  "hostname makes no pool name":
    "this machine's name makes no name for a runner",
  "no token was spent":
    "the runner package could not make the directory it keeps registrations in",
  "did not answer the registration":
    "the site did not answer the runner package",
  "is unknown, spent or expired":
    "the site did not take the registration token it had just made",
  "run register again": "the site could not register this machine just then",
  "pool file could not be written":
    "the runner package could not write this machine's registration",
} as const;

export type SetupRegisterRefusal = keyof typeof setupRegisterRefusals;

/** Which of the package's refusals a failed registration printed, or nothing where it is none this program knows. */
export function setupRegisterRefusal(
  printed: string,
): SetupRegisterRefusal | undefined {
  return (Object.keys(setupRegisterRefusals) as SetupRegisterRefusal[]).find(
    (known) => printed.includes(known),
  );
}

/**
 * How a program that was run did not do what it was run for. One that was
 * handed a secret ends `ExitUnquoted`: nothing it printed is kept, only which
 * refusal of a closed set it named.
 */
export type SetupChildFailed =
  | { readonly how: "Unstarted" }
  | { readonly how: "Unended"; readonly secs: number }
  | { readonly how: "Exit"; readonly exit: number; readonly excerpt: string }
  | {
      readonly how: "ExitUnquoted";
      readonly exit: number;
      readonly refusal: SetupRegisterRefusal | undefined;
    };

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
  /** `Enabled` is a service found running and set by this run to start at login, where `Started` is one this run started. */
  | {
      readonly note: "Running" | "Enabled" | "Started" | "Restarted";
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
      readonly stop: "DockerBarred";
      /** This machine's user the run is, by number, where the machine numbers them. */
      readonly user: string | undefined;
      readonly how: SetupDockerBarred;
    }
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
  | {
      readonly stop: "Inactive";
      readonly unit: string;
      /** The one word the service manager said of the service, empty where it said none, or nothing where it did not answer. */
      readonly state: string | undefined;
      /** How long the site had been waited on when the service was found stopped, or nothing where it was asked straight after it was started. */
      readonly waitedSecs: number | undefined;
    }
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
      | "Enabled"
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
    case "Enabled":
      return [
        "did",
        `set ${note.unit}, which was running, to start when you log in`,
      ];
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
    case "Enabled":
    case "Started":
    case "Restarted":
      return setupServiceNoteSaid(note);
  }
}

const setupUnchanged = "so nothing was changed on this machine";

/** Why a Mac is not a machine a runner is put on, said wherever one is met. */
export const setupMacNone = "chuggy has no runner for a Mac yet";
const setupTryAgain = "if the person asks to try again";
const setupElsewhere =
  "once the person says a runner is running on another machine";

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

function setupEngineNone({ engine, answered }: SetupEngineAsked): string {
  return answered === "Absent"
    ? `${engine} is not installed`
    : `${engine} did not answer you without a password`;
}

function setupEnginelessSaid(
  asked: readonly SetupEngineAsked[],
): SetupRunnerStopSaid {
  return {
    found: asked.map(setupEngineNone).join("; "),
    tell: `A runner does its work in containers, and ${setupEnginesNone(asked)} on this machine without a password, ${setupUnchanged}. ${setupEngineNeedsPassword} Tell me once one answers you.`,
    when: "once the person says a container engine answers them on this machine",
    again: "Runner",
  };
}

/** A person the package bars from docker, as they are told it: the package's reason, what leaves them no engine, what mends it, and what that waits on. */
export interface SetupDockerBarredTold {
  readonly why: string;
  readonly state: string;
  readonly mend: string;
  readonly when: string;
}

const setupPodmanInstead =
  "The package's own answer for any other user is rootless podman";

/** The package's rule in this program's words: a job under docker is one user of the machine, who could read no other's Claude login. */
export function setupDockerBarredTold(
  user: string | undefined,
  how: SetupDockerBarred,
): SetupDockerBarredTold {
  const why = `Under docker a runner's work runs as this machine's user ${setupJobUser}, which could not read your Claude login, so the runner package takes docker only from that user, and you are ${user === undefined ? "not that user" : `user ${user}`}.`;
  if (how.barred === "Named")
    return {
      why,
      state: `The runner's settings, ${how.settings}, set it to use docker`,
      mend: `${setupPodmanInstead}: once podman answers you, set "engine" to "podman" in that file, and tell me once you have.`,
      when: `once the person says ${how.settings} names podman`,
    };
  return {
    why,
    state: `${setupPodmanInstead}, and ${setupEngineNone({ engine: "podman", answered: how.answered })}`,
    mend: `${setupEngineNeedsPassword} Tell me once podman answers you.`,
    when: "once the person says podman answers them on this machine",
  };
}

function setupDockerBarredSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "DockerBarred" }>,
): SetupRunnerStopSaid {
  const { why, state, mend, when } = setupDockerBarredTold(stop.user, stop.how);
  const only = `the runner package takes docker only from this machine's user ${setupJobUser}`;
  return {
    found:
      stop.how.barred === "Named"
        ? `the runner is set to use docker, in ${stop.how.settings}, and ${only}`
        : `${setupEngineNone({ engine: "podman", answered: stop.how.answered })}, and docker was not asked: ${only}`,
    tell: `${why} ${state}, ${setupUnchanged}. ${mend}`,
    when,
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
    case "ExitUnquoted":
      return failed.refusal === undefined
        ? `ended with exit ${String(failed.exit)}, and what it printed is not shown, since it was handed the registration token`
        : `ended with exit ${String(failed.exit)}: ${setupRegisterRefusals[failed.refusal]}`;
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

/**
 * The package's refusals that running again does not mend, each with what
 * would have to change first. Every try has the site make another token, so
 * none of these is offered again as it stands.
 */
const setupRefusalsLasting: {
  readonly [Refusal in SetupRegisterRefusal]?: Pick<
    SetupRunnerStopSaid,
    "tell" | "when" | "again"
  >;
} = {
  "a Linux pool runs on": {
    tell: "The runner package does not run on this machine's kind of processor, so chuggy setup cannot set a runner up here. The work on your tickets needs a runner on a Linux machine it does run on. Tell me once one is running there.",
    when: setupElsewhere,
    again: "Status",
  },
  "hostname makes no pool name": {
    tell: "The runner package names a runner after its machine, and this machine's name makes no name for one, so the runner is not set up yet. Running again as the machine is named now would end the same way. Tell me once this machine's name starts with a letter from a to z or a digit.",
    when: "once the person says this machine's name starts with a letter from a to z or a digit",
    again: "Runner",
  },
};

/** A program that failed, as a stop: one to try again, but for a refusal that lasts, which waits on what would have to change. */
function setupActStopSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "Act" }>,
): SetupRunnerStopSaid {
  const said = setupActSaid(stop.act, setupFailedSaid(stop.failed));
  if (stop.failed.how !== "ExitUnquoted" || stop.failed.refusal === undefined)
    return said;
  return { ...said, ...setupRefusalsLasting[stop.failed.refusal] };
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
        when: setupElsewhere,
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

/** A service not read as running: the state the service manager gave it, or that the service manager did not answer, which is not a service that stopped. */
function setupInactiveSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "Inactive" }>,
): SetupRunnerStopSaid {
  const was =
    stop.waitedSecs === undefined
      ? "was started and"
      : `was running and after ${String(stop.waitedSecs)} s`;
  if (stop.state === undefined)
    return {
      found: `${stop.unit} ${was} this machine's user services did not answer whether it is running`,
      tell: `This machine's user services did not answer when I asked whether the runner's service is running, so I cannot say the runner is set up. ${setupPickedUp}`,
      when: setupTryAgain,
      again: "Runner",
    };
  return {
    found: `${stop.unit} ${was} is ${stop.state === "" ? "not running" : stop.state}`,
    tell: `The runner's service was started and is not running, so the runner is not set up yet. ${setupPickedUp}`,
    when: setupTryAgain,
    again: "Runner",
  };
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
      return setupInactiveSaid(stop);
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
    case "DockerBarred":
      return setupDockerBarredSaid(stop);
    case "Act":
      return setupActStopSaid(stop);
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
    case "DockerBarred":
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
