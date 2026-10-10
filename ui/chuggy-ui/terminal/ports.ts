/**
 * The machine the setup program runs on, as the ports its decisions take.
 *
 * Every ambient thing the program touches under Node is spelled here or in
 * the module beside this one that it is composed from, so
 * `ui/chuggy-ui/app/core/` names none of them. Nothing here decides anything:
 * a request follows no redirect, a JSON request is abandoned at the bound it
 * was built with, and every name, number and word comes from the caller.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as slept } from "node:timers/promises";

import type { ApiFetchInit } from "../app/core/apiRequest.ts";
import type { FetchJsonPort } from "../app/core/sessionHolder.ts";
import { setupDirectoryName } from "../app/core/setupPorts.ts";
import type { SetupPorts } from "../app/core/setupPorts.ts";
import { setupFetchTimeoutMs } from "../app/core/setupSession.ts";
import { filesIn } from "./files.ts";
import { listen } from "./listener.ts";
import { lockIn } from "./lock.ts";
import { processesOf } from "./processes.ts";

export function apiFetch(url: string, init: ApiFetchInit): Promise<Response> {
  return fetch(url, { ...init, redirect: "error" });
}

/** The port carries no signal, so the bound on a request is the adapter's to bring. */
export function fetchJsonWithin(timeoutMs: number): FetchJsonPort {
  return (url, init) =>
    fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
}

async function digest(message: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", message));
}

/** `script` is the file this program was run from, which a sign-in runs again. */
export function portsOf(script: string): SetupPorts {
  const directory = join(homedir(), setupDirectoryName);
  return {
    nowMs: () => Date.now(),
    sleepMs: (ms, signal) => slept(ms, undefined, { signal }),
    drawBytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
    digest,
    fetchJson: fetchJsonWithin(setupFetchTimeoutMs),
    apiFetch,
    files: filesIn(directory),
    lock: lockIn(directory),
    listen,
    process: processesOf(script),
    surroundings: {
      platform: process.platform,
      browser: process.env["BROWSER"],
      directory: join("~", setupDirectoryName),
    },
  };
}
