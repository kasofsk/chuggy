/**
 * What a run of the setup program found, as a value, and the lines it is
 * printed as.
 *
 * Every line is `<word>: <text>` with the word from a closed set, and the last
 * is the one `next:` line: a command that runs as it is written, or `stop`.
 * `stop` is also what follows anything running a command again would not
 * mend by itself: a Node too old to run the program, a sign-in that ended any
 * way but signed in, another run holding the lock, a path the machine would
 * not write, a site or a sign-in server that did not answer, a read that
 * failed. Each says what was found,
 * tells the person, and names in a `rule:` line the one command and the
 * condition it may be run under. A step the person does by hand is that shape
 * too, so nothing printed is a command an agent could run round and round
 * without her. `project` makes a project at the site, and is named only under
 * a rule that waits on her saying what to call it. `runner` and `chat-host` are the commands that change the
 * machine, so each is named only under a rule that waits on her yes, and where
 * one stops short it is that shape again, after everything it found and did.
 * `configuration`, `check` and `import` are each named under a rule that waits
 * on what the agent and the person do between them: the blanks filled in, the
 * faults fixed, the commit pushed. `bind` adds a repository to the project at
 * the site, and is named only under a rule that waits on her yes. `ticket`
 * files a ticket at the site, and is named only under a rule that waits on
 * her saying what she wants done.
 *
 * A report of a sign-in holds a site's origin, a directory, a path of the
 * program's own, numbers and members of closed sets. A checklist holds
 * descriptors made in `ui/chuggy-ui/app/core/setupStanding.ts` and
 * `ui/chuggy-ui/app/core/setupNext.ts` from the names a site and the folder's
 * remote gave. A report of the repository's configuration holds paths and
 * fields of the checkout's files and the import's own words for its faults.
 * A report of any of them holds paths, names and members of closed sets, and of what another program printed at most an excerpt the redactor
 * has been through. None has a field a token, a code or a message of another
 * system's is put in, and every line is flattened where it is printed. A
 * line's words are the catalog's; its word, a step's name and state, and its
 * `next:` are the program's own. Every command printed carries the workspace
 * and project the run was about, so the conversation holds that choice.
 * Nothing here runs on import and no parser is reached, because the Node
 * check prints through this module, and through the catalog, before the rest
 * of the program has been evaluated.
 */

import type { ApiFailure } from "./apiRequest.ts";
import { copyOrDataText } from "./copy.ts";
import type { Copy, CopyArgument, CopyOrData, CopyText } from "./copy.ts";
import {
  setupAnswerArguments,
  setupAnswersNone,
  setupCommandArguments,
  setupConfigurationFlag,
  setupIntentFlag,
  setupNameFlag,
  setupTestFlag,
  setupTitleFlag,
  setupWaitSecsMax,
} from "./setupArguments.ts";
import type {
  SetupAnswers,
  SetupAskFault,
  SetupCommand,
} from "./setupArguments.ts";
import type {
  SetupBlank,
  SetupCheckEnded,
  SetupCheckFault,
  SetupConfigurationEnded,
  SetupImportAnswered,
} from "./setupConfigurationEnded.ts";
import { setupPlatforms } from "./setupPorts.ts";
import type { SetupMachineFault, SetupPlatform } from "./setupPorts.ts";
import {
  setupLoopbackAddress,
  setupNodeMajorMin,
  setupProgramPath,
} from "./setupProgram.ts";
import {
  setupReplaceFlag,
  setupRunnerNamed,
  setupRunnerNoteSaid,
  setupRunnerStopExit,
  setupRunnerStopSaid,
} from "./setupRunnerSaid.ts";
import type {
  SetupRunnerAt,
  SetupRunnerEnded,
  SetupRunnerNote,
  SetupServerEnded,
} from "./setupRunnerSaid.ts";
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
  "mcp",
  "github",
  "repository",
  "runner",
  "ticket",
] as const;

export type SetupStepName = (typeof setupSteps)[number];

/** How a step stands: done, waiting on something named, to do, or not read. */
export const setupStepStates = ["done", "waiting", "todo", "unread"] as const;

export type SetupStepState = (typeof setupStepStates)[number];

/** One step as the checklist prints it: its name, how it stands, and the few words that say why, a name alone being data, or nothing where it says none. */
export interface SetupStepSaid {
  readonly step: SetupStepName;
  readonly state: SetupStepState;
  readonly detail: CopyOrData | undefined;
}

/**
 * The one next thing a checklist ends on: nothing, where setup is done;
 * something the person does by hand, and the condition the checklist may be
 * read again under; something `mcp` or `runner` would do on this machine for
 * the project named, or `chat-host` for the workspace where no project is, or
 * `bind` at the site for the project named, and the yes it waits on; a question only she answers, and the
 * flag her answer is passed in; what to call the project `project` makes in
 * the workspace, at the address named where one is; what she wants done
 * first, which `ticket` files for the project named, with the configuration
 * she chooses where `choose` says she must; the repository's own
 * configuration, which `configuration` starts and `import` has imported; or a
 * read that failed, `stale` where this copy of the program could not read what
 * the site sent.
 */
export type SetupThing =
  | { readonly thing: "Done"; readonly tell: Copy }
  | { readonly thing: "Hand"; readonly tell: Copy; readonly when: Copy }
  | {
      readonly thing: "Offer";
      readonly command: SetupOfferCommand;
      readonly tell: Copy;
      readonly when: Copy;
      readonly workspace: string;
      readonly project: string | undefined;
    }
  | {
      readonly thing: "Ask";
      readonly ask: Copy;
      readonly flag: "workspace" | "project";
    }
  | {
      readonly thing: "Name";
      readonly ask: Copy;
      readonly workspace: string;
      readonly project: string | undefined;
    }
  | {
      readonly thing: "Brief";
      readonly ask: Copy;
      readonly workspace: string;
      readonly project: string;
      readonly choose: boolean;
    }
  | {
      readonly thing: "Configure";
      readonly tell: Copy;
      readonly workspace: string;
      readonly project: string;
    }
  | {
      readonly thing: "Failed";
      readonly found: Copy;
      readonly stale: boolean;
    };

