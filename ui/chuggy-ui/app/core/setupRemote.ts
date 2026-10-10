/**
 * The repository the folder the setup program was run in was cloned from.
 *
 * Git is asked, because it alone knows what a checkout calls `origin`: a
 * worktree, a submodule and a rewritten address are all its to resolve. What
 * it prints is read as an address and kept as a host and a path only. A user,
 * a password or token before the host, a port, a query and a fragment are
 * dropped where the address is read, so nothing printed or compared after
 * this module could carry a credential the remote held. A path with an `@`
 * in it is read as no address at all, since what stands before an `@` is
 * where a credential is written. Outside a checkout, with no `origin`, with
 * no `git` to run, or with an address that names no host, there is no remote
 * and nothing is proposed from one.
 */

import type { SetupProcessPort } from "./setupPorts.ts";

/** What git is asked, in the folder the program was run in. */
export const setupRemoteCommand: readonly string[] = [
  "git",
  "remote",
  "get-url",
  "origin",
];

/** Far past what git takes to read its own configuration. */
export const setupRemoteWaitMs = 5_000;

/** Past any address of a repository. */
export const setupRemoteBytesMax = 4_096;

export interface SetupRemote {
  /** The host and the path, as a line names the repository. */
  readonly said: string;
  /** What two addresses of one repository have in common. */
  readonly key: string;
}

const setupRemoteSchemes: ReadonlySet<string> = new Set([
  "https:",
  "http:",
  "ssh:",
  "git:",
]);

/** `user@host:path`, the address git and a forge both write for SSH, which is no URL. */
const setupRemoteShort = /^(?:[^@/:\s]+@)?([^@/:\s]{2,}):(?!\/)(\S+)$/u;

function setupRemoteOf(host: string, path: string): SetupRemote | undefined {
  const within = path
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "");
  if (host === "" || within === "" || within.includes("@")) return undefined;
  const said = `${host.toLowerCase()}/${within}`;
  return { said, key: said.toLowerCase() };
}

/** An address of a repository as its host and path, or nothing where it is a path on this machine or no address at all. */
export function setupRepositoryRead(address: string): SetupRemote | undefined {
  const text = address.trim();
  if (text === "" || /\s/u.test(text)) return undefined;
  const short = setupRemoteShort.exec(text);
  if (short !== null) return setupRemoteOf(short[1] ?? "", short[2] ?? "");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  return setupRemoteSchemes.has(url.protocol)
    ? setupRemoteOf(url.hostname, url.pathname)
    : undefined;
}

/** The account that owns the repository an address names, where the address is a host, an owner and a name and no more: the account a credential to work in it is minted under. */
export function setupRepositoryOwner(address: string): string | undefined {
  const [, owner, name, ...more] =
    setupRepositoryRead(address)?.said.split("/") ?? [];
  return name === undefined || more.length > 0 ? undefined : owner;
}

/** What this folder's `origin` names, asked of git once and for a bounded time. */
export async function setupRemoteRead(
  process: SetupProcessPort,
): Promise<SetupRemote | undefined> {
  const printed = await process.read(
    setupRemoteCommand,
    setupRemoteWaitMs,
    setupRemoteBytesMax,
  );
  return printed === undefined ? undefined : setupRepositoryRead(printed);
}
