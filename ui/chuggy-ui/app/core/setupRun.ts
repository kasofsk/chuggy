/**
 * One run of the setup program, from its arguments to the report it prints.
 *
 * A run that uses the remembered sign-in holds the lock while it does, and
 * gives it up before it waits on a person, reads a checklist or touches the
 * machine for `runner` or `chat-host`. Before it asks a site or an issuer
 * anything it keeps room for what it may have to write, so a home that takes
 * no new file is found while the remembered sign-in is still good. Whatever
 * goes wrong on the machine ends as one report: which path it would not make,
 * write or read where a port said so, and otherwise only that something
 * unexpected stopped the run, so no message of another system's, and nothing a
 * message could carry, is ever printed.
 */

import type { ApiFailure } from "./apiRequest.ts";
import { base64urlFromBytes } from "./base64url.ts";
import { operationIdBytesCount } from "./operationFollow.ts";
import { setupAgentRead, setupMcpPackaged, setupServer } from "./setupAgent.ts";
import { setupAsked } from "./setupArguments.ts";
import type {
  SetupAnswers,
  SetupAsked,
  SetupCommand,
} from "./setupArguments.ts";
import {
  setupConfigurationChecked,
  setupConfigurationWritten,
  setupImportAsked,
  setupImportWrites,
} from "./setupConfiguration.ts";
import { setupBindAsked, setupBindWrites } from "./setupBind.ts";
import {
  setupHistoryRead,
  setupMergeAsked,
  setupMergeImportFailed,
  setupMergeWrites,
} from "./setupMerge.ts";
import {
  setupBindAwaited,
  setupBindDue,
  setupConfigurationDue,
  setupConnectDue,
  setupMcpDue,
  setupMergeAwaited,
  setupMergeDue,
  setupMergeUnseen,
  setupNext,
  setupRunnerDue,
  setupServeDue,
  setupTicketDue,
  setupWatchAwaited,
} from "./setupNext.ts";
import type { SetupMergeSeen } from "./setupNext.ts";
import type { SetupPacing } from "./setupPacing.ts";
import {
  SetupMachineError,
  setupPlatformOf,
  setupPlatformServed,
} from "./setupPorts.ts";
import type { SetupPorts } from "./setupPorts.ts";
import { setupPlugin, setupPluginHad } from "./setupPlugin.ts";
import { readSetup, setupPartition, setupReadPorts } from "./setupReads.ts";
import type { SetupReads } from "./setupReads.ts";
import { setupProject } from "./setupProject.ts";
import type { SetupProjectAsked } from "./setupProject.ts";
import { setupRemoteRead } from "./setupRemote.ts";
import { setupServeAsked } from "./setupServe.ts";
import type { SetupFault, SetupReport } from "./setupReport.ts";
import {
  setupChatHost,
  setupRunner,
  setupServeWrites,
  setupWritePorts,
} from "./setupRunner.ts";
import type {
  SetupChatHostAsked,
  SetupRunnerAsked,
  SetupRunnerEntered,
} from "./setupRunner.ts";
import { setupRunnerHere } from "./setupRunnerMachine.ts";
import {
  setupLoginRead,
  setupSessionOpened,
  setupWorkspacesRead,
} from "./setupSession.ts";
import type {
  SetupSessionOpened,
  SetupWorkspacesAnswered,
} from "./setupSession.ts";
import {
  setupBrowserOpened,
  setupListened,
  setupSignInAwaited,
  setupSignInBegun,
  setupSignInSettled,
  setupSignInStoodSaid,
} from "./setupSignIn.ts";
import type { SetupSignInBegun } from "./setupSignIn.ts";
import { setupStanding } from "./setupStanding.ts";
import {
  setupTicketFiled,
  setupTicketOffersRead,
  setupTicketWrites,
} from "./setupTicket.ts";
import type { SetupStanding } from "./setupStanding.ts";
import {
  setupLockHeldBy,
  setupLockReleased,
  setupLockTaken,
  setupLockWaitMs,
  setupSessionMoved,
  setupSessionSite,
  setupSessionSiteWritten,
  setupTokenRead,
  setupTokenRemoved,
} from "./setupStore.ts";

