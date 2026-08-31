/**
 * What this adapter needs to be there before it can serve any promotion at all:
 * a git that writes merge trees, and a scratch it can work in.
 *
 * A PREREQUISITE IS A VERDICT AND NOT AN EXCEPTION HERE. `scratchOpen` refuses
 * both of these at construction, which is right for a composition and useless
 * to a process that has to say which of its preconditions is unmet; these ask
 * the same two questions in the vocabulary a runtime reports.
 *
 * THE SCRATCH IS MADE RATHER THAN REQUIRED. Making one is what opening one
 * already does, so a check that insisted on finding it would refuse a
 * deployment this adapter would have served.
 */

import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";

import {
  runtimePreconditionAnswer,
  type RuntimePrecondition,
} from "../../interpreter/serviceRuntime.ts";
import { gitRun, gitVersionAdmits, type GitEnvironment } from "./gitRun.ts";

/** The bound the one call this asks for an answer on is made under. */
const gitAvailableTimeoutSecsMax = 30;

/** Requires a git that writes merge trees on the path this environment names. */
export function gitAvailablePrecondition(
  environment: GitEnvironment,
): RuntimePrecondition {
  return {
    name: "git-available",
    check: async (signal) => {
      signal.throwIfAborted();
      const ran = await gitRun({
        directory: ".",
        argv: ["--version"],
        timeoutSecsMax: gitAvailableTimeoutSecsMax,
        environment,
      });
      if (ran.ran !== "Exited" || ran.code !== 0)
        return {
          met: "Undecided",
          why: `git --version did not run: ${ran.ran}`,
        };
      return runtimePreconditionAnswer(
        gitVersionAdmits(ran.stdout),
        `the git on this path is not one that writes merge trees: ${ran.stdout}`,
      );
    },
  };
}

/** Requires the scratch directory to be one this process can make and write in. */
export function gitScratchWritablePrecondition(
  directory: string,
): RuntimePrecondition {
  return {
    name: "git-scratch-writable",
    check: async (signal) => {
      signal.throwIfAborted();
      await mkdir(directory, { recursive: true });
      signal.throwIfAborted();
      await access(directory, constants.W_OK | constants.X_OK);
      return { met: "Met" };
    },
  };
}
