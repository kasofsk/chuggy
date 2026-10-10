/**
 * The setup program's files, in one directory only the person can read.
 *
 * A file is written beside its place, under a name that says whose write it
 * is, and moved onto it, so no reader ever finds half of one. A write that
 * was cut short leaves that copy behind, holding what was being written, and
 * `sweep` is what removes it.
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

/** The names in the directory that are an unfinished write of `file`, whichever run's. */
function drafts(directory: string, file: SetupFile): readonly string[] {
  let names: readonly string[];
  try {
    names = readdirSync(directory);
  } catch (failure: unknown) {
    if (failed(failure, "ENOENT")) return [];
    throw failure;
  }
  return names.filter(
    (name) =>
      name.startsWith(`${file}.`) &&
      name.endsWith(draftSuffix) &&
      /^[0-9]+$/u.test(name.slice(file.length + 1, -draftSuffix.length)),
  );
}

export function filesIn(directory: string): SetupFilesPort {
  const placed = (file: SetupFile): string => join(directory, file);
  const drafted = (file: SetupFile, text: string): string => {
    const draft = `${placed(file)}.${String(process.pid)}${draftSuffix}`;
    mkdirSync(directory, { recursive: true, mode: directoryMode });
    rmSync(draft, { force: true });
    writeFileSync(draft, text, { mode: fileMode, flag: "wx" });
    return draft;
  };
  return {
    read: (file) => {
      try {
        return readFileSync(placed(file), "utf8");
      } catch (failure: unknown) {
        if (failed(failure, "ENOENT")) return undefined;
        throw failure;
      }
    },
    write: (file, text) => {
      renameSync(drafted(file, text), placed(file));
    },
    remove: (file) => {
      rmSync(placed(file), { force: true });
    },
    sweep: (file) => {
      for (const name of drafts(directory, file))
        rmSync(join(directory, name), { force: true });
    },
  };
}
