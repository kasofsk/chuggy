/**
 * Signing in from a terminal: a page the person's browser reaches on this
 * machine, held by a process that outlives the command that started it.
 *
 * `sign-in` starts the program again as a listener and waits on it for a
 * bounded time. The listener binds a port of the machine's choosing, sends the
 * browser on to the issuer, and reads the answer the issuer sends back to it.
 * A person slower than one wait finishes in the same tab: the listener is
 * still there, the note it left says where, and the next `sign-in` waits on
 * that one and opens nothing. The listener ends when it has an answer or when
 * its own bound passes, whichever is first.
 *
 * Signed in is three things together: the issuer exchanged the answer, it
 * handed over a renewal token, and the site then answered a read as that
 * person. The first two without the third is a token the site refuses, and the
 * first without the second is a sign-in that lasts one command.
 */

import { sessionRefreshTokenKey } from "./sessionHolder.ts";
import {
  setupListenArguments,
  setupListenSecsDefault,
} from "./setupArguments.ts";
import { setupFiles } from "./setupPorts.ts";
import type {
  SetupAnswered,
  SetupHeard,
  SetupPorts,
  SetupSurroundings,
} from "./setupPorts.ts";
import {
  setupCallbackPath,
  setupLoopbackAddress,
  setupLoopbackHost,
} from "./setupProgram.ts";
import type {
  SetupReport,
  SetupSignInEnded,
  SetupSignInOpened,
} from "./setupReport.ts";
import { setupSessionOpened, setupWorkspacesRead } from "./setupSession.ts";
import type { SetupSessionOpened } from "./setupSession.ts";
import {
  setupLockReleased,
  setupLockTaken,
  setupSignInNoteRead,
  setupSignInNoteWritten,
} from "./setupStore.ts";
import type { SetupSignInNote } from "./setupStore.ts";

export const setupSignInPollMs = 250;

/** How long a listener just started has to say where it listens. */
export const setupSignInStartSecsMax = 20;

/** How long an opener is watched before it is taken to have opened something. */
export const setupOpenerWaitMs = 3_000;

/** How long after a sign-in ended with nobody waiting its ending is still worth saying. */
export const setupSignInKeptSecs = 600;

/** How far past its own end a listener's note is still believed. */
export const setupSignInGraceSecs = 30;

/** How long a listener waits for the lock when an answer arrives while a command holds it. */
export const setupListenLockWaitMs = 30_000;

/** How long an answer under way is given to reach the browser once the listener is closing. */
export const setupListenCloseWaitMs = 2_000;

/** What `sign-in` finds of an earlier one for this site: a page still waiting, an ending nobody heard, or nothing. */
export type SetupSignInFound =
  | { readonly found: "Waiting"; readonly port: number; readonly pid: number }
  | { readonly found: "Ended"; readonly ended: SetupSignInEnded }
  | { readonly found: "None" };

export function setupSignInFound(
  note: SetupSignInNote | undefined,
  site: string,
  nowMs: number,
  alive: (pid: number) => boolean,
): SetupSignInFound {
  if (note === undefined || note.site !== site) return { found: "None" };
  if (note.note === "Waiting") {
    const believedUntilMs = note.endsAtMs + setupSignInGraceSecs * 1_000;
    return nowMs <= believedUntilMs && alive(note.pid)
      ? { found: "Waiting", port: note.port, pid: note.pid }
      : { found: "None" };
  }
  const kept = nowMs - note.endedAtMs <= setupSignInKeptSecs * 1_000;
  return kept && note.ended !== "SignedIn"
    ? { found: "Ended", ended: note.ended }
    : { found: "None" };
}

/** Drops the note of a sign-in that has ended, once a command has found for itself how it stands. */
export function setupSignInSettled(ports: SetupPorts): void {
  if (setupSignInNoteRead(ports.files)?.note === "Ended")
    ports.files.remove(setupFiles.signIn);
}

