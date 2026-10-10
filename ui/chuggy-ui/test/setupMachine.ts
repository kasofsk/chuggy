/**
 * A whole machine and a whole installation for the setup program, with nothing
 * real in either, so a suite runs commands against them as a person's agent
 * would and plays the person's browser itself.
 *
 * The files are a map, the lock is one word, the clock moves only when a wait
 * is waited out, and a command the program starts again is run here as a
 * second set of ports over the same files, lock, clock and network: the
 * listener a sign-in leaves behind is
 * the real one, deciding beside the command that started it. The issuer hands
 * out a new renewal token for each one it is shown and ends the whole sign-in
 * when shown a spent one, which is what the real one does, and it publishes
 * where a token is revoked, so what a run sends there is seen.
 *
 * What `runner` meets of the machine is its `box`: the paths outside the
 * program's own directory and the programs it runs there.
 */

import type { ApiFetchInit } from "../app/core/apiRequest.ts";
import type {
  FetchJsonInit,
  FetchJsonResponse,
} from "../app/core/sessionHolder.ts";
import { SetupMachineError } from "../app/core/setupPorts.ts";
import type {
  SetupAnswered,
  SetupFile,
  SetupHeard,
  SetupLaunched,
  SetupPorts,
} from "../app/core/setupPorts.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import { setupRun } from "../app/core/setupRun.ts";
import { boxDisk, boxHome, boxRan, runnerBox } from "./setupRunnerBox.ts";
import type { RunnerBox } from "./setupRunnerBox.ts";
import { setupSiteAnswered, setupSiteAt } from "./setupSite.ts";
import type { SetupSite } from "./setupSite.ts";

export const machineSite = "https://chuggy.example";
export const machineIssuer = "https://auth.example";
export const machineAudience = "https://chuggy.example/api";
export const machineScript = `${boxHome}/chuggy-setup.mjs`;
export const machineDirectory = "~/.chuggy-setup";
/** The program's directory as the machine names it, which is how a path it would not write is said. */
export const machineKept = `${boxHome}/.chuggy-setup`;
/** The number the machine knows its user by. */
export const machineUser = "1000";

export const machineTokenAddress = `${machineIssuer}/oauth2/token`;
export const machineRevokeAddress = `${machineIssuer}/oauth2/revoke`;
const tokenAddress = machineTokenAddress;
const authorizeAddress = `${machineIssuer}/oauth2/auth`;

/** How a part of the installation answers: as it should, with a refusal, with a fault of its own, with nothing readable, or not at all. */
export type Answering = "Answers" | "Refuses" | "Fails" | "Garbles" | "Silent";

/** What becomes of a run the program starts for itself: it runs, it is gone before it says anything, it stays and says nothing, or it cannot be started. */
export type Spawning = "Runs" | "Dies" | "Mute" | "Unstarted";

interface Timer {
  readonly atMs: number;
  readonly fire: () => void;
}

