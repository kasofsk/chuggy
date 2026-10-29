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
import { runnerPackages } from "./runners.ts";

/** The container engines the runner package runs its work in, the package's own default first. */
export const setupEngines = ["docker", "podman"] as const;

export type SetupEngine = (typeof setupEngines)[number];

/** The kinds of Claude credential the runner package runs its work on, by its own names; a machine with no settings is given the first. */
export const setupClaudeKinds = [
  "Subscription",
  "ApiKey",
  "Bedrock",
  "Vertex",
  "Foundry",
] as const;

export type SetupClaudeKind = (typeof setupClaudeKinds)[number];

/**
 * The runner's Claude credential: its kind and the one file that is its
 * secret, and of a Bedrock credential the profile it reads of an AWS
 * credentials file, none where the file is a Bedrock API key.
 */
export type SetupClaudeCredential =
  | {
      readonly kind: Exclude<SetupClaudeKind, "Bedrock">;
      readonly path: string;
    }
  | {
      readonly kind: "Bedrock";
      readonly path: string;
      readonly profile: string | undefined;
    };

/** Each kind as the person is told it: the credential, what makes one where its file holds it alone, and what the work then runs on. */
const setupClaudeWords: Record<
  SetupClaudeKind,
  { readonly credential: string; readonly made: string; readonly on: string }
> = {
  Subscription: {
    credential: "Claude login",
    made: "the login the command claude setup-token makes, which needs a Claude plan that allows it",
    on: "your Claude plan",
  },
  ApiKey: {
    credential: "Anthropic API key",
    made: "a key from the Claude Console, made in a workspace",
    on: "your Anthropic API key",
  },
  Bedrock: {
    credential: "Bedrock credential",
    made: "a Bedrock API key",
    on: "your Amazon Bedrock account",
  },
  Vertex: {
    credential: "Google Cloud service account key",
    made: "the JSON key Google Cloud made for a service account",
    on: "your Google Cloud project",
  },
  Foundry: {
    credential: "Foundry API key",
    made: "a key of the Microsoft Foundry resource",
    on: "your Microsoft Foundry resource",
  },
};

/** What the credential is and where it is kept, as the person is told it: its secret alone in its file, or an AWS credentials file whose profile holds an access key. */
function setupClaudeSaved(credential: SetupClaudeCredential): string {
  const { path } = credential;
  const kept = "readable only by you (mode 600)";
  return credential.kind === "Bedrock" && credential.profile !== undefined
    ? `It is an AWS credentials file, saved in ${path} and ${kept}, whose [${credential.profile}] profile holds aws_access_key_id and aws_secret_access_key.`
    : `It is ${setupClaudeWords[credential.kind].made}, saved alone in ${path} and ${kept}.`;
}

/** What work on a runner whose credential is of `kind` runs on, as an offer says it. */
export function setupClaudeOn(kind: SetupClaudeKind): string {
  return setupClaudeWords[kind].on;
}

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

/** The things `runner` runs another program to do; `RegisterChat`, `CheckChat` and `ServiceChat` are of the person's chat host. */
export type SetupRunnerAct =
  | "Install"
  | "Register"
  | "Check"
  | "Service"
  | "RegisterChat"
  | "CheckChat"
  | "ServiceChat"
  | "Reload"
  | "Start"
  | "Restart";

/**
 * What the runner package's `register` says where it refuses, by the words of
 * each that are the same every time and in the order it can meet them, each
 * with what it means in this program's words. The first is said by every
 * command of the package, before anything else.
 */