/** The command that opens an address in the person's browser, where this machine has one this program knows. */
export function setupOpenerCommand(
  surroundings: SetupSurroundings,
  address: string,
): readonly string[] | undefined {
  if (surroundings.browser !== undefined && surroundings.browser !== "")
    return [surroundings.browser, address];
  switch (surroundings.platform) {
    case "darwin":
      return ["open", address];
    case "linux":
      return ["xdg-open", address];
    default:
      return undefined;
  }
}

async function setupSignInOpened(
  ports: SetupPorts,
  port: number,
): Promise<boolean> {
  const command = setupOpenerCommand(
    ports.surroundings,
    setupLoopbackAddress(port),
  );
  if (command === undefined) return false;
  const launched = await ports.process.launch(command, setupOpenerWaitMs);
  switch (launched.launched) {
    case "Unstarted":
      return false;
    case "Running":
      return true;
    case "Ended":
      return launched.exit === 0;
  }
}

function setupEndedReport(site: string, ended: SetupSignInEnded): SetupReport {
  return { report: "SignInEnded", site, ended };
}

/** A page being waited on, or the report that ends the command without a wait. */
export type SetupSignInBegun =
  | {
      readonly begun: "Waiting";
      readonly port: number;
      readonly pid: number;
      readonly started: boolean;
    }
  | { readonly begun: "Reported"; readonly report: SetupReport };

/**
 * Waits for a listener just started to leave its note: where it listens, or
 * why it could not. Whether it is running is asked before the note is read, so
 * the last thing a listener wrote is read after it has gone.
 */
async function setupSignInStarted(
  ports: SetupPorts,
  site: string,
  pid: number,
): Promise<SetupSignInBegun> {
  const polls = Math.ceil(
    (setupSignInStartSecsMax * 1_000) / setupSignInPollMs,
  );
  for (let poll = 0; poll < polls; poll += 1) {
    const alive = ports.process.alive(pid);
    const note = setupSignInNoteRead(ports.files);
    if (note?.note === "Ended") {
      ports.files.remove(setupFiles.signIn);
      return { begun: "Reported", report: setupEndedReport(site, note.ended) };
    }
    if (note?.note === "Waiting")
      return {
        begun: "Waiting",
        port: note.port,
        pid: note.pid,
        started: true,
      };
    if (!alive) break;
    await ports.sleepMs(setupSignInPollMs);
  }
  return { begun: "Reported", report: { report: "Faulted" } };
}

/**
 * What a `sign-in` that is not signed in does next, decided while it holds the
 * lock so that two commands at once cannot each start a page.
 */
export async function setupSignInBegun(
  ports: SetupPorts,
  site: string,
): Promise<SetupSignInBegun> {
  const found = setupSignInFound(
    setupSignInNoteRead(ports.files),
    site,
    ports.nowMs(),
    ports.process.alive,
  );
  if (found.found === "Waiting")
    return {
      begun: "Waiting",
      port: found.port,
      pid: found.pid,
      started: false,
    };
  ports.files.remove(setupFiles.signIn);
  if (found.found === "Ended")
    return { begun: "Reported", report: setupEndedReport(site, found.ended) };
  const pid = ports.process.detach(
    setupListenArguments(site, setupListenSecsDefault),
  );
  if (pid === undefined)
    return { begun: "Reported", report: { report: "Faulted" } };
  return setupSignInStarted(ports, site, pid);
}