export interface SetupMachine {
  /** The files by name, as the program wrote them. */
  readonly files: Map<SetupFile, string>;
  /** What the lock says: its holder's word, or nothing where it is free. */
  lock: string | undefined;
  /** Each file the program asked to have its unfinished writes removed, in order, and whether the machine removes them, given which ask it is. */
  readonly swept: SetupFile[];
  sweeps: (turn: number) => boolean;
  /** Each file room was asked for, in order, and whether the machine gives it, given which ask it is. */
  readonly reserved: SetupFile[];
  room: (turn: number) => boolean;
  /** Whether the machine takes a write of a file. */
  takes: (file: SetupFile) => boolean;
  nowMs: number;
  /** How the site's own configuration, the issuer's discovery, its token endpoint and the API answer. */
  site: Answering;
  discovery: Answering;
  token: Answering;
  api: Answering;
  /** Whether an exchange hands over a renewal token, which an allow page can withhold. */
  renewable: boolean;
  /** How long the issuer says each access token it hands out is good for. */
  accessSecs: number;
  /** Whether the API takes the tokens the issuer hands out, which a site whose audience changed does not. */
  admits: boolean;
  /** What happens as the API is sent a request, before it answers. */
  answering: () => void;
  /** What the site holds, which is what its reads answer. */
  world: SetupSite;
  /** What git prints of the folder's `origin`, or nothing where it has none to print. */
  remote: string | undefined;
  browser: string | undefined;
  platform: string;
  /** Where the person keeps their configuration, where they set that; and the paths and programs `runner` meets. */
  configHome: string | undefined;
  readonly box: RunnerBox;
  spawning: Spawning;
  /** What happens while a listener is closing, before it is gone. */
  closing: () => Promise<void>;
  /** The machine's digest, which a case replaces to say exactly where two digests differ. */
  digest: (message: Uint8Array) => Uint8Array;
  /** The octets handed over where the program asks for ones nobody could guess, given how many and which ask it is. */
  draws: (count: number, turn: number) => Uint8Array;
  /** What starting the opener answers, and what the person then does in the browser it opened. */
  opener: SetupLaunched;
  opened: (address: string) => Promise<void>;
  /** Every address asked through either network port, and every body sent. */
  readonly asked: string[];
  readonly bodies: string[];
  /** Every request of the site's API, as its method and address, and each address that was asked while the lock was held. */
  readonly sent: string[];
  readonly locked: string[];
  /** Each command the program ran to read what it printed. */
  readonly ran: (readonly string[])[];
  /** The arguments of each run the program started for itself, and of each command it launched. */
  readonly detached: (readonly string[])[];
  readonly launched: (readonly string[])[];
  /** The processes running now, a suite's own among them; a number that names no one process is answered as running, as a system answers for a group. */
  readonly alive: Set<number>;
  /** Every renewal token the issuer handed out, each it was asked to revoke, and the one it would accept now. */
  readonly issued: string[];
  readonly revoked: string[];
  readonly live: () => string | undefined;
  /** Ends every access token handed out so far, as their time running out does, and leaves the renewal token good. */
  readonly lapse: () => void;
  /** Runs one command to its report, waiting out every wait it makes. */
  readonly command: (argv: readonly string[]) => Promise<SetupReport>;
  /** The machine as a process of its own meets it, for what is asked of the ports and not of a command. */
  readonly ports: () => SetupPorts;
  /** Moves the clock, firing whatever was waiting on it. */
  readonly advance: (ms: number) => Promise<void>;
  /** The one listener's port, where one is listening. */
  readonly listening: () => number | undefined;
  /** One request of a browser's to the listener, a GET unless it says otherwise. */
  readonly browse: (address: string, method?: string) => Promise<SetupAnswered>;
  /** What the issuer does with an authorization address: the address it sends the browser back to. */
  readonly authorized: (address: string, allowed: boolean) => string;
  /** The person signing in: the listener's first page, the issuer, and back. */
  readonly person: (allowed?: boolean) => Promise<SetupAnswered>;
}

function json(status: number, body: unknown): FetchJsonResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

/** More timers than any command sets inside every bound the program has, so one that never ends fails a case instead of holding it. */
const machineStepsMax = 20_000;

