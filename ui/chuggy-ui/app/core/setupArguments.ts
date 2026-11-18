/**
 * What a run of the setup program was asked to do, read from its arguments.
 *
 * The grammar is closed: at most one command, then flags that each take one
 * value, written `--name value` or `--name=value`, each at most once. Anything
 * else is asked wrongly, and which way is all that is kept of it, so nothing a
 * person typed is ever printed back. `listen` is the command a sign-in starts
 * for itself and no person runs. `project` makes a project in a workspace
 * named whole, called what `--name` says, at the address `--project` gives or
 * else the one the name makes. `mcp`, `runner` and `chat-host` are the
 * commands that change the machine, so `mcp` and `runner` are run for a
 * project named whole and `chat-host` for a workspace named whole, never for
 * one the program would have to choose. `--workspace` and `--project` say which project a run is
 * about where more than one could be meant; every command the program prints
 * carries them, so the conversation holds that choice and no file does.
 * `--name` is carried only by `project`, which is what it is read for.
 * `--replace` is the person's yes to `chat-host` registering this machine in
 * place of the chat host of theirs it names. `--chat-host` is the person's
 * answer to `runner` making this machine their chat host too, which it does
 * only on `yes`. `configuration` writes a starting
 * configuration into the checkout, its check running the command `--test`
 * gives where it gives one; `check` judges the checkout's configuration as an
 * import would; neither asks the site anything. `import` asks the site to
 * import the repository the checklist means, and reads the checklist again.
 * `bind` waits, for as long as `--wait-secs` gives it, while the checklist's
 * next thing waits on GitHub, then asks the site to add the folder's
 * repository to the project where that is the next thing, and reads the
 * checklist again. `--opened github` says a `bind` before it already opened
 * the page that connects GitHub, so this one opens none.
 * `merge`, on the person's yes, has the site merge the pull request the
 * checklist offers, then waits as `bind` does for the repository's own
 * configuration to be imported, and reads the checklist again.
 * `serve`, for a project named whole, has the person's own runners take its
 * work, where that is the checklist's next thing, and reads the checklist
 * again.
 * `ticket` files the project's first ticket, titled what `--title` says and
 * asking what `--intent` says, or else the end-to-end check setup announces,
 * naming the worker image `--image` says for the toolchains `--toolchains`
 * says, under the configuration `--configuration` names where the project
 * offers more than one, where that is the checklist's next thing, and reads
 * the checklist again. None of them is ever printed back. `watch` waits, as
 * `bind` does, while the checklist's next thing is that ticket on its way to
 * its landing, and reads the checklist again. `plugin` installs chuggy's
 * Claude Code plugin, or updates or enables it. `--plugin skip` is the way
 * past the plugin step without it, and every command the program prints
 * carries it as it carries the workspace and project. `--start yes` is the
 * person's yes to setup itself, read only by the bare command and carried
 * only by it.
 */

import { setupLoopbackHost } from "./setupProgram.ts";
import { setupSayable } from "./setupText.ts";

export const setupWaitSecsDefault = 90;
export const setupWaitSecsMax = 600;

/** The flag `project` is told what the project is called in. */
export const setupNameFlag = "--name";

/** The flag `configuration` is told the repository's test command in. */
export const setupTestFlag = "--test";

/** The flags `ticket` is told the ticket's title, what is wanted done, and the configuration chosen in. */
export const setupTitleFlag = "--title";
export const setupIntentFlag = "--intent";
export const setupConfigurationFlag = "--configuration";

/** The flags `ticket` is told the worker image recommended and the toolchains the repository's work needs in. */
export const setupImageFlag = "--image";
export const setupToolchainsFlag = "--toolchains";

/** The flag a `bind` is told the page connecting GitHub is already open in, and the one value it takes. */
export const setupOpenedFlag = "--opened";
export const setupOpenedGithub = "github";

/** How long a sign-in page stays answerable where the command starting it names no other life. */
export const setupListenSecsDefault = 600;

/** Which part of the arguments could not be read. */
export type SetupAskFault =
  | "Command"
  | "Flag"
  | "Site"
  | "WaitSecs"
  | "Name"
  | "Project"
  | "Workspace"
  | "Replace"
  | "ChatHost"
  | "ProjectName"
  | "Test"
  | "Brief"
  | "Image"
  | "Plugin"
  | "Opened"
  | "Start";

