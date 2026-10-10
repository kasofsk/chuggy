/**
 * What a run of the setup program found, as a value, and the lines it is
 * printed as.
 *
 * Every line is `<word>: <text>` with the word from a closed set, and the last
 * is the one `next:` line: a command that runs as it is written, or `stop`.
 * `stop` is also what follows anything running a command again would not
 * mend by itself: a sign-in that ended any way but signed in, another run
 * holding the lock, a path the machine would not write. Each says what was
 * found, tells the person, and names in a `rule:` line the one command and the
 * condition it may be run under. A report holds a site's origin, a directory,
 * a path of the program's own, workspace names, numbers and members of closed
 * sets, so no token, code or message of another system's has a field to ride
 * in. Nothing here runs on import and no parser is reached, because the Node
 * check prints through this module before anything else has been evaluated.
 */

import type { ApiFailure } from "./apiRequest.ts";
import { setupCommandArguments, setupWaitSecsMax } from "./setupArguments.ts";
import type { SetupAskFault, SetupCommand } from "./setupArguments.ts";
import type { SetupMachineFault } from "./setupPorts.ts";
import {
  setupLoopbackAddress,
  setupNodeMajorMin,
  setupProgramPath,
} from "./setupProgram.ts";

/** How a sign-in in the browser ended, in the order a person could meet them. */
export const setupSignInEndings = [
  "SignedIn",
  "NoRenewal",
  "Declined",
  "Refused",
  "Mismatched",
  "ExchangeFailed",
  "SiteChanged",
  "SiteRefused",
  "WorkspacesUnread",
  "Expired",
  "SiteUnusable",
  "Busy",
  "Faulted",
] as const;

export type SetupSignInEnded = (typeof setupSignInEndings)[number];

/** Whether this run opened the sign-in page, could not, or found one already waiting. */
export type SetupSignInOpened = "Opened" | "NotOpened" | "Attached";

/** Why a run stopped with no site and no sign-in server at fault: the machine, a sign-in page that would not start, or something nothing here expected. */
export type SetupFault =
  | SetupMachineFault
  | { readonly fault: "Unstarted" }
  | { readonly fault: "Unexpected" };

export type SetupReport =
  | { readonly report: "NodeOld"; readonly major: number | undefined }
  | { readonly report: "AskedWrongly"; readonly fault: SetupAskFault }
  | { readonly report: "SiteUnknown" }
  | {
      readonly report: "Busy";
      readonly asked: SetupCommand;
      /** The site the command was given, which may not be the one remembered. */
      readonly site: string | undefined;
      /** The process the lock named as its holder, where it still named one. */
      readonly pid: number | undefined;
    }
  | {
      readonly report: "Faulted";
      readonly asked: SetupCommand;
      readonly site: string | undefined;
      readonly fault: SetupFault;
    }
  | {
      readonly report: "SiteUnusable";
      readonly site: string;
      readonly phase: "Unreachable" | "Unconfigured";
      readonly asked: SetupCommand;
    }
  | {
      readonly report: "IssuerUnanswered";
      readonly site: string;
      readonly asked: SetupCommand;
    }
  | {
      readonly report: "SignedOut";
      readonly site: string;
      readonly directory: string;
      /** How the last sign-in for this site ended, where that ending still stands. */
      readonly ended: SetupSignInEnded | undefined;
    }
  | {
      readonly report: "SignedIn";
      readonly site: string;
      /** The workspaces the person administers. */
      readonly workspaces: readonly string[];
      readonly truncated: boolean;
    }
  | {
      readonly report: "WorkspacesUnread";
      readonly site: string;
      readonly outcome: ApiFailure["outcome"];
      readonly asked: SetupCommand;
    }
  | {
      readonly report: "SignInWaiting";
      readonly site: string;
      readonly port: number;
      readonly opened: SetupSignInOpened;
      readonly waitedSecs: number;
    }
  | {
      readonly report: "SignInEnded";
      readonly site: string;
      readonly ended: SetupSignInEnded;
    };

export const setupWords = [
  "site",
  "workspace",
  "found",
  "did",
  "tell",
  "rule",
  "next",
] as const;

type SetupWord = (typeof setupWords)[number];

type SetupLine = readonly [SetupWord, string];