function turn(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface Issuer {
  readonly codes: Map<string, string>;
  readonly issued: string[];
  live: string | undefined;
  minted: number;
  readonly access: Set<string>;
}

function issuerTokens(
  machine: SetupMachine,
  issuer: Issuer,
  renewable: boolean,
): FetchJsonResponse {
  issuer.minted += 1;
  const access = `access-${String(issuer.minted)}`;
  issuer.access.add(access);
  const expires_in = machine.accessSecs;
  if (!renewable) return json(200, { access_token: access, expires_in });
  const renewal = `renewal-${String(issuer.minted)}`;
  issuer.live = renewal;
  machine.issued.push(renewal);
  return json(200, {
    access_token: access,
    refresh_token: renewal,
    expires_in,
  });
}

/** The token endpoint: a code is exchanged once for the redirect it was given to, and a spent renewal token ends the chain. */
function issuerAnswered(
  machine: SetupMachine,
  issuer: Issuer,
  body: string,
): FetchJsonResponse {
  const form = new URLSearchParams(body);
  if (form.get("client_id") !== "chuggy-setup")
    return json(401, { error: "invalid_client" });
  if (form.get("grant_type") === "authorization_code") {
    const code = form.get("code") ?? "";
    const redirect = issuer.codes.get(code);
    issuer.codes.delete(code);
    return redirect !== undefined && redirect === form.get("redirect_uri")
      ? issuerTokens(machine, issuer, machine.renewable)
      : json(400, { error: "invalid_grant" });
  }
  if (form.get("refresh_token") !== issuer.live) {
    issuer.live = undefined;
    issuer.access.clear();
    return json(400, { error: "invalid_grant" });
  }
  return issuerTokens(machine, issuer, true);
}

function fetchJson(
  machine: SetupMachine,
  issuer: Issuer,
  url: string,
  init: FetchJsonInit,
): Promise<FetchJsonResponse> {
  machine.asked.push(url);
  if (init.body !== undefined) machine.bodies.push(init.body);
  const configuration = url.endsWith("/config.json");
  const granting = url === tokenAddress || url === machineRevokeAddress;
  const answering = configuration
    ? machine.site
    : granting
      ? machine.token
      : machine.discovery;
  if (answering === "Silent")
    return Promise.reject(new Error("no route to host"));
  if (answering === "Refuses")
    return Promise.resolve(json(granting ? 400 : 404, {}));
  if (answering === "Fails") return Promise.resolve(json(500, {}));
  if (answering === "Garbles") return Promise.resolve(json(200, {}));
  if (configuration)
    return Promise.resolve(
      json(200, {
        issuer: `${machineIssuer}/`,
        clientId: "chuggy-web",
        audience: machineAudience,
        redirectUri: `${machineSite}/auth/callback`,
        scopes: ["openid", "offline_access", "profile"],
      }),
    );
  if (url === tokenAddress)
    return Promise.resolve(issuerAnswered(machine, issuer, init.body ?? ""));
  if (url === machineRevokeAddress) {
    machine.revoked.push(new URLSearchParams(init.body).get("token") ?? "");
    return Promise.resolve(json(200, {}));
  }
  return Promise.resolve(
    json(200, {
      issuer: machineIssuer,
      authorization_endpoint: authorizeAddress,
      token_endpoint: tokenAddress,
      revocation_endpoint: machineRevokeAddress,
    }),
  );
}

/** What stands in for the answer to a write that never reached the site: one it does not admit, or one it is not answering. */
const unreached = { status: 401, body: {} } as const;

function apiFetch(
  machine: SetupMachine,
  issuer: Issuer,
  url: string,
  init: ApiFetchInit,
): Promise<Response> {
  machine.asked.push(url);
  machine.sent.push(`${init.method} ${url}`);
  if (machine.lock !== undefined) machine.locked.push(url);
  machine.answering();
  const body = typeof init.body === "string" ? init.body : undefined;
  const bearer = (init.headers["authorization"] ?? "").replace("Bearer ", "");
  const admitted = machine.admits && issuer.access.has(bearer);
  const reaches =
    init.method === "GET" || (admitted && machine.api === "Answers");
  const answer = !url.startsWith(`${machineSite}/`)
    ? undefined
    : reaches
      ? setupSiteAnswered(machine.world, url.slice(machineSite.length), {
          method: init.method,
          body,
        })
      : unreached;
  if (machine.api === "Silent")
    return Promise.reject(new Error("no route to host"));
  if (machine.api === "Refuses" || answer === undefined)
    return Promise.resolve(
      new Response("{}", { status: 503, headers: { "retry-after": "300" } }),
    );
  if (machine.api === "Fails")
    return Promise.resolve(new Response("{}", { status: 500 }));
  if (machine.api === "Garbles")
    return Promise.resolve(new Response("{}", { status: 200 }));
  return Promise.resolve(
    admitted
      ? new Response(JSON.stringify(answer.body), { status: answer.status })
      : new Response("{}", { status: 401 }),
  );
}

interface Inner {
  readonly machine: SetupMachine;
  readonly issuer: Issuer;
  readonly timers: Timer[];
  readonly listeners: Map<
    number,
    (heard: SetupHeard) => Promise<SetupAnswered>
  >;
  pids: number;
  drawn: number;
}

function slept(inner: Inner, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer: Timer = { atMs: inner.machine.nowMs + ms, fire: resolve };
    inner.timers.push(timer);
    signal?.addEventListener("abort", () => {
      const at = inner.timers.indexOf(timer);
      if (at >= 0) inner.timers.splice(at, 1);
      reject(new Error("the wait was abandoned"));
    });
  });
}

/** Fires the earliest wait due by `untilMs`, answering whether there was one; nothing is fired once `halted` says the work being waited on is over. */
async function fired(
  inner: Inner,
  untilMs: number,
  halted: () => boolean = () => false,
): Promise<boolean> {
  await turn();
  if (halted()) return false;
  const due = inner.timers
    .filter((timer) => timer.atMs <= untilMs)
    .sort((left, right) => left.atMs - right.atMs)[0];
  if (due === undefined) return false;
  inner.timers.splice(inner.timers.indexOf(due), 1);
  inner.machine.nowMs = Math.max(inner.machine.nowMs, due.atMs);
  due.fire();
  await turn();
  return true;
}

