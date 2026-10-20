/**
 * The release chuggy pins for each runner package, kept beside the roots that
 * read it because the image they run in ships `src/` and nothing else. The
 * pool plane answers a runner's poll with its package's pin, and the API shows
 * it beside the version each runner named.
 *
 * A PIN THAT DOES NOT PARSE REFUSES THE START, so a malformed one is never
 * served as a site that pins nothing. `just pin-runner-release` writes it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  workerRunnerReleasesRead,
  type WorkerRunnerReleases,
} from "../interpreter/workerRunnerRelease.ts";

/** Where the pins are kept: each runner package's release, by package. */
export const runnerReleasesPath = fileURLToPath(
  new URL("./runnerReleases.json", import.meta.url),
);

/** The pins kept at `path`, or the refusal naming the file and what is wrong with it. */
export function runnerReleasesPinned(
  path: string = runnerReleasesPath,
): WorkerRunnerReleases {
  try {
    return workerRunnerReleasesRead(JSON.parse(readFileSync(path, "utf8")));
  } catch (failure) {
    throw new Error(
      `${path} is no pin of each runner package's release: ${failure instanceof Error ? failure.message : String(failure)}`,
      { cause: failure },
    );
  }
}
