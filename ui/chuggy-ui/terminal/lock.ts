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
 *
 * Something else may write beside the entry, as a file manager does in any
 * folder a person opens. Such a name is not a word of the lock and is read
 * past: the lock says its one word whatever else is there.
 */

import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import { SetupMachineError, setupLockName } from "../app/core/setupPorts.ts";
import type { SetupLockPort } from "../app/core/setupPorts.ts";
import { attempted, directoryMode, failed, fileMode, tried } from "./files.ts";

/** The entry's name while nobody holds the lock. */
const free = "free";

const holders = /^[0-9]+\.[0-9]+$/u;

/** A word is one name in the directory, so it holds nothing a path is built from. */
function entry(word: string | undefined): string {
  if (word === undefined) return free;
  if (!holders.test(word))
    throw new Error("the lock was asked to say what is not a holder's word");
  return word;
}

/**
 * What the lock says, from the names in its directory: the free one or a
 * holder's, and more than one of those is a lock nobody can read. With
 * neither, the lock says the first other name there, so whoever judges that
 * nobody's takes the lock from it.
 */
function said(lock: string, names: readonly string[]): string | undefined {
  const words = names.filter((name) => name === free || holders.test(name));
  if (words.length > 1)
    throw new SetupMachineError({ fault: "Unreadable", path: lock });
  const [word] = words;
  if (word === undefined) return names.toSorted()[0];
  return word === free ? undefined : word;
}

/** Makes the lock where there is none, already saying `word`; answers no where another run made it first. */
function made(directory: string, lock: string, word: string): boolean {
  const draft = `${lock}.${String(process.pid)}.draft`;
  attempted("Unwritable", directory, () => {
    mkdirSync(directory, { recursive: true, mode: directoryMode });
  });
  return attempted("Unwritable", lock, () => {
    rmSync(draft, { recursive: true, force: true });
    mkdirSync(draft, { mode: directoryMode });
    try {
      writeFileSync(join(draft, word), "", { mode: fileMode, flag: "wx" });
      renameSync(draft, lock);
      return true;
    } catch (failure: unknown) {
      if (failed(failure, "ENOTEMPTY") || failed(failure, "EEXIST"))
        return false;
      throw failure;
    } finally {
      rmSync(draft, { recursive: true, force: true });
    }
  });
}

/** Renames the lock's one entry, answering no where it no longer has the name it is moved from. */
function moved(lock: string, from: string, next: string): boolean {
  const done = tried("Unwritable", lock, () => {
    renameSync(join(lock, from), join(lock, next));
    return true;
  });
  return done === true;
}

export function lockIn(directory: string): SetupLockPort {
  const lock = join(directory, setupLockName);
  return {
    read: () =>
      said(lock, tried("Unreadable", lock, () => readdirSync(lock)) ?? []),
    swap: (from, next) => {
      if (from !== undefined && basename(from) !== from) return false;
      if (moved(lock, from ?? free, entry(next))) return true;
      return from === undefined && made(directory, lock, entry(next));
    },
  };
}