export const setupRegisterRefusals = {
  "needs Node":
    "the runner package needs a newer Node than the node this machine's PATH finds first",
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
      readonly note: "Package";
      readonly command: string;
      readonly version: string | undefined;
    }
  | {
      readonly note: "Installed";
      readonly command: string;
      readonly version: string | undefined;
      /** The package found before the install, where it is elsewhere and still there. */
      readonly kept:
        | { readonly command: string; readonly version: string | undefined }
        | undefined;
    }
  | {
      readonly note: "Outdated";
      readonly command: string;
      readonly version: string | undefined;
      readonly least: string;
    }
  | { readonly note: "Settings"; readonly path: string }
  | {
      readonly note: "SettingsWritten";
      readonly path: string;
      readonly engine: SetupEngine;
    }
  | {
      readonly note: "Login";
      readonly credential: SetupClaudeCredential;
    }
  | { readonly note: "Pool"; readonly path: string }
  | { readonly note: "PoolGone"; readonly path: string; readonly pool: string }
  | { readonly note: "Registered"; readonly path: string }
  /** `warned` is the first line of the check that passed with a warning, where one did. */
  | { readonly note: "Checked"; readonly warned: string | undefined }
  | { readonly note: "ChatChecked"; readonly warned: string | undefined }
  | { readonly note: "Unit" | "UnitWritten"; readonly unit: string }
  | { readonly note: "ProjectLive" }
  /** The project's work runs on the cluster, said where the person's chat host is set up all the same. */
  | { readonly note: "Hosted" }
  /** `ChatHostGone` is a registration this machine holds that is not the chat host the site holds for the person. */
  | {
      readonly note: "ChatHost" | "ChatHostGone" | "ChatHostRegistered";
      readonly path: string;
    }
  | { readonly note: "ChatUnit" | "ChatUnitWritten"; readonly unit: string }
  /** `ChatHostElsewhere` is the person's chat host live on another machine, which is left as it is. */
  | { readonly note: "ChatHostLive" | "ChatHostElsewhere" }
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
  "Claude credential": "the runner's Claude credential is not as it needs it",
  "podman credential helpers": "podman would present logins of its own",
  "container engine": "the runner could not use the container engine",
  "job network": "the runner could not read its containers' network",
  "pool token":
    "chuggy's sign-in server did not take this machine's registration",
  plane: "chuggy did not answer this machine as a runner",
  "chat credential directory":
    "the Claude credential is not alone in a directory of its own, which a chat host needs",
  "chat settings": "the chat host's settings are not as it needs them",
  "chat session users":
    "the container engine cannot run each chat as a user of its own",
  "chat supervisor":
    "a container left from an earlier chat host is in the way of this one",
  "chat image": "the image the chat host runs could not be found or pulled",
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
export type SetupRunnerRead =
  "work" | "threads" | "placement" | "pools" | "permit" | "chat";

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
      readonly stop: "SettingsUnread";
      readonly path: string;
      readonly guide: string;
    }
  | {
      readonly stop: "LoginMissing";
      readonly credential: SetupClaudeCredential;
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
      /** The install ended well and left a package older than the run can use. */
      readonly stop: "Behind";
      readonly command: string;
      readonly version: string | undefined;
      readonly least: string;
    }
  | {
      /** The package would not write its service over the unit already at `path`. */
      readonly stop: "ServiceRefused";
      readonly act: "Service" | "ServiceChat";
      readonly path: string;
      readonly failed: Extract<SetupChildFailed, { readonly how: "Exit" }>;
    }
  | {
      readonly stop: "MintRefused";
      readonly outcome: ApiFailure["outcome"];
      /** How long a token nobody redeemed stays counted, at the longest. */
      readonly lapseMins: number;
    }
  | {
      readonly stop: "CheckFailed";
      /** Whose file was checked: the project's runner's or the person's chat host's. */
      readonly act: "Check" | "CheckChat";
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
      /** The one word the service manager said of the service, empty where what it said is no word, or nothing where it did not answer. */
      readonly state: string | undefined;
      /** How long the site had been waited on when the service was found stopped, or nothing where it was asked straight after it was started. */
      readonly waitedSecs: number | undefined;
    }
  | {
      readonly stop: "NotLive";
      readonly waitedSecs: number;
      readonly registered: boolean;
    }
  | {
      /** The workspace does not let the person register a chat host; `work` is what the project's work has, said as set up. */
      readonly stop: "PermitWithheld";
      readonly people: string;
      readonly work: "Runner" | "Cluster";
    }
  | {
      readonly stop: "ChatMintRefused";
      readonly outcome: ApiFailure["outcome"];
      readonly lapseMins: number;
    }
  /** The person's chat host is another machine, registered and not running, which registering this one would replace; `runners` is the page it is removed on. */
  | { readonly stop: "ChatHostOffline"; readonly runners: string }
  | {
      /** The runner's credential cannot be handed to a chat host: it is a symbolic link, or it shares the directory the chat host is handed whole; `login` is where a Claude login of the runner's own is kept alone. */
      readonly stop: "ChatLogin";
      readonly how: "Linked" | "Shared";
      readonly credential: SetupClaudeCredential;
      readonly settings: string;
      readonly login: string;
    }
  | { readonly stop: "ChatHostNotLive"; readonly waitedSecs: number };

