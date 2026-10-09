/**
 * A whole machine and a whole installation for the setup program, with nothing
 * real in either, so a suite runs commands against them as a person's agent
 * would and plays the person's browser itself.
 *
 * The files are a map, the clock moves only when a wait is waited out, and a
 * command the program starts again is run here as a second set of ports over
 * the same files, clock and network: the listener a sign-in leaves behind is
 * the real one, deciding beside the command that started it. The issuer hands
 * out a new renewal token for each one it is shown and ends the whole sign-in
 * when shown a spent one, which is what the real one does.
 */

import {
  accessCallerTenantsSchema,
  accessPlanePath,
} from "../../../src/contract/accessPlane.ts";
import { apiRead } from "../app/core/apiRequest.ts";
import type { ApiFetchInit } from "../app/core/apiRequest.ts";
import type {
  FetchJsonInit,
  FetchJsonResponse,
} from "../app/core/sessionHolder.ts";
import type {
  SetupAnswered,
  SetupFile,
  SetupHeard,
  SetupLaunched,
  SetupPorts,
} from "../app/core/setupPorts.ts";
import type { SetupReport } from "../app/core/setupReport.ts";
import { setupRun } from "../app/core/setupRun.ts";

export const machineSite = "https://chuggy.example";
export const machineIssuer = "https://auth.example";
export const machineAudience = "https://chuggy.example/api";
export const machineScript = "/home/person/chuggy-setup.mjs";
export const machineDirectory = "~/.chuggy-setup";

const tokenAddress = `${machineIssuer}/oauth2/token`;
const authorizeAddress = `${machineIssuer}/oauth2/auth`;
const workspacesAddress = `${machineSite}/access/v1/workspaces`;

/** How a part of the installation answers: as it should, with a refusal, or not at all. */
export type Answering = "Answers" | "Refuses" | "Silent";

export interface MachineTenant {
  readonly tenant: string;
  readonly roles: readonly string[];
  readonly administer: boolean;
}

interface Timer {
  readonly atMs: number;
  readonly fire: () => void;
}

