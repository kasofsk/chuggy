/**
 * The setup program's files, in one directory only the person can read, and
 * the shared sign-in store's, in another, written the same way.
 *
 * A file is written beside its place, under a name that says whose write it
 * is, and moved onto it, so no reader ever finds half of one. A write that
 * was cut short leaves that copy behind, holding what was being written, and
 * `sweep` is what removes it. Room for a write is kept as that same copy made
 * ahead of it and filled, so the write that follows is written over what the
 * system has already given: it asks for no new entry, and for no new block
 * where the file system writes over a file's blocks in place. One that writes
 * every change to new blocks can still refuse the write, which is then said
 * as a sign-in that was not kept. Only a copy this port made itself is written
 * over; any other write makes its copy anew, as a name nothing else holds.
 *
 * Whatever the system refuses is thrown as which path it was and whether it
 * was being written or read. What the system said of it is dropped here,
 * because a report prints what it is handed.
 */

import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

import {
  signInStoreDraftName,
  signInStoreDraftOf,
} from "../../../src/contract/signInStore.ts";
import { SetupMachineError } from "../app/core/setupPorts.ts";
import type {
  SetupFile,
  SetupFilesPort,
  SetupStorePort,
} from "../app/core/setupPorts.ts";

/** Read and written by the person alone. */
export const fileMode = 0o600;
export const directoryMode = 0o700;

export function failed(failure: unknown, code: string): boolean {
  return (
    failure instanceof Error && (failure as NodeJS.ErrnoException).code === code
  );
}

/** Whether the system said there is nothing at a path: no such entry, or a step of the path that is not a directory. */
export function absent(failure: unknown): boolean {
  return failed(failure, "ENOENT") || failed(failure, "ENOTDIR");
}

/** Runs one step against a path, and throws which path where the system would not do it. */
export function attempted<T>(
  fault: "Unwritable" | "Unreadable",
  path: string,
  step: () => T,
): T {
  try {
    return step();
  } catch (failure: unknown) {
    if (failure instanceof SetupMachineError) throw failure;
    throw new SetupMachineError({ fault, path });
  }
}

/** Runs one step against a path that may not be there: nothing where the system says nothing is, and which path where it would not do the step. */
export function tried<T>(
  fault: "Unwritable" | "Unreadable",
  path: string,
  step: () => T,
): T | undefined {
  return attempted(fault, path, () => {
    try {
      return step();
    } catch (failure: unknown) {
      if (absent(failure)) return undefined;
      throw failure;
    }
  });
}

/** The names in the directory that are an unfinished write of a file `of` takes, whichever run's. */
function drafts(
  directory: string,
  of: (file: string) => boolean,
): readonly string[] {
  const names =
    tried("Unreadable", directory, () => readdirSync(directory)) ?? [];
  return names.filter((name) => {
    const file = signInStoreDraftOf(name);
    return file !== undefined && of(file);
  });
}

/** Writes the whole text over a copy kept ahead of the write and ends the copy there; false where the copy is no longer there to write over. */
function filled(draft: string, text: string): boolean {
  const copy = tried("Unwritable", draft, () => openSync(draft, "r+"));
  if (copy === undefined) return false;
  try {
    const octets = Buffer.from(text, "utf8");
    writeSync(copy, octets, 0, octets.length, 0);
    ftruncateSync(copy, octets.length);
  } finally {
    closeSync(copy);
  }
  return true;
}

/** Files in `directory` by name, each written whole over a copy of its own, and `sweep` removing the copies left of every file `of` takes. */
function filesAt<F extends string>(directory: string) {
  const placed = (file: F): string => join(directory, file);
  const draft = (file: F): string =>
    join(directory, signInStoreDraftName(file, process.pid));
  const removed = (path: string): void => {
    tried("Unwritable", path, () => {
      rmSync(path, { force: true });
    });
  };
  const made = (): void => {
    attempted("Unwritable", directory, () => {
      mkdirSync(directory, { recursive: true, mode: directoryMode });
    });
  };
  const kept = new Set<F>();
  const fresh = (file: F, held: string | Buffer): void => {
    rmSync(draft(file), { force: true });
    writeFileSync(draft(file), held, { mode: fileMode, flag: "wx" });
  };
  return {
    read: (file: F) =>
      tried("Unreadable", placed(file), () =>
        readFileSync(placed(file), "utf8"),
      ),
    write: (file: F, text: string) => {
      made();
      attempted("Unwritable", placed(file), () => {
        if (!(kept.delete(file) && filled(draft(file), text)))
          fresh(file, text);
        renameSync(draft(file), placed(file));
      });
    },
    reserve: (file: F, bytes: number) => {
      made();
      attempted("Unwritable", placed(file), () => {
        kept.delete(file);
        fresh(file, Buffer.alloc(bytes, " "));
        kept.add(file);
      });
    },
    remove: (file: F) => {
      removed(placed(file));
    },
    sweep: (of: (file: string) => boolean) => {
      for (const file of kept) if (of(file)) kept.delete(file);
      for (const name of drafts(directory, of)) removed(join(directory, name));
    },
  };
}

export function filesIn(directory: string): SetupFilesPort {
  const files = filesAt<SetupFile>(directory);
  return {
    ...files,
    sweep: (file) => {
      files.sweep((name) => name === file);
    },
  };
}

/** The shared sign-in store, whose lock's holder is the one writer of every file in it. */
export function storeIn(directory: string): SetupStorePort {
  const files = filesAt<string>(directory);
  return {
    ...files,
    sweep: () => {
      files.sweep(() => true);
    },
  };
}