/** What `next:` says where no command is left to run. */
export const setupNextStop = "stop";

/** A word a shell reads as itself, quoted where it would read it as anything else. */
function setupShellWord(text: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(text)
    ? text
    : `'${text.replace(/'/gu, "'\\''")}'`;
}

function setupCommandLine(words: readonly string[]): string {
  return words.map(setupShellWord).join(" ");
}

function setupNext(script: string, words: readonly string[]): SetupLine {
  return ["next", setupCommandLine(["node", script, ...words])];
}

function setupNextCommand(script: string, command: SetupCommand): SetupLine {
  return setupNext(script, setupCommandArguments(command));
}

/** A command's arguments with its site named, for a run that ended before the site was remembered. */
function setupArgumentsAt(
  command: SetupCommand,
  site: string | undefined,
): readonly string[] {
  const words = setupCommandArguments(command);
  return site === undefined ? words : [...words, "--site", site];
}

function setupNextAt(
  script: string,
  command: SetupCommand,
  site: string,
): SetupLine {
  return setupNext(script, setupArgumentsAt(command, site));
}

const setupSignInNext: readonly string[] = setupCommandArguments("SignIn");

const setupAskFaults: Readonly<Record<SetupAskFault, string>> = {
  Command: "chuggy setup has no such command; it runs bare or as sign-in",
  Flag: "chuggy setup takes --site and --wait-secs, each once with a value, and no other flag",
  Site: "--site takes the address of a chuggy site, such as https://chuggy.example",
  WaitSecs: `--wait-secs takes a whole number of seconds, at most ${String(setupWaitSecsMax)}`,
};

function setupNodeLines(major: number | undefined): readonly SetupLine[] {
  const needs = `chuggy setup needs Node ${String(setupNodeMajorMin)} or newer`;
  const found =
    major === undefined
      ? "this Node did not say its version"
      : `this is Node ${String(major)}`;
  return [
    ["found", `${found}; ${needs}`],
    ["tell", `${needs} on this machine. Once it is installed I can carry on.`],
  ];
}

const setupSitePhases = {
  Unreachable: "no answer",
  Unconfigured: "not a chuggy site this program can read",
} as const;

/** How to drive the program, said once: to whoever has not yet signed in. */
function setupRuleLines(directory: string): readonly SetupLine[] {
  return [
    [
      "rule",
      `Run the command on the next: line exactly as written, and stop where it says ${setupNextStop}. Say each tell: line to the person as it is written.`,
    ],
    [
      "rule",
      `Never read or print anything under ${directory}: it holds the sign-in.`,
    ],
  ];
}

function setupWorkspaceLines(
  workspaces: readonly string[],
  truncated: boolean,
): readonly SetupLine[] {
  const listed: SetupLine[] = workspaces.map((name) => ["workspace", name]);
  if (listed.length === 0)
    listed.push(["found", "no workspace is yours to administer yet"]);
  if (truncated)
    listed.push(["found", "the site sent only part of the workspace list"]);
  return listed;
}

function setupWaitingLines(
  report: Extract<SetupReport, { readonly report: "SignInWaiting" }>,
): readonly SetupLine[] {
  const address = setupLoopbackAddress(report.port);
  const finish = `Sign in with GitHub there and allow chuggy setup. If the page is gone, open ${address} on this machine.`;
  switch (report.opened) {
    case "Opened":
      return [
        ["did", `opened ${address} in a browser`],
        [
          "found",
          `nobody finished signing in within ${String(report.waitedSecs)} s`,
        ],
        ["tell", `A sign-in page is open in your browser. ${finish}`],
      ];
    case "Attached":
      return [
        ["found", "the sign-in page opened earlier is still waiting"],
        ["tell", `A sign-in page is open in your browser. ${finish}`],
      ];
    case "NotOpened":
      return [
        ["found", "no browser could be opened from here"],
        [
          "tell",
          `Open ${address} in a browser on this machine, sign in with GitHub and allow chuggy setup.`,
        ],
      ];
  }
}

/** A stop: what was found, what the person is told, and the condition the one command a rule names may be run under. */
interface SetupStop {
  readonly found: string;
  readonly tell: string;
  readonly when: string;
}

