/**
 * A script named `git` standing in front of the real one on an adapter's path
 * alone. It writes the verb of every call it is told to watch as a line, and the
 * calls of the one verb a suite faults die, fail, say something and fail, or
 * reach git late, a late one writing `ended` once it has ended.
 *
 * WHAT A FAILED CALL SAYS IS A MARKER, written to git's own error stream, so a
 * suite can assert nothing git wrote reaches what the adapter answers.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** How one verb's calls go through the stand-in: as git has them, ended by a signal, failed with git's own code before git ran, failed after writing the marker, or begun only after a pause. */
export type GitStandInFault =
  "Whole" | "Killed" | "Failed" | "Said" | "Stalled";

/** What a `Said` call writes to its error stream before it fails. */
export const gitStandInMarker = "git-stand-in-said-r4t8w2";

function gitStandInText(git: string, verbs: readonly string[]): string {
  return [
    "#!/bin/sh",
    'here=$(dirname "$0")',
    'read faulted fault < "$here/faulted"',
    'for arg in "$@"; do',
    '  case "$arg" in',
    `  ${verbs.join(" | ")})`,
    '    echo "$arg" >> "$here/calls"',
    '    [ "$arg" = "$faulted" ] || break',
    '    case "$fault" in',
    "    Killed) kill -KILL $$ ;;",
    "    Failed) exit 128 ;;",
    `    Said) echo '${gitStandInMarker}' >&2; exit 128 ;;`,
    `    Stalled) sleep 3; '${git}' "$@"; code=$?; echo ended >> "$here/calls"; exit $code ;;`,
    "    esac",
    "    break ;;",
    "  esac",
    "done",
    `exec '${git}' "$@"`,
    "",
  ].join("\n");
}

/** Has the calls of one verb go through the stand-in one way from here on. */
export function gitStandInFaulted(
  directory: string,
  verb: string,
  fault: GitStandInFault,
): void {
  writeFileSync(join(directory, "faulted"), `${verb} ${fault}\n`);
}

/** Writes the stand-in into a directory of its own, watching the verbs named and faulting none of them, and answers the `PATH` that puts it first. */
export function gitStandInOpen(
  directory: string,
  verbs: readonly string[],
): string {
  mkdirSync(directory);
  const git = execFileSync("sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(join(directory, "git"), gitStandInText(git, verbs), {
    mode: 0o755,
  });
  gitStandInFaulted(directory, verbs[0] ?? "", "Whole");
  return `${directory}:${process.env["PATH"] ?? ""}`;
}

/** What the stand-in has written, in order: the verb of each watched call, and `ended` for each late call that has ended. */
export function gitStandInLines(directory: string): readonly string[] {
  const calls = join(directory, "calls");
  if (!existsSync(calls)) return [];
  return readFileSync(calls, "utf8").split("\n").filter(Boolean);
}
