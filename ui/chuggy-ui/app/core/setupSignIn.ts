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
 * An answer is one that carries the state this sign-in sent. A request's
 * method and path are read first and say only which page is being asked for,
 * so neither ends the sign-in nor spends anything. Of what is asked of the
 * answer's own path the state is checked before anything else is read, a
 * refusal as much as a code, so nothing else on the machine that reaches the
 * port can end the sign-in or spend what it holds: such a request is told
 * there is nothing here and the page goes on waiting. A sign-in that sent no
 * state has none to compare, and takes no request for its answer.
 *
 * How a page ended is reported once by a `sign-in`. Every ending but a
 * sign-in is then kept, because nothing is run after one until the person
 * asks: the bare command goes on saying it until a `sign-in` opens another
 * page, so an agent that asks where things stand is not sent to open one.
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
import { setupSignInHeld } from "./setupReport.ts";
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
  setupLockWaitMs,
  setupSessionRead,
  setupSignInNoteRead,
  setupSignInNoteWritten,
} from "./setupStore.ts";
import type { SetupSignInNote } from "./setupStore.ts";

type SetupSignInEndedNote = Extract<
  SetupSignInNote,
  { readonly note: "Ended" }
>;

export const setupSignInPollMs = 250;

/** How long a listener just started has to say where it listens. */
export const setupSignInStartSecsMax = 20;

/** How long an opener is watched before it is taken to have opened something. */
export const setupOpenerWaitMs = 3_000;

/** How long after a sign-in ended with nobody waiting a `sign-in` still reports its ending before it opens another page. */
export const setupSignInKeptSecs = 600;

/** How far past its own end a listener's note is still believed. */
export const setupSignInGraceSecs = 30;

/** How long a listener waits for the lock when an answer arrives while a command holds it. */
export const setupListenLockWaitMs = 30_000;

/** How long an answer under way is given to reach the browser once the listener is closing. */
export const setupListenCloseWaitMs = 2_000;

/** What `sign-in` finds of an earlier one for this site: a page still waiting, an ending no `sign-in` has reported, or nothing. */
export type SetupSignInFound =
  | { readonly found: "Waiting"; readonly port: number; readonly pid: number }
  | { readonly found: "Ended"; readonly note: SetupSignInEndedNote }
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
  return kept && !note.told && note.ended !== "SignedIn"
    ? { found: "Ended", note }
    : { found: "None" };
}

/** How the last sign-in for this site ended, where that ending is one that stands: what the bare command says in place of naming `sign-in`. */
export function setupSignInStood(
  note: SetupSignInNote | undefined,
  site: string,
): SetupSignInEnded | undefined {
  if (note?.note !== "Ended" || note.site !== site) return undefined;
  return setupSignInHeld(note.ended) ? note.ended : undefined;
}

/**
 * Leaves an ending a `sign-in` is reporting: kept and marked as told where it
 * stands, dropped where it does not. The caller holds the lock, so no page is
 * being started whose note this would write over.
 */
function setupSignInSaid(ports: SetupPorts, note: SetupSignInEndedNote): void {
  if (setupSignInHeld(note.ended))
    setupSignInNoteWritten(ports.files, { ...note, told: true });
  else ports.files.remove(setupFiles.signIn);
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

/** A page that could not be started, or never said where it listens; its site is remembered by then. */
const setupUnstarted: SetupReport = {
  report: "Faulted",
  asked: "SignIn",
  site: undefined,
  fault: { fault: "Unstarted" },
};

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
      setupSignInSaid(ports, note);
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
  return { begun: "Reported", report: setupUnstarted };
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
  if (found.found === "Ended") {
    setupSignInSaid(ports, found.note);
    return {
      begun: "Reported",
      report: setupEndedReport(site, found.note.ended),
    };
  }
  ports.files.remove(setupFiles.signIn);
  const pid = ports.process.detach(
    setupListenArguments(site, setupListenSecsDefault),
  );
  if (pid === undefined) return { begun: "Reported", report: setupUnstarted };
  return setupSignInStarted(ports, site, pid);
}

/**
 * Reports how the page a command waited on ended, and leaves that ending as
 * said. The wait holds no lock, so the lock is taken for this and the note is
 * read again under it: what is rewritten is the ending this wait read, or the
 * note of the listener it watched go, and never a page started since.
 */