/** Waits on a page for at most `waitSecs`, reading the note its listener leaves when it ends. */
async function setupSignInWaited(
  ports: SetupPorts,
  site: string,
  waiting: Extract<SetupSignInBegun, { readonly begun: "Waiting" }>,
  opened: SetupSignInOpened,
  waitSecs: number,
): Promise<SetupReport> {
  const polls = Math.ceil((waitSecs * 1_000) / setupSignInPollMs);
  for (let poll = 0; poll <= polls; poll += 1) {
    const alive = ports.process.alive(waiting.pid);
    const note = setupSignInNoteRead(ports.files);
    if (note?.note === "Ended") {
      ports.files.remove(setupFiles.signIn);
      return setupEndedReport(site, note.ended);
    }
    const listening = note?.pid === waiting.pid;
    if (!listening || !alive) {
      if (listening) ports.files.remove(setupFiles.signIn);
      return setupEndedReport(site, "Expired");
    }
    if (poll < polls) await ports.sleepMs(setupSignInPollMs);
  }
  return {
    report: "SignInWaiting",
    site,
    port: waiting.port,
    opened,
    waitedSecs: waitSecs,
  };
}

/**
 * The wait itself, after the lock is given up: a page this command started is
 * opened in a browser first, and one that cannot be opened is handed to the
 * person at once and waited on by the command that follows.
 */
export async function setupSignInAwaited(
  ports: SetupPorts,
  site: string,
  waiting: Extract<SetupSignInBegun, { readonly begun: "Waiting" }>,
  waitSecs: number,
): Promise<SetupReport> {
  if (!waiting.started)
    return setupSignInWaited(ports, site, waiting, "Attached", waitSecs);
  if (await setupSignInOpened(ports, waiting.port))
    return setupSignInWaited(ports, site, waiting, "Opened", waitSecs);
  return {
    report: "SignInWaiting",
    site,
    port: waiting.port,
    opened: "NotOpened",
    waitedSecs: 0,
  };
}

/** How an answer the issuer sent back reads before anything is spent on it: an ending, a code to exchange, or nothing of a sign-in's. */
function setupCallbackRead(
  search: string,
): "Declined" | "Refused" | "Code" | undefined {
  const query = new URLSearchParams(search);
  const refusal = query.get("error");
  if (refusal !== null)
    return refusal === "access_denied" ? "Declined" : "Refused";
  return query.get("code") === null || query.get("state") === null
    ? undefined
    : "Code";
}

/**
 * Exchanges the code and confirms what came of it, holding the lock from
 * before the exchange until the token it produced is written and has been used
 * once.
 */
async function setupCallbackExchanged(
  ports: SetupPorts,
  opened: SetupSessionOpened,
  heard: SetupHeard,
): Promise<SetupSignInEnded> {
  if (!(await setupLockTaken(ports, setupListenLockWaitMs))) return "Busy";
  try {
    const callback = await opened.holder.completeCallback({
      pathname: heard.path,
      search: heard.search,
    });
    if (callback.result !== "SignedIn")
      return opened.tokenAsked() === "Unasked"
        ? "Mismatched"
        : "ExchangeFailed";
    if (opened.store.read(sessionRefreshTokenKey) === null) return "NoRenewal";
    const workspaces = await setupWorkspacesRead(ports, opened);
    return workspaces.read === "Answered" ? "SignedIn" : "WorkspacesUnread";
  } finally {
    setupLockReleased(ports);
  }
}

const setupPages = {
  signedIn:
    "Signed in to chuggy. You can close this tab and go back to your terminal.",
  unfinished:
    "This sign-in did not finish. Close this tab and go back to your terminal.",
  answered: "This sign-in page has already been answered.",
  nothing: "There is nothing here.",
} as const;

function setupPage(status: number, text: string): SetupAnswered {
  return { status, text: `${text}\n` };
}

interface SetupListener {
  readonly ports: SetupPorts;
  readonly opened: SetupSessionOpened;
  readonly authorize: string;
  readonly decide: (ended: SetupSignInEnded) => void;
  deciding: boolean;
}

