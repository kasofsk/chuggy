/**
 * The releases of the worker contract this server still serves below its own,
 * and how a suite reads one. A plane serves every history entry its accepted
 * range holds; each older one is installed as a devDependency named for its
 * release, from the asset its tag was published with, and is read through its
 * own emitted modules rather than this tree's sources.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { workspaceManifest } from "../../scripts/pack-worker-contract.ts";
import { workerContractTag } from "../../scripts/publish-worker-contract.ts";
import {
  workerContractHistory,
  workerContractHistoryLater,
  type WorkerContractHistory,
} from "../../scripts/worker-contract-wire.ts";
import type { WorkerPlaneAnswer } from "../../src/contract/planeAnswers.ts";
import { workerContractRelease } from "../../src/contract/workerContract.ts";
import type { WorkerPlaneRoute } from "../../src/contract/workerPlane.ts";
import {
  contractVersionAccepted,
  workerContractAccepted,
  type WorkerContractRange,
} from "../../src/interpreter/workerPlane.ts";
import { workerPoolContractAccepted } from "../../src/interpreter/workerPool.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const manifest = workspaceManifest();

/** Every plane a harness speaks, and the range of versions the server serves on it. */
export const workerContractPlanes = {
  job: workerContractAccepted,
  session: workerContractAccepted,
  pool: workerPoolContractAccepted,
} as const satisfies Readonly<Record<string, WorkerContractRange>>;
export type WorkerContractPlane = keyof typeof workerContractPlanes;

/** The releases in `history` below `served` that `range` accepts, in the history's order. */
export function workerContractReleasesBelow(
  history: readonly Pick<WorkerContractHistory[number], "release">[],
  range: WorkerContractRange,
  served: string,
): readonly string[] {
  return history
    .map(({ release }) => release)
    .filter(
      (release) =>
        workerContractHistoryLater(release, served) &&
        contractVersionAccepted(range, release),
    );
}

/** The releases below this tree's own that `plane` still serves. */
export function workerContractReplayed(
  plane: WorkerContractPlane,
): readonly string[] {
  return workerContractReleasesBelow(
    workerContractHistory(),
    workerContractPlanes[plane],
    workerContractRelease,
  );
}

/** The name an older release is installed under. */
export function workerContractAlias(release: string): string {
  return `${manifest.name}-${release}`;
}

/** Where an installed release's files are. */
export function workerContractInstalled(release: string): string {
  return join(root, "node_modules", workerContractAlias(release));
}

/** The asset a release was published as, named as `npm pack` names a scoped package's tarball. */
export function workerContractAsset(release: string): string {
  const tarball = `${manifest.name.replace(/^@/u, "").replace("/", "-")}-${release}.tgz`;
  return `https://github.com/kasofsk/chuggy/releases/download/${workerContractTag(release)}/${tarball}`;
}

/** Every older release this tree installs, by the specifier its manifest names each with. */
export function workerContractAliases(): ReadonlyMap<string, string> {
  const installed = z
    .object({ devDependencies: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
  return new Map(
    Object.entries(installed.devDependencies).filter(([name]) =>
      name.startsWith(`${manifest.name}-`),
    ),
  );
}

/** Every export of one entry of an older release, read from the release's own emitted module. */
async function workerContractReleaseEntry(
  release: string,
  entry: string,
): Promise<Readonly<Record<string, unknown>>> {
  return (await import(`${workerContractAlias(release)}/${entry}`)) as Readonly<
    Record<string, unknown>
  >;
}

/** One export of one entry of an older release, refused where the release does not export it as `schema` reads it. */
export async function workerContractReleaseExport<Value>(
  release: string,
  entry: string,
  name: string,
  schema: z.ZodType<Value>,
): Promise<Value> {
  const exported = await workerContractReleaseEntry(release, entry);
  const read = schema.safeParse(exported[name]);
  if (!read.success)
    throw new Error(
      `${release}'s ${entry} exports no ${name} this suite can read: ${read.error.message}`,
    );
  return read.data;
}

/** A schema as an older release built it, which is this tree's zod, the package's peer. */
export const workerContractReleaseSchema = z.custom<z.ZodType>(
  (value) => value instanceof z.ZodType,
);

const workerContractReleaseRoutes = z.record(
  z.string(),
  z.strictObject({
    method: z.enum(["GET", "POST", "PUT"]),
    path: z.string(),
  }),
);

const workerContractReleaseAnswers = z.record(
  z.string(),
  z.record(
    z.string(),
    z.union([z.literal("empty"), workerContractReleaseSchema]),
  ),
);

/** One plane as an older release's pod speaks it: the routes it calls, how it reads each answer, and the schemas its entry exports. */
export interface WorkerContractReleasePlane {
  readonly release: string;
  readonly routes: Readonly<Record<string, WorkerPlaneRoute>>;
  readonly answers: Readonly<
    Record<string, Readonly<Record<number, WorkerPlaneAnswer>>>
  >;
  readonly schemas: Readonly<Record<string, z.ZodType>>;
}

/** The entry each plane a pod speaks is published in, and the names its routes and answers are exported under. */
const workerContractReleaseEntries = {
  job: {
    entry: "workerPlane",
    routes: "workerPlaneRoutes",
    answers: "workerPlaneAnswers",
  },
  session: {
    entry: "sessionPlane",
    routes: "sessionPlaneRoutes",
    answers: "sessionPlaneAnswers",
  },
} as const satisfies Partial<
  Record<WorkerContractPlane, Readonly<Record<string, string>>>
>;

/** `plane` as `release` speaks it. */
export async function workerContractReleasePlane(
  release: string,
  plane: keyof typeof workerContractReleaseEntries,
): Promise<WorkerContractReleasePlane> {
  const { entry, routes, answers } = workerContractReleaseEntries[plane];
  const exported = await workerContractReleaseEntry(release, entry);
  return {
    release,
    routes: await workerContractReleaseExport(
      release,
      entry,
      routes,
      workerContractReleaseRoutes,
    ),
    answers: await workerContractReleaseExport(
      release,
      entry,
      answers,
      workerContractReleaseAnswers,
    ),
    schemas: Object.fromEntries(
      Object.entries(exported).filter(
        (named): named is [string, z.ZodType] => named[1] instanceof z.ZodType,
      ),
    ),
  };
}
