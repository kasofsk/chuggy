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
import { isAbsolute, join } from "node:path";
import { setTimeout as slept } from "node:timers/promises";

import type { ApiFetchInit } from "../app/core/apiRequest.ts";
import type { FetchJsonPort } from "../app/core/sessionHolder.ts";
import { setupPacingRead } from "../app/core/setupPacing.ts";
import type { SetupPacing } from "../app/core/setupPacing.ts";
import {
  signInStoreDirectory,
  signInStorePlatforms,
} from "../../../src/contract/signInStore.ts";
import type { SignInStorePlatform } from "../../../src/contract/signInStore.ts";
import {
  SetupMachineError,
  setupDirectoryName,
} from "../app/core/setupPorts.ts";
import type { SetupPorts } from "../app/core/setupPorts.ts";
import { setupFetchTimeoutMs } from "../app/core/setupSession.ts";
import { disk } from "./disk.ts";
import { filesIn, storeIn } from "./files.ts";
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

/**
 * The person's home as the machine names it, or nothing where it names none.
 * A name that is not a whole path is none: under one the sign-in would be kept
 * in whatever folder the program happened to be run in.
 */
export function homeOf(named: () => string): string | undefined {
  try {
    const home = named();
    return isAbsolute(home) ? home : undefined;
  } catch {
    return undefined;
  }
}

function homeless(): never {
  throw new SetupMachineError({ fault: "Homeless" });
}

const homelessFiles = {
  read: homeless,
  write: homeless,
  reserve: homeless,
  remove: homeless,
  sweep: homeless,
};

/** The files, the store and the lock of a machine that names no home, or of a platform the store is not defined on: nothing is read and nothing kept, and each says why. */
const nowhere: Pick<SetupPorts, "files" | "store" | "lock"> = {
  files: homelessFiles,
  store: homelessFiles,
  lock: { read: homeless, swap: homeless },
};

function storePlatform(platform: string): SignInStorePlatform | undefined {
  return signInStorePlatforms.find((named) => named === platform);
}

/** The shared sign-in store's directory on this machine, or nothing where it has no home or the store is not defined on its platform. */
function storeOf(home: string | undefined): string | undefined {
  const platform = storePlatform(process.platform);
  return home === undefined || platform === undefined
    ? undefined
    : signInStoreDirectory({
        platform,
        home,
        configHome: process.env["XDG_CONFIG_HOME"],
      });
}

function keptIn(
  home: string,
  store: string,
): Pick<SetupPorts, "files" | "store" | "lock"> {
  return {
    files: filesIn(join(home, setupDirectoryName)),
    store: storeIn(store),
    lock: lockIn(store),
  };
}

/** A path as a person would write it: under `~` where it is in their home. */
function saidFrom(home: string | undefined, path: string): string {
  return home !== undefined && path.startsWith(`${home}/`)
    ? join("~", path.slice(home.length + 1))
    : path;
}

/** The variable a suite that runs this program names a quicker pacing in. */
export const pacingVariable = "CHUG_SETUP_PACING";

/** The pacing this run's environment names, which is the program's own wherever it names none. */
export function pacingOf(): SetupPacing {
  return setupPacingRead(process.env[pacingVariable]);
}

/** `script` is the file this program was run from, which a sign-in runs again. */
export function portsOf(script: string): SetupPorts {
  const home = homeOf(homedir);
  const store = storeOf(home);
  return {
    ...(home === undefined || store === undefined
      ? nowhere
      : keptIn(home, store)),
    nowMs: () => Date.now(),
    sleepMs: (ms, signal) => slept(ms, undefined, { signal }),
    drawBytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
    digest,
    fetchJson: fetchJsonWithin(setupFetchTimeoutMs),
    apiFetch,
    listen,
    process: processesOf(script),
    disk,
    surroundings: {
      platform: process.platform,
      browser: process.env["BROWSER"],
      directory: saidFrom(home, store ?? join("~", setupDirectoryName)),
      folder: process.cwd(),
      home,
      configHome: process.env["XDG_CONFIG_HOME"],
      claudeHome: process.env["CLAUDE_CONFIG_DIR"],
      user: process.getuid === undefined ? undefined : String(process.getuid()),
    },
  };
}
