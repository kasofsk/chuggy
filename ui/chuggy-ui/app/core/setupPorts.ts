/**
 * What the setup program needs of the machine it runs on, each a port the
 * terminal implements and a suite fakes.
 *
 * The files are the program's own, in a directory of the person's that nothing
 * else reads: the remembered sign-in, the lock a run holds while it uses it,
 * and the note a sign-in page in flight leaves for the command waiting on it.
 * They are read and written whole and at once, because the session holder's
 * store is synchronous.
 */

import type { ApiFetchPort } from "./apiRequest.ts";
import type { PkceDigestPort } from "./pkce.ts";
import type { FetchJsonPort } from "./sessionHolder.ts";

/** The directory in the person's home that holds the program's files. */
export const setupDirectoryName = ".chuggy-setup";

export const setupFiles = {
  session: "session.json",
  signIn: "sign-in.json",
  lock: "lock",
} as const;

export type SetupFile = (typeof setupFiles)[keyof typeof setupFiles];

export interface SetupFilesPort {
  /** The file's text, or nothing where there is no such file. */
  readonly read: (file: SetupFile) => string | undefined;
  /** Replaces the file whole, so a reader finds the old text or the new and never part of either. */
  readonly write: (file: SetupFile, text: string) => void;
  /** Makes the file where there is none, answering whether this call made it. */
  readonly create: (file: SetupFile, text: string) => boolean;
  readonly remove: (file: SetupFile) => void;
}

/** One request a browser on this machine made of the program. */
export interface SetupHeard {
  readonly method: string;
  readonly path: string;
  readonly search: string;
}

/** What the browser is answered: a page of plain text, or somewhere else to go. */
export interface SetupAnswered {
  readonly status: number;
  readonly location?: string;
  readonly text: string;
}

export interface SetupListening {
  readonly port: number;
  /** Stops listening, giving an answer under way at most `waitMs` to be sent. */
  readonly close: (waitMs: number) => Promise<void>;
}

/** Listens on `host` at a port the machine picks, answering each request with what `answer` decides. */
export type SetupListenPort = (
  host: string,
  answer: (heard: SetupHeard) => Promise<SetupAnswered>,
) => Promise<SetupListening>;

/** How a command that was run ended: not started, still running after the wait, or ended with its exit. */
export type SetupLaunched =
  | { readonly launched: "Unstarted" }
  | { readonly launched: "Running" }
  | { readonly launched: "Ended"; readonly exit: number };

export interface SetupProcessPort {
  /** This run's own identity among the machine's processes. */
  readonly pid: number;
  readonly alive: (pid: number) => boolean;
  /** Starts this program again with these arguments, outliving this run, and answers the identity it started under. */
  readonly detach: (argv: readonly string[]) => number | undefined;
  /** Runs a command of the machine's, waiting at most `waitMs` for it to end. */
  readonly launch: (
    command: readonly string[],
    waitMs: number,
  ) => Promise<SetupLaunched>;
}

/** Where the program is running, as plain facts read once at its start. */
export interface SetupSurroundings {
  readonly platform: string;
  /** The command the person has named for opening an address, where they named one. */
  readonly browser: string | undefined;
  /** The program's own directory, as a person would write it. */
  readonly directory: string;
}

export interface SetupPorts {
  readonly nowMs: () => number;
  readonly sleepMs: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly drawBytes: (count: number) => Uint8Array;
  readonly digest: PkceDigestPort;
  /** Asks an absolute address for JSON, within a bound of the port's own. */
  readonly fetchJson: FetchJsonPort;
  /** Sends one request to an absolute address. */
  readonly apiFetch: ApiFetchPort;
  readonly files: SetupFilesPort;
  readonly listen: SetupListenPort;
  readonly process: SetupProcessPort;
  readonly surroundings: SetupSurroundings;
}