/** The double's digest: every octet, its place and the length move the answer, and nothing waits on a clock that is not the machine's. */
export function folded(message: Uint8Array): Uint8Array {
  const digest = new Uint8Array(32);
  let carried = message.length + 1;
  for (const [at, octet] of message.entries()) {
    carried = (carried * 31 + octet + at) % 65_521;
    const slot = at % digest.length;
    digest[slot] = ((digest[slot] ?? 0) + carried) % 256;
  }
  digest[0] = ((digest[0] ?? 0) + carried) % 256;
  return digest;
}

/** What a write that was cut short leaves beside a file, as this machine names it. */
export const machineDraftSuffix = ".draft";

/** What the files throw where the machine would not write: which path, as the real ones do. */
function unwritable(file: string): SetupMachineError {
  return new SetupMachineError({
    fault: "Unwritable",
    path: `${machineKept}/${file}`,
  });
}

function filesOf(machine: SetupMachine): SetupPorts["files"] {
  const { files } = machine;
  return {
    read: (file) => files.get(file),
    write: (file, text) => {
      if (!machine.takes(file)) throw unwritable(file);
      files.set(file, text);
    },
    reserve: (file) => {
      machine.reserved.push(file);
      if (!machine.room(machine.reserved.length)) throw unwritable(file);
    },
    remove: (file) => {
      files.delete(file);
    },
    sweep: (file) => {
      machine.swept.push(file);
      if (!machine.sweeps(machine.swept.length))
        throw unwritable(`${file}${machineDraftSuffix}`);
    },
  };
}

function lockOf(machine: SetupMachine): SetupPorts["lock"] {
  return {
    read: () => machine.lock,
    swap: (held, next) => {
      if (machine.lock !== held) return false;
      machine.lock = next;
      return true;
    },
  };
}

function portsOf(inner: Inner, pid: number): SetupPorts {
  const { machine, issuer } = inner;
  return {
    nowMs: () => machine.nowMs,
    sleepMs: (ms, signal) => slept(inner, ms, signal),
    drawBytes: (count) => {
      inner.drawn += 1;
      return machine.draws(count, inner.drawn);
    },
    digest: (message) => Promise.resolve(machine.digest(message)),
    fetchJson: (url, init) => fetchJson(machine, issuer, url, init),
    apiFetch: (url, init) => apiFetch(machine, issuer, url, init),
    files: filesOf(machine),
    lock: lockOf(machine),
    listen: (host, answer) => {
      if (host !== "127.0.0.1") throw new Error(`listened on ${host}`);
      const port = 41_000 + inner.listeners.size + pid;
      inner.listeners.set(port, answer);
      return Promise.resolve({
        port,
        close: async () => {
          await machine.closing();
          inner.listeners.delete(port);
        },
      });
    },
    process: {
      pid,
      alive: (asked) => asked <= 0 || machine.alive.has(asked),
      detach: (argv) => {
        machine.detached.push(argv);
        if (machine.spawning === "Unstarted") return undefined;
        if (machine.spawning === "Runs") return started(inner, argv).pid;
        inner.pids += 1;
        if (machine.spawning === "Mute") machine.alive.add(inner.pids);
        return inner.pids;
      },
      launch: async (command) => {
        machine.launched.push(command);
        if (machine.opener.launched !== "Unstarted")
          await machine.opened(command.at(-1) ?? "");
        return machine.opener;
      },
      read: (command) => {
        machine.ran.push(command);
        return Promise.resolve(
          command[0] === "npm" ? machine.box.prefix : machine.remote,
        );
      },
      run: (command) =>
        Promise.resolve(
          boxRan(
            machine.box,
            { site: () => machine.world, origin: machineSite },
            command,
          ),
        ),
    },
    disk: boxDisk(machine.box),
    surroundings: {
      platform: machine.platform,
      browser: machine.browser,
      directory: machineDirectory,
      home: boxHome,
      configHome: machine.configHome,
      user: machineUser,
    },
  };
}

/** One run of the program as a process of its own, alive until it reports. */
function started(
  inner: Inner,
  argv: readonly string[],
): { readonly pid: number; readonly report: Promise<SetupReport> } {
  inner.pids += 1;
  const pid = inner.pids;
  inner.machine.alive.add(pid);
  const report = setupRun(portsOf(inner, pid), argv).finally(() => {
    inner.machine.alive.delete(pid);
  });
  return { pid, report };
}

