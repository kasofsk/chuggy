/**
 * What the setup program keeps between runs, as values: the site it
 * remembers, the sign-in it holds there, the lock a run holds while it uses
 * that sign-in, and the note a sign-in page leaves.
 *
 * The sign-in is a renewal token in the worker contract's shared store, a file
 * a site, which the runner packages' `mcp` reads as the same sign-in; the
 * program's own directory remembers which site is meant and nothing else, and
 * the server is the record of everything else. A renewal token is spent by the
 * request that uses it and replaying a spent one ends the whole sign-in, and
 * each run is a process of its own, so a run holds the store's lock from
 * before it reads the token until after it has written the one that replaced
 * it. Room for that write is kept before the token is spent, so a home that
 * would not take the new token is found while the old one is still good; and a
 * write that fails all the same is noted here, because the holder reads a
 * store that threw as a renewal that failed. A file that does not read as what
 * this module wrote is treated as absent, which costs a sign-in and never a
 * wrong answer. A token an older copy of this program kept beside the site it
 * remembers is moved into the shared store once, by the first run that holds
 * the lock, and is kept only where the store holds none for that site.
 *
 * The lock is one word, its holder's or none, and it changes hands only by a
 * swap that names the word it is changed from. So a lock whose holder is gone
 * is taken by the one run whose swap finds it still saying that holder's word:
 * every other run that judged the same lock finds a word it did not name, and
 * waits. No run removes a lock and then makes one, which is the step two runs
 * could both take.
 */

import { z } from "zod";

import {
  signInStoreFileName,
  signInStoreLockHolder,
  signInStoreLockStale,
  signInStoreLockWord,
  signInStoreText,
  signInStoreTokenRead,
} from "../../../../src/contract/signInStore.ts";

import { setupSiteRead } from "./setupArguments.ts";
import { setupFiles, SetupMachineError } from "./setupPorts.ts";
import type {
  SetupFilesPort,
  SetupPorts,
  SetupStorePort,
} from "./setupPorts.ts";
import { setupSignInEndings } from "./setupReport.ts";
import type { SetupSignInEnded } from "./setupReport.ts";
import { sessionRefreshTokenKey } from "./sessionHolder.ts";
import type { KeyValuePort } from "./sessionHolder.ts";

export const setupLockRetryMs = 100;

/** How long a command waits for a lock another run is holding. */
export const setupLockWaitMs = 5_000;

/** The site remembered, beside which an older copy of this program kept its token. */
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

function setupSessionParsed(
  files: SetupFilesPort,
): z.infer<typeof setupSessionSchema> | undefined {
  const stored = setupParsed(
    setupSessionSchema,
    files.read(setupFiles.session),
  );
  return stored === undefined || setupSiteRead(stored.site) !== stored.site
    ? undefined
    : stored;
}

/** The site the program remembers, or nothing where it remembers none. */
export function setupSessionSite(files: SetupFilesPort): string | undefined {
  return setupSessionParsed(files)?.site;
}

export function setupSessionSiteWritten(
  files: SetupFilesPort,
  site: string,
): void {
  files.write(setupFiles.session, JSON.stringify({ site }));
}

/** The renewal token the shared store holds for a site, or nothing where it holds none. */
export function setupTokenRead(
  store: SetupStorePort,
  site: string,
): string | undefined {
  const text = store.read(signInStoreFileName(site));
  return text === undefined ? undefined : signInStoreTokenRead(text);
}

/**
 * Moves a token an older copy of this program kept beside the site it
 * remembers into the shared store, where the store holds none for that site,
 * and leaves the site remembered alone. The caller holds the lock.
 */
export function setupSessionMoved(
  files: SetupFilesPort,
  store: SetupStorePort,
): void {
  const stored = setupSessionParsed(files);
  if (stored?.refreshToken === undefined) return;
  if (setupTokenRead(store, stored.site) === undefined)
    store.write(
      signInStoreFileName(stored.site),
      signInStoreText(stored.refreshToken),
    );
  setupSessionSiteWritten(files, stored.site);
}

/** The room kept for a write of the remembered sign-in: past any site's origin and any issuer's token together. */
export const setupSessionRoomBytes = 16_384;

