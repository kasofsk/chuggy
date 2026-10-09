/**
 * The setup program's files, in one directory only the person can read.
 *
 * A file is written beside its place and moved onto it, and made by linking a
 * written file to its name, so no reader ever finds half of one and no two
 * callers both make the same file.
 */

import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { SetupFile, SetupFilesPort } from "../app/core/setupPorts.ts";

/** Read and written by the person alone. */
const fileMode = 0o600;
const directoryMode = 0o700;

function failed(failure: unknown, code: string): boolean {
  return (
    failure instanceof Error && (failure as NodeJS.ErrnoException).code === code
  );
}

export function filesIn(directory: string): SetupFilesPort {
  const placed = (file: SetupFile): string => join(directory, file);
  const drafted = (file: SetupFile, text: string): string => {
    const draft = `${placed(file)}.${String(process.pid)}.draft`;
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
    create: (file, text) => {
      const draft = drafted(file, text);
      try {
        linkSync(draft, placed(file));
        return true;
      } catch (failure: unknown) {
        if (failed(failure, "EEXIST")) return false;
        throw failure;
      } finally {
        rmSync(draft, { force: true });
      }
    },
    remove: (file) => {
      rmSync(placed(file), { force: true });
    },
  };
}
