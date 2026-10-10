/**
 * What a run of the setup program found, as a value, and the lines it is
 * printed as.
 *
 * Every line is `<word>: <text>` with the word from a closed set, and the last
 * is the one `next:` line: a command that runs as it is written, or `stop`.
 * `stop` is also what follows an answer that was the person's to give, a
 * sign-in they declined or a page they left, where the command that would
 * open another page is named in a `rule:` line and run only when they ask.
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
      "You pressed Deny, so chuggy setup is not signed in and nothing was changed. Tell me if you want to sign in after all.",
    ],
  ],
  Refused: [["found", "the sign-in server refused the request"]],
  Mismatched: [
    ["found", "the answer that came back did not belong to this sign-in"],
  ],
  ExchangeFailed: [["found", "the sign-in server did not accept the answer"]],
  SiteChanged: [
    [
      "found",
      "another site was chosen on this machine while the sign-in page waited, so nothing was signed in",
    ],
  ],
  SiteRefused: [
    [
      "found",
      "the sign-in went through, but the site refused it, so nothing is remembered",
    ],
  ],
  WorkspacesUnread: [
    [
      "found",
      "the sign-in went through, but the site did not say which workspaces are yours",
    ],
  ],
  Expired: [
    ["found", "nobody finished the sign-in page before it closed"],
    [
      "tell",
      "The sign-in page expired before anyone signed in. Tell me when you are ready and I will open a new one.",
    ],
  ],
  SiteUnusable: [
    ["found", "the site stopped answering before the sign-in page could open"],
  ],
  Busy: [["found", "another chuggy setup command held the sign-in"]],
  Faulted: [
    ["found", "the sign-in page stopped on something it did not expect"],
  ],
};

/** The endings after which nothing is run until the person asks, and what a rule says they ask. */
const setupEndingsHeld: Partial<Readonly<Record<SetupSignInEnded, string>>> = {
  Declined: "if the person asks to sign in after all",
  SiteRefused: "if the person asks to try signing in again",
  Expired: "when the person says they are ready to sign in",
};

/** The endings a page is not what follows: the bare command says how the remembered site stands. */
const setupEndingsStanding: ReadonlySet<SetupSignInEnded> = new Set([
  "SiteChanged",
  "WorkspacesUnread",
]);

function setupEndedNext(
  ended: SetupSignInEnded,
  script: string,
): readonly SetupLine[] {
  const held = setupEndingsHeld[ended];
  if (held === undefined)
    return [
      setupNext(script, setupEndingsStanding.has(ended) ? [] : setupSignInNext),
    ];
  const signIn = setupCommandLine(["node", script, ...setupSignInNext]);
  return [
    ["rule", `Run ${signIn} only ${held}.`],
    ["next", setupNextStop],
  ];
}

function setupEndedLines(
  report: Extract<SetupReport, { readonly report: "SignInEnded" }>,
  script: string,
): readonly SetupLine[] {
  if (report.ended === "SignedIn")
    return [["site", `${report.site}, signed in`], setupNext(script, [])];
  return [
    ["site", `${report.site}, not signed in`],
    ...setupEndings[report.ended],
    ...setupEndedNext(report.ended, script),
  ];
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
        [
          "rule",
          `Run ${setupCommandLine(["node", script, "--site"])} with the address of the person's chuggy site after it, such as https://chuggy.example. Ask the person for the address if you do not have it.`,
        ],
        ["next", setupNextStop],
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
