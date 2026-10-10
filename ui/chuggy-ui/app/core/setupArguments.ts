/**
 * What a run of the setup program was asked to do, read from its arguments.
 *
 * The grammar is closed: at most one command, then flags that each take one
 * value, written `--name value` or `--name=value`, each at most once. Anything
 * else is asked wrongly, and which way is all that is kept of it, so nothing a
 * person typed is ever printed back. `listen` is the command a sign-in starts
 * for itself and no person runs. `runner` is the one command that changes the
 * machine, so it is run for a project named whole and never for one the
 * program would have to choose. `--workspace` and `--project` say which
 * project a run is about where more than one could be meant; every command
 * the program prints carries them, so the conversation holds that choice and
 * no file does.
 */

import { setupLoopbackHost } from "./setupProgram.ts";
import { setupSayable } from "./setupText.ts";

export const setupWaitSecsDefault = 90;
export const setupWaitSecsMax = 600;

/** How long a sign-in page stays answerable where the command starting it names no other life. */
export const setupListenSecsDefault = 600;

/** Which part of the arguments could not be read. */
export type SetupAskFault =
  "Command" | "Flag" | "Site" | "WaitSecs" | "Name" | "Project";

/** The commands a person or an agent runs, as a report names them. */
export type SetupCommand = "Status" | "SignIn" | "Runner";

/** Which workspace and project a run is about, as far as its arguments named them. */
export interface SetupAnswers {
  readonly workspace: string | undefined;
  readonly project: string | undefined;
}

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
      readonly asked: "Runner";
      readonly site: string | undefined;
      readonly waitSecs: number;
      readonly answers: SetupAnswers;
      /** The project the runner is for, which the command is not run without. */
      readonly workspace: string;
      readonly project: string;
    }
  | {
      readonly asked: "Listen";
      readonly site: string;
      readonly lifeSecs: number;
    }
  | { readonly asked: "Wrongly"; readonly fault: SetupAskFault };

type SetupRun = Exclude<SetupAsked["asked"], "Wrongly">;

const setupCommandWords = {
  "sign-in": "SignIn",
  runner: "Runner",
  listen: "Listen",
} as const;

type SetupCommandWord = keyof typeof setupCommandWords;

const setupFlags = [
  "site",
  "wait-secs",
  "life-secs",
  "workspace",
  "project",
] as const;

type SetupFlag = (typeof setupFlags)[number];

/** The flags each command reads; one it does not read is asked wrongly. */
const setupFlagsRead: Readonly<Record<SetupRun, readonly SetupFlag[]>> = {
  Status: ["site", "workspace", "project"],
  SignIn: ["site", "wait-secs", "workspace", "project"],
  Runner: ["site", "wait-secs", "workspace", "project"],
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

/** The names the flags gave, or nothing where one is not a name a line can carry back unchanged or an address can carry as itself. */
function setupAnswersRead(
  flags: ReadonlyMap<SetupFlag, string>,
): SetupAnswers | undefined {
  const workspace = flags.get("workspace");
  const project = flags.get("project");
  for (const name of [workspace, project])
    if (
      name !== undefined &&
      (!setupSayable(name) || setupPlaces.includes(name))
    )
      return undefined;
  return { workspace, project };
}

function setupAskedOf(
  asked: SetupRun,
  flags: ReadonlyMap<SetupFlag, string>,
): SetupAsked {
  const given = flags.get("site");
  const site = given === undefined ? undefined : setupSiteRead(given);
  if (given !== undefined && site === undefined)
    return { asked: "Wrongly", fault: "Site" };
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
      return { asked, site, answers };
    case "SignIn":
      return { asked, site, waitSecs: wait, answers };
    case "Runner": {
      const { workspace, project } = answers;
      return workspace === undefined || project === undefined
        ? { asked: "Wrongly", fault: "Project" }
        : { asked, site, waitSecs: wait, answers, workspace, project };
    }
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
    case "Runner":
      return ["runner"];
  }
}

/** The flags that name a choice again, which `setupAsked` reads back as the same choice. */
export function setupAnswerArguments(answers: SetupAnswers): readonly string[] {
  return [
    ...(answers.workspace === undefined
      ? []
      : ["--workspace", answers.workspace]),
    ...(answers.project === undefined ? [] : ["--project", answers.project]),
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
