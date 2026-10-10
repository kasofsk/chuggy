/**
 * One run of the setup program, from its arguments to the report it prints.
 *
 * A run that uses the remembered sign-in holds the lock while it does, and
 * gives it up before it waits on a person. Whatever goes wrong on the machine
 * ends as one report: which path it would not make, write or read where a
 * port said so, and otherwise only that something unexpected stopped the run,
 * so no message of another system's, and nothing a message could carry, is
 * ever printed.
 */

import { setupAsked } from "./setupArguments.ts";
import type { SetupAsked, SetupCommand } from "./setupArguments.ts";
import { SetupMachineError } from "./setupPorts.ts";
import type { SetupPorts } from "./setupPorts.ts";
import type { SetupFault, SetupReport } from "./setupReport.ts";
import { setupSessionOpened, setupWorkspacesRead } from "./setupSession.ts";
import type { SetupSessionOpened } from "./setupSession.ts";
import {
  setupListened,
  setupSignInAwaited,
  setupSignInBegun,
  setupSignInSettled,
  setupSignInStood,
} from "./setupSignIn.ts";
import type { SetupSignInBegun } from "./setupSignIn.ts";
import {
  setupLockHeldBy,
  setupLockReleased,
  setupLockTaken,
  setupLockWaitMs,
  setupSessionRead,
  setupSessionWritten,
  setupSignInNoteRead,
} from "./setupStore.ts";

type SetupBegun =
  | { readonly begun: "Session"; readonly opened: SetupSessionOpened }
  | { readonly begun: "Reported"; readonly report: SetupReport };

/**
 * The session a command works under: the site it was given or the one
 * remembered, loaded, with the remembered token only where it is that site's.
 * A site is remembered once it has answered as one.
 */
async function setupBegun(
  ports: SetupPorts,
  given: string | undefined,
  asked: SetupCommand,
): Promise<SetupBegun> {
  const stored = setupSessionRead(ports.files);
  const site = given ?? stored?.site;
  if (site === undefined)
    return { begun: "Reported", report: { report: "SiteUnknown" } };
  const held = stored?.site === site ? stored.refreshToken : undefined;
  const opened = setupSessionOpened(ports, site, held, undefined);
  await opened.holder.load();
  const phase = opened.holder.snapshot().phase;
  if (phase !== "SignedIn" && phase !== "SignedOut")
    return {
      begun: "Reported",
      report: opened.configured()
        ? { report: "IssuerUnanswered", site, asked }
        : {
            report: "SiteUnusable",
            site,
            phase: phase === "Unreachable" ? "Unreachable" : "Unconfigured",
            asked,
          },
    };
  if (stored?.site !== site)
    setupSessionWritten(ports.files, { site, refreshToken: undefined });
  return { begun: "Session", opened };
}

/**
 * Whether the remembered sign-in still stands: its token renews and the site
 * answers as that person. A renewal the issuer refuses is not a failure, only
 * not signed in; one it did not answer is.
 */
async function setupStanding(
  ports: SetupPorts,
  opened: SetupSessionOpened,
  asked: SetupCommand,
): Promise<SetupReport> {
  const site = opened.site;
  const signedOut: SetupReport = {
    report: "SignedOut",
    site,
    directory: ports.surroundings.directory,
    ended: undefined,
  };
  if (opened.holder.snapshot().phase !== "SignedIn") return signedOut;
  if ((await opened.holder.bearer()) === undefined)
    return opened.tokenAsked() === "Refused"
      ? signedOut
      : { report: "IssuerUnanswered", site, asked };
  const workspaces = await setupWorkspacesRead(opened);
  if (workspaces.read === "Unread")
    return {
      report: "WorkspacesUnread",
      site,
      outcome: workspaces.outcome,
      asked,
    };
  return {
    report: "SignedIn",
    site,
    workspaces: workspaces.workspaces,
    truncated: workspaces.truncated,
  };
}

