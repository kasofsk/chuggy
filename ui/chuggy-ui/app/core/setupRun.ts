/**
 * One run of the setup program, from its arguments to the report it prints.
 *
 * A run that uses the remembered sign-in holds the lock while it does, and
 * gives it up before it waits on a person. Before it asks a site or an issuer
 * anything it keeps room for what it may have to write, so a home that takes
 * no new file is found while the remembered sign-in is still good. Whatever
 * goes wrong on the machine ends as one report: which path it would not make,
 * write or read where a port said so, and otherwise only that something
 * unexpected stopped the run, so no message of another system's, and nothing a
 * message could carry, is ever printed.
 */

import { setupAsked } from "./setupArguments.ts";
import type {
  SetupAnswers,
  SetupAsked,
  SetupCommand,
} from "./setupArguments.ts";
import { setupNext } from "./setupNext.ts";
import { SetupMachineError, setupPlatforms } from "./setupPorts.ts";
import type { SetupPorts } from "./setupPorts.ts";
import { readSetup, setupReadPorts } from "./setupReads.ts";
import { setupRemoteRead } from "./setupRemote.ts";
import type { SetupFault, SetupReport } from "./setupReport.ts";
import { setupSessionOpened, setupWorkspacesRead } from "./setupSession.ts";
import type {
  SetupSessionOpened,
  SetupWorkspacesAnswered,
} from "./setupSession.ts";
import {
  setupListened,
  setupSignInAwaited,
  setupSignInBegun,
  setupSignInSettled,
  setupSignInStoodSaid,
} from "./setupSignIn.ts";
import type { SetupSignInBegun } from "./setupSignIn.ts";
import { setupStanding } from "./setupStanding.ts";
import {
  setupLockHeldBy,
  setupLockReleased,
  setupLockTaken,
  setupLockWaitMs,
  setupSessionRead,
  setupSessionWritten,
} from "./setupStore.ts";

type SetupBegun =
  | { readonly begun: "Session"; readonly opened: SetupSessionOpened }
  | { readonly begun: "Reported"; readonly report: SetupReport };

/**
 * The session a command works under: the site it was given or the one
 * remembered, loaded, with the remembered token only where it is that site's
 * and room for its renewal kept before anything is asked of either. A site is
 * remembered once it has answered as one.
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
  opened.store.roomed();
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

/** Whether a session is signed in: with the bearer the site took and the workspaces it answered, or the report that says why it is not. */
type SetupSigned =
  | {
      readonly signed: "In";
      readonly opened: SetupSessionOpened;
      readonly bearer: string;
      readonly workspaces: SetupWorkspacesAnswered;
    }
  | { readonly signed: "Out"; readonly report: SetupReport };

/**
 * Whether the remembered sign-in still stands: its token renews and the site
 * answers as that person, where a renewal the issuer refuses is only not
 * signed in and one it did not answer is a failure. What the store was refused
 * is thrown after each thing that could have spent a token, before anything is
 * made of how the holder took it.
 */
async function setupSigned(
  ports: SetupPorts,
  opened: SetupSessionOpened,
  asked: SetupCommand,
): Promise<SetupSigned> {
  const site = opened.site;
  const out = (report: SetupReport): SetupSigned => ({ signed: "Out", report });
  const signedOut: SetupReport = {
    report: "SignedOut",
    site,
    directory: ports.surroundings.directory,
    ended: undefined,
  };
  if (opened.holder.snapshot().phase !== "SignedIn") return out(signedOut);
  const renewed = await opened.holder.bearer();
  opened.store.kept();
  if (renewed === undefined)
    return out(
      opened.tokenAsked() === "Refused"
        ? signedOut
        : { report: "IssuerUnanswered", site, asked },
    );
  const workspaces = await setupWorkspacesRead(opened);
  opened.store.kept();
  if (workspaces.read === "Unread")
    return out({
      report: "WorkspacesUnread",
      site,
      outcome: workspaces.outcome,
      asked,
    });
  const bearer = (await opened.holder.bearer()) ?? renewed;
  opened.store.kept();
  return { signed: "In", opened, bearer, workspaces };
}

