/**
 * The releases of the worker contract a suite replays against this server, and
 * how it reads one. They are the releases on either side of each feature's
 * first version, the last the history records, and the packages listed as
 * deployed, each where a plane's range accepts the release its contract names.
 * The history is a frozen record of the releases published while a package's
 * label was the release its contract named. Each replayed is installed as a devDependency named for its
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
import type { WorkerPlaneAnswer } from "../../src/contract/planeAnswers.ts";
import {
  workerContractFeatures,
  workerContractVersionOf,
  type WorkerContractVersion,
} from "../../src/contract/workerContract.ts";
import type { WorkerPlaneRoute } from "../../src/contract/workerPlane.ts";
import {
  contractVersionAccepted,
  workerContractAccepted,
  type WorkerContractRange,
} from "../../src/interpreter/workerPlane.ts";
import { workerPoolContractAccepted } from "../../src/interpreter/workerPool.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const manifest = workspaceManifest();

const workerContractHistorySchema = z
  .array(
    z.strictObject({
      release: z
        .string()
        .refine((release) => workerContractVersionOf(release) !== undefined),
      wire: z.string().regex(/^[0-9a-f]{64}$/u),
      files: z.string().regex(/^[0-9a-f]{64}$/u),
    }),
  )
  .min(1);
export type WorkerContractHistory = z.infer<typeof workerContractHistorySchema>;

/** The history as this tree holds it, one entry per release it records, its files as `workerContractFilesDigest` reads them. */
export function workerContractHistory(): WorkerContractHistory {
  return workerContractHistorySchema.parse(
    JSON.parse(
      readFileSync(
        join(root, "test/contract/workerContract.history.json"),
        "utf8",
      ),
    ),
  );
}

/** One published package: the label it was published under, and the release its contract names in the header. */
export interface WorkerContractPackage {
  readonly label: string;
  readonly wire: string;
}

/** Every plane a harness speaks, and the range of versions the server serves on it. */
export const workerContractPlanes = {
  job: workerContractAccepted,
  session: workerContractAccepted,
  pool: workerPoolContractAccepted,
} as const satisfies Readonly<Record<string, WorkerContractRange>>;
export type WorkerContractPlane = keyof typeof workerContractPlanes;

/**
 * The packages replayed because something deployed installs one, by label.
 * What puts a label here is a pin in a harness's own repository, which this
 * tree holds only for the worker image's core.
 */
export const workerContractFieldReleases: readonly string[] = [
  "1.77.0",
  "1.78.0",
  "1.94.0",
  "1.115.0",
  "1.117.0",
  "1.131.0",
  "1.140.0",
];

/** Where the version `release` speaks sits against `version`: below it, at it, or past it. */
function workerContractReleaseAgainst(
  release: string,
  version: WorkerContractVersion,
): number {
  const spoken = workerContractVersionOf(release);
  if (spoken === undefined) throw new Error(`${release} is not a release`);
  return spoken.major === version.major
    ? Math.sign(spoken.minor - version.minor)
    : Math.sign(spoken.major - version.major);
}

/**
 * The labels replayed where `range` accepts the release each one's contract
 * names: for each version in `features` the first of `history` at it and the
 * last below it, the last of `history`, and every one of `field`. A release
 * the history records names itself, and they come in the history's order, then
 * any the history does not record.
 */
export function workerContractBaselines(
  history: readonly Pick<WorkerContractHistory[number], "release">[],
  features: readonly WorkerContractVersion[],
  range: WorkerContractRange,
  field: readonly WorkerContractPackage[],
): readonly string[] {
  const releases = history.map(({ release }) => release);
  const recorded = [
    ...features.flatMap((first) => [
      releases.find(
        (release) => workerContractReleaseAgainst(release, first) === 0,
      ),
      releases.findLast(
        (release) => workerContractReleaseAgainst(release, first) < 0,
      ),
    ]),
    releases.at(-1),
  ].filter((release) => release !== undefined);
  const replayed = new Set(
    [...recorded.map((label) => ({ label, wire: label })), ...field]
      .filter(({ wire }) => contractVersionAccepted(range, wire))
      .map(({ label }) => label),
  );
  return [
    ...releases.filter((release) => replayed.has(release)),
    ...field
      .map(({ label }) => label)
      .filter((label) => replayed.has(label) && !releases.includes(label)),
  ];
}

/**
 * Why a package is not one `range` is replayed with, or nothing where it is. A
 * label `history` records names itself in the header, and any other names a
 * release `range` accepts.
 */