/** How a run of `runner` ended: the site sees live the runner the project's work runs on and the chat host the person's chats in it run on, the cluster runs both, or it stopped. */
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

type SetupChatNote = Extract<
  SetupRunnerNote,
  {
    readonly note:
      | "ProjectLive"
      | "Hosted"
      | "ChatHost"
      | "ChatHostGone"
      | "ChatHostRegistered"
      | "ChatChecked"
      | "ChatUnit"
      | "ChatUnitWritten"
      | "ChatHostLive"
      | "ChatHostElsewhere";
  }
>;

/** What the site sees of the project's runner, and what a run found and did of the person's chat host. */
function setupChatNoteSaid(
  note: SetupChatNote,
  project: string,
): SetupRunnerNoteSaid {
  switch (note.note) {
    case "ProjectLive":
      return ["found", `the site sees a runner of ${project} live`];
    case "Hosted":
      return [
        "found",
        `chuggy's cluster runs the work of ${project}, so that work needs no runner`,
      ];
    case "ChatHost":
      return [
        "found",
        `this machine is registered as your chat host, in ${note.path}`,
      ];
    case "ChatHostGone":
      return [
        "found",
        `${note.path} registered this machine as your chat host, and the site no longer knows that registration`,
      ];
    case "ChatHostRegistered":
      return [
        "did",
        `registered this machine as your chat host, in ${note.path}`,
      ];
    case "ChatChecked":
      return [
        "found",
        note.warned === undefined
          ? "the chat host's own check passed"
          : `the chat host's own check passed, with a warning: ${note.warned}`,
      ];
    case "ChatUnit":
      return ["found", `your chat host's service is installed: ${note.unit}`];
    case "ChatUnitWritten":
      return ["did", `installed your chat host's service, ${note.unit}`];
    case "ChatHostLive":
      return [
        "found",
        `the site sees this machine live as your chat host, so your chats in ${project} can run on it`,
      ];
    case "ChatHostElsewhere":
      return [
        "found",
        `the site sees your chat host live on another machine, so your chats in ${project} run there`,
      ];
  }
}

type SetupPoolNote = Extract<
  SetupRunnerNote,
  { readonly note: "Pool" | "PoolGone" | "Registered" | "Checked" }
>;

function setupPoolNoteSaid(
  note: SetupPoolNote,
  project: string,
): SetupRunnerNoteSaid {
  switch (note.note) {
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
    case "Outdated":
      return [
        "found",
        `the runner package is installed: ${setupVersioned(setupProgramOf(note.command), note.version)}, at ${note.command}, and chuggy setup needs ${note.least} or later${note.version === undefined ? " and could not read its version" : ""}`,
      ];
    case "Installed":
      return [
        "did",
        `installed the runner package, ${setupVersioned(setupProgramOf(note.command), note.version)}, at ${note.command}${note.kept === undefined ? "" : `, and ${setupVersioned(setupProgramOf(note.kept.command), note.kept.version)} is still at ${note.kept.command}`}`,
      ];
    case "Settings":
      return ["found", `the runner's settings are in ${note.path}`];
    case "SettingsWritten":
      return [
        "did",
        `wrote the runner's settings to ${note.path}: its guide's own, with ${note.engine} as the engine`,
      ];
    case "Login":
      return [
        "found",
        `the runner's ${setupClaudeWords[note.credential.kind].credential} is in ${note.credential.path}`,
      ];
    case "Pool":
    case "PoolGone":
    case "Registered":
    case "Checked":
      return setupPoolNoteSaid(note, project);
    case "Unit":
    case "UnitWritten":
    case "Linger":
    case "LingerOn":
    case "Running":
    case "Enabled":
    case "Started":
    case "Restarted":
      return setupServiceNoteSaid(note);
    case "ProjectLive":
    case "Hosted":
    case "ChatHost":
    case "ChatHostGone":
    case "ChatHostRegistered":
    case "ChatChecked":
    case "ChatUnit":
    case "ChatUnitWritten":
    case "ChatHostLive":
    case "ChatHostElsewhere":
      return setupChatNoteSaid(note, project);
  }
}

const setupUnchanged = "so nothing was changed on this machine";

/** Why setup puts no runner on a Mac, said wherever one is met. */
export const setupMacNone = "chuggy setup puts a runner only on Linux";
const setupTryAgain = "if the person asks to try again";
const setupLookAgain = "if the person asks to look again";
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

