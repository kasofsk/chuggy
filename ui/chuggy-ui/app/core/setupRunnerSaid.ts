/**
 * What a run of `runner` found, did and stopped on, as values, and the
 * catalog's sentences each is printed as.
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
import type { Copy, CopyArgument, CopyHanded, CopyId } from "./copy.ts";
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

/** Each kind as the person is told it: the credential, and what makes one where its file holds it alone. */
const setupClaudeWords: Record<
  SetupClaudeKind,
  { readonly credential: Copy; readonly made: Copy }
> = {
  Subscription: {
    credential: { id: "setup-runner-claude-subscription" },
    made: { id: "setup-runner-claude-subscription-made" },
  },
  ApiKey: {
    credential: { id: "setup-runner-claude-api-key" },
    made: { id: "setup-runner-claude-api-key-made" },
  },
  Bedrock: {
    credential: { id: "setup-runner-claude-bedrock" },
    made: { id: "setup-runner-claude-bedrock-made" },
  },
  Vertex: {
    credential: { id: "setup-runner-claude-vertex" },
    made: { id: "setup-runner-claude-vertex-made" },
  },
  Foundry: {
    credential: { id: "setup-runner-claude-foundry" },
    made: { id: "setup-runner-claude-foundry-made" },
  },
};

/** What the credential is and where it is kept, as the person is told it: its secret alone in its file, or an AWS credentials file whose profile holds an access key. */
function setupClaudeSaved(credential: SetupClaudeCredential): Copy {
  const { path } = credential;
  return credential.kind === "Bedrock" && credential.profile !== undefined
    ? {
        id: "setup-runner-claude-saved-profile",
        args: { path, profile: credential.profile },
      }
    : {
        id: "setup-runner-claude-saved",
        args: { made: setupClaudeWords[credential.kind].made, path },
      };
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
  "needs Node": { id: "setup-runner-refusal-node" },
  "a Linux pool runs on": { id: "setup-runner-refusal-processor" },
  "hostname makes no pool name": { id: "setup-runner-refusal-hostname" },
  "no token was spent": { id: "setup-runner-refusal-directory" },
  "did not answer the registration": { id: "setup-runner-refusal-unanswered" },
  "is unknown, spent or expired": { id: "setup-runner-refusal-token" },
  "run register again": { id: "setup-runner-refusal-again" },
  "pool file could not be written": { id: "setup-runner-refusal-pool-file" },
} as const satisfies Readonly<Record<string, Copy>>;

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
  "pool file": { id: "setup-runner-check-pool-file" },
  "runner configuration": { id: "setup-runner-check-configuration" },
  "runtime directory": { id: "setup-runner-check-runtime" },
  "Claude credential": { id: "setup-runner-check-credential" },
  "podman credential helpers": { id: "setup-runner-check-helpers" },
  "container engine": { id: "setup-runner-check-engine" },
  "job network": { id: "setup-runner-check-network" },
  "pool token": { id: "setup-runner-check-pool-token" },
  plane: { id: "setup-runner-check-plane" },
  "chat credential directory": { id: "setup-runner-check-chat-credential" },
  "chat settings": { id: "setup-runner-check-chat-settings" },
  "chat session users": { id: "setup-runner-check-chat-users" },
  "chat supervisor": { id: "setup-runner-check-chat-supervisor" },
  "chat image": { id: "setup-runner-check-chat-image" },
} as const satisfies Readonly<Record<string, Copy>>;

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
  readonly found: Copy;
  readonly tell: Copy;
  readonly when: Copy;
  readonly again: "Runner" | "Status";
}

/** A note as its word and its text. */
export type SetupRunnerNoteSaid = readonly ["found" | "did", Copy];

/** A program by its name, and by its version where it said one. */
function setupVersioned(
  program: string,
  version: string | undefined,
): CopyArgument {
  return version === undefined
    ? program
    : { id: "setup-runner-versioned", args: { program, version } };
}

