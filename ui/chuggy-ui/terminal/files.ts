/**
 * The setup program's files, in one directory only the person can read.
 *
 * A file is written beside its place, under a name that says whose write it
 * is, and moved onto it, so no reader ever finds half of one. A write that
 * was cut short leaves that copy behind, holding what was being written, and
 * `sweep` is what removes it.
 *
 * Whatever the system refuses is thrown as which path it was and whether it
 * was being written or read. What the system said of it is dropped here,
 * because a report prints what it is handed.
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { SetupMachineError } from "../app/core/setupPorts.ts";
import type { SetupFile, SetupFilesPort } from "../app/core/setupPorts.ts";

/** Read and written by the person alone. */
export const fileMode = 0o600;
export const directoryMode = 0o700;

const draftSuffix = ".draft";

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

/** The names in the directory that are an unfinished write of `file`, whichever run's. */
function drafts(directory: string, file: SetupFile): readonly string[] {
  const names =
    tried("Unreadable", directory, () => readdirSync(directory)) ?? [];
  return names.filter(
    (name) =>
      name.startsWith(`${file}.`) &&
      name.endsWith(draftSuffix) &&
      /^[0-9]+$/u.test(name.slice(file.length + 1, -draftSuffix.length)),
  );
}

export function filesIn(directory: string): SetupFilesPort {
  const placed = (file: SetupFile): string => join(directory, file);
  const removed = (path: string): void => {
    tried("Unwritable", path, () => {
      rmSync(path, { force: true });
    });
  };
  return {
    read: (file) =>
      tried("Unreadable", placed(file), () =>
        readFileSync(placed(file), "utf8"),
      ),
    write: (file, text) => {
      const draft = `${placed(file)}.${String(process.pid)}${draftSuffix}`;
      attempted("Unwritable", directory, () => {
        mkdirSync(directory, { recursive: true, mode: directoryMode });
      });
      attempted("Unwritable", placed(file), () => {
        rmSync(draft, { force: true });
        writeFileSync(draft, text, { mode: fileMode, flag: "wx" });
        renameSync(draft, placed(file));
      });
    },
    remove: (file) => {
      removed(placed(file));
    },
    sweep: (file) => {
      for (const name of drafts(directory, file))
        removed(join(directory, name));
    },
  };
}