async function setupSignInHeard(
  ports: SetupPorts,
  site: string,
  pid: number,
  ended: SetupSignInEnded,
): Promise<SetupReport> {
  if (await setupLockTaken(ports, setupLockWaitMs))
    try {
      const note = setupSignInNoteRead(ports.files);
      if (note?.note === "Ended") {
        if (note.site === site && note.ended === ended)
          setupSignInSaid(ports, note);
      } else if (note === undefined || note.pid === pid)
        setupSignInSaid(ports, {
          note: "Ended",
          site,
          ended,
          endedAtMs: ports.nowMs(),
          told: false,
        });
    } finally {
      setupLockReleased(ports);
    }
  return setupEndedReport(site, ended);
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
    if (note?.note === "Ended")
      return setupSignInHeard(ports, site, waiting.pid, note.ended);
    if (note?.pid !== waiting.pid || !alive)
      return setupSignInHeard(ports, site, waiting.pid, "Expired");
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

/** How an answer that is this sign-in's reads before anything is spent on it: an ending, a code to exchange, or neither. */
function setupCallbackRead(
  query: URLSearchParams,
): "Declined" | "Refused" | "Code" | undefined {
  const refusal = query.get("error");
  if (refusal !== null)
    return refusal === "access_denied" ? "Declined" : "Refused";
  return query.get("code") === null ? undefined : "Code";
}

/** What a sign-in the issuer exchanged comes to: a renewal token must have come with it, and the site must then answer as that person. */
async function setupExchangeConfirmed(
  opened: SetupSessionOpened,
): Promise<SetupSignInEnded> {
  if (opened.store.read(sessionRefreshTokenKey) === null) return "NoRenewal";
  const workspaces = await setupWorkspacesRead(opened);
  if (workspaces.read === "Answered") return "SignedIn";
  return workspaces.outcome === "Unauthenticated"
    ? "SiteRefused"
    : "WorkspacesUnread";
}

/**
 * Exchanges the code and confirms what came of it, holding the lock from
 * before the exchange until the token it produced is written and has been used
 * once. A page whose site is no longer the one remembered exchanges nothing,
 * because what it wrote would replace another site's sign-in.
 */
async function setupCallbackExchanged(
  ports: SetupPorts,
  opened: SetupSessionOpened,
  heard: SetupHeard,
): Promise<SetupSignInEnded> {
  if (!(await setupLockTaken(ports, setupListenLockWaitMs))) return "Busy";
  try {
    if (setupSessionRead(ports.files)?.site !== opened.site)
      return "SiteChanged";
    const callback = await opened.holder.completeCallback({
      pathname: heard.path,
      search: heard.search,
    });
    if (callback.result === "SignedIn")
      return await setupExchangeConfirmed(opened);
    return opened.tokenAsked() === "Unasked" ? "Mismatched" : "ExchangeFailed";
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
  /** The state this sign-in sent, which only its own answer brings back, or nothing where it sent none. */
  readonly state: string | undefined;
  readonly decide: (ended: SetupSignInEnded) => void;
  deciding: boolean;
}

/**
 * Whether a request carries the state this sign-in sent, which nothing does
 * where it sent none. Both are digested and every octet of the two digests is
 * compared, so how long the answer takes says nothing of how nearly a guess
 * matched.
 */
async function setupStateMatched(
  listener: SetupListener,
  given: string | null,
): Promise<boolean> {
  if (listener.state === undefined) return false;
  const octets = new TextEncoder();
  const [sent, came] = await Promise.all([
    listener.ports.digest(octets.encode(listener.state)),
    listener.ports.digest(octets.encode(given ?? "")),
  ]);
  let differing = sent.length ^ came.length;
  for (const [at, octet] of sent.entries())
    differing |= octet ^ (came[at] ?? 0);
  return differing === 0;
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
  const query = new URLSearchParams(heard.search);
  if (!(await setupStateMatched(listener, query.get("state"))))
    return setupPage(400, setupPages.nothing);
  const read = setupCallbackRead(query);
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
    told: false,
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
  const sent = new URL(authorize).searchParams.get("state");
  const state = sent === null || sent === "" ? undefined : sent;
  let decide: (ended: SetupSignInEnded) => void = () => undefined;
  const decided = new Promise<SetupSignInEnded>((resolve) => {
    decide = resolve;
  });
  return {
    listener: { ports, opened, authorize, state, decide, deciding: false },
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
        told: false,
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