/** What the site answered a bind, in the words the console's Add dialog says it in: added, or already, or refused. */
export type SetupBindAnswered =
  | { readonly answered: "Bound"; readonly said: Copy }
  | { readonly answered: "Refused"; readonly refusal: Copy };

/** What the site answered a filing: the ticket made, released and sent to start, under the configuration named and whether that is a bootstrap, or refused, in the console's creation's words where they are its. */
export type SetupTicketAnswered =
  | {
      readonly answered: "Filed";
      readonly ticket: number;
      readonly configuration: string;
      readonly bootstrap: boolean;
    }
  | { readonly answered: "Refused"; readonly refusal: Copy };

/**
 * How a run of `project` ended: the project the site answered as made, which
 * is also its answer to the person who made it asking again, or refused, in
 * the console form's own words for the refusal, and whether the same command
 * could be answered otherwise if tried again.
 */
export type SetupProjectEnded =
  | { readonly ended: "Made"; readonly project: string; readonly name: string }
  | {
      readonly ended: "Refused";
      readonly refusal: Copy;
      readonly again: boolean;
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
      readonly found: readonly Copy[];
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
    }
  | {
      readonly report: "SignInEnded";
      readonly site: string;
      readonly ended: SetupSignInEnded;
    }
  | {
      /** A run of `runner`, or of `chat-host` where it names no project. */
      readonly report: "Runner";
      /** The site the run was signed in to, or nothing where it stopped before it asked one. */
      readonly site: string | undefined;
      readonly workspace: string;
      readonly project: string | undefined;
      readonly notes: readonly SetupRunnerNote[];
      readonly ended: SetupRunnerEnded;
    }
  | {
      /** A run of `project`: the workspace, and its display name where the sign-in read one, the address it was given where it was given one, the name, and how it ended. */
      readonly report: "Project";
      readonly site: string;
      readonly workspace: string;
      readonly workspaceName?: string;
      readonly project: string | undefined;
      readonly name: string;
      readonly ended: SetupProjectEnded;
    }
  | {
      /** A run of `mcp`: what it found and did of the runner package and the agent's configuration, and how it ended. */
      readonly report: "Mcp";
      readonly site: string;
      readonly workspace: string;
      readonly project: string;
      readonly notes: readonly SetupRunnerNote[];
      readonly ended: SetupServerEnded;
    }
  | {
      /** A run of `configuration`: what it wrote into the checkout, or why it wrote nothing. */
      readonly report: "Configuration";
      readonly ended: SetupConfigurationEnded;
    }
  | {
      /** A run of `check`: what the checkout's configuration comes to, judged as an import of it would. */
      readonly report: "Check";
      readonly ended: SetupCheckEnded;
    }
  | {
      /** A run of `import`: the repository it asked the site to import and what the site answered, where the checklist's next thing was that, and the checklist read after. */
      readonly report: "Import";
      readonly repository: string | undefined;
      readonly answered: SetupImportAnswered | undefined;
      readonly checklist: Extract<
        SetupReport,
        { readonly report: "Checklist" }
      >;
    }
  | {
      /** A run of `bind`: the repository it asked the site to add and what the site answered, where the checklist's next thing was that, and the checklist read after. */
      readonly report: "Bind";
      readonly repository: string | undefined;
      readonly answered: SetupBindAnswered | undefined;
      readonly checklist: Extract<
        SetupReport,
        { readonly report: "Checklist" }
      >;
    }
  | {
      /** A run of `ticket`: what the site answered the filing, where the checklist's next thing was that, and the checklist read after. */
      readonly report: "Ticket";
      readonly answered: SetupTicketAnswered | undefined;
      readonly checklist: Extract<
        SetupReport,
        { readonly report: "Checklist" }
      >;
    }
  | {
      /** A run of `runner` or `chat-host` whose sign-in the site stopped taking part-way: what it had found and done by then, and the report that ends it. */
      readonly report: "RunnerOut";
      readonly workspace: string;
      readonly project: string | undefined;
      readonly notes: readonly SetupRunnerNote[];
      readonly out: SetupReport;
    };

/** The commands that change the machine. */
export type SetupMachineCommand = Extract<
  SetupCommand,
  "Mcp" | "Runner" | "ChatHost"
>;

/** The commands a checklist offers, each waiting on the person's yes: those that change the machine, and `bind`, which adds a repository at the site. */
export type SetupOfferCommand =
  SetupMachineCommand | Extract<SetupCommand, "Bind">;

/** The command a run of the runner package's service is for `at` as: `runner` for a project, `chat-host` for a workspace alone. */
function setupRunCommand(at: SetupRunnerAt): "Runner" | "ChatHost" {
  return at.project === undefined ? "ChatHost" : "Runner";
}

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

/** A line before it is printed: its word and its text, a step's being the cells its columns are laid out from and `next:`'s the command or the word that says there is none. */
type SetupLine =
  | readonly [Exclude<SetupWord, "step" | "next">, Copy]
  | readonly ["step", SetupStepSaid]
  | readonly ["next", string];

/** What `next:` says where no command is left to run. */
export const setupNextStop = "stop";

/** How a report is said: where the program is kept, the choice each of its commands carries, and whether the report ends a run that had already gone some way. */
interface SetupSaying {
  readonly script: string;
  readonly answers: SetupAnswers;
  readonly partWay: boolean;
}

const setupWentNoFurther: Copy = { id: "setup-came-no-further" };