/** The program a command's path ends in, which is how the package is named. */
function setupProgramOf(command: string): string {
  return command.slice(command.lastIndexOf("/") + 1);
}

/** The package at `command`, by its name and version. */
function setupPackageOf(command: string, version: string | undefined) {
  return setupVersioned(setupProgramOf(command), version);
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
      return [
        "found",
        { id: "setup-runner-note-unit", args: { unit: note.unit } },
      ];
    case "UnitWritten":
      return [
        "did",
        { id: "setup-runner-note-unit-written", args: { unit: note.unit } },
      ];
    case "Linger":
      return ["found", { id: "setup-runner-note-linger" }];
    case "LingerOn":
      return [
        "did",
        {
          id: note.read
            ? "setup-runner-note-linger-on"
            : "setup-runner-note-linger-on-unread",
        },
      ];
    case "Running":
      return [
        "found",
        { id: "setup-runner-note-running", args: { unit: note.unit } },
      ];
    case "Enabled":
      return [
        "did",
        { id: "setup-runner-note-enabled", args: { unit: note.unit } },
      ];
    case "Started":
      return [
        "did",
        { id: "setup-runner-note-started", args: { unit: note.unit } },
      ];
    case "Restarted":
      return [
        "did",
        { id: "setup-runner-note-restarted", args: { unit: note.unit } },
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
      return [
        "found",
        { id: "setup-runner-note-project-live", args: { project } },
      ];
    case "Hosted":
      return ["found", { id: "setup-runner-note-hosted", args: { project } }];
    case "ChatHost":
      return [
        "found",
        { id: "setup-runner-note-chat-host", args: { path: note.path } },
      ];
    case "ChatHostGone":
      return [
        "found",
        { id: "setup-runner-note-chat-host-gone", args: { path: note.path } },
      ];
    case "ChatHostRegistered":
      return [
        "did",
        {
          id: "setup-runner-note-chat-host-registered",
          args: { path: note.path },
        },
      ];
    case "ChatChecked":
      return [
        "found",
        note.warned === undefined
          ? { id: "setup-runner-note-chat-checked" }
          : {
              id: "setup-runner-note-chat-checked-warned",
              args: { warned: note.warned },
            },
      ];
    case "ChatUnit":
      return [
        "found",
        { id: "setup-runner-note-chat-unit", args: { unit: note.unit } },
      ];
    case "ChatUnitWritten":
      return [
        "did",
        {
          id: "setup-runner-note-chat-unit-written",
          args: { unit: note.unit },
        },
      ];
    case "ChatHostLive":
      return [
        "found",
        { id: "setup-runner-note-chat-host-live", args: { project } },
      ];
    case "ChatHostElsewhere":
      return [
        "found",
        { id: "setup-runner-note-chat-host-elsewhere", args: { project } },
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
        { id: "setup-runner-note-pool", args: { project, path: note.path } },
      ];
    case "PoolGone":
      return [
        "found",
        {
          id: "setup-runner-note-pool-gone",
          args: { path: note.path, pool: note.pool, project },
        },
      ];
    case "Registered":
      return [
        "did",
        {
          id: "setup-runner-note-registered",
          args: { project, path: note.path },
        },
      ];
    case "Checked":
      return [
        "found",
        note.warned === undefined
          ? { id: "setup-runner-note-checked" }
          : {
              id: "setup-runner-note-checked-warned",
              args: { warned: note.warned },
            },
      ];
  }
}

type SetupPackageNote = Extract<
  SetupRunnerNote,
  { readonly note: "Package" | "Outdated" | "Installed" }
>;