/** The commands a person or an agent runs, as a report names them. */
export type SetupCommand =
  | "Status"
  | "SignIn"
  | "SignOut"
  | "Project"
  | "Mcp"
  | "Runner"
  | "ChatHost"
  | "Configuration"
  | "Check"
  | "Import"
  | "Bind"
  | "Merge"
  | "Serve"
  | "Ticket"
  | "Watch"
  | "Plugin";

/** Which workspace and project a run is about, as far as its arguments named them, what `project` was asked to call the one it makes, and whether the plugin step is passed over. */
export interface SetupAnswers {
  readonly workspace: string | undefined;
  readonly project: string | undefined;
  readonly name?: string | undefined;
  readonly plugin?: SetupPluginAnswer;
  /** The person's yes to setup itself, which a bare run is given once they have said it. */
  readonly start?: SetupStartAnswer;
  /** What `runner` was told of making this machine the person's chat host too, carried into every `runner` printed again. */
  readonly chatHost?: SetupChatHostAnswer;
}

/** The one value `--plugin` takes: the plugin step passed over without the plugin. */
export const setupPluginSkip = "skip";

export type SetupPluginAnswer = typeof setupPluginSkip;

/** The flag the plugin step is passed over with. */
export const setupPluginFlag = "--plugin";

/** The plugin step's answer, where one was given, to be kept in answers made anew. */
export function setupAnswersPlugin(
  answers: SetupAnswers,
): Pick<SetupAnswers, "plugin"> {
  return answers.plugin === undefined ? {} : { plugin: answers.plugin };
}

/** The flag the bare command is told the person's yes to setup in, and the one value it takes. */
export const setupStartFlag = "--start";
export const setupStartYes = "yes";

export type SetupStartAnswer = typeof setupStartYes;

/** The flag `runner` is told in whether to make this machine the person's chat host too, and the answers it takes. */
export const setupChatHostFlag = "--chat-host";
export const setupChatHostAnswers = ["yes", "no"] as const;

export type SetupChatHostAnswer = (typeof setupChatHostAnswers)[number];

export const setupAnswersNone: SetupAnswers = {
  workspace: undefined,
  project: undefined,
};

export type SetupAsked =
  | {
      readonly asked: "Status";
      readonly site: string | undefined;
      readonly answers: SetupAnswers;
    }
  | {
      readonly asked: "SignIn";
      readonly site: string | undefined;
      readonly waitSecs: number;
      readonly answers: SetupAnswers;
    }
  | {
      readonly asked: "SignOut";
      readonly site: string | undefined;
      readonly answers: SetupAnswers;
    }
  | {
      readonly asked: "Project";
      readonly site: string | undefined;
      readonly answers: SetupAnswers;
      /** The workspace the project is made in, which the command is not run without. */
      readonly workspace: string;
      /** What the project is called, which the command is not run without. */
      readonly name: string;
    }
  | {
      readonly asked: "Mcp";
      readonly site: string | undefined;
      readonly answers: SetupAnswers;
      /** The project the agent's server is for, which the command is not run without. */
      readonly workspace: string;
      readonly project: string;
    }
  | {
      readonly asked: "Runner";
      readonly site: string | undefined;
      readonly waitSecs: number;
      readonly answers: SetupAnswers;
      /** The project the runner is for, which the command is not run without. */
      readonly workspace: string;
      readonly project: string;
      /** Whether this machine is made the person's chat host too, where the person was asked. */
      readonly chatHost: SetupChatHostAnswer | undefined;
    }
  | {
      readonly asked: "ChatHost";
      readonly site: string | undefined;
      readonly waitSecs: number;
      readonly answers: SetupAnswers;
      /** The workspace the chat host is for, which the command is not run without. */
      readonly workspace: string;
      /** The short id of the chat host this machine is to be registered in place of, where the person said one. */
      readonly replace: string | undefined;
    }
  | {
      readonly asked: "Configuration";
      readonly site: undefined;
      readonly answers: SetupAnswers;
      /** The command that runs the repository's tests, where the agent said one. */
      readonly test: string | undefined;
    }
  | {
      readonly asked: "Check";
      readonly site: undefined;
      readonly answers: SetupAnswers;
    }
  | {
      readonly asked: "Import";
      readonly site: string | undefined;
      readonly answers: SetupAnswers;
    }
  | {
      readonly asked: "Bind";
      readonly site: string | undefined;
      readonly waitSecs: number;
      readonly answers: SetupAnswers;
      /** Whether a `bind` before this one opened the page connecting GitHub, so this one opens none. */
      readonly opened: boolean;
    }
  | {
      readonly asked: "Merge";
      readonly site: string | undefined;
      readonly waitSecs: number;
      readonly answers: SetupAnswers;
    }
  | {
      readonly asked: "Serve";
      readonly site: string | undefined;
      readonly answers: SetupAnswers;
      /** The project the person's runners are to take the work of, which the command is not run without. */
      readonly workspace: string;
      readonly project: string;
    }
  | {
      readonly asked: "Ticket";
      readonly site: string | undefined;
      readonly answers: SetupAnswers;
      /** What the ticket is called and what the person wants done, where they asked for something of their own. */
      readonly said: SetupTicketSaid | undefined;
      /** The worker image recommended and the toolchains it was recommended for, where they were given. */
      readonly worker: SetupTicketWorker | undefined;
      /** The configuration the person chose, where they named one. */
      readonly configuration: string | undefined;
    }
  | {
      readonly asked: "Watch";
      readonly site: string | undefined;
      readonly waitSecs: number;
      readonly answers: SetupAnswers;
    }
  | {
      readonly asked: "Plugin";
      readonly site: string | undefined;
      readonly answers: SetupAnswers;
    }
  | {
      readonly asked: "Listen";
      readonly site: string;
      readonly lifeSecs: number;
    }
  | { readonly asked: "Wrongly"; readonly fault: SetupAskFault };