function setupStopSaid(stop: SetupStop): readonly SetupLine[] {
  return [
    ["found", stop.found],
    ["tell", stop.tell],
  ];
}

function setupStopRule(stop: SetupStop, command: string): readonly SetupLine[] {
  return [
    ["rule", `Run ${command} only ${stop.when}.`],
    ["next", setupNextStop],
  ];
}

const setupAskedAgain = "if the person asks to try signing in again";

/**
 * Every ending that is not a sign-in and after which nothing is run until the
 * person asks. A page is opened by a person's wish and never by a failure, so
 * each is a stop, and each stands until a `sign-in` opens another page.
 */
const setupEndingsHeld = {
  NoRenewal: {
    found: "the sign-in was allowed without leave to stay signed in",
    tell: "The sign-in went through without the permission that keeps chuggy setup signed in, so it was not kept. Next time, tick every box on the page that asks before pressing Allow. Tell me when you are ready to sign in again.",
    when: "when the person says they are ready to sign in again",
  },
  Declined: {
    found: "the sign-in was declined in the browser",
    tell: "The sign-in was declined in the browser, so chuggy setup is not signed in and nothing was changed. Tell me if you want to sign in after all.",
    when: "if the person asks to sign in after all",
  },
  Refused: {
    found: "the sign-in server refused the request",
    tell: "The sign-in server refused the sign-in, so chuggy setup is not signed in. Tell me if you want to try signing in again.",
    when: setupAskedAgain,
  },
  Mismatched: {
    found: "the answer that came back did not belong to this sign-in",
    tell: "The answer the browser brought back was not this sign-in's, so chuggy setup is not signed in. Tell me if you want to try signing in again.",
    when: setupAskedAgain,
  },
  ExchangeFailed: {
    found: "the sign-in server did not accept the answer",
    tell: "The sign-in server did not accept the answer the browser brought back, so chuggy setup is not signed in. Tell me if you want to try signing in again.",
    when: setupAskedAgain,
  },
  SiteRefused: {
    found:
      "the sign-in went through, but the site refused it, so nothing is remembered",
    tell: "The sign-in went through, but the chuggy site did not accept it, so chuggy setup is not signed in. Tell me if you want to try signing in again.",
    when: setupAskedAgain,
  },
  Expired: {
    found: "nobody finished the sign-in page before it closed",
    tell: "The sign-in page expired before anyone signed in. Tell me when you are ready and I will open a new one.",
    when: "when the person says they are ready to sign in",
  },
  SiteUnusable: {
    found: "the site stopped answering before the sign-in page could open",
    tell: "The chuggy site stopped answering before the sign-in page could open, so nothing was signed in. Tell me if you want to try signing in again.",
    when: setupAskedAgain,
  },
  Busy: {
    found: "another chuggy setup command held the sign-in",
    tell: "The sign-in was answered while another chuggy setup command was running, so it was not kept. Tell me if you want to try signing in again.",
    when: setupAskedAgain,
  },
  Faulted: {
    found: "the sign-in page stopped on something it did not expect",
    tell: "The sign-in page stopped before the sign-in finished, so chuggy setup is not signed in. Tell me if you want to try signing in again.",
    when: setupAskedAgain,
  },
} as const satisfies Partial<Readonly<Record<SetupSignInEnded, SetupStop>>>;

type SetupSignInHeld = keyof typeof setupEndingsHeld;

/** The endings a page is not what follows: the bare command says how the remembered site stands. */
const setupEndingsStanding: Readonly<
  Record<Exclude<SetupSignInEnded, SetupSignInHeld | "SignedIn">, string>
> = {
  SiteChanged:
    "another site was chosen on this machine while the sign-in page waited, so nothing was signed in",
  WorkspacesUnread:
    "the sign-in went through, but the site did not say which workspaces are yours",
};

/** Whether an ending is one nothing is run after until the person asks, which is also whether it stands. */
export function setupSignInHeld(
  ended: SetupSignInEnded,
): ended is SetupSignInHeld {
  return Object.hasOwn(setupEndingsHeld, ended);
}

function setupSignInCommand(script: string): string {
  return setupCommandLine(["node", script, ...setupSignInNext]);
}