function setupPackageNoteSaid(note: SetupPackageNote): SetupRunnerNoteSaid {
  const versioned = setupPackageOf(note.command, note.version);
  const { command } = note;
  switch (note.note) {
    case "Package":
      return [
        "found",
        { id: "setup-runner-note-package", args: { versioned, command } },
      ];
    case "Outdated":
      return [
        "found",
        {
          id:
            note.version === undefined
              ? "setup-runner-note-outdated-unread"
              : "setup-runner-note-outdated",
          args: { versioned, command, least: note.least },
        },
      ];
    case "Installed":
      return [
        "did",
        note.kept === undefined
          ? { id: "setup-runner-note-installed", args: { versioned, command } }
          : {
              id: "setup-runner-note-installed-kept",
              args: {
                versioned,
                command,
                kept: setupPackageOf(note.kept.command, note.kept.version),
                where: note.kept.command,
              },
            },
      ];
  }
}

export function setupRunnerNoteSaid(
  note: SetupRunnerNote,
  project: string,
): SetupRunnerNoteSaid {
  switch (note.note) {
    case "Engine":
      return [
        "found",
        { id: "setup-runner-note-engine", args: { engine: note.engine } },
      ];
    case "Package":
    case "Outdated":
    case "Installed":
      return setupPackageNoteSaid(note);
    case "Settings":
      return [
        "found",
        { id: "setup-runner-note-settings", args: { path: note.path } },
      ];
    case "SettingsWritten":
      return [
        "did",
        {
          id: "setup-runner-note-settings-written",
          args: { path: note.path, engine: note.engine },
        },
      ];
    case "Login":
      return [
        "found",
        {
          id: "setup-runner-note-login",
          args: {
            credential: setupClaudeWords[note.credential.kind].credential,
            path: note.credential.path,
          },
        },
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

const setupUnchanged: Copy = { id: "setup-runner-unchanged" };
const setupTryAgain: Copy = { id: "setup-runner-when-try-again" };
const setupLookAgain: Copy = { id: "setup-runner-when-look-again" };

const setupEngineNames: Readonly<Record<SetupEngine, Copy>> = {
  docker: { id: "setup-runner-engine-docker" },
  podman: { id: "setup-runner-engine-podman" },
};

/** Lines said as one, each in its place and in order; there is always one. */
function setupJoined(
  id: "setup-runner-engine-each" | "setup-runner-engines-nor",
  said: readonly Copy[],
): Copy {
  const [first, ...rest] = said;
  if (first === undefined) throw new Error("setupJoined: nothing to join");
  return rest.reduce<Copy>(
    (one, other) => ({ id, args: { one, other } }),
    first,
  );
}

/** Which engines did not answer, as a sentence says it: the one the runner is set to use, or each the package runs on. */
function setupEnginesNone(asked: readonly SetupEngineAsked[]): Copy {
  const names = asked.map(({ engine }) => setupEngineNames[engine]);
  const engines = setupJoined("setup-runner-engines-nor", names);
  return names.length < 2
    ? { id: "setup-runner-engines-one", args: { engine: engines } }
    : { id: "setup-runner-engines-neither", args: { engines } };
}

function setupEngineNone({ engine, answered }: SetupEngineAsked): Copy {
  return {
    id:
      answered === "Absent"
        ? "setup-runner-engine-absent"
        : "setup-runner-engine-silent",
    args: { engine },
  };
}

function setupEnginelessSaid(
  asked: readonly SetupEngineAsked[],
): SetupRunnerStopSaid {
  return {
    found: setupJoined("setup-runner-engine-each", asked.map(setupEngineNone)),
    tell: {
      id: "setup-runner-engineless-tell",
      args: { none: setupEnginesNone(asked) },
    },
    when: { id: "setup-runner-engineless-when" },
    again: "Runner",
  };
}

/** A person the package bars from docker, as they are told it: the package's reason, what leaves them no engine, what mends it, and what that waits on. */
interface SetupDockerBarredTold {
  readonly why: Copy;
  readonly state: Copy;
  readonly mend: Copy;
  readonly when: Copy;
}

/** The package's rule in this program's words: a job under docker is one user of the machine, who could read no other's Claude credential. */
function setupDockerBarredTold(
  user: string | undefined,
  how: SetupDockerBarred,
): SetupDockerBarredTold {
  const why: Copy = {
    id: "setup-runner-docker-why",
    args: {
      job: setupJobUser,
      who:
        user === undefined
          ? { id: "setup-runner-docker-who-unnumbered" }
          : { id: "setup-runner-docker-who", args: { user } },
    },
  };
  if (how.barred === "Named")
    return {
      why,
      state: {
        id: "setup-runner-docker-named-state",
        args: { settings: how.settings },
      },
      mend: { id: "setup-runner-docker-named-mend" },
      when: {
        id: "setup-runner-docker-named-when",
        args: { settings: how.settings },
      },
    };
  return {
    why,
    state: {
      id: "setup-runner-docker-podmanless-state",
      args: {
        none: setupEngineNone({ engine: "podman", answered: how.answered }),
      },
    },
    mend: { id: "setup-runner-docker-podmanless-mend" },
    when: { id: "setup-runner-docker-podmanless-when" },
  };
}

function setupDockerBarredSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "DockerBarred" }>,
): SetupRunnerStopSaid {
  const { why, state, mend, when } = setupDockerBarredTold(stop.user, stop.how);
  return {
    found:
      stop.how.barred === "Named"
        ? {
            id: "setup-runner-docker-named-found",
            args: { settings: stop.how.settings, job: setupJobUser },
          }
        : {
            id: "setup-runner-docker-podmanless-found",
            args: {
              none: setupEngineNone({
                engine: "podman",
                answered: stop.how.answered,
              }),
              job: setupJobUser,
            },
          },
    tell: { id: "setup-runner-docker-tell", args: { why, state, mend } },
    when,
    again: "Runner",
  };
}

const setupReadsSaid: Readonly<Record<SetupRunnerRead, Copy>> = {
  work: { id: "setup-runner-read-work" },
  threads: { id: "setup-runner-read-threads" },
  placement: { id: "setup-runner-read-placement" },
  pools: { id: "setup-runner-read-pools" },
  permit: { id: "setup-runner-read-permit" },
  chat: { id: "setup-runner-read-chat" },
};

/** The reads a run makes before it looks at the machine, which makes them the ones a stop at can say nothing was changed. */
const setupReadsFirst: readonly SetupRunnerRead[] = ["work", "threads"];

/** What a read the site did not give leaves of a run: a runner not known to be set up, which is not one known not to be. */
const setupUnknown: Copy = { id: "setup-runner-unknown" };

function setupUnreadSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "Unread" }>,
  project: string,
): SetupRunnerStopSaid {
  const what = setupReadsSaid[stop.read];
  if (stop.outcome === "Refused")
    return {
      found: {
        id: "setup-runner-unread-refused-found",
        args: { project, what },
      },
      tell: {
        id: "setup-runner-unread-refused-tell",
        args: {
          project,
          left: setupReadsFirst.includes(stop.read)
            ? setupUnchanged
            : setupUnknown,
        },
      },
      when: { id: "setup-runner-unread-refused-when" },
      again: "Runner",
    };
  return {
    found: {
      id: "setup-runner-unread-found",
      args: { project, what, outcome: stop.outcome },
    },
    tell: { id: "setup-runner-unread-tell" },
    when: setupTryAgain,
    again: "Runner",
  };
}

