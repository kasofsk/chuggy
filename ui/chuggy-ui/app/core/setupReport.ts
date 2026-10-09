/**
 * What a run of the setup program found, as a value, and the lines it is
 * printed as.
 *
 * Every line is `<word>: <text>` with the word from a closed set, and the last
 * is the one `next:` line: the command to run, or `stop` where there is none.
 * A report holds a site's origin, a directory, workspace names, numbers and
 * members of closed sets, so no token, code or message of another system's has
 * a field to ride in. Nothing here runs on import and no parser is reached,
 * because the Node check prints through this module before anything else has
 * been evaluated.
 */

import type { ApiFailure } from "./apiRequest.ts";
import { setupCommandArguments, setupWaitSecsMax } from "./setupArguments.ts";
import type { SetupAskFault, SetupCommand } from "./setupArguments.ts";
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
  "WorkspacesUnread",
  "Expired",
  "SiteUnusable",
  "Busy",
  "Faulted",
] as const;

export type SetupSignInEnded = (typeof setupSignInEndings)[number];

/** Whether this run opened the sign-in page, could not, or found one already waiting. */
export type SetupSignInOpened = "Opened" | "NotOpened" | "Attached";

export type SetupReport =
  | { readonly report: "NodeOld"; readonly major: number | undefined }
  | { readonly report: "AskedWrongly"; readonly fault: SetupAskFault }
  | { readonly report: "SiteUnknown" }
  | { readonly report: "Busy"; readonly asked: SetupCommand }
  | { readonly report: "Faulted" }
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
    }
  | {
      readonly report: "SignedIn";
      readonly site: string;
      /** The workspaces the person administers, or nothing where the site was not asked. */
      readonly workspaces: readonly string[] | undefined;
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

/** The command again with its site named, for a site that failed before it was remembered. */
function setupNextAt(
  script: string,
  command: SetupCommand,
  site: string,
): SetupLine {
  return setupNext(script, [...setupCommandArguments(command), "--site", site]);
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
  workspaces: readonly string[] | undefined,
  truncated: boolean,
): readonly SetupLine[] {
  if (workspaces === undefined) return [];
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

/** What each ending that is not a sign-in found, and what the person is told where it was theirs. */
const setupEndings: Readonly<
  Record<Exclude<SetupSignInEnded, "SignedIn">, readonly SetupLine[]>
> = {
  NoRenewal: [
    ["found", "the sign-in was allowed without leave to stay signed in"],
    [
      "tell",
      "The sign-in went through without the permission that keeps chuggy setup signed in. I will open the page again: tick every box on the page that asks before pressing Allow.",
    ],
  ],
  Declined: [
    ["found", "the sign-in was declined in the browser"],
    [
      "tell",
      "The sign-in was declined in the browser, so nothing is signed in. I will open the page again.",
    ],
  ],
  Refused: [["found", "the sign-in server refused the request"]],
  Mismatched: [
    ["found", "the answer that came back did not belong to this sign-in"],
  ],
  ExchangeFailed: [["found", "the sign-in server did not accept the answer"]],
  WorkspacesUnread: [
    [
      "found",
      "the sign-in went through, but the site did not say which workspaces are yours",
    ],
  ],
  Expired: [["found", "nobody finished the sign-in page before it closed"]],
  SiteUnusable: [
    ["found", "the site stopped answering before the sign-in page could open"],
  ],
  Busy: [["found", "another chuggy setup command held the sign-in"]],
  Faulted: [
    ["found", "the sign-in page stopped on something it did not expect"],
  ],
};

function setupEndedLines(
  report: Extract<SetupReport, { readonly report: "SignInEnded" }>,
  script: string,
): readonly SetupLine[] {
  if (report.ended === "SignedIn")
    return [["site", `${report.site}, signed in`], setupNext(script, [])];
  return [
    ["site", `${report.site}, not signed in`],
    ...setupEndings[report.ended],
    report.ended === "WorkspacesUnread"
      ? setupNext(script, [])
      : setupNext(script, setupSignInNext),
  ];
}

function setupUnreadLines(
  report: Extract<SetupReport, { readonly report: "WorkspacesUnread" }>,
  script: string,
): readonly SetupLine[] {
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
      readonly report:
        "SignedOut" | "SignedIn" | "SiteUnusable" | "IssuerUnanswered";
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
    case "SignedOut":
      return [
        ["site", `${report.site}, not signed in`],
        ...setupRuleLines(report.directory),
        setupNext(script, setupSignInNext),
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
        setupNext(script, ["--site", "<the address of your chuggy site>"]),
      ];
    case "Busy":
      return [
        ["found", "another chuggy setup command is running on this machine"],
        setupNextCommand(script, report.asked),
      ];
    case "Faulted":
      return [
        ["found", "chuggy setup stopped on something it did not expect"],
        setupNext(script, []),
      ];
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
    case "SiteUnusable":
    case "IssuerUnanswered":
    case "SignedOut":
    case "SignedIn":
      return setupSessionLines(report, script);
  }
}

/**
 * The lines a report is printed as, for a program kept at `script`. A break in
 * any text is flattened, so a line is one line whatever a name held.
 */
export function setupReportLines(
  report: SetupReport,
  script: string,
): readonly string[] {
  return setupLines(report, script).map(
    ([word, text]) => `${word}: ${text.replace(/\s+/gu, " ").trim()}`,
  );
}

const setupEndedFailures: ReadonlySet<SetupSignInEnded> = new Set([
  "Refused",
  "ExchangeFailed",
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