/** What a person asked a ticket to do in place of the end-to-end check: what it is called and what they want done. */
export interface SetupTicketSaid {
  readonly title: string;
  readonly intent: string;
}

/** The worker image the first ticket's configuration is to name, and the toolchains the repository's work needs of it. */
export interface SetupTicketWorker {
  readonly image: string;
  readonly toolchains: string;
}

type SetupRun = Exclude<SetupAsked["asked"], "Wrongly">;

const setupCommandWords = {
  "sign-in": "SignIn",
  "sign-out": "SignOut",
  project: "Project",
  mcp: "Mcp",
  runner: "Runner",
  "chat-host": "ChatHost",
  configuration: "Configuration",
  check: "Check",
  import: "Import",
  bind: "Bind",
  merge: "Merge",
  serve: "Serve",
  ticket: "Ticket",
  watch: "Watch",
  plugin: "Plugin",
  listen: "Listen",
} as const;

type SetupCommandWord = keyof typeof setupCommandWords;

const setupFlags = [
  "site",
  "wait-secs",
  "life-secs",
  "workspace",
  "project",
  "name",
  "replace",
  "chat-host",
  "test",
  "title",
  "intent",
  "configuration",
  "image",
  "toolchains",
  "plugin",
  "opened",
  "start",
] as const;

type SetupFlag = (typeof setupFlags)[number];

/** The flags each command reads; one it does not read is asked wrongly. */
const setupFlagsRead: Readonly<Record<SetupRun, readonly SetupFlag[]>> = {
  Status: ["site", "workspace", "project", "plugin", "start"],
  SignIn: ["site", "wait-secs", "workspace", "project", "plugin"],
  SignOut: ["site", "workspace", "project", "plugin"],
  Project: ["site", "workspace", "project", "name", "plugin"],
  Mcp: ["site", "workspace", "project", "plugin"],
  Runner: ["site", "wait-secs", "workspace", "project", "chat-host", "plugin"],
  ChatHost: ["site", "wait-secs", "workspace", "replace", "plugin"],
  Configuration: ["workspace", "project", "test", "plugin"],
  Check: ["workspace", "project", "plugin"],
  Import: ["site", "workspace", "project", "plugin"],
  Bind: ["site", "wait-secs", "workspace", "project", "plugin", "opened"],
  Merge: ["site", "wait-secs", "workspace", "project", "plugin"],
  Serve: ["site", "workspace", "project", "plugin"],
  Ticket: [
    "site",
    "workspace",
    "project",
    "title",
    "intent",
    "image",
    "toolchains",
    "configuration",
    "plugin",
  ],
  Watch: ["site", "wait-secs", "workspace", "project", "plugin"],
  Plugin: ["site", "workspace", "project", "plugin"],
  Listen: ["site", "life-secs"],
};