/** The package's rule in this program's words: a job under docker is one user of the machine, who could read no other's Claude credential. */
export function setupDockerBarredTold(
  user: string | undefined,
  how: SetupDockerBarred,
): SetupDockerBarredTold {
  const why = `Under docker a runner's work runs as this machine's user ${setupJobUser}, which could not read the file your Claude credential is in, so the runner package takes docker only from that user, and you are ${user === undefined ? "not that user" : `user ${user}`}.`;
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
  threads: "where your chats in it run",
  placement: "how its runners stand",
  pools: "which runners it has",
  permit: "whether you may register a chat host",
  chat: "whether you have a chat host",
};

/** The reads a run makes before it looks at the machine, which makes them the ones a stop at can say nothing was changed. */
const setupReadsFirst: readonly SetupRunnerRead[] = ["work", "threads"];

/** What a read the site did not give leaves of a run: a runner not known to be set up, which is not one known not to be. */
const setupUnknown =
  "so I cannot say the runner is set up. What was done before stays done";

function setupUnreadSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "Unread" }>,
  project: string,
): SetupRunnerStopSaid {
  const what = setupReadsSaid[stop.read];
  if (stop.outcome === "Refused")
    return {
      found: `the site does not show you ${project} or ${what}`,
      tell: `The chuggy site does not show you what a runner for ${project} is set up from, ${setupReadsFirst.includes(stop.read) ? setupUnchanged : setupUnknown}. An admin of the workspace can see it, or can give you the access to. Tell me if your access changes.`,
      when: "if the person says their access has changed",
      again: "Runner",
    };
  return {
    found: `the site did not say of ${project} ${what} (${stop.outcome})`,
    tell: `The chuggy site did not answer everything I asked it, ${setupUnknown}. Tell me if you want me to try again.`,
    when: setupTryAgain,
    again: "Runner",
  };
}

const setupActs: Readonly<Record<SetupRunnerAct, string>> = {
  Install: "installing the runner package",
  Register: "registering this machine",
  Check: "the runner's own check",
  Service: "installing the runner's service",
  RegisterChat: "registering this machine as your chat host",
  CheckChat: "the chat host's own check",
  ServiceChat: "installing your chat host's service",
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

/** An install that left a package older than the run can use, which running again would install again until the package has a newer release. */
function setupBehindSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "Behind" }>,
): SetupRunnerStopSaid {
  const program = setupProgramOf(stop.command);
  const left = setupVersioned(program, stop.version);
  const unread =
    stop.version === undefined ? " and could not read its version" : "";
  return {
    found: `installing the runner package left ${left} at ${stop.command}, and chuggy setup needs ${stop.least} or later${unread}`,
    tell: `Installing the runner package left ${left}, and chuggy setup needs ${stop.least} or later here, so the runner is not set up yet. chuggy setup installs the package's latest release, so running again now would install the same one. Tell me once a newer ${program} is out.`,
    when: `once the person says a newer ${program} is out`,
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
  "needs Node": {
    tell: "The runner package needs a newer Node than the node this machine's PATH finds first, so the runner is not set up yet. Running again under the same Node would end the same way. Tell me once node is newer.",
    when: "once the person says node on this machine is newer",
    again: "Runner",
  },
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

/** The package's refusal a failed program named, where it is one that lasts. */
function setupLasting(
  failed: SetupChildFailed,
): Pick<SetupRunnerStopSaid, "tell" | "when" | "again"> | undefined {
  const refusal =
    failed.how === "ExitUnquoted"
      ? failed.refusal
      : failed.how === "Exit"
        ? setupRegisterRefusal(failed.excerpt)
        : undefined;
  return refusal === undefined ? undefined : setupRefusalsLasting[refusal];
}

/** A program that failed, as a stop: one to try again, but for a refusal that lasts, which waits on what would have to change. */
function setupActStopSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "Act" }>,
): SetupRunnerStopSaid {
  return {
    ...setupActSaid(stop.act, setupFailedSaid(stop.failed)),
    ...setupLasting(stop.failed),
  };
}

