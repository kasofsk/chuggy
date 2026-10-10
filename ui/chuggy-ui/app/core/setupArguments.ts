/**
 * What a run of the setup program was asked to do, read from its arguments.
 *
 * The grammar is closed: at most one command, then flags that each take one
 * value, written `--name value` or `--name=value`, each at most once. Anything
 * else is asked wrongly, and which way is all that is kept of it, so nothing a
 * person typed is ever printed back. `listen` is the command a sign-in starts
 * for itself and no person runs.
 */

import { setupLoopbackHost } from "./setupProgram.ts";

export const setupWaitSecsDefault = 90;
export const setupWaitSecsMax = 600;

/** How long a sign-in page stays answerable where the command starting it names no other life. */
export const setupListenSecsDefault = 600;

/** Which part of the arguments could not be read. */
export type SetupAskFault = "Command" | "Flag" | "Site" | "WaitSecs";

/** The commands a person or an agent runs, as a report names them. */
export type SetupCommand = "Status" | "SignIn";

export type SetupAsked =
  | { readonly asked: "Status"; readonly site: string | undefined }
  | {
      readonly asked: "SignIn";
      readonly site: string | undefined;
      readonly waitSecs: number;
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
  listen: "Listen",
} as const;

type SetupCommandWord = keyof typeof setupCommandWords;

const setupFlags = ["site", "wait-secs", "life-secs"] as const;

type SetupFlag = (typeof setupFlags)[number];

/** The flags each command reads; one it does not read is asked wrongly. */
const setupFlagsRead: Readonly<Record<SetupRun, readonly SetupFlag[]>> = {
  Status: ["site"],
  SignIn: ["site", "wait-secs"],
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

function setupAskedOf(
  asked: SetupRun,
  flags: ReadonlyMap<SetupFlag, string>,
): SetupAsked {
  const given = flags.get("site");
  const site = given === undefined ? undefined : setupSiteRead(given);
  if (given !== undefined && site === undefined)
    return { asked: "Wrongly", fault: "Site" };
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
      return { asked, site };
    case "SignIn":
      return { asked, site, waitSecs: wait };
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
  }
}

/** The arguments a sign-in starts its listener with. */
export function setupListenArguments(
  site: string,
  lifeSecs: number,
): readonly string[] {
  return ["listen", "--site", site, "--life-secs", String(lifeSecs)];
}
