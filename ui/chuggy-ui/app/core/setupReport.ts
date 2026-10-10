/**
 * What a run of the setup program found, as a value, and the lines it is
 * printed as.
 *
 * Every line is `<word>: <text>` with the word from a closed set, and the last
 * is the one `next:` line: a command that runs as it is written, or `stop`.
 * `stop` is also what follows anything running a command again would not
 * mend by itself: a sign-in that ended any way but signed in, another run
 * holding the lock, a path the machine would not write, a site or a sign-in
 * server that did not answer, a read that failed. Each says what was found,
 * tells the person, and names in a `rule:` line the one command and the
 * condition it may be run under. A step the person does by hand is that shape
 * too, so nothing printed is a command an agent could run round and round
 * without her.
 *
 * A report of a sign-in holds a site's origin, a directory, a path of the
 * program's own, numbers and members of closed sets. A checklist holds
 * sentences made in `ui/chuggy-ui/app/core/setupStanding.ts` and
 * `ui/chuggy-ui/app/core/setupNext.ts` from the names a site and the folder's
 * remote gave. Neither has a field a token, a code or a message of another
 * system's is put in, and every line is flattened where it is printed. Every
 * command printed carries the workspace and project the run was about, so the
 * conversation holds that choice. Nothing here runs on import and no parser
 * is reached, because the Node check prints through this module before
 * anything else has been evaluated.
 */

import type { ApiFailure } from "./apiRequest.ts";
import {
  setupAnswerArguments,
  setupAnswersNone,
  setupCommandArguments,
  setupWaitSecsMax,
} from "./setupArguments.ts";
import type {
  SetupAnswers,
  SetupAskFault,
  SetupCommand,
} from "./setupArguments.ts";
import { setupPlatforms } from "./setupPorts.ts";
import type { SetupMachineFault, SetupPlatform } from "./setupPorts.ts";
import {
  setupLoopbackAddress,
  setupNodeMajorMin,
  setupProgramPath,
} from "./setupProgram.ts";
import { setupCommandLine, setupFlat } from "./setupText.ts";

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

/** The steps of setup, in the order they are done and printed. */
export const setupSteps = [
  "workspace",
  "project",
  "github",
  "repository",
  "runner",
  "ticket",
] as const;

export type SetupStepName = (typeof setupSteps)[number];

/** How a step stands: done, waiting on something named, to do, or not read. */
export const setupStepStates = ["done", "waiting", "todo", "unread"] as const;

export type SetupStepState = (typeof setupStepStates)[number];

/** One step as the checklist prints it: its name, how it stands, and the few words that say why. */
export interface SetupStepSaid {
  readonly step: SetupStepName;
  readonly state: SetupStepState;
  readonly detail: string;
}

/**
 * The one next thing a checklist ends on: nothing, where setup is done;
 * something the person does by hand, and the condition the checklist may be
 * read again under; a question only she answers, and the flag her answer is
 * passed in; or a read that failed, `stale` where this copy of the program
 * could not read what the site sent.
 */
export type SetupThing =
  | { readonly thing: "Done"; readonly tell: string }
  | { readonly thing: "Hand"; readonly tell: string; readonly when: string }
  | {
      readonly thing: "Ask";
      readonly ask: string;
      readonly flag: "workspace" | "project";
    }
  | {
      readonly thing: "Failed";
      readonly found: string;
      readonly stale: boolean;
    };

export interface SetupNext {
  /** The workspace and project every command the checklist prints carries. */
  readonly carried: SetupAnswers;
  readonly thing: SetupThing;
}

export type SetupReport =
  | { readonly report: "NodeOld"; readonly major: number | undefined }
  /** A platform the program is not served on, by the name the machine gave. */
  | { readonly report: "Unserved"; readonly platform: string }
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
      readonly report: "Checklist";
      readonly site: string;
      /** What was found that is no one step's: what the folder's remote proposed. */
      readonly found: readonly string[];
      /** One a step, or none where which project is meant is still the person's to say. */
      readonly steps: readonly SetupStepSaid[];
      readonly next: SetupNext;
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
  "found",
  "step",
  "did",
  "tell",
  "ask",
  "rule",
  "next",
] as const;

type SetupWord = (typeof setupWords)[number];

/** A line before it is printed: its word and its text, a step's being the cells its columns are laid out from. */
type SetupLine =
  | readonly [Exclude<SetupWord, "step">, string]
  | readonly ["step", SetupStepSaid];

/** What `next:` says where no command is left to run. */
export const setupNextStop = "stop";