/**
 * A site's origin from whatever address of it was given. Plain HTTP is read
 * only at this machine's own address, where a rehearsal's site answers.
 */
export function setupSiteRead(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && url.hostname === setupLoopbackHost)
    return url.origin;
  return undefined;
}

function setupSecsRead(text: string, max: number): number | undefined {
  if (!/^\d{1,6}$/u.test(text)) return undefined;
  const secs = Number(text);
  return secs <= max ? secs : undefined;
}

interface SetupTokens {
  readonly command: SetupCommandWord | undefined;
  readonly flags: ReadonlyMap<SetupFlag, string>;
}

function setupFlagNamed(name: string): SetupFlag | undefined {
  return setupFlags.find((flag) => flag === name);
}

/** The command and each flag's value, or which part was not in the grammar. */
function setupTokens(argv: readonly string[]): SetupTokens | SetupAskFault {
  let command: SetupCommandWord | undefined;
  const flags = new Map<SetupFlag, string>();
  for (let at = 0; at < argv.length; at += 1) {
    const token = argv[at] ?? "";
    if (!token.startsWith("--")) {
      if (command !== undefined || !Object.hasOwn(setupCommandWords, token))
        return "Command";
      command = token as SetupCommandWord;
      continue;
    }
    const equals = token.indexOf("=");
    const flag = setupFlagNamed(
      token.slice(2, equals < 0 ? undefined : equals),
    );
    const value = equals < 0 ? argv[at + 1] : token.slice(equals + 1);
    if (flag === undefined || value === undefined || flags.has(flag))
      return "Flag";
    flags.set(flag, value);
    if (equals < 0) at += 1;
  }
  return { command, flags };
}

/** What an address reads as a place and not a name, so one made with either would be another address. */
const setupPlaces: readonly string[] = [".", ".."];

/** Whether a name is one a line can carry back unchanged and an address can carry as itself. */
function setupNameWhole(name: string | undefined): boolean {
  return (
    name === undefined || (setupSayable(name) && !setupPlaces.includes(name))
  );
}

/** The names the flags gave, or nothing where one is not whole. */
function setupAnswersRead(
  flags: ReadonlyMap<SetupFlag, string>,
): SetupAnswers | undefined {
  const workspace = flags.get("workspace");
  const project = flags.get("project");
  const name = flags.get("name");
  if (!setupNameWhole(workspace) || !setupNameWhole(project)) return undefined;
  const plugin: Pick<SetupAnswers, "plugin"> = flags.has("plugin")
    ? { plugin: setupPluginSkip }
    : {};
  const start: Pick<SetupAnswers, "start"> = flags.has("start")
    ? { start: setupStartYes }
    : {};
  return name === undefined
    ? { workspace, project, ...plugin, ...start }
    : { workspace, project, name, ...plugin, ...start };
}

/** A name is carried back in the command that retries it, so it is one a line prints as it is. */
function setupProjectAsked(
  site: string | undefined,
  answers: SetupAnswers,
): SetupAsked {
  const { workspace, name } = answers;
  if (workspace === undefined) return { asked: "Wrongly", fault: "Workspace" };
  if (name === undefined || !setupSayable(name))
    return { asked: "Wrongly", fault: "ProjectName" };
  return { asked: "Project", site, answers, workspace, name };
}

function setupChatHostAsked(
  site: string | undefined,
  waitSecs: number,
  answers: SetupAnswers,
  replace: string | undefined,
): SetupAsked {
  const { workspace } = answers;
  if (workspace === undefined) return { asked: "Wrongly", fault: "Workspace" };
  if (!setupNameWhole(replace)) return { asked: "Wrongly", fault: "Replace" };
  return {
    asked: "ChatHost",
    site,
    waitSecs,
    answers,
    workspace,
    replace,
  };
}