type SetupBegun =
  | { readonly begun: "Session"; readonly opened: SetupSessionOpened }
  | { readonly begun: "Reported"; readonly report: SetupReport };

/**
 * The session a command works under: the site it was given or the one
 * remembered, loaded, with the token the shared store holds for that site and
 * room for its renewal kept before anything is asked of either. A site is
 * remembered once it has answered as one.
 */
async function setupBegun(
  ports: SetupPorts,
  given: string | undefined,
  asked: SetupCommand,
): Promise<SetupBegun> {
  setupSessionMoved(ports.files, ports.store);
  const remembered = setupSessionSite(ports.files);
  const site = given ?? remembered;
  if (site === undefined)
    return { begun: "Reported", report: { report: "SiteUnknown" } };
  const held = setupTokenRead(ports.store, site);
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
  if (remembered !== site) setupSessionSiteWritten(ports.files, site);
  return { begun: "Session", opened };
}

/** Whether a session is signed in: with the bearer the site took, the workspaces it answered and, once asked after the lock is given up, the GitHub login it named where it named one, or the report that says why it is not. */
type SetupSigned =
  | {
      readonly signed: "In";
      readonly opened: SetupSessionOpened;
      readonly bearer: string;
      readonly workspaces: SetupWorkspacesAnswered;
      readonly login: string | undefined;
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
  return { signed: "In", opened, bearer, workspaces, login: undefined };
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
 * for it. Everything goes out through ports that can only read; Claude Code's
 * list of plugins is read where the plugin step was not passed over, the agent's
 * configuration is read for the project chosen, where the MCP step or the
 * runner's is the one next the machine is looked at and not touched, where
 * the project's first ticket is, what it may be drawn under is read, and where
 * the merge is offered and `merged` says nothing of one, the folder's history
 * is counted.
 */
async function setupChecklist(
  ports: SetupPorts,
  signed: Extract<SetupSigned, { readonly signed: "In" }>,
  answers: SetupAnswers,
  pacing: SetupPacing,
  merged?: SetupMergeSeen,
): Promise<Extract<SetupReport, { readonly report: "Checklist" }>> {
  const standing = await setupStandingRead(ports, signed, answers, pacing);
  const due = setupRunnerDue(standing);
  const here =
    due === undefined ? undefined : await setupRunnerHere(ports, due);
  const packaged =
    setupMcpDue(standing) === undefined
      ? undefined
      : await setupMcpPackaged(ports);
  const filing = setupTicketDue(standing);
  const offers =
    filing === undefined
      ? undefined
      : await setupTicketOffersRead(
          setupReadPorts(signed.opened.api, signed.bearer),
          filing,
        );
  const merge =
    merged ??
    (setupMergeDue(standing) === undefined
      ? setupMergeUnseen
      : {
          seen: "Offered",
          history: await setupHistoryRead(ports.process, pacing.remoteWaitMs),
        });
  return {
    report: "Checklist",
    site: standing.site,
    login: signed.login,
    found: standing.found,
    steps: standing.steps.map(({ step, state, detail }) => ({
      step,
      state,
      detail,
    })),
    next: setupNext(
      standing,
      answers,
      setupPlatformOf(ports.surroundings),
      here,
      packaged,
      offers,
      merge,
    ),
  };
}

/** Where the person stands, from one bundle of reads sent through ports that can only read. */
async function setupStandingRead(
  ports: SetupPorts,
  signed: Extract<SetupSigned, { readonly signed: "In" }>,
  answers: SetupAnswers,
  pacing: SetupPacing,
): Promise<SetupStanding> {
  const reads = await readSetup(
    setupReadPorts(signed.opened.api, signed.bearer),
    {
      site: signed.opened.site,
      answers,
      remote: await setupRemoteRead(ports.process, pacing.remoteWaitMs),
      workspaces: signed.workspaces,
    },
  );
  return setupStanding(
    reads,
    await setupChecklistNamed(ports, reads),
    await setupPluginHad(ports, answers),
  );
}

/** Whether the agent's configuration for this folder names chuggy's server for the project the reads chose, where they chose one. */
async function setupChecklistNamed(
  ports: SetupPorts,
  reads: SetupReads,
): Promise<boolean> {
  const partition = setupPartition(reads.choice, reads.inventory);
  if (partition === undefined) return false;
  const { tenant: workspace, project } = partition;
  return (await setupAgentRead(ports, { site: reads.site, workspace, project }))
    .named;
}

/**
 * The remembered sign-in entered under the lock, for a command that opens no
 * page: signed in, or the report that says why not, which for a run not
 * signed in says how the last sign-in ended while that ending stands, and
 * signed in, named by the login the site then gives once the lock is given
 * up. Nothing is answered where another run kept the lock past the wait.
 */
async function setupEntered(
  ports: SetupPorts,
  given: string | undefined,
  asked: SetupCommand,
): Promise<SetupSigned | undefined> {
  const held = await setupLocked(ports, async (): Promise<SetupSigned> => {
    const begun = await setupBegun(ports, given, asked);
    if (begun.begun === "Reported")
      return { signed: "Out", report: begun.report };
    const signed = await setupSigned(ports, begun.opened, asked);
    if (signed.signed === "In" || signed.report.report !== "SignedOut")
      return signed;
    const ended = setupSignInStoodSaid(ports, signed.report.site);
    return { signed: "Out", report: { ...signed.report, ended } };
  });
  return held?.signed === "In"
    ? { ...held, login: await setupLoginRead(held.opened) }
    : held;
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
  pacing: SetupPacing,
): Promise<SetupReport> {
  const held = await setupEntered(ports, asked.site, "Status");
  if (held === undefined) return setupBusy(ports, "Status", asked.site);
  return held.signed === "Out"
    ? held.report
    : setupChecklist(ports, held, asked.answers, pacing);
}

/**
 * `import` works under the remembered sign-in as the bare command does. Where
 * the checklist's next thing is the repository's configuration, it asks the
 * site to import that repository, the one write its ports let through, and
 * reads the checklist again, which says what the import came to as the site
 * keeps it; where it is not, it imports nothing and says the checklist.
 */
async function setupImport(
  ports: SetupPorts,
  asked: Extract<SetupAsked, { readonly asked: "Import" }>,
  pacing: SetupPacing,
): Promise<SetupReport> {
  const held = await setupEntered(ports, asked.site, "Import");
  if (held === undefined) return setupBusy(ports, "Import", asked.site);
  if (held.signed === "Out") return held.report;
  const due = setupConfigurationDue(
    await setupStandingRead(ports, held, asked.answers, pacing),
  );
  const answered =
    due === undefined
      ? undefined
      : await setupImportAsked(
          setupWritePorts(
            held.opened.api,
            held.bearer,
            setupImportWrites(due.partition),
          ),
          due.partition,
          due.repository,
        );
  return {
    report: "Import",
    repository: due?.repository,
    answered,
    checklist: await setupChecklist(ports, held, asked.answers, pacing),
  };
}

/** The repositories page that begins Connect GitHub, opened in a browser where connecting GitHub is the next thing and the opener took it. */
async function setupBindConnectOpened(
  ports: SetupPorts,
  standing: SetupStanding,
): Promise<string | undefined> {
  const address = setupConnectDue(standing);
  if (address === undefined) return undefined;
  return (await setupBrowserOpened(ports, address)) ? address : undefined;
}

/** The one bind `bind` asks of the site, under an operation of its own, and the checklist read after it. */
async function setupBound(
  ports: SetupPorts,
  held: Extract<SetupSigned, { readonly signed: "In" }>,
  due: NonNullable<ReturnType<typeof setupBindDue>>,
  checklist: () => Promise<
    Extract<SetupReport, { readonly report: "Checklist" }>
  >,
): Promise<
  Omit<
    Extract<SetupReport, { readonly report: "Bind" }>,
    "opened" | "openBefore"
  >
> {
  const answered = await setupBindAsked(
    setupWritePorts(
      held.opened.api,
      held.bearer,
      setupBindWrites(due.partition),
    ),
    due.partition,
    due.url,
    base64urlFromBytes(ports.drawBytes(operationIdBytesCount)),
  );
  return {
    report: "Bind",
    repository: due.repository,
    answered,
    checklist: await checklist(),
  };
}

/** Whether a look `bind` could not finish may be answered otherwise at the next: where the site did not answer, failed or was rolling out, and not where it answered with a refusal. */
function setupBindAgain(outcome: ApiFailure["outcome"]): boolean {
  switch (outcome) {
    case "Unreachable":
    case "Fault":
    case "Retryable":
      return true;
    case "Absent":
    case "Rejected":
    case "Conflict":
    case "Unauthenticated":
    case "Unreadable":
      return false;
  }
}

/** Whether the sign-in `bind` entered failed in a way its next look may not: the site, the issuer or the workspaces read did not answer. */
function setupBindAgainEntered(report: SetupReport): boolean {
  if (report.report === "IssuerUnanswered") return true;
  if (report.report === "SiteUnusable") return report.phase === "Unreachable";
  if (report.report === "WorkspacesUnread")
    return setupBindAgain(report.outcome);
  return false;
}

/** Whether the first thing `bind` read lacking is a read that failed in a way its next look may not. */
function setupBindAgainRead(standing: SetupStanding): boolean {
  const lack = standing.steps.find((step) => step.lacks !== undefined)?.lacks;
  return (
    lack?.lacks === "Read" &&
    lack.fate.fate === "Failed" &&
    setupBindAgain(lack.fate.outcome)
  );
}

/**
 * `bind` works under the remembered sign-in as `import` does, entered again at
 * each look so a wait outlasts its first bearer, and reads the checklist again
 * at `pacing.bindPollMs`, for as long as the run was given, while the next
 * thing waits on GitHub or a look failed where the next may not, opening the
 * page that connects GitHub where its first look to read the standing finds
 * that next and no `bind` before it opened one, and ending a look still
 * failing when the time is up as it would have at once. Once the next thing is
 * adding the folder's repository it binds it, the one write its ports let
 * through, and reads the checklist again; where the next thing waits on
 * neither, it binds nothing.
 */
async function setupBind(
  ports: SetupPorts,
  asked: Extract<SetupAsked, { readonly asked: "Bind" }>,
  pacing: SetupPacing,
): Promise<SetupReport> {
  const endsAtMs = ports.nowMs() + asked.waitSecs * 1_000;
  let opened: string | undefined;
  for (let looked = false; ;) {
    const held = await setupEntered(ports, asked.site, "Bind");
    if (held === undefined) return setupBusy(ports, "Bind", asked.site);
    if (held.signed === "Out") {
      if (ports.nowMs() >= endsAtMs || !setupBindAgainEntered(held.report))
        return held.report;
      await ports.sleepMs(pacing.bindPollMs);
      continue;
    }
    const checklist = () => setupChecklist(ports, held, asked.answers, pacing);
    const standing = await setupStandingRead(
      ports,
      held,
      asked.answers,
      pacing,
    );
    const due = setupBindDue(standing);
    const open = { opened, openBefore: asked.opened };
    if (due !== undefined)
      return { ...(await setupBound(ports, held, due, checklist)), ...open };
    const failed = setupBindAgainRead(standing);
    if (!failed && !looked && !asked.opened)
      opened = await setupBindConnectOpened(ports, standing);
    looked ||= !failed;
    const waits = failed || setupBindAwaited(standing);
    if (!waits || ports.nowMs() >= endsAtMs)
      return {
        report: "Bind",
        opened,
        openBefore: asked.opened,
        repository: undefined,
        answered: undefined,
        checklist: await checklist(),
      };
    await ports.sleepMs(pacing.bindPollMs);
  }
}

type SetupMergeReport = Extract<SetupReport, { readonly report: "Merge" }>;

/** The one merge `merge` asks of the site, where the checklist offers it, and what it looked at before. */
async function setupMergeFirst(
  held: Extract<SetupSigned, { readonly signed: "In" }>,
  standing: SetupStanding,
): Promise<
  Pick<SetupMergeReport, "url" | "answered"> & {
    readonly since: Extract<SetupMergeSeen, { readonly seen: "Merged" }>;
  }
> {
  const due = setupMergeDue(standing);
  const answered =
    due === undefined
      ? undefined
      : await setupMergeAsked(
          setupWritePorts(
            held.opened.api,
            held.bearer,
            setupMergeWrites(due.partition, due.unmerged.ticket),
          ),
          due.partition,
          due.unmerged.ticket,
        );
  return {
    url: due?.unmerged.url,
    answered,
    since: {
      seen: "Merged",
      before: standing.bootstrap?.lastImport,
      mergeCommit:
        answered?.answered === "Merged"
          ? answered.mergeCommit
          : standing.bootstrap?.mergeCommit,
    },
  };
}

/**
 * `merge` works under the remembered sign-in as `bind` does, asking the site
 * for the merge where the checklist offers it, the one write its ports let
 * through, and ending on a refusal with setup said to be done. Once it is
 * merged, or where nothing stands unmerged and the repository still holds only
 * the bootstrap, it reads the checklist again at `pacing.mergePollMs`, entered
 * again at each look, until the repository's own configuration is imported,
 * its import is refused, or the run's wait ends.
 */
async function setupMergeRun(
  ports: SetupPorts,
  asked: Extract<SetupAsked, { readonly asked: "Merge" }>,
  pacing: SetupPacing,
): Promise<SetupReport> {
  const endsAtMs = ports.nowMs() + asked.waitSecs * 1_000;
  const first = await setupEntered(ports, asked.site, "Merge");
  if (first === undefined) return setupBusy(ports, "Merge", asked.site);
  if (first.signed === "Out") return first.report;
  const standing = await setupStandingRead(ports, first, asked.answers, pacing);
  const { url, answered, since } = await setupMergeFirst(first, standing);
  const report = async (
    held: Extract<SetupSigned, { readonly signed: "In" }>,
    merged: SetupMergeSeen | undefined,
  ): Promise<SetupReport> => ({
    report: "Merge",
    url,
    answered,
    checklist: await setupChecklist(ports, held, asked.answers, pacing, merged),
  });
  if (answered?.answered === "Refused")
    return report(first, { seen: "Refused" });
  if (answered?.answered === "Failed") return report(first, undefined);
  if (answered === undefined && !setupMergeAwaited(standing))
    return report(first, undefined);
  for (let held = first, looked = standing; ;) {
    const imported =
      !setupMergeAwaited(looked) ||
      setupMergeImportFailed(since, looked.bootstrap?.lastImport);
    if (imported || ports.nowMs() >= endsAtMs) return report(held, since);
    await ports.sleepMs(pacing.mergePollMs);
    const again = await setupEntered(ports, asked.site, "Merge");
    if (again === undefined) return setupBusy(ports, "Merge", asked.site);
    if (again.signed === "Out") return again.report;
    held = again;
    looked = await setupStandingRead(ports, held, asked.answers, pacing);
  }
}

/**
 * `serve` works under the remembered sign-in as `bind` does. Where the
 * checklist's next thing is a personal runner of the person's taking the
 * project's work, it asks the site for the writes that are due, the only ones
 * its ports let through, and reads the checklist again; where it is not, it
 * writes nothing and says the checklist.
 */
async function setupServe(
  ports: SetupPorts,
  asked: Extract<SetupAsked, { readonly asked: "Serve" }>,
  pacing: SetupPacing,
): Promise<SetupReport> {
  const held = await setupEntered(ports, asked.site, "Serve");
  if (held === undefined) return setupBusy(ports, "Serve", asked.site);
  if (held.signed === "Out") return held.report;
  const due = setupServeDue(
    await setupStandingRead(ports, held, asked.answers, pacing),
  );
  const answered =
    due === undefined
      ? undefined
      : await setupServeAsked(
          setupWritePorts(held.opened.api, held.bearer, setupServeWrites(due)),
          due,
        );
  return {
    report: "Serve",
    project: due?.partition.project,
    answered,
    checklist: await setupChecklist(ports, held, asked.answers, pacing),
  };
}

/**
 * `ticket` works under the remembered sign-in as `import` does. Where the
 * checklist's next thing is the project's first ticket, it files one from
 * what the person said, as the console's Create ticket does, through ports
 * that let out only that creation's writes, each submission under an
 * operation of its own, and reads the checklist again; where it is not, it
 * files nothing and says the checklist.
 */
async function setupTicket(
  ports: SetupPorts,
  asked: Extract<SetupAsked, { readonly asked: "Ticket" }>,
  pacing: SetupPacing,
): Promise<SetupReport> {
  const held = await setupEntered(ports, asked.site, "Ticket");
  if (held === undefined) return setupBusy(ports, "Ticket", asked.site);
  if (held.signed === "Out") return held.report;
  const due = setupTicketDue(
    await setupStandingRead(ports, held, asked.answers, pacing),
  );
  const drawn = (): string =>
    base64urlFromBytes(ports.drawBytes(operationIdBytesCount));
  const answered =
    due === undefined
      ? undefined
      : await setupTicketFiled(
          setupWritePorts(held.opened.api, held.bearer, setupTicketWrites(due)),
          due,
          asked,
          { release: drawn(), dispatch: drawn() },
          ports.text,
        );
  return {
    report: "Ticket",
    answered,
    checklist: await setupChecklist(ports, held, asked.answers, pacing),
  };
}

/**
 * `watch` works under the remembered sign-in as the bare command does, and
 * reads the checklist again at `pacing.watchPollMs`, entered again at each
 * look, while its next thing is the first ticket on its way to its landing and
 * the run's wait has not ended, then says the checklist. It writes nothing.
 */
async function setupWatch(
  ports: SetupPorts,
  asked: Extract<SetupAsked, { readonly asked: "Watch" }>,
  pacing: SetupPacing,
): Promise<SetupReport> {
  const endsAtMs = ports.nowMs() + asked.waitSecs * 1_000;
  for (;;) {
    const held = await setupEntered(ports, asked.site, "Watch");
    if (held === undefined) return setupBusy(ports, "Watch", asked.site);
    if (held.signed === "Out") return held.report;
    const standing = await setupStandingRead(
      ports,
      held,
      asked.answers,
      pacing,
    );
    if (!setupWatchAwaited(standing) || ports.nowMs() >= endsAtMs)
      return setupChecklist(ports, held, asked.answers, pacing);
    await ports.sleepMs(pacing.watchPollMs);
  }
}

/**
 * One entry of the sign-in `project`, `runner` or `chat-host` works under. Whatever does
 * not end signed in is answered as a report, a fault of this machine's among
 * them, so a run that enters again part-way has one way out and says what it
 * had done ahead of it.
 */
async function setupRunnerEntry(
  ports: SetupPorts,
  asked: SetupProjectAsked | SetupRunnerAsked | SetupChatHostAsked,
): Promise<SetupRunnerEntered> {
  try {
    const held = await setupEntered(ports, asked.site, asked.asked);
    if (held === undefined)
      return {
        entered: "Out",
        report: setupBusy(ports, asked.asked, asked.site),
      };
    if (held.signed === "Out") return { entered: "Out", report: held.report };
    const { site, api } = held.opened;
    return {
      entered: "In",
      session: {
        site,
        api,
        bearer: held.bearer,
        workspaces: held.workspaces.tenants,
        login: held.login,
      },
    };
  } catch (failure: unknown) {
    return { entered: "Out", report: setupFaulted(asked, failure) };
  }
}

/**
 * `runner` and `chat-host` work under the remembered sign-in as the bare
 * command does, and enter it again the same way where the site stops taking
 * the bearer they held, so the lock is never held while the machine is worked
 * on.
 */
function setupRunnerRun(
  ports: SetupPorts,
  asked: SetupRunnerAsked | SetupChatHostAsked,
  pacing: SetupPacing,
): Promise<SetupReport> {
  const enter = () => setupRunnerEntry(ports, asked);
  return asked.asked === "Runner"
    ? setupRunner(ports, asked, enter, pacing.livePollMs)
    : setupChatHost(ports, asked, enter, pacing.livePollMs);
}

type SetupSignInStep =
  | { readonly step: "Reported"; readonly report: SetupReport }
  | { readonly step: "SignedIn"; readonly opened: SetupSessionOpened }
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
  pacing: SetupPacing,
): Promise<SetupSignInStep> {
  const begun = await setupBegun(ports, given, "SignIn");
  if (begun.begun === "Reported")
    return { step: "Reported", report: begun.report };
  const site = begun.opened.site;
  const signed = await setupSigned(ports, begun.opened, "SignIn");
  if (signed.signed === "In") {
    setupSignInSettled(ports);
    return { step: "SignedIn", opened: signed.opened };
  }
  if (signed.report.report !== "SignedOut")
    return { step: "Reported", report: signed.report };
  const page = await setupSignInBegun(ports, site, pacing.signInPollMs);
  return page.begun === "Reported"
    ? { step: "Reported", report: page.report }
    : { step: "Waiting", site, waiting: page };
}