/** One request of the browser's: sent on to the issuer, read as its answer, or told there is nothing here. */
async function setupListenerAnswered(
  listener: SetupListener,
  heard: SetupHeard,
): Promise<SetupAnswered> {
  if (heard.method !== "GET") return setupPage(405, setupPages.nothing);
  if (heard.path === "/")
    return { status: 302, location: listener.authorize, text: "" };
  if (heard.path !== setupCallbackPath)
    return setupPage(404, setupPages.nothing);
  const read = setupCallbackRead(heard.search);
  if (read === undefined) return setupPage(400, setupPages.nothing);
  if (listener.deciding) return setupPage(409, setupPages.answered);
  listener.deciding = true;
  let ended: SetupSignInEnded = "Faulted";
  try {
    ended =
      read === "Code"
        ? await setupCallbackExchanged(listener.ports, listener.opened, heard)
        : read;
  } finally {
    listener.decide(ended);
  }
  return ended === "SignedIn"
    ? setupPage(200, setupPages.signedIn)
    : setupPage(400, setupPages.unfinished);
}

/** Leaves the ending where the listener's own note still stands, so a listener that was replaced writes over nobody. */
function setupListenerEnded(
  ports: SetupPorts,
  site: string,
  ended: SetupSignInEnded,
): void {
  const note = setupSignInNoteRead(ports.files);
  if (note?.note !== "Waiting" || note.pid !== ports.process.pid) return;
  setupSignInNoteWritten(ports.files, {
    note: "Ended",
    site,
    ended,
    endedAtMs: ports.nowMs(),
  });
}

interface SetupListenerOpened {
  readonly listener: SetupListener;
  readonly decided: Promise<SetupSignInEnded>;
}

/** A session that has started a sign-in returning to `port`, or nothing where the site would not start one. */
async function setupListenerOpened(
  ports: SetupPorts,
  site: string,
  port: number,
): Promise<SetupListenerOpened | undefined> {
  const opened = setupSessionOpened(ports, site, undefined, port);
  await opened.holder.load();
  if (opened.holder.snapshot().phase !== "SignedOut") return undefined;
  await opened.holder.signIn();
  const authorize = opened.authorize();
  if (authorize === undefined) return undefined;
  let decide: (ended: SetupSignInEnded) => void = () => undefined;
  const decided = new Promise<SetupSignInEnded>((resolve) => {
    decide = resolve;
  });
  return {
    listener: { ports, opened, authorize, decide, deciding: false },
    decided,
  };
}

/**
 * The listener's whole life: bind, start the sign-in, say where it listens,
 * and end on the first of an answer and its bound. An answer being read when
 * the bound passes is read to its end, so the note never says expired over a
 * sign-in that was written.
 */
export async function setupListened(
  ports: SetupPorts,
  site: string,
  lifeSecs: number,
): Promise<SetupReport> {
  let heardBy: SetupListener | undefined;
  const listening = await ports.listen(setupLoopbackHost, (heard) =>
    heardBy === undefined
      ? Promise.resolve(setupPage(503, setupPages.nothing))
      : setupListenerAnswered(heardBy, heard),
  );
  const life = new AbortController();
  try {
    const begun = await setupListenerOpened(ports, site, listening.port);
    const endsAtMs = ports.nowMs() + lifeSecs * 1_000;
    if (begun === undefined) {
      setupSignInNoteWritten(ports.files, {
        note: "Ended",
        site,
        ended: "SiteUnusable",
        endedAtMs: ports.nowMs(),
      });
      return setupEndedReport(site, "SiteUnusable");
    }
    heardBy = begun.listener;
    setupSignInNoteWritten(ports.files, {
      note: "Waiting",
      site,
      port: listening.port,
      pid: ports.process.pid,
      endsAtMs,
    });
    const expired = ports.sleepMs(lifeSecs * 1_000, life.signal).then(
      () => undefined,
      () => undefined,
    );
    const first = await Promise.race([begun.decided, expired]);
    const ended =
      first ?? (begun.listener.deciding ? await begun.decided : "Expired");
    begun.listener.deciding = true;
    setupListenerEnded(ports, site, ended);
    return setupEndedReport(site, ended);
  } finally {
    life.abort();
    await listening.close(setupListenCloseWaitMs);
  }
}