async function settled<T>(inner: Inner, work: Promise<T>): Promise<T> {
  let done = false;
  const marked = work.finally(() => {
    done = true;
  });
  marked.catch(() => undefined);
  const halted = (): boolean => done;
  for (let step = 0; step < machineStepsMax && !done; step += 1)
    if (!(await fired(inner, Number.POSITIVE_INFINITY, halted)) && !done)
      throw new Error("the command waits on nothing that will ever happen");
  if (!done) throw new Error("the command outlived every bound it has");
  return work;
}

function authorized(issuer: Issuer, address: string, allowed: boolean): string {
  const asked = new URL(address);
  const redirect = asked.searchParams.get("redirect_uri") ?? "";
  const state = asked.searchParams.get("state") ?? "";
  if (!allowed) return `${redirect}?error=access_denied&state=${state}`;
  const code = `code-${String(issuer.codes.size + issuer.minted + 1)}`;
  issuer.codes.set(code, redirect);
  return `${redirect}?code=${code}&state=${state}`;
}

function browsed(
  inner: Inner,
  address: string,
  method = "GET",
): Promise<SetupAnswered> {
  const url = new URL(address);
  const answer = inner.listeners.get(Number(url.port));
  if (answer === undefined)
    return Promise.reject(new Error(`nothing listens at ${address}`));
  return answer({ method, path: url.pathname, search: url.search });
}

async function person(inner: Inner, allowed: boolean): Promise<SetupAnswered> {
  const port = inner.machine.listening();
  const first = await browsed(inner, `http://127.0.0.1:${String(port)}/`);
  return browsed(
    inner,
    authorized(inner.issuer, first.location ?? "", allowed),
  );
}

const issuerNew = (): Issuer => ({
  codes: new Map(),
  issued: [],
  live: undefined,
  minted: 0,
  access: new Set(),
});

export function setupMachine(): SetupMachine {
  const issuer = issuerNew();
  const machine: SetupMachine = {
    files: new Map(),
    lock: undefined,
    swept: [],
    sweeps: () => true,
    reserved: [],
    room: () => true,
    takes: () => true,
    nowMs: 1_000_000,
    site: "Answers",
    discovery: "Answers",
    token: "Answers",
    api: "Answers",
    renewable: true,
    accessSecs: 600,
    admits: true,
    answering: () => undefined,
    world: setupSiteAt("Workspace"),
    remote: undefined,
    browser: undefined,
    platform: "linux",
    configHome: undefined,
    box: runnerBox(),
    spawning: "Runs",
    closing: () => Promise.resolve(),
    digest: folded,
    draws: (count, turn) => new Uint8Array(count).fill(turn),
    opener: { launched: "Ended", exit: 0 },
    opened: () => Promise.resolve(),
    asked: [],
    bodies: [],
    sent: [],
    locked: [],
    ran: [],
    detached: [],
    launched: [],
    alive: new Set(),
    issued: issuer.issued,
    revoked: [],
    live: () => issuer.live,
    lapse: () => {
      issuer.access.clear();
    },
    command: (argv) => settled(inner, started(inner, argv).report),
    ports: () => portsOf(inner, inner.pids),
    advance: async (ms) => {
      const untilMs = machine.nowMs + ms;
      for (let step = 0; step < machineStepsMax; step += 1)
        if (!(await fired(inner, untilMs))) break;
      machine.nowMs = untilMs;
    },
    listening: () => [...inner.listeners.keys()][0],
    browse: (address, method) => browsed(inner, address, method),
    authorized: (address, allowed) => authorized(issuer, address, allowed),
    person: (allowed = true) => person(inner, allowed),
  };
  const inner: Inner = {
    machine,
    issuer,
    timers: [],
    listeners: new Map(),
    pids: 100,
    drawn: 0,
  };
  return machine;
}

/** A machine already signed in to a site holding `world`, as a sign-in the person finished leaves it, with nothing yet recorded as asked. */
export async function machineSignedIn(
  world: SetupSite = setupSiteAt("Workspace"),
): Promise<SetupMachine> {
  const machine = setupMachine();
  machine.world = world;
  machine.opened = async () => {
    await machine.person();
  };
  await machine.command(["sign-in", "--site", machineSite]);
  machine.opened = () => Promise.resolve();
  for (const recorded of [
    machine.asked,
    machine.bodies,
    machine.sent,
    machine.locked,
    machine.ran,
    machine.reserved,
    machine.swept,
  ])
    recorded.length = 0;
  return machine;
}