async function setupSignIn(
  ports: SetupPorts,
  given: string | undefined,
  waitSecs: number,
  pacing: SetupPacing,
): Promise<SetupReport> {
  const step = await setupLocked(ports, () =>
    setupSignInStep(ports, given, pacing),
  );
  if (step === undefined) return setupBusy(ports, "SignIn", given);
  if (step.step === "Reported") return step.report;
  if (step.step === "SignedIn")
    return {
      report: "SignInEnded",
      site: step.opened.site,
      ended: "SignedIn",
      login: await setupLoginRead(step.opened),
    };
  return setupSignInAwaited(
    ports,
    step.site,
    step.waiting,
    waitSecs,
    pacing.signInPollMs,
  );
}

/**
 * `sign-out` removes the sign-in this machine holds for the site, asking the
 * site nothing, and leaves the site remembered and whatever runs from that
 * sign-in elsewhere alone.
 */
async function setupSignOut(
  ports: SetupPorts,
  given: string | undefined,
): Promise<SetupReport> {
  const report = await setupLocked(ports, (): Promise<SetupReport> => {
    setupSessionMoved(ports.files, ports.store);
    const site = given ?? setupSessionSite(ports.files);
    return Promise.resolve(
      site === undefined
        ? { report: "SiteUnknown" }
        : {
            report: "SignedOutHere",
            site,
            held: setupTokenRemoved(ports.store, site),
          },
    );
  });
  return report ?? setupBusy(ports, "SignOut", given);
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
    asked: asked.asked === "Listen" ? "SignIn" : asked.asked,
    site: asked.site,
    fault: setupFaultOf(failure),
  };
}