/** What a run came to that the lock or the site stopped at its sign-in: nothing, unless it had gone some way and was entering its sign-in again. */
function setupCameTo(saying: SetupSaying): Copy {
  return saying.partWay ? setupWentNoFurther : { id: "setup-came-nothing" };
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
    ...setupAnswerArguments(saying.answers, command),
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

const setupFlagSite = "--site";
const setupFlagWorkspace = "--workspace";
const setupFlagProject = "--project";

/** The address a line names where it shows what a site's address looks like. */
const setupSiteExample = "https://chuggy.example";

/** The word each command is asked by, as a line names it. */
function setupCommandWords() {
  const [
    signIn = "",
    made = "",
    mcp = "",
    runner = "",
    chatHost = "",
    configuration = "",
    check = "",
    imported = "",
    bound = "",
    filed = "",
  ] = [
    ...setupCommandArguments("SignIn"),
    ...setupCommandArguments("Project"),
    ...setupCommandArguments("Mcp"),
    ...setupCommandArguments("Runner"),
    ...setupCommandArguments("ChatHost"),
    ...setupCommandArguments("Configuration"),
    ...setupCommandArguments("Check"),
    ...setupCommandArguments("Import"),
    ...setupCommandArguments("Bind"),
    ...setupCommandArguments("Ticket"),
  ];
  return {
    signIn,
    made,
    mcp,
    runner,
    chatHost,
    configuration,
    check,
    imported,
    bound,
    filed,
  };
}

function setupAskFaultSaid(fault: SetupAskFault): Copy {
  const words = setupCommandWords();
  const { made, mcp, runner, chatHost, configuration, filed } = words;
  const names = { workspace: setupFlagWorkspace, project: setupFlagProject };
  switch (fault) {
    case "Command":
      return {
        id: "setup-asked-command",
        args: words,
      };
    case "Flag":
      return {
        id: "setup-asked-flag",
        args: {
          ...names,
          site: setupFlagSite,
          wait: "--wait-secs",
          replace: setupReplaceFlag,
          chatHost,
          name: setupNameFlag,
          made,
          test: setupTestFlag,
          configuration,
          title: setupTitleFlag,
          intent: setupIntentFlag,
          chosen: setupConfigurationFlag,
          filed,
        },
      };
    case "Site":
      return {
        id: "setup-asked-site",
        args: { flag: setupFlagSite, example: setupSiteExample },
      };
    case "WaitSecs":
      return {
        id: "setup-asked-wait-secs",
        args: { flag: "--wait-secs", secs: String(setupWaitSecsMax) },
      };
    case "Name":
      return { id: "setup-asked-name", args: names };
    case "Project":
      return { id: "setup-asked-project", args: { ...names, mcp, runner } };
    case "Workspace":
      return {
        id: "setup-asked-workspace",
        args: { workspace: setupFlagWorkspace, chatHost },
      };
    case "Replace":
      return { id: "setup-asked-replace", args: { flag: setupReplaceFlag } };
    case "ProjectName":
      return {
        id: "setup-asked-project-name",
        args: { made, workspace: setupFlagWorkspace, name: setupNameFlag },
      };
    case "Test":
      return {
        id: "setup-asked-test",
        args: { flag: setupTestFlag, configuration },
      };
    case "Brief":
      return {
        id: "setup-asked-brief",
        args: { filed, title: setupTitleFlag, intent: setupIntentFlag },
      };
  }
}

const setupPlatformNames: Readonly<Record<SetupPlatform, string>> = {
  linux: "Linux",
  darwin: "macOS",
};

function setupUnservedLines(platform: string): readonly SetupLine[] {
  const [first = "", ...rest] = setupPlatforms.map(
    (name) => setupPlatformNames[name],
  );
  const served = rest.reduce<CopyArgument>(
    (one, other) => ({ id: "setup-platforms-and", args: { one, other } }),
    first,
  );
  return [
    ["found", { id: "setup-unserved-found", args: { served, platform } }],
    ["tell", { id: "setup-unserved-tell", args: { served } }],
    ["next", setupNextStop],
  ];
}

function setupSiteSaid(
  site: string,
  id:
    | "setup-site-named"
    | "setup-site-signed-in"
    | "setup-site-signed-out"
    | "setup-site-unconfirmed"
    | "setup-site-unreachable"
    | "setup-site-unconfigured"
    | "setup-site-issuer",
): SetupLine {
  return ["site", { id, args: { site } }];
}

/** How to drive the program, said once: to whoever has not yet signed in. */
function setupRuleLines(directory: string): readonly SetupLine[] {
  return [
    ["rule", { id: "setup-rule-drive", args: { stop: setupNextStop } }],
    ["rule", { id: "setup-rule-directory", args: { directory } }],
  ];
}

function setupWaitingLines(
  report: Extract<SetupReport, { readonly report: "SignInWaiting" }>,
): readonly SetupLine[] {
  const address = setupLoopbackAddress(report.port);
  const open: SetupLine = [
    "tell",
    {
      id: "setup-waiting-open-tell",
      args: { finish: { id: "setup-waiting-finish", args: { address } } },
    },
  ];
  const waits: SetupLine = ["rule", { id: "setup-waiting-rule" }];
  switch (report.opened) {
    case "Opened":
      return [
        ["did", { id: "setup-waiting-opened", args: { address } }],
        ["found", { id: "setup-waiting-open" }],
        open,
        waits,
      ];
    case "Attached":
      return [["found", { id: "setup-waiting-attached" }], open, waits];
    case "NotOpened":
      return [
        ["found", { id: "setup-waiting-unopened" }],
        ["tell", { id: "setup-waiting-unopened-tell", args: { address } }],
      ];
  }
}

/** A stop: what was found, what the person is told, and the condition the one command a rule names may be run under. */
interface SetupStop {
  readonly found: Copy;
  readonly tell: Copy;
  readonly when: Copy;
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
    ["rule", { id: "setup-runner-rule", args: { command, when: stop.when } }],
    ["next", setupNextStop],
  ];
}