function setupEndedLines(
  report: Extract<SetupReport, { readonly report: "SignInEnded" }>,
  script: string,
): readonly SetupLine[] {
  if (report.ended === "SignedIn")
    return [["site", `${report.site}, signed in`], setupNext(script, [])];
  const head: SetupLine = ["site", `${report.site}, not signed in`];
  if (!setupSignInHeld(report.ended))
    return [
      head,
      ["found", setupEndingsStanding[report.ended]],
      setupNext(script, []),
    ];
  const held: SetupStop = setupEndingsHeld[report.ended];
  return [
    head,
    ...setupStopSaid(held),
    ...setupStopRule(held, setupSignInCommand(script)),
  ];
}

/** Not signed in: how the program is driven, and either the sign-in that is next or the ending that still stands in its way. */
function setupSignedOutLines(
  report: Extract<SetupReport, { readonly report: "SignedOut" }>,
  script: string,
): readonly SetupLine[] {
  const head: SetupLine = ["site", `${report.site}, not signed in`];
  const stood: SetupStop | undefined =
    report.ended !== undefined && setupSignInHeld(report.ended)
      ? setupEndingsHeld[report.ended]
      : undefined;
  if (stood === undefined)
    return [
      head,
      ...setupRuleLines(report.directory),
      setupNext(script, setupSignInNext),
    ];
  return [
    head,
    ...setupStopSaid(stood),
    ...setupRuleLines(report.directory),
    ...setupStopRule(stood, setupSignInCommand(script)),
  ];
}

const setupAskedRetry = "if the person asks to try again";

function setupFaultStop(fault: SetupFault): SetupStop {
  switch (fault.fault) {
    case "Unwritable":
      return {
        found: `chuggy setup could not make or write ${fault.path}`,
        tell: `chuggy setup stopped because it could not write ${fault.path} on this machine. Tell me once it can.`,
        when: `once ${fault.path} can be made and written`,
      };
    case "Unreadable":
      return {
        found: `chuggy setup could not read ${fault.path}`,
        tell: `chuggy setup stopped because it could not read ${fault.path} on this machine. Tell me once it can.`,
        when: `once ${fault.path} can be read`,
      };
    case "Homeless":
      return {
        found: "this machine did not say where the person's home directory is",
        tell: "chuggy setup keeps its sign-in in your home directory, and this machine did not say where that is. Tell me once HOME is set.",
        when: "once HOME names the person's home directory",
      };
    case "Unstarted":
      return {
        found: "the sign-in page could not be started on this machine",
        tell: "I could not start the sign-in page on this machine. Tell me if you want me to try again.",
        when: setupAskedRetry,
      };
    case "Unexpected":
      return {
        found: "chuggy setup stopped on something it did not expect",
        tell: "chuggy setup stopped on something it did not expect. Tell me if you want me to try again.",
        when: setupAskedRetry,
      };
  }
}

function setupBusyStop(pid: number | undefined): SetupStop {
  const running = "another chuggy setup command is running on this machine";
  return {
    found:
      pid === undefined ? running : `${running}, as process ${String(pid)}`,
    tell: "Another chuggy setup command is still running on this machine, so this one did nothing. I will run it again once the other has ended.",
    when: "once that command has ended",
  };
}

/** A run that stopped on this machine and not on a site: what stopped it, and the same command named under the condition that mends it. */
function setupStoppedLines(
  report: Extract<SetupReport, { readonly report: "Busy" | "Faulted" }>,
  script: string,
): readonly SetupLine[] {
  const stop =
    report.report === "Busy"
      ? setupBusyStop(report.pid)
      : setupFaultStop(report.fault);
  const command = setupCommandLine([
    "node",
    script,
    ...setupArgumentsAt(report.asked, report.site),
  ]);
  return [...setupStopSaid(stop), ...setupStopRule(stop, command)];
}