/** A platform the program is not served on is refused before an argument is read or anything is asked, made or written. */
export async function setupRun(
  ports: SetupPorts,
  argv: readonly string[],
  pacing: SetupPacing,
): Promise<SetupReport> {
  const platform = ports.surroundings.platform;
  if (setupPlatformServed(platform) === undefined)
    return { report: "Unserved", platform };
  const asked = setupAsked(argv);
  if (asked.asked === "Wrongly")
    return { report: "AskedWrongly", fault: asked.fault };
  try {
    switch (asked.asked) {
      case "Status":
        return await setupStatus(ports, asked, pacing);
      case "SignIn":
        return await setupSignIn(ports, asked.site, asked.waitSecs, pacing);
      case "SignOut":
        return await setupSignOut(ports, asked.site);
      case "Project":
        return await setupProject(
          ports,
          asked,
          await setupRunnerEntry(ports, asked),
        );
      case "Mcp":
        return await setupServer(ports, asked);
      case "Plugin":
        return await setupPlugin(ports, asked);
      case "Runner":
      case "ChatHost":
        return await setupRunnerRun(ports, asked, pacing);
      case "Configuration":
        return {
          report: "Configuration",
          ended: await setupConfigurationWritten(ports, asked.test),
        };
      case "Check":
        return {
          report: "Check",
          ended: await setupConfigurationChecked(ports),
        };
      case "Import":
        return await setupImport(ports, asked, pacing);
      case "Bind":
        return await setupBind(ports, asked, pacing);
      case "Merge":
        return await setupMergeRun(ports, asked, pacing);
      case "Serve":
        return await setupServe(ports, asked, pacing);
      case "Ticket":
        return await setupTicket(ports, asked, pacing);
      case "Watch":
        return await setupWatch(ports, asked, pacing);
      case "Listen":
        return await setupListened(ports, asked.site, asked.lifeSecs);
    }
  } catch (failure: unknown) {
    return setupFaulted(asked, failure);
  }
}