export function workerContractPackageRefusal(
  history: readonly Pick<WorkerContractHistory[number], "release">[],
  range: WorkerContractRange,
  { label, wire }: WorkerContractPackage,
): string | undefined {
  if (history.some(({ release }) => release === label))
    return wire === label
      ? undefined
      : `the history records ${label}, and its contract names ${wire}`;
  return contractVersionAccepted(range, wire)
    ? undefined
    : `${label}'s contract names ${wire}, which the plane refuses`;
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

/** The release each installed package's own contract names in the header, by the name it is installed under. */
const workerContractWires: ReadonlyMap<string, string> = new Map(
  await Promise.all(
    [...workerContractAliases().keys()].map(
      async (alias) =>
        [
          alias,
          z
            .object({ workerContractRelease: z.string() })
            .parse(await import(`${alias}/workerContract`))
            .workerContractRelease,
        ] as const,
    ),
  ),
);

/** The release the package installed as `label` names in the header, which is what a plane reads of it. */
export function workerContractWireOf(label: string): string {
  const wire = workerContractWires.get(workerContractAlias(label));
  if (wire === undefined)
    throw new Error(`${workerContractAlias(label)} is not installed`);
  return wire;
}

/** The labels replayed on `plane`. */
export function workerContractReplayed(
  plane: WorkerContractPlane,
): readonly string[] {
  const versions: readonly (WorkerContractVersion | undefined)[] =
    Object.values(workerContractFeatures);
  return workerContractBaselines(
    workerContractHistory(),
    versions.filter((version) => version !== undefined),
    workerContractPlanes[plane],
    workerContractFieldReleases.map((label) => ({
      label,
      wire: workerContractWireOf(label),
    })),
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
    z.union([
      z.literal("empty"),
      z.literal("bytes"),
      workerContractReleaseSchema,
    ]),
  ),
);

/** One plane as an older release's pod speaks it: the routes it calls, how it reads each answer, and the schemas its entry exports. */
export interface WorkerContractReleasePlane {
  readonly release: string;

  /** The release its contract names in the header. */
  readonly wire: string;
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
    wire: workerContractWireOf(release),
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

/** The pool plane as an older release's pool speaks it: where it polls and under which names, where it settles, and the schemas it reads and builds with. */
export interface WorkerContractReleasePool {
  readonly release: string;

  /** The release its contract names in the header. */
  readonly wire: string;
  readonly pollRoute: string;

  /** The names the release's poll goes under. */
  readonly pollQuery: {
    readonly held: string;
    readonly wanted: string;
    readonly wantedSessions: string;
  };

  /** The header the release's poll names its runner in, where it names one. */
  readonly runnerHeader: string | undefined;

  /** The header the release's poll names its memory room in, where it names one. */
  readonly memoryRoomHeader: string | undefined;
  readonly settlementRoutes: Readonly<Record<string, string>>;
  readonly settlementPath: (outcome: string, assignment: string) => string;
  readonly reconciliation: z.ZodType;
  readonly outcome: z.ZodType;
}

/** The pool plane as `release` speaks it. */
export async function workerContractReleasePool(
  release: string,
): Promise<WorkerContractReleasePool> {
  const read = <Value>(name: string, schema: z.ZodType<Value>) =>
    workerContractReleaseExport(release, "workerPool", name, schema);
  return {
    release,
    wire: workerContractWireOf(release),
    pollRoute: await read("workerPoolPollRoute", z.string()),
    pollQuery: await read(
      "workerPoolPollQuery",
      z.object({
        held: z.string(),
        wanted: z.string(),
        wantedSessions: z.string(),
      }),
    ),
    runnerHeader: await read("workerRunnerHeader", z.string().optional()),
    memoryRoomHeader: await read(
      "workerRunnerMemoryRoomHeader",
      z.string().optional(),
    ),
    settlementRoutes: await read(
      "workerPoolSettlementRoutes",
      z.record(z.string(), z.string()),
    ),
    settlementPath: await read(
      "workerPoolSettlementPath",
      z.custom<(outcome: string, assignment: string) => string>(
        (value) => typeof value === "function",
      ),
    ),
    reconciliation: await read(
      "workerPoolReconciliationSchema",
      workerContractReleaseSchema,
    ),
    outcome: await read("assignmentOutcomeSchema", workerContractReleaseSchema),
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

/** Marks each roster value `value` holds where `schema` reads a roster, under that roster's path. */
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
 * member. A union is followed down the member that reads the body, and an
 * object's variant its own refinement refuses is left out, being no body a
 * release builds: a value it ties to another field is offered by a body that
 * carries that field.
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
      ...Object.entries(shape)
        .flatMap(([key, field]) =>
          workerContractEnumsWalked(field, held[key])
            .slice(1)
            .map((value) => ({ ...held, [key]: value })),
        )
        .filter((variant) => schema.safeParse(variant).success),
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