/** The package refusing to write its service over a unit already there, which it does where that unit serves another registration or is not one it can read back. */
function setupServiceRefusedSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "ServiceRefused" }>,
): SetupRunnerStopSaid {
  const said = setupActs[stop.act];
  return {
    found: `${said} ${setupFailedSaid(stop.failed)}`,
    tell: `${said.charAt(0).toUpperCase()}${said.slice(1)} did not work, so the runner is not set up yet: the runner package would not write it over the service already at ${stop.path}. If that one is left from a runner set up before, remove it, and tell me once you have or if you want me to try again.`,
    when: `once the person says ${stop.path} is removed, or asks to try again`,
    again: "Runner",
    ...setupLasting(stop.failed),
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

/** No credential where the runner's settings say it is, or at the login's own place where there are no settings; a subscription's is what a newcomer is told to make. */
function setupLoginMissingSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "LoginMissing" }>,
): SetupRunnerStopSaid {
  const { kind, path } = stop.credential;
  const { credential } = setupClaudeWords[kind];
  const saved = setupClaudeSaved(stop.credential);
  return {
    found: `the runner has no ${credential} on this machine: nothing is at ${path}`,
    tell:
      kind === "Subscription"
        ? `The runner needs a Claude login of its own on this machine, and there is none at ${path}, ${setupUnchanged}. ${saved} An Anthropic API key or a cloud provider's credential can be used instead; the runner's guide says how: ${stop.guide}. Tell me once one is there.`
        : `The runner's settings name its ${credential} as ${path}, and nothing is there, ${setupUnchanged}. ${saved} Tell me once it is there.`,
    when: `once the person says the runner's ${credential} is on this machine`,
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
        found:
          "this machine is a Mac, and chuggy setup puts a runner only on Linux",
        tell: `${setupMacNone} and cannot set one up here, ${setupUnchanged}. A Mac runs one with ${runnerPackages.darwin.program}, added by hand, and a Linux machine runs one too. Tell me once one is running.`,
        when: "once the person says a runner is running",
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
        tell: `The runner's settings file, ${stop.path}, is there, and chuggy setup could not read from it which engine and which Claude credential the runner uses, ${setupUnchanged}. The runner's guide says what the file holds: ${stop.guide}. Tell me once it is mended.`,
        when: `once the person says ${stop.path} is mended`,
        again: "Runner",
      };
    case "LoginMissing":
      return setupLoginMissingSaid(stop);
    case "Npmless":
      return {
        found:
          "the runner package is not installed at a version chuggy setup can use, and npm did not answer",
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
      const check = setupActs[stop.act];
      const meant =
        stop.check === undefined
          ? `${check} did not pass`
          : setupRunnerChecks[stop.check];
      const what =
        stop.act === "Check"
          ? "The runner is installed and registered on this machine"
          : "This machine is registered as your chat host";
      return {
        found: `${meant}; ${check} said: ${stop.line}`,
        tell: `${what}, and its own check did not pass: ${meant}. What it said is: ${stop.line}. Tell me once that is mended, or if you want me to try again.`,
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
        when: setupLookAgain,
        again: "Runner",
      };
  }
}

/** A mint of the person's chat host registration token the site refused, by why. */
function setupChatMintSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "ChatMintRefused" }>,
): SetupRunnerStopSaid {
  const found = `the site made no registration token for your chat host (${stop.outcome})`;
  if (stop.outcome === "Absent")
    return {
      found,
      tell: "The chuggy site would not make a registration for a chat host of yours: the workspace lets only members it chooses register one. Tell me once a workspace admin has let you.",
      when: "once the person says a workspace admin has let them register a chat host",
      again: "Runner",
    };
  if (stop.outcome === "Conflict")
    return {
      found,
      tell: `chuggy already holds as many unused registrations of yours as it keeps at once, so it made no more. Each lapses by itself within ${String(stop.lapseMins)} minutes of being made. Tell me when you want me to try again.`,
      when: setupTryAgain,
      again: "Runner",
    };
  return {
    found,
    tell: `The chuggy site did not make a registration for your chat host, so this machine is not your chat host yet. ${setupPickedUp}`,
    when: setupTryAgain,
    again: "Runner",
  };
}

/** Restarts every runner service of this machine's, each of which reads the runner's settings only as it starts. */
const setupRestartAll = `systemctl --user restart '${runnerPackages.linux.program}-*.service'`;

/**
 * A credential a chat host cannot be handed, and how a copy is put where it
 * can be: a subscription's at the login's own place, any other in a directory
 * of its own. A copy leaves the running services the file they were started
 * on until they restart onto the settings that name it.
 */
function setupChatLoginSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "ChatLogin" }>,
): SetupRunnerStopSaid {
  const { kind, path } = stop.credential;
  const { credential } = setupClaudeWords[kind];
  const directory = stop.login.slice(0, stop.login.lastIndexOf("/"));
  const why =
    stop.how === "Linked"
      ? `is handed the runner's ${credential} only as a file of its own, and ${path} is a symbolic link`
      : `is handed the directory of the runner's ${credential} whole, and ${path} shares its directory with other files`;
  const copy =
    kind === "Subscription"
      ? `Copy the token itself alone to ${stop.login}, readable only by you (mode 600), and set claudeTokenFile in ${stop.settings} to ${stop.login}.`
      : `Copy it alone into a directory of its own, such as ${directory}, readable only by you, and change where ${stop.settings} names it to the copy.`;
  return {
    found:
      stop.how === "Linked"
        ? `the runner's ${credential}, ${path}, is a symbolic link, which your chat host is not handed`
        : `the runner's ${credential}, ${path}, is not alone in its directory, which your chat host is handed whole`,
    tell: `Your chat host ${why}, so this machine is not your chat host yet. ${copy} Then restart this machine's runner services, which read the settings only as they start: ${setupRestartAll}. The old one can go once they have. Tell me once they have restarted.`,
    when: `once the person says the runner's ${credential} is copied alone into a directory of its own and its services have restarted`,
    again: "Runner",
  };
}

/** Where the person's chat host stopped short: the workspace has not let them have one, the site would not register it, theirs is another machine that is not running, this machine's credential cannot be handed to it, or it is not seen live. */
function setupChatSaid(
  stop: Extract<
    SetupRunnerStop,
    {
      readonly stop:
        | "PermitWithheld"
        | "ChatMintRefused"
        | "ChatHostOffline"
        | "ChatLogin"
        | "ChatHostNotLive";
    }
  >,
  project: string,
): SetupRunnerStopSaid {
  switch (stop.stop) {
    case "PermitWithheld":
      return {
        found: "the workspace does not let you register a chat host",
        tell: `${stop.work === "Runner" ? `The runner for the work on ${project} is set up and live.` : `chuggy's cluster runs the work on ${project}.`} Your chats there run only on your chat host, and the workspace does not let you register one yet. An admin of the workspace, you if you are one, turns on Personal runners for you on its People page, ${stop.people}, with Edit on your row. Tell me once it is on.`,
        when: "once the person says Personal runners is on for them in the workspace",
        again: "Runner",
      };
    case "ChatMintRefused":
      return setupChatMintSaid(stop);
    case "ChatHostOffline":
      return {
        found: "your chat host is another machine, registered and not running",
        tell: `Your chats in ${project} run only on your chat host, which is another machine, registered and not running. A member has one chat host, so making this machine it would replace that one. Start it on its machine, or remove it on your My runners page, ${stop.runners}, for this machine to be it instead. Tell me once you have done either.`,
        when: "once the person says their chat host is running, or that they removed it",
        again: "Runner",
      };
    case "ChatLogin":
      return setupChatLoginSaid(stop);
    case "ChatHostNotLive":
      return {
        found: `your chat host's service is running, and after ${String(stop.waitedSecs)} s the site still does not see this machine live as your chat host`,
        tell: "Your chat host is installed, registered and started on this machine, and the chuggy site does not see it live yet. It can take a little longer. Tell me when you want me to look again.",
        when: setupLookAgain,
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
    case "Behind":
      return setupBehindSaid(stop);
    case "ServiceRefused":
      return setupServiceRefusedSaid(stop);
    case "MintRefused":
      return setupMintSaid(stop, project);
    case "CheckFailed":
    case "LingerAsks":
    case "Inactive":
    case "NotLive":
      return setupServiceSaid(stop, project);
    case "PermitWithheld":
    case "ChatMintRefused":
    case "ChatHostOffline":
    case "ChatLogin":
    case "ChatHostNotLive":
      return setupChatSaid(stop, project);
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
    case "PermitWithheld":
    case "ChatHostOffline":
    case "ChatLogin":
      return 0;
    case "Unread":
      return stop.outcome === "Refused" ? 0 : 1;
    case "SettingsUnread":
    case "Unwritten":
    case "Act":
    case "Unseen":
    case "Behind":
    case "ServiceRefused":
    case "MintRefused":
    case "CheckFailed":
    case "Inactive":
    case "NotLive":
    case "ChatMintRefused":
    case "ChatHostNotLive":
      return 1;
  }
}
