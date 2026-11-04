/**
 * A repository a git suite builds its history in or pushes to. Git's automatic
 * housekeeping is off in it, because by default that housekeeping detaches,
 * and a detached process ends as a child no process collects.
 */

import { execFileSync } from "node:child_process";

/** Initialises a repository on `main` at `directory`, bare where asked, that sets off no housekeeping. */
export function gitFixtureRepository(
  directory: string,
  ...options: readonly "--bare"[]
): void {
  execFileSync("git", ["init", "-q", ...options, "-b", "main", directory]);
  execFileSync("git", ["-C", directory, "config", "gc.auto", "0"]);
  execFileSync("git", ["-C", directory, "config", "maintenance.auto", "false"]);
}
