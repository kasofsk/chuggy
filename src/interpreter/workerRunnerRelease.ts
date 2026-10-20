/**
 * The release chuggy pins for each runner package, and what a runner is told
 * of it: a poll's answer names its package's pin, and a reader is shown the
 * version a runner named beside the one pinned for its package.
 *
 * A PIN IS A RELEASE, NEVER A CHANNEL. It names one version, the address of its
 * tarball and the integrity of those bytes, and moves only when the pin does.
 */

import { z } from "zod";

import {
  workerRunnerPackageSchema,
  workerRunnerReleaseSchema,
  type WorkerRunner,
  type WorkerRunnerRelease,
} from "../contract/workerPool.ts";
import {
  contractVersionAccepted,
  workerContractRunnerReleases,
} from "./workerPlane.ts";

/** The release pinned for each runner package, by package. */
export type WorkerRunnerReleases = ReadonlyMap<string, WorkerRunnerRelease>;

/** The pins as they are kept: each package's release, less the package its key already names. */
const workerRunnerPinsSchema = z.record(
  workerRunnerPackageSchema,
  workerRunnerReleaseSchema.omit({ package: true }),
);

/** The pins `kept` holds, thrown on where it is not a pin of each package it names. */
export function workerRunnerReleasesRead(kept: unknown): WorkerRunnerReleases {
  return new Map(
    Object.entries(workerRunnerPinsSchema.parse(kept)).map(
      ([named, release]) => [named, { package: named, ...release }],
    ),
  );
}

/**
 * The release a poll's answer names: the one pinned for the package the poll's
 * runner named, where the release the poll offered reads one, and nothing
 * otherwise.
 */
export function workerRunnerReleaseAnswered(
  releases: WorkerRunnerReleases,
  runner: WorkerRunner | undefined,
  offered: string | undefined,
): WorkerRunnerRelease | undefined {
  return runner !== undefined &&
    contractVersionAccepted(workerContractRunnerReleases, offered)
    ? releases.get(runner.package)
    : undefined;
}

/** A runner as a reader is shown it: what its newest poll named, and the version pinned for its package where one is. */
export interface WorkerRunnerListed extends WorkerRunner {
  readonly pinned?: string;
}

/** `runner` as a reader is shown it, or nothing where its poll named none. */
export function workerRunnerListed(
  releases: WorkerRunnerReleases,
  runner: WorkerRunner | undefined,
): WorkerRunnerListed | undefined {
  if (runner === undefined) return undefined;
  const named = { package: runner.package, version: runner.version };
  const pinned = releases.get(runner.package)?.version;
  return pinned === undefined ? named : { ...named, pinned };
}