const setupActs: Readonly<Record<SetupRunnerAct, CopyId>> = {
  Install: "setup-runner-act-install",
  Register: "setup-runner-act-register",
  Check: "setup-runner-act-check",
  Service: "setup-runner-act-service",
  RegisterChat: "setup-runner-act-register-chat",
  CheckChat: "setup-runner-act-check-chat",
  ServiceChat: "setup-runner-act-service-chat",
  Reload: "setup-runner-act-reload",
  Start: "setup-runner-act-start",
  Restart: "setup-runner-act-restart",
};

/** An act as a sentence names it, `upper` where the act begins the sentence. */
function setupActOf(act: SetupRunnerAct, upper = false): CopyHanded {
  return { id: setupActs[act], args: { case: upper ? "upper" : "lower" } };
}

function setupFailedSaid(failed: SetupChildFailed): Copy {
  switch (failed.how) {
    case "Unstarted":
      return { id: "setup-runner-failed-unstarted" };
    case "Unended":
      return {
        id: "setup-runner-failed-unended",
        args: { secs: String(failed.secs) },
      };
    case "Exit":
      return failed.excerpt === ""
        ? {
            id: "setup-runner-failed-exit-silent",
            args: { exit: String(failed.exit) },
          }
        : {
            id: "setup-runner-failed-exit",
            args: { exit: String(failed.exit), excerpt: failed.excerpt },
          };
    case "ExitUnquoted":
      return failed.refusal === undefined
        ? {
            id: "setup-runner-failed-unquoted",
            args: { exit: String(failed.exit) },
          }
        : {
            id: "setup-runner-failed-refused",
            args: {
              exit: String(failed.exit),
              refusal: setupRegisterRefusals[failed.refusal],
            },
          };
  }
}

