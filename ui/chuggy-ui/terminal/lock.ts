/**
 * The setup program's lock, as a directory that holds one entry whose name is
 * what the lock says.
 *
 * The lock changes hands by renaming that entry, and by nothing else. A
 * rename names the entry it moves, so of several runs that move the same one
 * the system lets one succeed and tells the rest it is gone: whoever takes a
 * lock a dead run left takes it from that run's own word, and a run that
 * judged the same word a moment later finds it moved. The directory is first
 * made whole elsewhere and moved into place, which the system refuses where a
 * directory with an entry is already there.
 *
 * What this needs of where the person's home is kept: a rename inside one
 * directory that is one step and fails once its source is gone, and a
 * directory that cannot be moved onto one holding an entry. No link is made.
 * Where a rename can succeed and still be answered as failed, as over a
 * network mount that lost the answer, a run takes itself to have lost a lock
 * it holds, and the lock is nobody's again when that run ends.
 */

import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import { setupLockName } from "../app/core/setupPorts.ts";
import type { SetupLockPort } from "../app/core/setupPorts.ts";
import { directoryMode, failed, fileMode } from "./files.ts";

/** The entry's name while nobody holds the lock. */
const free = "free";

/** A word is one name in the directory, so it holds nothing a path is built from. */
function entry(word: string | undefined): string {
  if (word === undefined) return free;
  if (!/^[0-9]+\.[0-9]+$/u.test(word))
    throw new Error("the lock was asked to say what is not a holder's word");
  return word;
}

/** Makes the lock where there is none, already saying `said`; answers no where another run made it first. */
function made(directory: string, lock: string, said: string): boolean {
  const draft = `${lock}.${String(process.pid)}.draft`;
  mkdirSync(directory, { recursive: true, mode: directoryMode });
  rmSync(draft, { recursive: true, force: true });
  mkdirSync(draft, { mode: directoryMode });
  try {
    writeFileSync(join(draft, said), "", { mode: fileMode, flag: "wx" });
    renameSync(draft, lock);
    return true;
  } catch (failure: unknown) {
    if (failed(failure, "ENOTEMPTY") || failed(failure, "EEXIST")) return false;
    throw failure;
  } finally {
    rmSync(draft, { recursive: true, force: true });
  }
}

export function lockIn(directory: string): SetupLockPort {
  const lock = join(directory, setupLockName);
  return {
    read: () => {
      let said: readonly string[];
      try {
        said = readdirSync(lock);
      } catch (failure: unknown) {
        if (failed(failure, "ENOENT")) return undefined;
        throw failure;
      }
      if (said.length > 1) throw new Error("the lock says more than one word");
      return said[0] === free ? undefined : said[0];
    },
    swap: (held, next) => {
      const from = join(lock, held === undefined ? free : held);
      if (held !== undefined && basename(held) !== held) return false;
      try {
        renameSync(from, join(lock, entry(next)));
        return true;
      } catch (failure: unknown) {
        if (!failed(failure, "ENOENT")) throw failure;
      }
      return held === undefined && made(directory, lock, entry(next));
    },
  };
}
