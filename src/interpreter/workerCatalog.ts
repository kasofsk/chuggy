/**
 * The label an admitted image is published under, and the rule a deployment's
 * catalog entry has to satisfy to carry one.
 *
 * A LABEL SITS BESIDE THE IMAGE AND NEVER INSIDE IT. An execution requirement
 * pins a digest and the model derives its identity from that digest alone, so
 * nothing here reaches a requirement, a revision or anything either is hashed
 * over — a catalogued name is read out of the catalog by image and is absent
 * where the image was never published.
 *
 * A NAME IS A REPOSITORY CONFIGURATION NAME, spelled by that module's own rule
 * rather than by a copy of it. A version is only bounded text: it is whatever
 * the release that admitted the image calls itself, and no reader picks an
 * entry out of a list by it.
 */

import { asRepositoryConfigurationName } from "./repositoryConfigurationIdentity.ts";

/** The label an image carries in front of a reader, as the catalog holds it. */
export interface Worker {
  readonly name: string;
  readonly version: string;
}

/** One entry of a deployment's admitted-images list that named itself. */
export interface AdmittedWorker extends Worker {
  readonly image: string;
}

export const workerImageCharsMax = 512;
export const workerVersionCharsMax = 64;

/** The most entries one deployment's admitted-images list may carry. */
export const admittedImagesMax = 100;

export function asWorkerName(value: unknown): string | undefined {
  return asRepositoryConfigurationName(value);
}

export function asWorkerVersion(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= workerVersionCharsMax &&
    value.isWellFormed()
    ? value
    : undefined;
}