/** A Node too old runs the program no better a second time, so it is a stop until the Node under it is another. */
function setupNodeStop(major: number | undefined): SetupStop {
  const needs: Copy = {
    id: "setup-node-needs",
    args: { major: String(setupNodeMajorMin) },
  };
  const found: Copy =
    major === undefined
      ? { id: "setup-node-unsaid" }
      : { id: "setup-node-is", args: { major: String(major) } };
  return {
    found: { id: "setup-node-found", args: { found, needs } },
    tell: { id: "setup-node-tell", args: { needs } },
    when: { id: "setup-node-when", args: { needs } },
  };
}

const setupAskedAgain: Copy = { id: "setup-when-sign-in-again" };

function setupDeclinedTold(left: Copy): Copy {
  return { id: "setup-ended-declined-tell", args: { left } };
}

/**
 * Every ending that is not a sign-in and after which nothing is run until the
 * person asks. A page is opened by a person's wish and never by a failure, so
 * each is a stop, and each stands until a `sign-in` opens another page.
 */
const setupEndingsHeld = {
  NoRenewal: {
    found: { id: "setup-ended-no-renewal-found" },
    tell: { id: "setup-ended-no-renewal-tell" },
    when: { id: "setup-ended-no-renewal-when" },
  },
  Declined: {
    found: { id: "setup-ended-declined-found" },
    tell: setupDeclinedTold({ id: "setup-came-unchanged" }),
    when: { id: "setup-ended-declined-when" },
  },
  Refused: {
    found: { id: "setup-ended-refused-found" },
    tell: { id: "setup-ended-refused-tell" },
    when: setupAskedAgain,
  },
  Mismatched: {
    found: { id: "setup-ended-mismatched-found" },
    tell: { id: "setup-ended-mismatched-tell" },
    when: setupAskedAgain,
  },
  ExchangeFailed: {
    found: { id: "setup-ended-exchange-found" },
    tell: { id: "setup-ended-exchange-tell" },
    when: setupAskedAgain,
  },
  SiteRefused: {
    found: { id: "setup-ended-site-refused-found" },
    tell: { id: "setup-ended-site-refused-tell" },
    when: setupAskedAgain,
  },
  Expired: {
    found: { id: "setup-ended-expired-found" },
    tell: { id: "setup-ended-expired-tell" },
    when: { id: "setup-ended-expired-when" },
  },
  SiteUnusable: {
    found: { id: "setup-ended-unusable-found" },
    tell: { id: "setup-ended-unusable-tell" },
    when: setupAskedAgain,
  },
  Busy: {
    found: { id: "setup-ended-busy-found" },
    tell: { id: "setup-ended-busy-tell" },
    when: setupAskedAgain,
  },
  Faulted: {
    found: { id: "setup-ended-faulted-found" },
    tell: { id: "setup-ended-faulted-tell" },
    when: setupAskedAgain,
  },
} as const satisfies Partial<Readonly<Record<SetupSignInEnded, SetupStop>>>;

type SetupSignInHeld = keyof typeof setupEndingsHeld;

/** The endings a page is not what follows: the bare command says how the remembered site stands. */
const setupEndingsStanding: Readonly<
  Record<Exclude<SetupSignInEnded, SetupSignInHeld | "SignedIn">, Copy>
> = {
  SiteChanged: { id: "setup-ended-site-changed" },
  WorkspacesUnread: { id: "setup-ended-workspaces-unread" },
};

/** Whether an ending is one nothing is run after until the person asks, which is also whether it stands. */
export function setupSignInHeld(
  ended: SetupSignInEnded,
): ended is SetupSignInHeld {
  return Object.hasOwn(setupEndingsHeld, ended);
}

/** An ending that stands where a run is not signed in, as a stop. A sign-in declined changed nothing, which a run that met that ending having gone some way does not say of itself. */
function setupHeldStop(ended: SetupSignInHeld, saying: SetupSaying): SetupStop {
  const held: SetupStop = setupEndingsHeld[ended];
  return ended === "Declined" && saying.partWay
    ? { ...held, tell: setupDeclinedTold(setupWentNoFurther) }
    : held;
}