/**
 * Runs `body` holding the lock, or answers nothing where another run kept it
 * past the wait. What `body` threw is what is thrown, whatever giving the lock
 * up then met: the first thing the machine refused is the one a report says.
 */
async function setupLocked<T>(
  ports: SetupPorts,
  body: () => Promise<T>,
): Promise<T | undefined> {
  if (!(await setupLockTaken(ports, setupLockWaitMs))) return undefined;
  const tried = await body().then(
    (value) => ({ threw: false, value }) as const,
    (failure: unknown) => ({ threw: true, failure }) as const,
  );
  try {
    setupLockReleased(ports);
  } catch (failure: unknown) {
    if (!tried.threw) throw failure;
  }
  if (tried.threw) throw tried.failure;
  return tried.value;
}

function setupBusy(
  ports: SetupPorts,
  asked: SetupCommand,
  site: string | undefined,
): SetupReport {
  return { report: "Busy", asked, site, pid: setupLockHeldBy(ports) };
}

/**
 * The checklist, read once the lock is given up: nothing from here on reads
 * or writes the session file, and no request is sent while the lock is held
 * for it. Everything goes out through ports that can only read.
 */
async function setupChecklist(
  ports: SetupPorts,
  signed: Extract<SetupSigned, { readonly signed: "In" }>,
  answers: SetupAnswers,
): Promise<SetupReport> {
  const site = signed.opened.site;
  const reads = await readSetup(
    setupReadPorts(signed.opened.api, signed.bearer),
    {
      site,
      answers,
      remote: await setupRemoteRead(ports.process),
      workspaces: signed.workspaces,
    },
  );
  const standing = setupStanding(reads);
  return {
    report: "Checklist",
    site,
    found: standing.found,
    steps: standing.steps.map(({ step, state, detail }) => ({
      step,
      state,
      detail,
    })),
    next: setupNext(standing, answers),
  };
}

/**
 * The bare command opens no page and changes nothing at the site. Signed in,
 * it reads where the person stands; not signed in, it says how the last
 * sign-in ended while that ending stands, leaves it as said, and names
 * `sign-in` only where none does.
 */
async function setupStatus(
  ports: SetupPorts,
  asked: Extract<SetupAsked, { readonly asked: "Status" }>,
): Promise<SetupReport> {
  const held = await setupLocked(ports, async (): Promise<SetupSigned> => {
    const begun = await setupBegun(ports, asked.site, "Status");
    if (begun.begun === "Reported")
      return { signed: "Out", report: begun.report };
    const signed = await setupSigned(ports, begun.opened, "Status");
    if (signed.signed === "In" || signed.report.report !== "SignedOut")
      return signed;
    const ended = setupSignInStoodSaid(ports, signed.report.site);
    return { signed: "Out", report: { ...signed.report, ended } };
  });
  if (held === undefined) return setupBusy(ports, "Status", asked.site);
  return held.signed === "Out"
    ? held.report
    : setupChecklist(ports, held, asked.answers);
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
  const site = begun.opened.site;
  const signed = await setupSigned(ports, begun.opened, "SignIn");
  if (signed.signed === "In") {
    setupSignInSettled(ports);
    return {
      step: "Reported",
      report: { report: "SignInEnded", site, ended: "SignedIn" },
    };
  }
  if (signed.report.report !== "SignedOut")
    return { step: "Reported", report: signed.report };
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

/** A platform the program is not served on is refused before an argument is read or anything is asked, made or written. */
export async function setupRun(
  ports: SetupPorts,
  argv: readonly string[],
): Promise<SetupReport> {
  const platform = ports.surroundings.platform;
  if (!setupPlatforms.some((served) => served === platform))
    return { report: "Unserved", platform };
  const asked = setupAsked(argv);
  if (asked.asked === "Wrongly")
    return { report: "AskedWrongly", fault: asked.fault };
  try {
    switch (asked.asked) {
      case "Status":
        return await setupStatus(ports, asked);
      case "SignIn":
        return await setupSignIn(ports, asked.site, asked.waitSecs);
      case "Listen":
        return await setupListened(ports, asked.site, asked.lifeSecs);
    }
  } catch (failure: unknown) {
    return setupFaulted(asked, failure);
  }
}
