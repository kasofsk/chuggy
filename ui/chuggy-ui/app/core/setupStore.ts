/**
 * What the setup program keeps between runs, as values: the remembered
 * sign-in, the lock a run holds while it uses it, and the note a sign-in page
 * leaves.
 *
 * The remembered sign-in is a site's origin and the renewal token for it and
 * nothing else; the server is the record of everything else. A renewal token
 * is spent by the request that uses it and replaying a spent one ends the
 * whole sign-in, and each run is a process of its own, so a run holds the lock
 * from before it reads the token until after it has written the one that
 * replaced it. A file that does not read as what this module wrote is treated
 * as absent, which costs a sign-in and never a wrong answer.
 *
 * The lock is one word, its holder's or none, and it changes hands only by a
 * swap that names the word it is changed from. So a lock whose holder is gone
 * is taken by the one run whose swap finds it still saying that holder's word:
 * every other run that judged the same lock finds a word it did not name, and
 * waits. No run removes a lock and then makes one, which is the step two runs
 * could both take.
 */

import { z } from "zod";

import { setupSiteRead } from "./setupArguments.ts";
import { setupFiles } from "./setupPorts.ts";
import type { SetupFilesPort, SetupPorts } from "./setupPorts.ts";
import { setupSignInEndings } from "./setupReport.ts";
import type { SetupSignInEnded } from "./setupReport.ts";
import { sessionRefreshTokenKey } from "./sessionHolder.ts";
import type { KeyValuePort } from "./sessionHolder.ts";

/** Past this a lock is its holder's no longer, whoever that was: every run ends well inside it. */
export const setupLockSecsMax = 300;
export const setupLockRetryMs = 100;

/** How long a command waits for a lock another run is holding. */
export const setupLockWaitMs = 5_000;

export interface SetupSession {
  readonly site: string;
  readonly refreshToken: string | undefined;
}

const setupSessionSchema = z.strictObject({
  site: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
});

function setupParsed<T>(
  schema: z.ZodType<T>,
  text: string | undefined,
): T | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function setupSessionRead(
  files: SetupFilesPort,
): SetupSession | undefined {
  const stored = setupParsed(
    setupSessionSchema,
    files.read(setupFiles.session),
  );
  if (stored === undefined || setupSiteRead(stored.site) !== stored.site)
    return undefined;
  return { site: stored.site, refreshToken: stored.refreshToken };
}

export function setupSessionWritten(
  files: SetupFilesPort,
  session: SetupSession,
): void {
  const { site, refreshToken } = session;
  files.write(
    setupFiles.session,
    JSON.stringify(
      refreshToken === undefined ? { site } : { site, refreshToken },
    ),
  );
}

/**
 * The session holder's store for one site: the token it was opened with, and
 * every token after it written to the file before the write returns.
 */
export function setupTokenStore(
  files: SetupFilesPort,
  site: string,
  held: string | undefined,
): KeyValuePort {
  let refreshToken = held;
  const keep = (next: string | undefined): void => {
    refreshToken = next;
    setupSessionWritten(files, { site, refreshToken });
  };
  return {
    read: (key) =>
      key === sessionRefreshTokenKey ? (refreshToken ?? null) : null,
    write: (key, value) => {
      if (key === sessionRefreshTokenKey) keep(value);
    },
    remove: (key) => {
      if (key === sessionRefreshTokenKey && refreshToken !== undefined)
        keep(undefined);
    },
  };
}

/** A holder's word: the process, and when it took the lock. */
export function setupLockWord(pid: number, takenAtMs: number): string {
  return `${String(pid)}.${String(Math.floor(takenAtMs))}`;
}

interface SetupLockHolder {
  readonly pid: number;
  readonly takenAtMs: number;
}

function setupLockHolder(word: string): SetupLockHolder | undefined {
  const read = /^([1-9]\d{0,14})\.(\d{1,15})$/u.exec(word);
  return read === null
    ? undefined
    : { pid: Number(read[1]), takenAtMs: Number(read[2]) };
}

/** Whether a word is nobody's: not a holder's, its holder gone, or older than any run lasts. */
export function setupLockStale(
  word: string,
  nowMs: number,
  alive: (pid: number) => boolean,
): boolean {
  const held = setupLockHolder(word);
  if (held === undefined) return true;
  if (nowMs - held.takenAtMs > setupLockSecsMax * 1_000) return true;
  return !alive(held.pid);
}

type SetupLockPorts = Pick<
  SetupPorts,
  "files" | "lock" | "nowMs" | "sleepMs" | "process"
>;

/**
 * Takes the lock, waiting at most `waitMs` for a run that holds it. Whoever
 * holds it is the one writer of the remembered sign-in, so what a write that
 * was cut short left of that file is removed as the lock is taken.
 */
export async function setupLockTaken(
  ports: SetupLockPorts,
  waitMs: number,
): Promise<boolean> {
  const turns = Math.ceil(waitMs / setupLockRetryMs) + 1;
  for (let turn = 0; turn < turns; turn += 1) {
    const held = ports.lock.read();
    const nowMs = ports.nowMs();
    const nobodys =
      held === undefined || setupLockStale(held, nowMs, ports.process.alive);
    if (
      nobodys &&
      ports.lock.swap(held, setupLockWord(ports.process.pid, nowMs))
    ) {
      ports.files.sweep(setupFiles.session);
      return true;
    }
    if (turn + 1 < turns) await ports.sleepMs(setupLockRetryMs);
  }
  return false;
}

/** The process the lock names as its holder, for a run that waited for it and did not get it. */
export function setupLockHeldBy(ports: SetupLockPorts): number | undefined {
  const held = ports.lock.read();
  return held === undefined ? undefined : setupLockHolder(held)?.pid;
}

/** Gives the lock up where it is still this run's, so a run that outlived its lock frees nobody else's. */
export function setupLockReleased(ports: SetupLockPorts): void {
  const held = ports.lock.read();
  if (held === undefined) return;
  if (setupLockHolder(held)?.pid === ports.process.pid)
    ports.lock.swap(held, undefined);
}

/**
 * What a sign-in page leaves for the command waiting on it: where it listens,
 * or how it ended. An ending is `told` once a `sign-in` has reported it, and
 * is kept after that where nothing is run until the person asks, so the bare
 * command goes on saying it until a `sign-in` opens another page.
 */
export type SetupSignInNote =
  | {
      readonly note: "Waiting";
      readonly site: string;
      readonly port: number;
      readonly pid: number;
      readonly endsAtMs: number;
    }
  | {
      readonly note: "Ended";
      readonly site: string;
      readonly ended: SetupSignInEnded;
      readonly endedAtMs: number;
      readonly told: boolean;
    };

const setupSignInNoteSchema = z.discriminatedUnion("note", [
  z.strictObject({
    note: z.literal("Waiting"),
    site: z.string().min(1),
    port: z.number().int().positive(),
    pid: z.number().int().positive(),
    endsAtMs: z.number(),
  }),
  z.strictObject({
    note: z.literal("Ended"),
    site: z.string().min(1),
    ended: z.enum(setupSignInEndings),
    endedAtMs: z.number(),
    told: z.boolean(),
  }),
]);

export function setupSignInNoteRead(
  files: SetupFilesPort,
): SetupSignInNote | undefined {
  return setupParsed(setupSignInNoteSchema, files.read(setupFiles.signIn));
}

export function setupSignInNoteWritten(
  files: SetupFilesPort,
  note: SetupSignInNote,
): void {
  files.write(setupFiles.signIn, JSON.stringify(note));
}