function setupEndedLines(
  report: Extract<SetupReport, { readonly report: "SignInEnded" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  if (report.ended === "SignedIn")
    return [
      setupSiteSaid(report.site, "setup-site-signed-in"),
      setupNextLine(saying, "Status"),
    ];
  const head = setupSiteSaid(report.site, "setup-site-signed-out");
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
  const head = setupSiteSaid(report.site, "setup-site-signed-out");
  const stood: SetupStop | undefined =
    report.ended !== undefined && setupSignInHeld(report.ended)
      ? setupHeldStop(report.ended, saying)
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

const setupAskedRetry: Copy = { id: "setup-runner-when-try-again" };

function setupFaultStop(fault: SetupFault): SetupStop {
  switch (fault.fault) {
    case "Unwritable": {
      const args = { path: fault.path };
      return {
        found: { id: "setup-fault-unwritable-found", args },
        tell: { id: "setup-fault-unwritable-tell", args },
        when: { id: "setup-fault-unwritable-when", args },
      };
    }
    case "Unreadable": {
      const args = { path: fault.path };
      return {
        found: { id: "setup-fault-unreadable-found", args },
        tell: { id: "setup-fault-unreadable-tell", args },
        when: { id: "setup-fault-unreadable-when", args },
      };
    }
    case "Unkept": {
      const args = { path: fault.path };
      return {
        found: { id: "setup-fault-unkept-found", args },
        tell: { id: "setup-fault-unkept-tell", args },
        when: { id: "setup-fault-unwritable-when", args },
      };
    }
    case "Homeless":
      return {
        found: { id: "setup-fault-homeless-found" },
        tell: { id: "setup-fault-homeless-tell" },
        when: { id: "setup-fault-homeless-when" },
      };
    case "Unstarted":
      return {
        found: { id: "setup-fault-unstarted-found" },
        tell: { id: "setup-fault-unstarted-tell" },
        when: setupAskedRetry,
      };
    case "Unexpected":
      return {
        found: { id: "setup-fault-unexpected-found" },
        tell: { id: "setup-fault-unexpected-tell" },
        when: setupAskedRetry,
      };
  }
}

function setupBusyStop(pid: number | undefined, came: Copy): SetupStop {
  const running: Copy = { id: "setup-busy-found" };
  return {
    found:
      pid === undefined
        ? running
        : { id: "setup-busy-found-pid", args: { running, pid: String(pid) } },
    tell: { id: "setup-busy-tell", args: { came } },
    when: { id: "setup-busy-when" },
  };
}

/** A run that stopped on this machine and not on a site: what stopped it, and the same command named under the condition that mends it. */
function setupStoppedLines(
  report: Extract<SetupReport, { readonly report: "Busy" | "Faulted" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  const stop =
    report.report === "Busy"
      ? setupBusyStop(report.pid, setupCameTo(saying))
      : setupFaultStop(report.fault);
  const command = setupCommandOf(
    saying,
    report.asked,
    setupSiteFlag(report.site),
  );
  return [...setupStopSaid(stop), ...setupStopRule(stop, command)];
}

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

const setupLookAgain: Copy = { id: "setup-runner-when-look-again" };

/** What follows an answer this copy could not read: the person is told, and fetching the site's own copy waits on their say-so. */
function setupStaleLines(
  site: string,
  saying: SetupSaying,
): readonly SetupLine[] {
  return [
    ["tell", { id: "setup-stale-tell" }],
    ...setupStopRule(
      { when: { id: "setup-stale-when" } },
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
      setupSiteSaid(report.site, "setup-site-signed-out"),
      ["found", { id: "setup-forgotten" }],
      setupNextLine(saying, "SignIn"),
    ];
  const head = setupSiteSaid(report.site, "setup-site-unconfirmed");
  if (report.outcome === "Unreadable")
    return [
      head,
      ["found", { id: "setup-stale" }],
      ...setupStaleLines(report.site, saying),
    ];
  const stop: SetupStop = {
    found: {
      id: "setup-workspaces-unread-found",
      args: { outcome: report.outcome },
    },
    tell: { id: "setup-workspaces-unread-tell" },
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
  came: Copy,
): SetupStop {
  if (report.report === "IssuerUnanswered")
    return {
      found: { id: "setup-issuer-found" },
      tell: { id: "setup-issuer-tell" },
      when: setupAskedRetry,
    };
  const args = { site: report.site, came };
  switch (report.phase) {
    case "Unreachable":
      return {
        found: { id: "setup-unreachable-found" },
        tell: { id: "setup-unreachable-tell", args },
        when: setupAskedRetry,
      };
    case "Unconfigured":
      return {
        found: { id: "setup-unconfigured-found" },
        tell: { id: "setup-unconfigured-tell", args },
        when: setupAskedRetry,
      };
  }
}

const setupSitePhases = {
  Unreachable: "setup-site-unreachable",
  Unconfigured: "setup-site-unconfigured",
} as const;

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
      : "setup-site-issuer";
  const stop = setupSessionStop(report, setupCameTo(saying));
  const command = setupCommandOf(
    saying,
    report.asked,
    setupSiteFlag(report.site),
  );
  return [
    setupSiteSaid(report.site, said),
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
      ["tell", { id: "setup-failed-tell" }],
      ...setupStopRule(
        { when: setupLookAgain },
        setupCommandOf(saying, "Status"),
      ),
    ];
  return [
    ["found", { id: "setup-failed-stale", args: { found: thing.found } }],
    ...setupStaleLines(site, saying),
  ];
}

/** How a command for one project, or for a workspace alone, is written, whatever names the run was given: that project's or that workspace's. */
function setupSayingOf(saying: SetupSaying, named: SetupRunnerAt): SetupSaying {
  const { workspace, project } = named;
  return { ...saying, answers: { workspace, project } };
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
    case "Offer":
      return [
        ["tell", thing.tell],
        ...setupStopRule(
          thing,
          setupCommandOf(setupSayingOf(saying, thing), thing.command),
        ),
      ];
    case "Ask":
      return [
        ["ask", thing.ask],
        [
          "rule",
          {
            id: "setup-rule-ask",
            args: { command: setupAnswered(saying, thing.flag) },
          },
        ],
        ["next", setupNextStop],
      ];
    case "Name": {
      const { workspace, project } = thing;
      const answers = { workspace, project };
      return [
        ["ask", thing.ask],
        [
          "rule",
          {
            id: "setup-rule-ask-name",
            args: {
              command: setupCommandOf({ ...saying, answers }, "Project", [
                setupNameFlag,
              ]),
            },
          },
        ],
        ["next", setupNextStop],
      ];
    }
    case "Brief":
      return setupBriefLines(thing, saying);
    case "Configure":
      return [
        ["tell", thing.tell],
        ...setupConfigureRule(setupSayingOf(saying, thing)),
      ];
    case "Failed":
      return setupFailedLines(report.site, thing, saying);
  }
}

/** What the person wants done first, asked, and the rule `ticket` is named under: with the configuration they choose where they must choose one. */
function setupBriefLines(
  thing: Extract<SetupThing, { readonly thing: "Brief" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  return [
    ["ask", thing.ask],
    [
      "rule",
      {
        id: "setup-rule-ticket",
        args: {
          command: setupCommandOf(setupSayingOf(saying, thing), "Ticket"),
          title: setupTitleFlag,
          intent: setupIntentFlag,
          choose: thing.choose ? "choose" : "given",
          configuration: setupConfigurationFlag,
        },
      },
    ],
    ["next", setupNextStop],
  ];
}

/** The rule `configuration` is named under: with the repository's test command where the agent knows it, and bare where it does not. */
function setupConfigureRule(saying: SetupSaying): readonly SetupLine[] {
  return [
    [
      "rule",
      {
        id: "setup-rule-configuration",
        args: {
          with: setupCommandOf(saying, "Configuration", [setupTestFlag]),
          without: setupCommandOf(saying, "Configuration"),
        },
      },
    ],
    ["next", setupNextStop],
  ];
}

const setupBlankSaid: Readonly<Record<SetupBlank, Copy>> = {
  Image: { id: "setup-configuration-blank-image" },
  Test: { id: "setup-configuration-blank-test" },
};

/** A checkout the program was not run in, as a stop whose rule names `command` again. */
function setupOutsideLines(
  saying: SetupSaying,
  command: "Configuration" | "Check",
): readonly SetupLine[] {
  const stop: SetupStop = {
    found: { id: "setup-configuration-outside-found" },
    tell: { id: "setup-configuration-outside-tell" },
    when: { id: "setup-configuration-outside-when" },
  };
  return [
    ...setupStopSaid(stop),
    ...setupStopRule(stop, setupCommandOf(saying, command)),
  ];
}

/**
 * A run of `configuration`: the file written and each field it leaves blank,
 * with `check` named once they are filled in; the declarations already there,
 * left as they are, with `check` next; or no checkout.
 */
function setupConfigurationLines(
  ended: SetupConfigurationEnded,
  saying: SetupSaying,
): readonly SetupLine[] {
  switch (ended.ended) {
    case "Written":
      return [
        [
          "did",
          { id: "setup-configuration-written", args: { path: ended.path } },
        ],
        ...ended.blanks.map(({ blank, field }): SetupLine => [
          "tell",
          {
            id: "setup-configuration-blank",
            args: { field, what: setupBlankSaid[blank] },
          },
        ]),
        ["tell", { id: "setup-configuration-written-tell" }],
        ...setupStopRule(
          { when: { id: "setup-configuration-filled-when" } },
          setupCommandOf(saying, "Check"),
        ),
      ];
    case "Kept":
      return [
        [
          "found",
          {
            id: "setup-configuration-kept-found",
            args: { paths: ended.paths.join(", ") },
          },
        ],
        setupNextLine(saying, "Check"),
      ];
    case "Outside":
      return setupOutsideLines(saying, "Configuration");
  }
}

/** One fault `check` found, by its file, its fault and the fields it is about. */
function setupCheckFaultSaid(fault: SetupCheckFault): Copy {
  return {
    id: "setup-check-fault",
    args: {
      path: fault.path,
      fault: fault.fault,
      detail: fault.detail ?? "",
      detailed: fault.detail === undefined ? "none" : "some",
      fields: fault.fields.join(", "),
      at: fault.fields.length === 0 ? "none" : "some",
    },
  };
}

/**
 * A run of `check`: clean, with `import` named once the configuration is
 * committed and pushed; each fault by file and field, with `check` named again
 * once they are fixed; nothing declared, with `configuration` named; or no
 * checkout.
 */
function setupCheckLines(
  ended: SetupCheckEnded,
  saying: SetupSaying,
): readonly SetupLine[] {
  switch (ended.ended) {
    case "Clean":
      return [
        [
          "found",
          {
            id: "setup-check-clean-found",
            args: { count: ended.paths.length, paths: ended.paths.join(", ") },
          },
        ],
        ["tell", { id: "setup-check-clean-tell" }],
        ...setupStopRule(
          { when: { id: "setup-check-pushed-when" } },
          setupCommandOf(saying, "Import"),
        ),
      ];
    case "Refused": {
      const more = ended.count - ended.faults.length;
      return [
        ...ended.faults.map((fault): SetupLine => [
          "found",
          setupCheckFaultSaid(fault),
        ]),
        ...(more > 0
          ? [
              [
                "found",
                { id: "setup-check-faults-more", args: { more } },
              ] as const,
            ]
          : []),
        ["tell", { id: "setup-check-refused-tell" }],
        ...setupStopRule(
          { when: { id: "setup-check-fixed-when" } },
          setupCommandOf(saying, "Check"),
        ),
      ];
    }
    case "Absent":
      return [
        [
          "found",
          {
            id: "setup-check-absent-found",
            args: { directory: ended.directory },
          },
        ],
        ...setupConfigureRule(saying),
      ];
    case "Outside":
      return setupOutsideLines(saying, "Check");
  }
}

/** What `import` asked of the site and what it answered, each file it refused among that, said where the checklist read after it says the site. */
function setupImportSaid(
  report: Extract<SetupReport, { readonly report: "Import" }>,
): readonly SetupLine[] {
  const repository = report.repository ?? "";
  const answered = report.answered;
  if (answered === undefined) return [["found", { id: "setup-import-none" }]];
  return answered.answered === "Imported"
    ? [["did", { id: "setup-import-did", args: { repository } }]]
    : [
        [
          "found",
          {
            id: "setup-import-refused",
            args: { repository, refusal: answered.refusal },
          },
        ],
        ...answered.faults.map((fault): SetupLine => [
          "found",
          setupCheckFaultSaid(fault),
        ]),
      ];
}

/** What `bind` asked of the site and what it answered, said where the checklist read after it says the site. */
function setupBindSaid(
  report: Extract<SetupReport, { readonly report: "Bind" }>,
): readonly SetupLine[] {
  const repository = report.repository ?? "";
  const answered = report.answered;
  if (answered === undefined) return [["found", { id: "setup-bind-none" }]];
  return answered.answered === "Bound"
    ? [
        [
          "did",
          { id: "setup-bind-did", args: { repository, said: answered.said } },
        ],
      ]
    : [
        [
          "found",
          {
            id: "setup-bind-refused",
            args: { repository, refusal: answered.refusal },
          },
        ],
      ];
}

/** A run of `bind`: the checklist read after it, with what it asked and what the site answered after the site's own line. */
function setupBindLines(
  report: Extract<SetupReport, { readonly report: "Bind" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  const [site, ...rest] = setupLines(report.checklist, saying);
  return [
    ...(site === undefined ? [] : [site]),
    ...setupBindSaid(report),
    ...rest,
  ];
}

/** What `ticket` asked of the site and what it answered, said where the checklist read after it says the site. */
function setupTicketSaid(
  report: Extract<SetupReport, { readonly report: "Ticket" }>,
): readonly SetupLine[] {
  const answered = report.answered;
  if (answered === undefined) return [["found", { id: "setup-ticket-none" }]];
  return answered.answered === "Filed"
    ? [
        [
          "did",
          {
            id: "setup-ticket-did",
            args: {
              ticket: String(answered.ticket),
              configuration: answered.configuration,
              bootstrap: answered.bootstrap ? "bootstrap" : "own",
            },
          },
        ],
      ]
    : [
        [
          "found",
          { id: "setup-ticket-unfiled", args: { refusal: answered.refusal } },
        ],
      ];
}

/** A run of `ticket`: the checklist read after it, with what it asked and what the site answered after the site's own line. */
function setupTicketLines(
  report: Extract<SetupReport, { readonly report: "Ticket" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  const [site, ...rest] = setupLines(report.checklist, saying);
  return [
    ...(site === undefined ? [] : [site]),
    ...setupTicketSaid(report),
    ...rest,
  ];
}

/** A run of `import`: the checklist read after it, with what it asked and what the site answered after the site's own line. */
function setupImportLines(
  report: Extract<SetupReport, { readonly report: "Import" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  const [site, ...rest] = setupLines(report.checklist, saying);
  return [
    ...(site === undefined ? [] : [site]),
    ...setupImportSaid(report),
    ...rest,
  ];
}

function setupChecklistLines(
  report: Extract<SetupReport, { readonly report: "Checklist" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  return [
    setupSiteSaid(report.site, "setup-site-signed-in"),
    ...report.found.map((found): SetupLine => ["found", found]),
    ...report.steps.map((step): SetupLine => ["step", step]),
    ...setupThingLines(report, saying),
  ];
}

/** The command a stop's rule names, for a run that was for `at`. */
function setupAgainOf(
  again: "Again" | "Status" | "Mcp",
  at: SetupRunnerAt,
): SetupCommand {
  switch (again) {
    case "Again":
      return setupRunCommand(at);
    case "Status":
    case "Mcp":
      return again;
  }
}

/** What a run of `mcp`, `runner` or `chat-host` found and did, in the order it met them. */
function setupNoteLines(
  report: Extract<
    SetupReport,
    { readonly report: "Mcp" | "Runner" | "RunnerOut" }
  >,
): readonly SetupLine[] {
  return report.notes.map((note) => setupRunnerNoteSaid(note, report));
}

/**
 * A run of `runner` or `chat-host`: everything it found and did, in the order
 * it met them, each runner it waited on seen live among them, then the
 * checklist as the next command where those runners are live or none is
 * needed, and otherwise the stop, whose rule names the command to run once
 * what stopped it is mended, with the chat host it may replace where it says
 * one.
 */
function setupRunnerLines(
  report: Extract<SetupReport, { readonly report: "Runner" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  const named = setupRunnerNamed(report);
  const of = setupSayingOf(saying, report);
  const head: readonly SetupLine[] = [
    ...(report.site === undefined
      ? []
      : [setupSiteSaid(report.site, "setup-site-signed-in")]),
    ...setupNoteLines(report),
  ];
  switch (report.ended.ended) {
    case "Live":
      return [...head, setupNextLine(of, "Status")];
    case "Hosted":
      return [
        ...head,
        ["found", { id: "setup-hosted-found", args: { project: named } }],
        setupNextLine(of, "Status"),
      ];
    case "Stopped": {
      const stop = setupRunnerStopSaid(report.ended.stop, report);
      const command = setupAgainOf(stop.again, report);
      const rest =
        stop.replace === undefined ? [] : [setupReplaceFlag, stop.replace];
      return [
        ...head,
        ...setupStopSaid(stop),
        ...setupStopRule(stop, setupCommandOf(of, command, rest)),
      ];
    }
  }
}

/** A run of `mcp`: everything it found and did, then the checklist where the agent's configuration names the server, and otherwise the stop, whose rule names `mcp` again or the checklist. */
function setupServerLines(
  report: Extract<SetupReport, { readonly report: "Mcp" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  const of = setupSayingOf(saying, report);
  const head: readonly SetupLine[] = [
    setupSiteSaid(report.site, "setup-site-named"),
    ...setupNoteLines(report),
  ];
  if (report.ended.ended === "Served")
    return [...head, setupNextLine(of, "Status")];
  const stop = setupRunnerStopSaid(report.ended.stop, report);
  const command = stop.again === "Status" ? "Status" : "Mcp";
  return [
    ...head,
    ...setupStopSaid(stop),
    ...setupStopRule(stop, setupCommandOf(of, command)),
  ];
}

/**
 * A run of `project`: the project made, and the checklist for it as the next
 * command; or the refusal, and either the same command again, where trying
 * again could be answered otherwise, or the checklist for the workspace, which
 * asks again what to call the project where there is still none.
 */
function setupProjectLines(
  report: Extract<SetupReport, { readonly report: "Project" }>,
  saying: SetupSaying,
): readonly SetupLine[] {
  const { workspace, ended } = report;
  const head = setupSiteSaid(report.site, "setup-site-signed-in");
  if (ended.ended === "Made")
    return [
      head,
      [
        "did",
        {
          id: "setup-project-made",
          args: {
            project: setupRunnerNamed({ ...report, project: ended.project }),
            name: ended.name,
          },
        },
      ],
      setupNextLine(
        { ...saying, answers: { workspace, project: ended.project } },
        "Status",
      ),
    ];
  const { refusal } = ended;
  const command = ended.again
    ? setupCommandOf(
        {
          ...saying,
          answers: { workspace, project: report.project, name: report.name },
        },
        "Project",
      )
    : setupCommandOf(
        { ...saying, answers: { workspace, project: undefined } },
        "Status",
      );
  return [
    head,
    ["found", { id: "setup-project-refused-found", args: { refusal } }],
    ["tell", { id: "setup-project-refused-tell", args: { refusal } }],
    ...setupStopRule(
      { when: ended.again ? setupAskedRetry : setupLookAgain },
      command,
    ),
  ];
}

function setupNodeOldSaid(
  major: number | undefined,
  saying: SetupSaying,
): readonly SetupLine[] {
  const stop = setupNodeStop(major);
  return [
    ...setupStopSaid(stop),
    ...setupStopRule(stop, setupCommandOf(saying, "Status")),
  ];
}

/** No site remembered or named: the bare command is named with the site's address after it. */
function setupSiteUnknownLines(saying: SetupSaying): readonly SetupLine[] {
  return [
    ["found", { id: "setup-site-unknown" }],
    [
      "rule",
      {
        id: "setup-rule-site",
        args: {
          command: setupCommandOf(saying, "Status", [setupFlagSite]),
          example: setupSiteExample,
        },
      },
    ],
    ["next", setupNextStop],
  ];
}

function setupLines(
  report: SetupReport,
  saying: SetupSaying,
): readonly SetupLine[] {
  const bare: SetupSaying = { ...saying, answers: setupAnswersNone };
  switch (report.report) {
    case "NodeOld":
      return setupNodeOldSaid(report.major, bare);
    case "Unserved":
      return setupUnservedLines(report.platform);
    case "AskedWrongly":
      return [
        ["found", setupAskFaultSaid(report.fault)],
        setupNextLine(bare, "Status"),
      ];
    case "SiteUnknown":
      return setupSiteUnknownLines(saying);
    case "Busy":
    case "Faulted":
      return setupStoppedLines(report, saying);
    case "WorkspacesUnread":
      return setupUnreadLines(report, saying);
    case "SignInWaiting":
      return [
        setupSiteSaid(report.site, "setup-site-signed-out"),
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
    case "Project":
      return setupProjectLines(report, saying);
    case "Configuration":
      return setupConfigurationLines(report.ended, saying);
    case "Check":
      return setupCheckLines(report.ended, saying);
    case "Import":
      return setupImportLines(report, saying);
    case "Bind":
      return setupBindLines(report, saying);
    case "Ticket":
      return setupTicketLines(report, saying);
    case "Mcp":
      return setupServerLines(report, saying);
    case "Runner":
      return setupRunnerLines(report, saying);
    case "RunnerOut":
      return [
        ...setupNoteLines(report),
        ...setupLines(report.out, { ...saying, partWay: true }),
      ];
  }
}

/** The spaces between a column's longest word and the next column. */
const setupColumnGap = 2;

function setupWidth(words: readonly string[]): number {
  return Math.max(...words.map((word) => word.length)) + setupColumnGap;
}

/** A line as it is printed. A step's name and state are laid out in columns as wide as the longest of each, so the cells are flattened one at a time and the spaces between them are the layout's own. */
function setupPrinted(line: SetupLine, text: CopyText): string {
  if (line[0] === "next") return `next: ${setupFlat(line[1])}`;
  if (line[0] !== "step") return `${line[0]}: ${setupFlat(text(line[1]))}`;
  const { step, state, detail } = line[1];
  const said = detail === undefined ? "" : copyOrDataText(text, detail);
  const laid = `${step.padEnd(setupWidth(setupSteps))}${state.padEnd(setupWidth(setupStepStates))}${setupFlat(said)}`;
  return `step: ${laid.trimEnd()}`;
}

/**
 * The lines a report is printed as, for a program kept at `script` and a run
 * whose arguments named `answers`, the catalog's words formatted by `text`.
 * Every line passes through the one place text is flattened, so a line is one
 * line, and holds nothing a terminal would obey, whatever a name from a
 * server, a file, the folder's remote or the command line held.
 */
export function setupReportLines(
  report: SetupReport,
  script: string,
  text: CopyText,
  answers: SetupAnswers = setupAnswersNone,
): readonly string[] {
  return setupLines(report, { script, answers, partWay: false }).map((line) =>
    setupPrinted(line, text),
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
    case "Project":
      return report.ended.ended === "Made" ? 0 : 1;
    case "Configuration":
      return report.ended.ended === "Outside" ? 1 : 0;
    case "Check":
      return report.ended.ended === "Refused" ||
        report.ended.ended === "Outside"
        ? 1
        : 0;
    case "Import":
    case "Bind":
    case "Ticket":
      return setupReportExit(report.checklist);
    case "Mcp":
    case "Runner":
      return report.ended.ended === "Stopped"
        ? setupRunnerStopExit(report.ended.stop)
        : 0;
    case "RunnerOut":
      return setupReportExit(report.out);
  }
}