function setupActSaid(act: SetupRunnerAct, failed: Copy): SetupRunnerStopSaid {
  return {
    found: {
      id: "setup-runner-act-found",
      args: { act: setupActOf(act), failed },
    },
    tell: { id: "setup-runner-act-tell", args: { act: setupActOf(act, true) } },
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
  const { command, least } = stop;
  return {
    found: {
      id:
        stop.version === undefined
          ? "setup-runner-behind-found-unread"
          : "setup-runner-behind-found",
      args: { left, command, least },
    },
    tell: { id: "setup-runner-behind-tell", args: { left, least, program } },
    when: { id: "setup-runner-behind-when", args: { program } },
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
    tell: { id: "setup-runner-lasting-node-tell" },
    when: { id: "setup-runner-lasting-node-when" },
    again: "Runner",
  },
  "a Linux pool runs on": {
    tell: { id: "setup-runner-lasting-processor-tell" },
    when: { id: "setup-runner-when-elsewhere" },
    again: "Status",
  },
  "hostname makes no pool name": {
    tell: { id: "setup-runner-lasting-hostname-tell" },
    when: { id: "setup-runner-lasting-hostname-when" },
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
  const { path } = stop;
  return {
    found: {
      id: "setup-runner-act-found",
      args: { act: setupActOf(stop.act), failed: setupFailedSaid(stop.failed) },
    },
    tell: {
      id: "setup-runner-service-refused-tell",
      args: { act: setupActOf(stop.act, true), path },
    },
    when: { id: "setup-runner-service-refused-when", args: { path } },
    again: "Runner",
    ...setupLasting(stop.failed),
  };
}

function setupMintSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "MintRefused" }>,
  project: string,
): SetupRunnerStopSaid {
  const found: Copy = {
    id: "setup-runner-mint-found",
    args: { project, outcome: stop.outcome },
  };
  if (stop.outcome === "Absent")
    return {
      found,
      tell: { id: "setup-runner-mint-absent-tell", args: { project } },
      when: { id: "setup-runner-when-admin", args: { project } },
      again: "Runner",
    };
  if (stop.outcome === "Conflict")
    return {
      found,
      tell: {
        id: "setup-runner-mint-conflict-tell",
        args: { project, mins: String(stop.lapseMins) },
      },
      when: setupTryAgain,
      again: "Runner",
    };
  return {
    found,
    tell: { id: "setup-runner-mint-tell", args: { project } },
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
    found: {
      id: "setup-runner-login-missing-found",
      args: { credential, path },
    },
    tell:
      kind === "Subscription"
        ? {
            id: "setup-runner-login-missing-tell",
            args: { path, saved, guide: stop.guide },
          }
        : {
            id: "setup-runner-login-missing-named-tell",
            args: { credential, path, saved },
          },
    when: { id: "setup-runner-login-missing-when", args: { credential } },
    again: "Runner",
  };
}