function setupUnreadLines(
  report: Extract<SetupReport, { readonly report: "WorkspacesUnread" }>,
  script: string,
): readonly SetupLine[] {
  if (report.outcome === "Unauthenticated")
    return [
      ["site", `${report.site}, not signed in`],
      ["found", "the site refused the remembered sign-in, so it was forgotten"],
      setupNext(script, setupSignInNext),
    ];
  const head: SetupLine = ["site", `${report.site}, sign-in not confirmed`];
  if (report.outcome !== "Unreadable")
    return [
      head,
      [
        "found",
        `the site did not say which workspaces are yours (${report.outcome})`,
      ],
      setupNextCommand(script, report.asked),
    ];
  const fetched = setupCommandLine([
    "curl",
    "-fsS",
    `${report.site}${setupProgramPath}`,
    "-o",
    script,
  ]);
  return [
    head,
    ["found", "this copy of chuggy setup may be older than the site"],
    ["next", `${fetched} && ${setupCommandLine(["node", script])}`],
  ];
}

function setupSessionLines(
  report: Extract<
    SetupReport,
    {
      readonly report: "SignedIn" | "SiteUnusable" | "IssuerUnanswered";
    }
  >,
  script: string,
): readonly SetupLine[] {
  switch (report.report) {
    case "SiteUnusable":
      return [
        ["site", `${report.site}, ${setupSitePhases[report.phase]}`],
        setupNextAt(script, report.asked, report.site),
      ];
    case "IssuerUnanswered":
      return [
        ["site", `${report.site}, its sign-in server is not answering`],
        setupNextAt(script, report.asked, report.site),
      ];
    case "SignedIn":
      return [
        ["site", `${report.site}, signed in`],
        ...setupWorkspaceLines(report.workspaces, report.truncated),
        ["next", setupNextStop],
      ];
  }
}

function setupLines(report: SetupReport, script: string): readonly SetupLine[] {
  switch (report.report) {
    case "NodeOld":
      return [...setupNodeLines(report.major), setupNext(script, [])];
    case "AskedWrongly":
      return [["found", setupAskFaults[report.fault]], setupNext(script, [])];
    case "SiteUnknown":
      return [
        ["found", "no chuggy site is remembered on this machine yet"],
        [
          "rule",
          `Run ${setupCommandLine(["node", script, "--site"])} with the address of the person's chuggy site after it, such as https://chuggy.example. Ask the person for the address if you do not have it.`,
        ],
        ["next", setupNextStop],
      ];
    case "Busy":
    case "Faulted":
      return setupStoppedLines(report, script);
    case "WorkspacesUnread":
      return setupUnreadLines(report, script);
    case "SignInWaiting":
      return [
        ["site", `${report.site}, not signed in`],
        ...setupWaitingLines(report),
        setupNext(script, setupSignInNext),
      ];
    case "SignInEnded":
      return setupEndedLines(report, script);
    case "SignedOut":
      return setupSignedOutLines(report, script);
    case "SiteUnusable":
    case "IssuerUnanswered":
    case "SignedIn":
      return setupSessionLines(report, script);
  }
}

/** Every control character, every character that only directs how others are drawn, and every space and line end of any kind. */
const setupUnprinted = /[\p{Cc}\p{Cf}\s]+/gu;

/**
 * The lines a report is printed as, for a program kept at `script`. Each run
 * of characters that are not printed as themselves becomes one plain space,
 * so a line is one line, and holds nothing a terminal would obey, whatever a
 * name from a server, a file or the command line held.
 */
export function setupReportLines(
  report: SetupReport,
  script: string,
): readonly string[] {
  return setupLines(report, script).map(
    ([word, text]) => `${word}: ${text.replace(setupUnprinted, " ").trim()}`,
  );
}

const setupEndedFailures: ReadonlySet<SetupSignInEnded> = new Set([
  "Refused",
  "ExchangeFailed",
  "SiteRefused",
  "WorkspacesUnread",
  "SiteUnusable",
  "Busy",
  "Faulted",
]);

/** Zero is follow `next:`, one is failed, two is asked wrongly or run on a Node too old. */
export function setupReportExit(report: SetupReport): 0 | 1 | 2 {
  switch (report.report) {
    case "NodeOld":
    case "AskedWrongly":
    case "SiteUnknown":
      return 2;
    case "Busy":
    case "Faulted":
    case "SiteUnusable":
    case "IssuerUnanswered":
    case "WorkspacesUnread":
      return 1;
    case "SignedOut":
    case "SignedIn":
    case "SignInWaiting":
      return 0;
    case "SignInEnded":
      return setupEndedFailures.has(report.ended) ? 1 : 0;
  }
}
