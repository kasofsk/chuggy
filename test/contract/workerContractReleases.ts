/**
 * The releases of the worker contract this server still serves below its own,
 * and how a suite reads one. A plane serves every history entry its accepted
 * range holds; each older one is installed as a devDependency named for its
 * release, from the asset its tag was published with, and is read through its
 * own emitted modules rather than this tree's sources. A body one of its schemas
 * builds is walked through every roster value that schema names.
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

/**
 * Hands `visit` every schema that reads `value` along the way, with the path to
 * it and what the value holds there, a field left out included. A union is
 * followed down the member that reads the value, which its parse answers with.
 */
function workerContractVisited(
  schema: z.ZodType,
  value: unknown,
  path: string,
  visit: (schema: z.ZodType, value: unknown, path: string) => void,
): void {
  visit(schema, value, path);
  if (value === undefined) return;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodExactOptional)
    workerContractVisited(schema.unwrap() as z.ZodType, value, path, visit);
  else if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Readonly<Record<string, z.ZodType>>;
    for (const [key, field] of Object.entries(shape))
      workerContractVisited(
        field,
        (value as Readonly<Record<string, unknown>>)[key],
        `${path}.${key}`,
        visit,
      );
  } else if (schema instanceof z.ZodArray)
    for (const item of value as readonly unknown[])
      workerContractVisited(
        schema.element as z.ZodType,
        item,
        `${path}[]`,
        visit,
      );
  else if (schema instanceof z.ZodUnion) {
    const members = schema.options as readonly z.ZodType[];
    const index = members.findIndex(
      (member) => member.safeParse(value).success,
    );
    const member = members[index];
    if (member !== undefined)
      workerContractVisited(member, value, `${path}|${String(index)}`, visit);
  }
}

/** Marks every optional field `schema` names along `value` as present or absent under its path. */
export function workerContractOptionalsSeen(
  schema: z.ZodType,
  value: unknown,
  path: string,
  seen: Map<string, Set<boolean>>,
): void {
  workerContractVisited(schema, value, path, (field, held, at) => {
    if (field instanceof z.ZodOptional || field instanceof z.ZodExactOptional)
      seen.set(at, (seen.get(at) ?? new Set()).add(held !== undefined));
  });
}

/** Marks the value each roster `schema` reads along `value` holds, under its path. */
export function workerContractEnumsSeen(
  schema: z.ZodType,
  value: unknown,
  path: string,
  seen: Map<string, Set<unknown>>,
): void {
  workerContractVisited(schema, value, path, (field, held, at) => {
    if (field instanceof z.ZodEnum)
      seen.set(at, (seen.get(at) ?? new Set()).add(held));
  });
}

/**
 * `body` first, then again for each other value of each enum `schema` reads in
 * it, the rest held, so a roster is offered whole wherever the body offers one
 * member. A union is followed down the member that reads the body.
 */
export function workerContractEnumsWalked(
  schema: z.ZodType,
  body: unknown,
): readonly unknown[] {
  if (schema instanceof z.ZodEnum)
    return [body, ...schema.options.filter((value) => value !== body)];
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodExactOptional)
    return body === undefined
      ? [body]
      : workerContractEnumsWalked(schema.unwrap() as z.ZodType, body);
  if (schema instanceof z.ZodUnion) {
    const member = (schema.options as readonly z.ZodType[]).find(
      (option) => option.safeParse(body).success,
    );
    return member === undefined
      ? [body]
      : workerContractEnumsWalked(member, body);
  }
  if (schema instanceof z.ZodObject) {
    const held = body as Readonly<Record<string, unknown>>;
    const shape = schema.shape as Readonly<Record<string, z.ZodType>>;
    return [
      held,
      ...Object.entries(shape).flatMap(([key, field]) =>
        workerContractEnumsWalked(field, held[key])
          .slice(1)
          .map((value) => ({ ...held, [key]: value })),
      ),
    ];
  }
  if (schema instanceof z.ZodArray) {
    const items = body as readonly unknown[];
    return [
      items,
      ...items.flatMap((item, index) =>
        workerContractEnumsWalked(schema.element as z.ZodType, item)
          .slice(1)
          .map((value) =>
            items.map((each, at) => (at === index ? value : each)),
          ),
      ),
    ];
  }
  return [body];
}