/** Settings at their place that do not read as the runner's. */
function setupSettingsUnreadSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "SettingsUnread" }>,
): SetupRunnerStopSaid {
  const { path } = stop;
  return {
    found: { id: "setup-runner-settings-unread-found", args: { path } },
    tell: {
      id: "setup-runner-settings-unread-tell",
      args: { path, guide: stop.guide },
    },
    when: { id: "setup-runner-settings-unread-when", args: { path } },
    again: "Runner",
  };
}

/** What the person's user services are asked through, which is how a manager that does not answer is named. */
const setupUserServices = "systemctl --user";

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
        found: { id: "setup-runner-mac-found" },
        tell: {
          id: "setup-runner-mac-tell",
          args: { program: runnerPackages.darwin.program },
        },
        when: { id: "setup-runner-mac-when" },
        again: "Status",
      };
    case "Serviceless":
      return {
        found: {
          id: "setup-runner-serviceless-found",
          args: { command: setupUserServices },
        },
        tell: {
          id: "setup-runner-serviceless-tell",
          args: { guide: stop.guide },
        },
        when: setupTryAgain,
        again: "Runner",
      };
    case "SettingsUnread":
      return setupSettingsUnreadSaid(stop);
    case "LoginMissing":
      return setupLoginMissingSaid(stop);
    case "Npmless":
      return {
        found: { id: "setup-runner-npmless-found" },
        tell: { id: "setup-runner-npmless-tell" },
        when: { id: "setup-runner-npmless-when" },
        again: "Runner",
      };
    case "Unwritten":
      return {
        found: {
          id: "setup-runner-unwritten-found",
          args: { path: stop.path },
        },
        tell: { id: "setup-runner-unwritten-tell", args: { path: stop.path } },
        when: { id: "setup-runner-unwritten-when", args: { path: stop.path } },
        again: "Runner",
      };
  }
}

/** A service not read as running: the state the service manager gave it, or that the service manager did not answer, which is not a service that stopped. */
function setupInactiveSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "Inactive" }>,
): SetupRunnerStopSaid {
  const was: Copy =
    stop.waitedSecs === undefined
      ? { id: "setup-runner-inactive-started" }
      : {
          id: "setup-runner-inactive-waited",
          args: { secs: String(stop.waitedSecs) },
        };
  const { unit } = stop;
  if (stop.state === undefined)
    return {
      found: { id: "setup-runner-inactive-silent-found", args: { unit, was } },
      tell: { id: "setup-runner-inactive-silent-tell" },
      when: setupTryAgain,
      again: "Runner",
    };
  return {
    found: {
      id: "setup-runner-inactive-found",
      args: {
        unit,
        was,
        state:
          stop.state === ""
            ? { id: "setup-runner-inactive-not-running" }
            : stop.state,
      },
    },
    tell: { id: "setup-runner-inactive-tell" },
    when: setupTryAgain,
    again: "Runner",
  };
}

function setupCheckFailedSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "CheckFailed" }>,
): SetupRunnerStopSaid {
  const check = setupActOf(stop.act);
  const meant: Copy =
    stop.check === undefined
      ? { id: "setup-runner-check-unpassed", args: { check } }
      : setupRunnerChecks[stop.check];
  const { line } = stop;
  return {
    found: {
      id: "setup-runner-check-failed-found",
      args: { meant, check, line },
    },
    tell: {
      id: "setup-runner-check-failed-tell",
      args: {
        what: {
          id:
            stop.act === "Check"
              ? "setup-runner-check-failed-runner"
              : "setup-runner-check-failed-chat",
        },
        meant,
        line,
      },
    },
    when: { id: "setup-runner-check-failed-when" },
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
    case "CheckFailed":
      return setupCheckFailedSaid(stop);
    case "LingerAsks":
      return {
        found:
          stop.excerpt === ""
            ? { id: "setup-runner-linger-found" }
            : {
                id: "setup-runner-linger-found-said",
                args: { excerpt: stop.excerpt },
              },
        tell: {
          id: "setup-runner-linger-tell",
          args: { command: stop.command },
        },
        when: { id: "setup-runner-linger-when" },
        again: "Runner",
      };
    case "Inactive":
      return setupInactiveSaid(stop);
    case "NotLive":
      return {
        found: {
          id: stop.registered
            ? "setup-runner-not-live-found"
            : "setup-runner-not-live-unregistered-found",
          args: { secs: String(stop.waitedSecs), project },
        },
        tell: { id: "setup-runner-not-live-tell" },
        when: setupLookAgain,
        again: "Runner",
      };
  }
}