export interface SetupMachine {
  /** The files by name, as the program wrote them. */
  readonly files: Map<SetupFile, string>;
  nowMs: number;
  /** How the site's own configuration, the issuer's discovery, its token endpoint and the API answer. */
  site: Answering;
  discovery: Answering;
  token: Answering;
  api: Answering;
  /** Whether an exchange hands over a renewal token, which an allow page can withhold. */
  renewable: boolean;
  tenants: readonly MachineTenant[];
  browser: string | undefined;
  platform: string;
  /** What starting the opener answers, and what the person then does in the browser it opened. */
  opener: SetupLaunched;
  opened: (address: string) => Promise<void>;
  /** Every address asked through either network port, and every body sent. */
  readonly asked: string[];
  readonly bodies: string[];
  /** The arguments of each run the program started for itself, and of each command it launched. */
  readonly detached: (readonly string[])[];
  readonly launched: (readonly string[])[];
  /** The processes running now, a suite's own among them. */
  readonly alive: Set<number>;
  /** Every renewal token the issuer handed out, and the one it would accept now. */
  readonly issued: string[];
  readonly live: () => string | undefined;
  /** Runs one command to its report, waiting out every wait it makes. */
  readonly command: (argv: readonly string[]) => Promise<SetupReport>;
  /** Moves the clock, firing whatever was waiting on it. */
  readonly advance: (ms: number) => Promise<void>;
  /** The one listener's port, where one is listening. */
  readonly listening: () => number | undefined;
  /** One request of a browser's to the listener. */
  readonly browse: (address: string) => Promise<SetupAnswered>;
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
  if (!renewable) return json(200, { access_token: access, expires_in: 600 });
  const renewal = `renewal-${String(issuer.minted)}`;
  issuer.live = renewal;
  machine.issued.push(renewal);
  return json(200, {
    access_token: access,
    refresh_token: renewal,
    expires_in: 600,
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
  const answering =
    url === `${machineSite}/config.json`
      ? machine.site
      : url === tokenAddress
        ? machine.token
        : machine.discovery;
  if (answering === "Silent")
    return Promise.reject(new Error("no route to host"));
  if (answering === "Refuses")
    return Promise.resolve(json(url === tokenAddress ? 400 : 404, {}));
  if (url === `${machineSite}/config.json`)
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
  return Promise.resolve(
    json(200, {
      issuer: machineIssuer,
      authorization_endpoint: authorizeAddress,
      token_endpoint: tokenAddress,
    }),
  );
}

function apiFetch(
  machine: SetupMachine,
  issuer: Issuer,
  url: string,
  init: ApiFetchInit,
): Promise<Response> {
  machine.asked.push(url);
  if (machine.api === "Silent")
    return Promise.reject(new Error("no route to host"));
  if (machine.api === "Refuses" || url !== workspacesAddress)
    return Promise.resolve(
      new Response("{}", { status: 503, headers: { "retry-after": "300" } }),
    );
  const bearer = (init.headers["authorization"] ?? "").replace("Bearer ", "");
  return Promise.resolve(
    issuer.access.has(bearer)
      ? new Response(
          JSON.stringify({ tenants: machine.tenants, truncated: false }),
          { status: 200 },
        )
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

/** Fires the earliest wait due by `untilMs`, answering whether there was one. */
async function fired(inner: Inner, untilMs: number): Promise<boolean> {
  await turn();
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

function filesOf(files: Map<SetupFile, string>): SetupPorts["files"] {
  return {
    read: (file) => files.get(file),
    write: (file, text) => {
      files.set(file, text);
    },
    create: (file, text) => {
      if (files.has(file)) return false;
      files.set(file, text);
      return true;
    },
    remove: (file) => {
      files.delete(file);
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
      return new Uint8Array(count).fill(inner.drawn);
    },
    digest: (message) => Promise.resolve(message.slice(0, 32)),
    fetchJson: (url, init) => fetchJson(machine, issuer, url, init),
    apiFetch: (url, init) => apiFetch(machine, issuer, url, init),
    files: filesOf(machine.files),
    listen: (host, answer) => {
      if (host !== "127.0.0.1") throw new Error(`listened on ${host}`);
      const port = 41_000 + inner.listeners.size + pid;
      inner.listeners.set(port, answer);
      return Promise.resolve({
        port,
        close: () => {
          inner.listeners.delete(port);
          return Promise.resolve();
        },
      });
    },
    process: {
      pid,
      alive: (asked) => machine.alive.has(asked),
      detach: (argv) => {
        machine.detached.push(argv);
        return started(inner, argv).pid;
      },
      launch: async (command) => {
        machine.launched.push(command);
        if (machine.opener.launched !== "Unstarted")
          await machine.opened(command.at(-1) ?? "");
        return machine.opener;
      },
    },
    surroundings: {
      platform: machine.platform,
      browser: machine.browser,
      directory: machineDirectory,
    },
    callerTenants: (api) =>
      apiRead(
        api,
        { method: "GET", path: accessPlanePath("callerTenants", {}) },
        (value) => accessCallerTenantsSchema.parse(value),
      ),
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
  for (let step = 0; step < 100_000 && !done; step += 1)
    if (!(await fired(inner, Number.POSITIVE_INFINITY)) && !done)
      throw new Error("the command waits on nothing that will ever happen");
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

function browsed(inner: Inner, address: string): Promise<SetupAnswered> {
  const url = new URL(address);
  const answer = inner.listeners.get(Number(url.port));
  if (answer === undefined)
    return Promise.reject(new Error(`nothing listens at ${address}`));
  return answer({ method: "GET", path: url.pathname, search: url.search });
}

async function person(inner: Inner, allowed: boolean): Promise<SetupAnswered> {
  const port = inner.machine.listening();
  const first = await browsed(inner, `http://127.0.0.1:${String(port)}/`);
  return browsed(
    inner,
    authorized(inner.issuer, first.location ?? "", allowed),
  );
}

export function setupMachine(): SetupMachine {
  const issuer: Issuer = {
    codes: new Map(),
    issued: [],
    live: undefined,
    minted: 0,
    access: new Set(),
  };
  const machine: SetupMachine = {
    files: new Map(),
    nowMs: 1_000_000,
    site: "Answers",
    discovery: "Answers",
    token: "Answers",
    api: "Answers",
    renewable: true,
    tenants: [
      { tenant: "acme", roles: ["Admin"], administer: true },
      { tenant: "guest", roles: ["Member"], administer: false },
    ],
    browser: undefined,
    platform: "linux",
    opener: { launched: "Ended", exit: 0 },
    opened: () => Promise.resolve(),
    asked: [],
    bodies: [],
    detached: [],
    launched: [],
    alive: new Set(),
    issued: issuer.issued,
    live: () => issuer.live,
    command: (argv) => settled(inner, started(inner, argv).report),
    advance: async (ms) => {
      const untilMs = machine.nowMs + ms;
      for (let step = 0; step < 100_000; step += 1)
        if (!(await fired(inner, untilMs))) break;
      machine.nowMs = untilMs;
    },
    listening: () => [...inner.listeners.keys()][0],
    browse: (address) => browsed(inner, address),
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