export interface SetupTokenStore extends KeyValuePort {
  /** Keeps room for the next write of the remembered sign-in, and throws which path would not give it. */
  readonly roomed: () => void;
  /** Throws what the store was refused, whatever the holder made of it: no room, or a token handed back and not written. */
  readonly kept: () => void;
}

function setupAsThrown(failure: unknown): unknown {
  return failure;
}

/** What a write that failed is thrown as once the issuer has answered: the token it handed back is the one that was lost. */
function setupUnkept(failure: unknown): unknown {
  return failure instanceof SetupMachineError &&
    failure.fault.fault === "Unwritable"
    ? new SetupMachineError({ fault: "Unkept", path: failure.fault.path })
    : failure;
}

/**
 * The session holder's store for one site: the token it was opened with, and
 * every token after it written to the site's file in the shared store before
 * the write returns. The
 * first thing the machine refuses it is what that step and every refused step
 * after it throws, and what `kept` throws.
 */
export function setupTokenStore(
  store: SetupStorePort,
  site: string,
  held: string | undefined,
): SetupTokenStore {
  const name = signInStoreFileName(site);
  let refreshToken = held;
  let room = false;
  let refused: { readonly failure: unknown } | undefined;
  const noting = (step: () => void, thrown: (failure: unknown) => unknown) => {
    try {
      step();
    } catch (failure: unknown) {
      refused ??= { failure: thrown(failure) };
      throw refused.failure;
    }
  };
  const keep = (next: string | undefined): void => {
    refreshToken = next;
    room = false;
    noting(
      () => {
        if (next === undefined) store.remove(name);
        else store.write(name, signInStoreText(next));
      },
      next === undefined ? setupAsThrown : setupUnkept,
    );
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
    roomed: () => {
      if (room) return;
      noting(() => {
        store.reserve(name, setupSessionRoomBytes);
      }, setupAsThrown);
      room = true;
    },
    kept: () => {
      if (refused !== undefined) throw refused.failure;
    },
  };
}

type SetupLockPorts = Pick<
  SetupPorts,
  "files" | "store" | "lock" | "nowMs" | "sleepMs" | "process"
>;

/** What a write cut short left of the files the lock's holder is the one writer of: the site remembered and the shared store's. */
function setupLockSwept(ports: SetupLockPorts): void {
  ports.files.sweep(setupFiles.session);
  ports.store.sweep();
}

/**
 * Takes the lock, waiting at most `waitMs` for a run that holds it, and as the
 * one writer of the remembered site and the shared store removes what a write
 * that was cut short left of either. Where that cannot be removed the lock is given back
 * before the path is thrown, so a run that stops there leaves it nobody's.
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
      held === undefined ||
      signInStoreLockStale(held, nowMs, ports.process.alive);
    const mine = signInStoreLockWord(ports.process.pid, nowMs);
    if (nobodys && ports.lock.swap(held, mine)) {
      try {
        setupLockSwept(ports);
      } catch (failure: unknown) {
        ports.lock.swap(mine, undefined);
        throw failure;
      }
      return true;
    }
    if (turn + 1 < turns) await ports.sleepMs(setupLockRetryMs);
  }
  return false;
}

/** The process the lock names as its holder, for a run that waited for it and did not get it. */
export function setupLockHeldBy(ports: SetupLockPorts): number | undefined {
  const held = ports.lock.read();
  return held === undefined ? undefined : signInStoreLockHolder(held)?.pid;
}

/**
 * Gives the lock up where it is still this run's, so a run that outlived its
 * lock frees nobody else's. Room this run kept and no write took is given
 * back first, while it is still the one writer.
 */
export function setupLockReleased(ports: SetupLockPorts): void {
  const held = ports.lock.read();
  if (held === undefined) return;
  if (signInStoreLockHolder(held)?.pid !== ports.process.pid) return;
  try {
    setupLockSwept(ports);
  } finally {
    ports.lock.swap(held, undefined);
  }
}

/**
 * What a sign-in page leaves for the command waiting on it: where it listens,
 * or how it ended. An ending is `told` once a command has said it, whichever
 * command that was, and is kept after that where nothing is run until the
 * person asks: the bare command goes on saying it, and the next `sign-in`
 * opens another page.
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
