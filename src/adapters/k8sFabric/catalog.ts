/**
 * The task-type catalog: the deployment configuration a ticket's task type
 * names, parsed the way the journal is — a schema mirroring the declared type,
 * refusing what it does not describe.
 *
 * IT IS A FILE AT A CONFIGURED PATH, NEVER CONTENT OF A PROJECT'S REPOSITORY.
 * A spec a work branch could rewrite is work granting itself capability, which
 * the authority split's node-local tier forbids; the command a type runs may
 * live in the repository, because it runs inside the sandbox the spawn granted
 * and decides nothing about grants.
 *
 * EVERY TYPE CARRIES A DEADLINE AND A RELAUNCH LIMIT, required rather than
 * defaulted: they are what discharge the model's trusted fabric axioms on
 * every Job this adapter writes, and a type that omitted them would be a spawn
 * the axioms do not cover. The CHUG_ environment names are refused here
 * because they are the spawner's own vocabulary, so a catalog cannot bend
 * what a job is told about itself.
 *
 * AN UNSERVABLE CATALOG ENDS CONSTRUCTION. A fabric that cannot say what any
 * type runs cannot serve a single spawn, so `catalogLoad` throws where the
 * per-delivery reads refuse by returning.
 */

import { readFileSync } from "node:fs";

import * as z from "zod";

import {
  parseRefusal,
  type Mirrors,
  type Parsed,
} from "../../interpreter/wire.ts";

/** One resource band, in the API's own quantity strings. */
export interface CatalogAmounts {
  readonly cpu: string;
  readonly memory: string;
}

/** What a task's container asks of the node, written onto the Job verbatim. */
export interface CatalogResources {
  readonly requests: CatalogAmounts;
  readonly limits: CatalogAmounts;
}

/** How a type's work runs: the image, the command, and the environment the type adds. */
export interface CatalogWork {
  readonly image: string;
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** How a type's evaluation runs; it installs the work artifact, so it names no environment of its own. */
export interface CatalogEval {
  readonly image: string;
  readonly command: readonly string[];
}

/** Everything the fabric needs to run one task type. */
export interface CatalogTaskType {
  readonly work: CatalogWork;
  readonly eval: CatalogEval;
  readonly resources: CatalogResources;
  readonly activeDeadlineSeconds: number;
  readonly backoffLimit: number;
}

/** The whole catalog, keyed by the type name a ticket's annex carries. */
export type Catalog = Readonly<Record<string, CatalogTaskType>>;

const catalogAmountsSchema = z.object({
  cpu: z.string().min(1),
  memory: z.string().min(1),
});

const catalogCommandSchema = z.array(z.string().min(1)).min(1).readonly();

const catalogEnvSchema = z
  .record(z.string().min(1), z.string())
  .readonly()
  .refine(
    (env) => Object.keys(env).every((name) => !name.startsWith("CHUG_")),
    {
      message: "names a CHUG_ variable, and those are the spawner's own",
    },
  );

const catalogTaskTypeSchema = z.object({
  work: z.object({
    image: z.string().min(1),
    command: catalogCommandSchema,
    env: catalogEnvSchema,
  }),
  eval: z.object({
    image: z.string().min(1),
    command: catalogCommandSchema,
  }),
  resources: z.object({
    requests: catalogAmountsSchema,
    limits: catalogAmountsSchema,
  }),
  activeDeadlineSeconds: z.int().min(1),
  backoffLimit: z.int().min(0),
});

const catalogSchema = z
  .record(z.string().min(1), catalogTaskTypeSchema)
  .readonly();

/** The compile-time half of the parse: the schema and the declared type describe each other, on every build. */
export const catalogSchemaMirrorsCatalog: Mirrors<
  z.infer<typeof catalogSchema>,
  Catalog
> = true;

/** Reads one catalog off a parsed file, refusing anything the vocabulary does not describe. */
export function parseCatalog(raw: unknown): Parsed<Catalog> {
  const result = catalogSchema.safeParse(raw);
  return result.success
    ? { parsed: "Ok", value: result.data }
    : { parsed: "Refused", why: parseRefusal(result.error) };
}

/** The catalog at the configured path, or the construction failure a fabric that cannot run anything is. */
export function catalogLoad(path: string): Catalog {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (failure) {
    throw new Error(
      `k8sFabric: the catalog at ${path} cannot be read — ${failure instanceof Error ? failure.message : String(failure)}`,
      { cause: failure },
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (failure) {
    throw new Error(`k8sFabric: the catalog at ${path} is not JSON`, {
      cause: failure,
    });
  }
  const parsed = parseCatalog(raw);
  if (parsed.parsed === "Refused") {
    throw new Error(
      `k8sFabric: the catalog at ${path} was refused — ${parsed.why}`,
    );
  }
  return parsed.value;
}