/** Runs `body` holding the lock, or answers nothing where another run kept it past the wait. */
async function setupLocked<T>(
  ports: SetupPorts,
  body: () => Promise<T>,
): Promise<T | undefined> {
  if (!(await setupLockTaken(ports, setupLockWaitMs))) return undefined;
  try {
    return await body();
  } finally {
    setupLockReleased(ports);
  }
}

function setupBusy(
  ports: SetupPorts,
  asked: SetupCommand,
  site: string | undefined,
): SetupReport {
  return { report: "Busy", asked, site, pid: setupLockHeldBy(ports) };
}

/**
 * The bare command opens no page, so where it is not signed in it says how
 * the last sign-in ended while that ending stands, and names `sign-in` only
 * where none does.
 */
async function setupStatus(
  ports: SetupPorts,
  given: string | undefined,
): Promise<SetupReport> {
  const report = await setupLocked(ports, async () => {
    const begun = await setupBegun(ports, given, "Status");
    if (begun.begun === "Reported") return begun.report;
    const standing = await setupStanding(ports, begun.opened, "Status");
    if (standing.report !== "SignedOut") return standing;
    const note = setupSignInNoteRead(ports.files);
    return { ...standing, ended: setupSignInStood(note, standing.site) };
  });
  return report ?? setupBusy(ports, "Status", given);
}

type SetupSignInStep =
  | { readonly step: "Reported"; readonly report: SetupReport }
  | {
      readonly step: "Waiting";
      readonly site: string;
      readonly waiting: Extract<
        SetupSignInBegun,
        { readonly begun: "Waiting" }
      >;
    };

async function setupSignInStep(
  ports: SetupPorts,
  given: string | undefined,
): Promise<SetupSignInStep> {
  const begun = await setupBegun(ports, given, "SignIn");
  if (begun.begun === "Reported")
    return { step: "Reported", report: begun.report };
  const standing = await setupStanding(ports, begun.opened, "SignIn");
  if (standing.report === "SignedIn") setupSignInSettled(ports);
  if (standing.report !== "SignedOut")
    return { step: "Reported", report: standing };
  const site = begun.opened.site;
  const page = await setupSignInBegun(ports, site);
  return page.begun === "Reported"
    ? { step: "Reported", report: page.report }
    : { step: "Waiting", site, waiting: page };
}

async function setupSignIn(
  ports: SetupPorts,
  given: string | undefined,
  waitSecs: number,
): Promise<SetupReport> {
  const step = await setupLocked(ports, () => setupSignInStep(ports, given));
  if (step === undefined) return setupBusy(ports, "SignIn", given);
  if (step.step === "Reported") return step.report;
  return setupSignInAwaited(ports, step.site, step.waiting, waitSecs);
}

/** What a port threw, as a member of a closed set: the machine's own word for what it would not do, or only that something unexpected happened. */
function setupFaultOf(failure: unknown): SetupFault {
  return failure instanceof SetupMachineError
    ? failure.fault
    : { fault: "Unexpected" };
}

/** What a run the machine stopped reports, and is run again as: a listener is run by `sign-in` and by nobody else. */
function setupFaulted(
  asked: Exclude<SetupAsked, { readonly asked: "Wrongly" }>,
  failure: unknown,
): SetupReport {
  return {
    report: "Faulted",
    asked: asked.asked === "Status" ? "Status" : "SignIn",
    site: asked.site,
    fault: setupFaultOf(failure),
  };
}

export async function setupRun(
  ports: SetupPorts,
  argv: readonly string[],
): Promise<SetupReport> {
  const asked = setupAsked(argv);
  if (asked.asked === "Wrongly")
    return { report: "AskedWrongly", fault: asked.fault };
  try {
    switch (asked.asked) {
      case "Status":
        return await setupStatus(ports, asked.site);
      case "SignIn":
        return await setupSignIn(ports, asked.site, asked.waitSecs);
      case "Listen":
        return await setupListened(ports, asked.site, asked.lifeSecs);
    }
  } catch (failure: unknown) {
    return setupFaulted(asked, failure);
  }
}