/** A mint of the person's chat host registration token the site refused, by why. */
function setupChatMintSaid(
  stop: Extract<SetupRunnerStop, { readonly stop: "ChatMintRefused" }>,
): SetupRunnerStopSaid {
  const found: Copy = {
    id: "setup-runner-chat-mint-found",
    args: { outcome: stop.outcome },
  };
  if (stop.outcome === "Absent")
    return {
      found,
      tell: { id: "setup-runner-chat-mint-absent-tell" },
      when: { id: "setup-runner-chat-mint-absent-when" },
      again: "Runner",
    };
  if (stop.outcome === "Conflict")
    return {
      found,
      tell: {
        id: "setup-runner-chat-mint-conflict-tell",
        args: { mins: String(stop.lapseMins) },
      },
      when: setupTryAgain,
      again: "Runner",
    };
  return {
    found,
    tell: { id: "setup-runner-chat-mint-tell" },
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
  const { login, settings } = stop;
  const linked = stop.how === "Linked";
  return {
    found: {
      id: linked
        ? "setup-runner-chat-login-linked-found"
        : "setup-runner-chat-login-shared-found",
      args: { credential, path },
    },
    tell: {
      id: "setup-runner-chat-login-tell",
      args: {
        why: {
          id: linked
            ? "setup-runner-chat-login-linked-why"
            : "setup-runner-chat-login-shared-why",
          args: { credential, path },
        },
        copy:
          kind === "Subscription"
            ? {
                id: "setup-runner-chat-login-token-copy",
                args: { login, settings },
              }
            : {
                id: "setup-runner-chat-login-copy",
                args: {
                  directory: login.slice(0, login.lastIndexOf("/")),
                  settings,
                },
              },
        restart: setupRestartAll,
      },
    },
    when: { id: "setup-runner-chat-login-when", args: { credential } },
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
        found: { id: "setup-runner-permit-found" },
        tell: {
          id: "setup-runner-permit-tell",
          args: {
            work: {
              id:
                stop.work === "Runner"
                  ? "setup-runner-permit-runner"
                  : "setup-runner-permit-hosted",
              args: { project },
            },
            people: stop.people,
          },
        },
        when: { id: "setup-runner-permit-when" },
        again: "Runner",
      };
    case "ChatMintRefused":
      return setupChatMintSaid(stop);
    case "ChatHostOffline":
      return {
        found: { id: "setup-runner-offline-found" },
        tell: {
          id: "setup-runner-offline-tell",
          args: { project, runners: stop.runners },
        },
        when: { id: "setup-runner-offline-when" },
        again: "Runner",
      };
    case "ChatLogin":
      return setupChatLoginSaid(stop);
    case "ChatHostNotLive":
      return {
        found: {
          id: "setup-runner-chat-not-live-found",
          args: { secs: String(stop.waitedSecs) },
        },
        tell: { id: "setup-runner-chat-not-live-tell" },
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
        found: { id: "setup-runner-not-admin-found", args: { project } },
        tell: { id: "setup-runner-not-admin-tell", args: { project } },
        when: { id: "setup-runner-when-admin", args: { project } },
        again: "Runner",
      };
    case "Engineless":
      return setupEnginelessSaid(stop.asked);
    case "DockerBarred":
      return setupDockerBarredSaid(stop);
    case "Act":
      return setupActStopSaid(stop);
    case "Unseen":
      return setupActSaid(stop.act, {
        id: "setup-runner-failed-unseen",
        args: { path: stop.path },
      });
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
