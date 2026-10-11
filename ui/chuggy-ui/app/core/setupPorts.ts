/**
 * What the setup program needs of the machine it runs on, each a port the
 * terminal implements and a suite fakes.
 *
 * The files are the program's own, in a directory of the person's that nothing
 * else reads: the remembered sign-in, and the note a sign-in page in flight
 * leaves for the command waiting on it. They are read and written whole and at
 * once, because the session holder's store is synchronous. The lock a run
 * holds while it uses the remembered sign-in is beside them and is not a file
 * to read and write: it is one word, changed only by a call that names what it
 * says now.
 *
 * The runner command needs more of the machine than files of its own: other
 * programs run to their end and read on both streams, and paths that are the
 * runner package's, probed and at most made where there was nothing. Neither
 * port keeps anything of the program's.
 */

import type { ApiFetchPort } from "./apiRequest.ts";
import type { PkceDigestPort } from "./pkce.ts";
import type { FetchJsonPort } from "./sessionHolder.ts";

/** The directory in the person's home that holds the program's files. */
export const setupDirectoryName = ".chuggy-setup";

export const setupFiles = {
  session: "session.json",
  signIn: "sign-in.json",
} as const;

/** The lock's name in the directory, beside the files. */
export const setupLockName = "lock";

export type SetupFile = (typeof setupFiles)[keyof typeof setupFiles];

/** What of the machine stopped a run: a path it could not make or write, one it could not read, one that would not take a sign-in the issuer had already handed back, or no home to keep anything in. */
export type SetupMachineFault =
  | { readonly fault: "Unwritable"; readonly path: string }
  | { readonly fault: "Unreadable"; readonly path: string }
  | { readonly fault: "Unkept"; readonly path: string }
  | { readonly fault: "Homeless" };

/**
 * What the files and the lock throw where the machine would not do what was
 * asked. It carries which path and nothing the system said of it, so a report
 * names the path and no message of another system's.
 */
export class SetupMachineError extends Error {
  readonly fault: SetupMachineFault;

  constructor(fault: SetupMachineFault) {
    super("the machine did not do what chuggy setup asked of it");
    this.name = "SetupMachineError";
    this.fault = fault;
  }
}

export interface SetupFilesPort {
  /** The file's text, or nothing where there is no such file. */
  readonly read: (file: SetupFile) => string | undefined;
  /** Replaces the file whole, so a reader finds the old text or the new and never part of either. */
  readonly write: (file: SetupFile, text: string) => void;
  /**
   * Keeps room for one write of the file of at most `bytes`, so that write is
   * made over what the machine has already given. `sweep` gives the room back
   * where no write took it.
   */
  readonly reserve: (file: SetupFile, bytes: number) => void;
  readonly remove: (file: SetupFile) => void;
  /** Removes every copy of the file a write left unfinished. Only a caller that is the file's one writer may ask, since a write under way is such a copy. */
  readonly sweep: (file: SetupFile) => void;
}

export interface SetupLockPort {
  /** What the lock says: its holder's word, or nothing where it is free. */
  readonly read: () => string | undefined;
  /** Makes the lock say `next` where it still says `held`, answering whether this call did. Of several calls that name the same word, one is answered yes. */
  readonly swap: (
    held: string | undefined,
    next: string | undefined,
  ) => boolean;
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

/** How a command that was run to its end ended: not started, ended by the wait, or ended with its exit and what it printed on each stream as far as the bound kept it. */
export type SetupChildEnded =
  | { readonly ended: "Unstarted" }
  | { readonly ended: "Unended" }
  | {
      readonly ended: "Exited";
      readonly exit: number;
      readonly out: string;
      readonly err: string;
    };

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
  /** Runs a command of the machine's in the folder the program was run in and answers what it printed. Nothing is answered where it did not start, did not end well within `waitMs`, or printed more than `bytesMax`. */
  readonly read: (
    command: readonly string[],
    waitMs: number,
    bytesMax: number,
  ) => Promise<string | undefined>;
  /**
   * Runs a command of the machine's to its end with nothing to read and no
   * terminal to ask a person on, and answers how it ended. What it prints past
   * `bytesMax` on a stream is let go of, and one still running at `waitMs` is
   * ended with everything it started.
   */
  readonly run: (
    command: readonly string[],
    waitMs: number,
    bytesMax: number,
  ) => Promise<SetupChildEnded>;
}

/** What is at a path: a file, a directory, something else, or nothing this user can see. */
export type SetupDiskKind = "File" | "Directory" | "Other" | "None";

/** Paths outside the program's own directory, each named whole by the caller. */
export interface SetupDiskPort {
  readonly kind: (path: string) => SetupDiskKind;
  /** The names in a directory, or none where there is no such directory to list. */
  readonly names: (directory: string) => readonly string[];
  /** A file's text, or nothing where there is none to read or it is longer than `bytesMax`. */
  readonly text: (path: string, bytesMax: number) => string | undefined;
  /** Makes a file only its owner reads, with the directories above it, where nothing is at the path; throws which path it could not make. */
  readonly make: (path: string, text: string) => void;
  /** Whether this user may make and remove names in a directory that is there. */
  readonly writable: (directory: string) => boolean;
}

/** The platforms the program is served on: those it knows how to open a browser on. */
export const setupPlatforms = ["linux", "darwin"] as const;

export type SetupPlatform = (typeof setupPlatforms)[number];

/** Where the program is running, as plain facts read once at its start. */
export interface SetupSurroundings {
  readonly platform: string;
  /** The command the person has named for opening an address, where they named one. */
  readonly browser: string | undefined;
  /** The program's own directory, as a person would write it. */
  readonly directory: string;
  /** The person's home as the machine names it, or nothing where it names none. */
  readonly home: string | undefined;
  /** What the person set their configuration directory to, where they set one. */
  readonly configHome: string | undefined;
  /** The person as the machine numbers its users, or nothing where it numbers none. */
  readonly user: string | undefined;
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
  readonly lock: SetupLockPort;
  readonly listen: SetupListenPort;
  readonly process: SetupProcessPort;
  readonly disk: SetupDiskPort;
  readonly surroundings: SetupSurroundings;
}
