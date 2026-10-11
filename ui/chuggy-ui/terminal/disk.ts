/**
 * Paths outside the setup program's own directory: what is at one, the names
 * in one, a file's text, a file made where there was nothing, and whether a
 * directory is this user's to write.
 *
 * Every path is the caller's, whole, and nothing here knows whose it is. A
 * probe the system would not answer is answered as nothing there, since a
 * path this user cannot see is one it cannot use, and what the system said of
 * it is dropped. Only making a file throws, as which path it was. A file is
 * made beside its place, put on the disk and only then linked onto it, so it
 * is there whole or not at all, also on a machine that loses power, and a
 * link is refused where something already holds the name.
 */

import {
  accessSync,
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { SetupDiskKind, SetupDiskPort } from "../app/core/setupPorts.ts";
import { attempted, directoryMode, fileMode } from "./files.ts";

/** What a path leads to, following a link to where it points. */
function kind(path: string): SetupDiskKind {
  try {
    const found = statSync(path);
    if (found.isFile()) return "File";
    return found.isDirectory() ? "Directory" : "Other";
  } catch {
    return "None";
  }
}

function names(directory: string): readonly string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/** Only a file is read, and only one no longer than the bound, so nothing that would never end is opened. */
function text(path: string, bytesMax: number): string | undefined {
  try {
    const found = statSync(path);
    if (!found.isFile() || found.size > bytesMax) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Writes a file that was not there and has the system put it on the disk before answering. */
function flushed(path: string, held: string): void {
  const file = openSync(path, "wx", fileMode);
  try {
    writeFileSync(file, held);
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
}

function make(path: string, held: string): void {
  const draft = `${path}.${String(process.pid)}.draft`;
  attempted("Unwritable", path, () => {
    mkdirSync(dirname(path), { recursive: true, mode: directoryMode });
    rmSync(draft, { force: true });
    flushed(draft, held);
    try {
      linkSync(draft, path);
    } finally {
      rmSync(draft, { force: true });
    }
  });
}

function writable(directory: string): boolean {
  try {
    accessSync(directory, constants.W_OK | constants.X_OK);
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

export const disk: SetupDiskPort = { kind, names, text, make, writable };