function setupChatHostRead(
  given: string | undefined,
): SetupChatHostAnswer | "Wrongly" | undefined {
  if (given === undefined) return undefined;
  return setupChatHostAnswers.find((answer) => answer === given) ?? "Wrongly";
}

/** A test command is carried back in the command that writes it, so it is one a line prints as it is. */
function setupConfigurationAsked(
  answers: SetupAnswers,
  test: string | undefined,
): SetupAsked {
  if (test !== undefined && !setupSayable(test))
    return { asked: "Wrongly", fault: "Test" };
  return { asked: "Configuration", site: undefined, answers, test };
}

/** Two flags given together or not at all: their values, nothing, or that only one was given. */
function setupTicketPair(
  flags: ReadonlyMap<SetupFlag, string>,
  first: SetupFlag,
  second: SetupFlag,
): readonly [string, string] | "Wrongly" | undefined {
  const one = flags.get(first);
  const other = flags.get(second);
  if (one === undefined && other === undefined) return undefined;
  return one === undefined || other === undefined ? "Wrongly" : [one, other];
}

/** A ticket is filed with a title and what is wanted done together, a worker image and its toolchains together, or both; none is printed back, so none is held to a line. */
function setupTicketAsked(
  site: string | undefined,
  answers: SetupAnswers,
  flags: ReadonlyMap<SetupFlag, string>,
): SetupAsked {
  const said = setupTicketPair(flags, "title", "intent");
  const worker = setupTicketPair(flags, "image", "toolchains");
  if (said === "Wrongly") return { asked: "Wrongly", fault: "Brief" };
  if (worker === "Wrongly") return { asked: "Wrongly", fault: "Image" };
  if (said === undefined && worker === undefined)
    return { asked: "Wrongly", fault: "Brief" };
  return {
    asked: "Ticket",
    site,
    answers,
    said: said === undefined ? undefined : { title: said[0], intent: said[1] },
    worker:
      worker === undefined
        ? undefined
        : { image: worker[0], toolchains: worker[1] },
    configuration: flags.get("configuration"),
  };
}

function setupBindAsked(
  site: string | undefined,
  waitSecs: number,
  answers: SetupAnswers,
  opened: string | undefined,
): SetupAsked {
  if (opened !== undefined && opened !== setupOpenedGithub)
    return { asked: "Wrongly", fault: "Opened" };
  return {
    asked: "Bind",
    site,
    waitSecs,
    answers,
    opened: opened !== undefined,
  };
}

/** A run of `mcp`, `serve` or `runner`, each of which names its project, and `runner` its chat host where it is given one. */
function setupAskedOfProjectRun(
  asked: "Mcp" | "Serve" | "Runner",
  site: string | undefined,
  waitSecs: number,
  answers: SetupAnswers,
  flags: ReadonlyMap<SetupFlag, string>,
): SetupAsked {
  const { workspace, project } = answers;
  if (workspace === undefined || project === undefined)
    return { asked: "Wrongly", fault: "Project" };
  if (asked !== "Runner") return { asked, site, answers, workspace, project };
  const chatHost = setupChatHostRead(flags.get("chat-host"));
  if (chatHost === "Wrongly") return { asked: "Wrongly", fault: "ChatHost" };
  return {
    asked,
    site,
    waitSecs,
    answers: chatHost === undefined ? answers : { ...answers, chatHost },
    workspace,
    project,
    chatHost,
  };
}