/** How a report's commands are written: where the program is kept, and the choice each of them carries. */
interface SetupSaying {
  readonly script: string;
  readonly answers: SetupAnswers;
}

/** A command of this program as it is run: its word, the workspace and project the conversation holds, then whatever else it takes. */
function setupCommandOf(
  saying: SetupSaying,
  command: SetupCommand,
  rest: readonly string[] = [],
): string {
  return setupCommandLine([
    "node",
    saying.script,
    ...setupCommandArguments(command),
    ...setupAnswerArguments(saying.answers),
    ...rest,
  ]);
}

function setupNextLine(
  saying: SetupSaying,
  command: SetupCommand,
  rest: readonly string[] = [],
): SetupLine {
  return ["next", setupCommandOf(saying, command, rest)];
}

/** The site named again, for a run that ended before the site was remembered. */
function setupSiteFlag(site: string | undefined): readonly string[] {
  return site === undefined ? [] : ["--site", site];
}

const setupAskFaults: Readonly<Record<SetupAskFault, string>> = {
  Command: "chuggy setup has no such command; it runs bare or as sign-in",
  Flag: "chuggy setup takes --site, --workspace, --project and --wait-secs, each once with a value, and no other flag",
  Site: "--site takes the address of a chuggy site, such as https://chuggy.example",
  WaitSecs: `--wait-secs takes a whole number of seconds, at most ${String(setupWaitSecsMax)}`,
  Name: "--workspace and --project each take one name, as the chuggy site writes it",
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

const setupPlatformNames: Readonly<Record<SetupPlatform, string>> = {
  linux: "Linux",
  darwin: "macOS",
};

function setupUnservedLines(platform: string): readonly SetupLine[] {
  const served = setupPlatforms
    .map((name) => setupPlatformNames[name])
    .join(" and ");
  return [
    [
      "found",
      `chuggy setup runs on ${served}, and this machine is ${platform}`,
    ],
    [
      "tell",
      `chuggy setup runs on ${served} and this machine is neither, so it did nothing. Run it from a machine that is one of those.`,
    ],
    ["next", setupNextStop],
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
      `Run the command on the next: line exactly as written, and stop where it says ${setupNextStop}. Say each tell: line to the person as it is written. Put each ask: line to the person, and pass their answer in the flag it names.`,
    ],
    [
      "rule",
      `Never read or print anything under ${directory}: it holds the sign-in.`,
    ],
  ];
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

function setupStopRule(
  stop: Pick<SetupStop, "when">,
  command: string,
): readonly SetupLine[] {
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

function setupEndedLines(
  report: Extract<SetupReport, { readonly report: "SignInEnded" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  if (report.ended === "SignedIn")
    return [
      ["site", `${report.site}, signed in`],
      setupNextLine(saying, "Status"),
    ];
  const head: SetupLine = ["site", `${report.site}, not signed in`];
  if (!setupSignInHeld(report.ended))
    return [
      head,
      ["found", setupEndingsStanding[report.ended]],
      setupNextLine(saying, "Status"),
    ];
  const held: SetupStop = setupEndingsHeld[report.ended];
  return [
    head,
    ...setupStopSaid(held),
    ...setupStopRule(held, setupCommandOf(saying, "SignIn")),
  ];
}

/** Not signed in: how the program is driven, and either the sign-in that is next or the ending that still stands in its way. */
function setupSignedOutLines(
  report: Extract<SetupReport, { readonly report: "SignedOut" }>,
  saying: SetupSaying,
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
      setupNextLine(saying, "SignIn"),
    ];
  return [
    head,
    ...setupStopSaid(stood),
    ...setupRuleLines(report.directory),
    ...setupStopRule(stood, setupCommandOf(saying, "SignIn")),
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
    case "Unkept":
      return {
        found: `the sign-in was renewed and could not be kept: chuggy setup could not write ${fault.path}`,
        tell: `chuggy setup renewed your sign-in and then could not write it to ${fault.path} on this machine, so it was not kept and you may have to sign in again. Tell me once that path can be written.`,
        when: `once ${fault.path} can be made and written`,
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
  saying: SetupSaying,
): readonly SetupLine[] {
  const stop =
    report.report === "Busy"
      ? setupBusyStop(report.pid)
      : setupFaultStop(report.fault);
  const command = setupCommandOf(
    saying,
    report.asked,
    setupSiteFlag(report.site),
  );
  return [...setupStopSaid(stop), ...setupStopRule(stop, command)];
}

const setupStale = "this copy of chuggy setup may be older than the site";

/** The command that fetches the site's own copy of the program over this one and reads the checklist with it. */
function setupFetched(site: string, saying: SetupSaying): string {
  const fetched = setupCommandLine([
    "curl",
    "-fsS",
    `${site}${setupProgramPath}`,
    "-o",
    saying.script,
  ]);
  return `${fetched} && ${setupCommandOf(saying, "Status")}`;
}

const setupLookAgain = "if the person asks to look again";

/** What follows an answer this copy could not read: the person is told, and fetching the site's own copy waits on their say-so. */
function setupStaleLines(
  site: string,
  saying: SetupSaying,
): readonly SetupLine[] {
  return [
    [
      "tell",
      "This copy of chuggy setup could not read what the chuggy site sent, and may be older than the site. Tell me if you want me to fetch the site's own copy.",
    ],
    ...setupStopRule(
      { when: "if the person asks to fetch chuggy setup again" },
      setupFetched(site, saying),
    ),
  ];
}

/** A sign-in the site refused is forgotten, and the page that mends it is next; any other read that did not confirm it is a stop. */
function setupUnreadLines(
  report: Extract<SetupReport, { readonly report: "WorkspacesUnread" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  if (report.outcome === "Unauthenticated")
    return [
      ["site", `${report.site}, not signed in`],
      ["found", "the site refused the remembered sign-in, so it was forgotten"],
      setupNextLine(saying, "SignIn"),
    ];
  const head: SetupLine = ["site", `${report.site}, sign-in not confirmed`];
  if (report.outcome === "Unreadable")
    return [
      head,
      ["found", setupStale],
      ...setupStaleLines(report.site, saying),
    ];
  const stop: SetupStop = {
    found: `the site did not say which workspaces are yours (${report.outcome})`,
    tell: "The chuggy site did not answer when I asked which workspaces are yours, so I cannot say where you stand. Tell me if you want me to look again.",
    when: setupLookAgain,
  };
  return [
    head,
    ...setupStopSaid(stop),
    ...setupStopRule(stop, setupCommandOf(saying, report.asked)),
  ];
}

/** Why a site could not be worked with, as a stop: asking again unasked mends none of them. */
function setupSessionStop(
  report: Extract<
    SetupReport,
    { readonly report: "SiteUnusable" | "IssuerUnanswered" }
  >,
): SetupStop {
  if (report.report === "IssuerUnanswered")
    return {
      found: "the sign-in server did not answer",
      tell: "The chuggy site's sign-in server is not answering, so I cannot tell whether chuggy setup is signed in. Tell me if you want me to try again.",
      when: setupAskedRetry,
    };
  switch (report.phase) {
    case "Unreachable":
      return {
        found: "the site did not answer",
        tell: `${report.site} did not answer, so chuggy setup did nothing. Check the address and that this machine can reach it, and tell me if you want me to try again.`,
        when: setupAskedRetry,
      };
    case "Unconfigured":
      return {
        found: "the address answered, and not as a chuggy site",
        tell: `What answered at ${report.site} is not a chuggy site this program can read, so chuggy setup did nothing. Check the address, and tell me if you want me to try again.`,
        when: setupAskedRetry,
      };
  }
}

function setupSessionLines(
  report: Extract<
    SetupReport,
    { readonly report: "SiteUnusable" | "IssuerUnanswered" }
  >,
  saying: SetupSaying,
): readonly SetupLine[] {
  const said =
    report.report === "SiteUnusable"
      ? setupSitePhases[report.phase]
      : "its sign-in server is not answering";
  const stop = setupSessionStop(report);
  const command = setupCommandOf(
    saying,
    report.asked,
    setupSiteFlag(report.site),
  );
  return [
    ["site", `${report.site}, ${said}`],
    ...setupStopSaid(stop),
    ...setupStopRule(stop, command),
  ];
}

/** A read that failed is a stop like any other: what was not read, and the one command named under the person's say-so. */
function setupFailedLines(
  site: string,
  thing: Extract<SetupThing, { readonly thing: "Failed" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  if (!thing.stale)
    return [
      ["found", thing.found],
      [
        "tell",
        "The chuggy site did not answer everything I asked it, so I cannot say what comes next. Tell me if you want me to look again.",
      ],
      ...setupStopRule(
        { when: setupLookAgain },
        setupCommandOf(saying, "Status"),
      ),
    ];
  return [
    ["found", `${thing.found}; ${setupStale}`],
    ...setupStaleLines(site, saying),
  ];
}

/** The command an answer is passed to: the flag it goes in last, and never twice, whatever was carried under that name. */
function setupAnswered(
  saying: SetupSaying,
  flag: "workspace" | "project",
): string {
  const answers = { ...saying.answers, [flag]: undefined };
  return setupCommandOf({ ...saying, answers }, "Status", [`--${flag}`]);
}

/** What a checklist ends on, which is a command only where a later step has one to run. */
function setupThingLines(
  report: Extract<SetupReport, { readonly report: "Checklist" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  const thing = report.next.thing;
  switch (thing.thing) {
    case "Done":
      return [
        ["tell", thing.tell],
        ["next", setupNextStop],
      ];
    case "Hand":
      return [
        ["tell", thing.tell],
        ...setupStopRule(thing, setupCommandOf(saying, "Status")),
      ];
    case "Ask":
      return [
        ["ask", thing.ask],
        [
          "rule",
          `Run ${setupAnswered(saying, thing.flag)} with the person's answer after it, only once the person has answered.`,
        ],
        ["next", setupNextStop],
      ];
    case "Failed":
      return setupFailedLines(report.site, thing, saying);
  }
}

function setupChecklistLines(
  report: Extract<SetupReport, { readonly report: "Checklist" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  return [
    ["site", `${report.site}, signed in`],
    ...report.found.map((found): SetupLine => ["found", found]),
    ...report.steps.map((step): SetupLine => ["step", step]),
    ...setupThingLines(report, saying),
  ];
}

function setupLines(
  report: SetupReport,
  saying: SetupSaying,
): readonly SetupLine[] {
  const bare: SetupSaying = { ...saying, answers: setupAnswersNone };
  switch (report.report) {
    case "NodeOld":
      return [...setupNodeLines(report.major), setupNextLine(bare, "Status")];
    case "Unserved":
      return setupUnservedLines(report.platform);
    case "AskedWrongly":
      return [
        ["found", setupAskFaults[report.fault]],
        setupNextLine(bare, "Status"),
      ];
    case "SiteUnknown":
      return [
        ["found", "no chuggy site is remembered on this machine yet"],
        [
          "rule",
          `Run ${setupCommandOf(saying, "Status", ["--site"])} with the address of the person's chuggy site after it, such as https://chuggy.example. Ask the person for the address if you do not have it.`,
        ],
        ["next", setupNextStop],
      ];
    case "Busy":
    case "Faulted":
      return setupStoppedLines(report, saying);
    case "WorkspacesUnread":
      return setupUnreadLines(report, saying);
    case "SignInWaiting":
      return [
        ["site", `${report.site}, not signed in`],
        ...setupWaitingLines(report),
        setupNextLine(saying, "SignIn"),
      ];
    case "SignInEnded":
      return setupEndedLines(report, saying);
    case "SignedOut":
      return setupSignedOutLines(report, saying);
    case "SiteUnusable":
    case "IssuerUnanswered":
      return setupSessionLines(report, saying);
    case "Checklist":
      return setupChecklistLines(report, {
        ...saying,
        answers: report.next.carried,
      });
  }
}

/** The spaces between a column's longest word and the next column. */
const setupColumnGap = 2;

function setupWidth(words: readonly string[]): number {
  return Math.max(...words.map((word) => word.length)) + setupColumnGap;
}

/** A line as it is printed. A step's name and state are laid out in columns as wide as the longest of each, so the cells are flattened one at a time and the spaces between them are the layout's own. */
function setupPrinted(line: SetupLine): string {
  if (line[0] !== "step") return `${line[0]}: ${setupFlat(line[1])}`;
  const { step, state, detail } = line[1];
  const laid = `${step.padEnd(setupWidth(setupSteps))}${state.padEnd(setupWidth(setupStepStates))}${setupFlat(detail)}`;
  return `step: ${laid.trimEnd()}`;
}

/**
 * The lines a report is printed as, for a program kept at `script` and a run
 * whose arguments named `answers`. Every line passes through the one place
 * text is flattened, so a line is one line, and holds nothing a terminal
 * would obey, whatever a name from a server, a file, the folder's remote or
 * the command line held.
 */
export function setupReportLines(
  report: SetupReport,
  script: string,
  answers: SetupAnswers = setupAnswersNone,
): readonly string[] {
  return setupLines(report, { script, answers }).map(setupPrinted);
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

/** Zero is follow `next:`, one is failed, two is asked wrongly or run where the program cannot be: a Node too old, or a platform it is not served on. */
export function setupReportExit(report: SetupReport): 0 | 1 | 2 {
  switch (report.report) {
    case "NodeOld":
    case "Unserved":
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
    case "SignInWaiting":
      return 0;
    case "SignInEnded":
      return setupEndedFailures.has(report.ended) ? 1 : 0;
    case "Checklist":
      return report.next.thing.thing === "Failed" ? 1 : 0;
  }
}
