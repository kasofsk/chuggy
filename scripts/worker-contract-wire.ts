/**
 * The worker contract's wire as one digest, and the history that names the
 * release each wire was published as.
 *
 * THE DIGEST IS TAKEN OVER EVERY EXPORT OF EVERY ENTRY THE PACKAGE NAMES, read
 * off the modules rather than listed, so an export added or removed moves it
 * like a value changed. A schema is the JSON Schema it reads and the one it
 * writes, a refinement, a transform and a function are their source, and
 * every other value is itself.
 *
 * IT SEES A NAME AND NOT WHAT THE NAME HOLDS. Source reads a value by its name,
 * so a value only a refinement, a transform or a function reads, changed
 * alone, moves no digest.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

import { workerContractVersionOf } from "../src/contract/workerContract.ts";
import { workspaceManifest } from "./pack-worker-contract.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Where the history is kept, one entry per published release. */
export const workerContractHistoryPath = join(
  root,
  "test/contract/workerContract.history.json",
);

const workerContractHistorySchema = z
  .array(
    z.strictObject({
      release: z
        .string()
        .refine((release) => workerContractVersionOf(release) !== undefined),
      wire: z.string().regex(/^[0-9a-f]{64}$/u),
    }),
  )
  .min(1);

export type WorkerContractHistory = z.infer<typeof workerContractHistorySchema>;

/** The history as this tree holds it. */
export function workerContractHistory(): WorkerContractHistory {
  return workerContractHistorySchema.parse(
    JSON.parse(readFileSync(workerContractHistoryPath, "utf8")),
  );
}

/** A function's source with its whitespace collapsed, so a reformatting is not a change. */
function workerContractWireSource(held: unknown): string | undefined {
  return typeof held === "function"
    ? held.toString().replace(/\s+/gu, " ")
    : undefined;
}

/** A schema's refinements and transforms as their source, which is what its JSON Schema cannot state. */
function workerContractWireChecks(schema: z.core.$ZodType): readonly string[] {
  const definition = schema._zod.def as {
    readonly checks?: readonly z.core.$ZodCheck[];
    readonly in?: z.core.$ZodType;
    readonly out?: z.core.$ZodType;
  };
  const pipeSides = [definition.in, definition.out].map((side) =>
    side instanceof z.ZodTransform ? side._zod.def.transform : undefined,
  );
  const refinements = (definition.checks ?? []).map((check) =>
    "fn" in check._zod.def ? check._zod.def.fn : undefined,
  );
  return [...refinements, ...pipeSides].flatMap(
    (held) => workerContractWireSource(held) ?? [],
  );
}

/** One schema in both directions, each node that holds source carrying it. */
function workerContractWireSchema(schema: z.ZodType): unknown {
  return Object.fromEntries(
    (["input", "output"] as const).map((direction) => [
      direction,
      z.toJSONSchema(schema, {
        io: direction,
        unrepresentable: "any",
        override: ({ zodSchema, jsonSchema }) => {
          const checks = workerContractWireChecks(zodSchema);
          if (checks.length > 0) jsonSchema["x-source"] = checks;
        },
      }),
    ]),
  );
}

/** One export as the digest reads it, an object's keys in order so the order they were written in is not a change. */
function workerContractWireValue(held: unknown): unknown {
  if (held instanceof z.ZodType)
    return { schema: workerContractWireSchema(held) };
  if (held instanceof RegExp)
    return { regexp: { source: held.source, flags: held.flags } };
  if (typeof held === "function")
    return { function: workerContractWireSource(held) };
  if (held === undefined) return { undefined: true };
  if (Array.isArray(held)) return held.map(workerContractWireValue);
  if (typeof held === "object" && held !== null)
    return Object.fromEntries(
      Object.keys(held)
        .sort()
        .map((key) => [
          key,
          workerContractWireValue((held as Record<string, unknown>)[key]),
        ]),
    );
  return held;
}

/** The wire as it stands in this tree, as a sha256 over every export of every entry. */
export async function workerContractWire(): Promise<string> {
  const entries = Object.entries(workspaceManifest().exports).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const wire: Record<string, unknown> = {};
  for (const [entry, source] of entries) {
    const module = (await import(
      pathToFileURL(join(root, "src/contract", source)).href
    )) as Record<string, unknown>;
    wire[entry] = workerContractWireValue({ ...module });
  }
  return createHash("sha256").update(JSON.stringify(wire)).digest("hex");
}

/** Whether `later` is a later release than `earlier`, each read as its three numbers. */
function workerContractHistoryLater(earlier: string, later: string): boolean {
  const right = later.split(".").map(Number);
  for (const [index, part] of earlier.split(".").map(Number).entries()) {
    const other = right[index] ?? 0;
    if (part !== other) return part < other;
  }
  return false;
}

/** The version a release speaks, which is all of it but its patch. */
function workerContractHistoryVersion(release: string): string {
  return release.slice(0, release.lastIndexOf("."));
}

/**
 * Why `history` does not name `release` as the wire `wire` is, or nothing
 * where it does. Releases only rise, the last is `release` at `wire`, and a
 * wire that moved between two entries moved their major or minor, because a
 * patch moves only the packaging.
 */
export function workerContractHistoryRefusal(
  history: WorkerContractHistory,
  release: string,
  wire: string,
): string | undefined {
  for (const [index, entry] of history.entries()) {
    const earlier = history[index - 1];
    if (earlier === undefined) continue;
    if (!workerContractHistoryLater(earlier.release, entry.release))
      return `${entry.release} does not follow ${earlier.release}`;
    if (
      earlier.wire !== entry.wire &&
      workerContractHistoryVersion(earlier.release) ===
        workerContractHistoryVersion(entry.release)
    )
      return `${entry.release} moved the wire in a patch`;
  }
  const last = history.at(-1);
  if (last?.release !== release)
    return `the history's last release is ${String(last?.release)}, and the contract's is ${release}: add its entry`;
  if (last.wire !== wire)
    return `the wire is no longer the one ${release} was published as: move the release, and add its entry`;
  return undefined;
}
