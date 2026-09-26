/**
 * Which worker contract a request and an answer speak. Each side names its
 * release in one header, and a plane serves a range of versions and refuses the
 * rest by name. A version is a release's major and minor; the patch moves only
 * the packaging, so two releases differing in it speak one wire.
 */

import { z } from "zod";

/** The release of the worker contract, which versions the package `scripts/pack-worker-contract.ts` builds. */
export const workerContractRelease = "1.1.0";

/** The header a pod or a pool names its release in, and a plane answers with its own. */
export const workerContractHeader = "chuggy-worker-contract";

/** One version of the wire. */
export interface WorkerContractVersion {
  readonly major: number;
  readonly minor: number;
}

/** What a request naming no release speaks. */
export const workerContractUnnamed: WorkerContractVersion = {
  major: 1,
  minor: 0,
};

/** A release as the header carries it: major, minor and patch, each written without a leading zero. */
const workerContractReleasePattern =
  /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/u;

/** The version a release speaks, or nothing where the text is no release. */
export function workerContractVersionOf(
  release: string,
): WorkerContractVersion | undefined {
  const parts = workerContractReleasePattern.exec(release);
  return parts === null
    ? undefined
    : { major: Number(parts[1]), minor: Number(parts[2]) };
}

/** A version as a refusal names it. */
export function workerContractVersionText(
  version: WorkerContractVersion,
): string {
  return `${String(version.major)}.${String(version.minor)}`;
}

const workerContractVersionTextSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u);

/** A request refused for the release it named, or for naming none where the plane no longer serves the first. */
export const contractVersionRefusalSchema = z.object({
  action: z.literal("stop"),
  reason: z.literal("UnsupportedContractVersion"),
  accepted: z.object({
    min: workerContractVersionTextSchema,
    max: workerContractVersionTextSchema,
  }),
});
export type ContractVersionRefusal = z.infer<
  typeof contractVersionRefusalSchema
>;

/** The status a refusal is answered with, which a route may share with a stop of its own. */
export const contractVersionRefusalStatus = 409;