function setupAskedOf(
  asked: SetupRun,
  flags: ReadonlyMap<SetupFlag, string>,
): SetupAsked {
  const given = flags.get("site");
  const site = given === undefined ? undefined : setupSiteRead(given);
  if (given !== undefined && site === undefined)
    return { asked: "Wrongly", fault: "Site" };
  const plugin = flags.get("plugin");
  if (plugin !== undefined && plugin !== setupPluginSkip)
    return { asked: "Wrongly", fault: "Plugin" };
  const start = flags.get("start");
  if (start !== undefined && start !== setupStartYes)
    return { asked: "Wrongly", fault: "Start" };
  const answers = setupAnswersRead(flags);
  if (answers === undefined) return { asked: "Wrongly", fault: "Name" };
  const wait = setupSecsRead(
    flags.get("wait-secs") ?? String(setupWaitSecsDefault),
    setupWaitSecsMax,
  );
  const life = setupSecsRead(
    flags.get("life-secs") ?? String(setupListenSecsDefault),
    setupListenSecsDefault,
  );
  if (wait === undefined || life === undefined)
    return { asked: "Wrongly", fault: "WaitSecs" };
  switch (asked) {
    case "Status":
    case "SignOut":
      return { asked, site, answers };
    case "SignIn":
    case "Merge":
    case "Watch":
      return { asked, site, waitSecs: wait, answers };
    case "Project":
      return setupProjectAsked(site, answers);
    case "Mcp":
    case "Serve":
    case "Runner":
      return setupAskedOfProjectRun(asked, site, wait, answers, flags);
    case "ChatHost":
      return setupChatHostAsked(site, wait, answers, flags.get("replace"));
    case "Configuration":
      return setupConfigurationAsked(answers, flags.get("test"));
    case "Check":
      return { asked, site: undefined, answers };
    case "Bind":
      return setupBindAsked(site, wait, answers, flags.get("opened"));
    case "Import":
    case "Plugin":
      return { asked, site, answers };
    case "Ticket":
      return setupTicketAsked(site, answers, flags);
    case "Listen":
      return site === undefined
        ? { asked: "Wrongly", fault: "Site" }
        : { asked, site, lifeSecs: life };
  }
}

export function setupAsked(argv: readonly string[]): SetupAsked {
  const tokens = setupTokens(argv);
  if (typeof tokens === "string") return { asked: "Wrongly", fault: tokens };
  const asked: SetupRun =
    tokens.command === undefined ? "Status" : setupCommandWords[tokens.command];
  for (const flag of tokens.flags.keys())
    if (!setupFlagsRead[asked].includes(flag))
      return { asked: "Wrongly", fault: "Flag" };
  return setupAskedOf(asked, tokens.flags);
}

/** The arguments a command is run again with, which `setupAsked` reads back. */
export function setupCommandArguments(
  command: SetupCommand,
): readonly string[] {
  switch (command) {
    case "Status":
      return [];
    case "SignIn":
      return ["sign-in"];
    case "SignOut":
      return ["sign-out"];
    case "Project":
      return ["project"];
    case "Mcp":
      return ["mcp"];
    case "Runner":
      return ["runner"];
    case "ChatHost":
      return ["chat-host"];
    case "Configuration":
      return ["configuration"];
    case "Check":
      return ["check"];
    case "Import":
      return ["import"];
    case "Bind":
      return ["bind"];
    case "Merge":
      return ["merge"];
    case "Serve":
      return ["serve"];
    case "Ticket":
      return ["ticket"];
    case "Watch":
      return ["watch"];
    case "Plugin":
      return ["plugin"];
  }
}

/** The flags that name a choice again for `command`, which `setupAsked` reads back as the same choice: the name only for `project`, the one command that reads it, the yes to setup only for the bare command, and the plugin step passed over for every command. */
export function setupAnswerArguments(
  answers: SetupAnswers,
  command: SetupCommand = "Status",
): readonly string[] {
  return [
    ...(answers.workspace === undefined
      ? []
      : ["--workspace", answers.workspace]),
    ...(answers.project === undefined ? [] : ["--project", answers.project]),
    ...(command !== "Project" || answers.name === undefined
      ? []
      : [setupNameFlag, answers.name]),
    ...(answers.plugin === undefined ? [] : [setupPluginFlag, answers.plugin]),
    ...(command !== "Runner" || answers.chatHost === undefined
      ? []
      : [setupChatHostFlag, answers.chatHost]),
    ...(command !== "Status" || answers.start === undefined
      ? []
      : [setupStartFlag, answers.start]),
  ];
}

/** The choice a run's own arguments named, and none where they were asked wrongly or start a listener. */
export function setupAnswersAsked(argv: readonly string[]): SetupAnswers {
  const asked = setupAsked(argv);
  return asked.asked === "Wrongly" || asked.asked === "Listen"
    ? setupAnswersNone
    : asked.answers;
}

/** The arguments a sign-in starts its listener with. */
export function setupListenArguments(
  site: string,
  lifeSecs: number,
): readonly string[] {
  return ["listen", "--site", site, "--life-secs", String(lifeSecs)];
}
