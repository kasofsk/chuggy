/**
 * The setup program's three files as values: the remembered sign-in, the lock
 * a run holds while it uses it, and the note a sign-in page leaves.
 *
 * The remembered sign-in is a site's origin and the renewal token for it and
 * nothing else; the server is the record of everything else. A renewal token
 * is spent by the request that uses it and replaying a spent one ends the
 * whole sign-in, and each run is a process of its own, so a run holds the lock
 * from before it reads the token until after it has written the one that
 * replaced it. A file that does not read as what this module wrote is treated
 * as absent, which costs a sign-in and never a wrong answer.
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

const setupLockSchema = z.strictObject({
  pid: z.number().int().positive(),
  takenAtMs: z.number(),
});

/** Whether a lock is nobody's: unreadable, its holder gone, or older than any run lasts. */
export function setupLockStale(
  text: string | undefined,
  nowMs: number,
  alive: (pid: number) => boolean,
): boolean {
  const held = setupParsed(setupLockSchema, text);
  if (held === undefined) return true;
  if (nowMs - held.takenAtMs > setupLockSecsMax * 1_000) return true;
  return !alive(held.pid);
}

type SetupLockPorts = Pick<
  SetupPorts,
  "files" | "nowMs" | "sleepMs" | "process"
>;

/**
 * Takes the lock, waiting at most `waitMs` for a run that holds it. A lock
 * that is nobody's is removed and taken in the same turn.
 */
export async function setupLockTaken(
  ports: SetupLockPorts,
  waitMs: number,
): Promise<boolean> {
  const turns = Math.ceil(waitMs / setupLockRetryMs) + 1;
  const taken = (): boolean =>
    ports.files.create(
      setupFiles.lock,
      JSON.stringify({ pid: ports.process.pid, takenAtMs: ports.nowMs() }),
    );
  for (let turn = 0; turn < turns; turn += 1) {
    if (taken()) return true;
    const held = ports.files.read(setupFiles.lock);
    if (setupLockStale(held, ports.nowMs(), ports.process.alive)) {
      ports.files.remove(setupFiles.lock);
      if (taken()) return true;
    }
    if (turn + 1 < turns) await ports.sleepMs(setupLockRetryMs);
  }
  return false;
}

/** Gives the lock up where it is still this run's, so a run that outlived its lock removes nobody else's. */
export function setupLockReleased(ports: SetupLockPorts): void {
  const held = setupParsed(setupLockSchema, ports.files.read(setupFiles.lock));
  if (held?.pid === ports.process.pid) ports.files.remove(setupFiles.lock);
}

/** What a sign-in page leaves for the command waiting on it: where it listens, or how it ended. */
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
