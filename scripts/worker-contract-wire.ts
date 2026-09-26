/**
 * The worker contract's wire as one digest, and the history that names the
 * release each wire was published as.
 *
 * THE DIGEST IS TAKEN OVER EVERY EXPORT OF EVERY ENTRY THE PACKAGE NAMES, read
 * off the modules rather than listed, so an export added or removed moves it
 * like a value changed. A schema is the JSON Schema it reads and the one it
 * writes, a refinement, a transform and a function are their tokens, and
 * every other value is itself. Tokens leave out comments, whitespace and
 * trailing commas, so a formatter moves no digest.
 *
 * SOURCE READS A VALUE BY ITS NAME, so every contract name a source reads is
 * taken too: as the value its module exports, or as its declaration's tokens
 * where the module keeps it. A name is matched by its text alone, so one that
 * merely shares a contract name's text makes the digest read more, never less,
 * and a module binding a name under another, or out of a pattern, is refused
 * rather than lost.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
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

/** One token of source, and whether it is a name the digest follows into the contract. */
interface WorkerContractWireToken {
  readonly text: string;
  readonly reads: boolean;
}

/** `node`'s tokens, without the comments, whitespace and trailing commas a formatter moves. */
function workerContractWireTokens(
  node: ts.Node,
  file: ts.SourceFile,
): readonly WorkerContractWireToken[] {
  const children = node.getChildren(file);
  if (children.length === 0) {
    const text = node.getText(file);
    if (text === "") return [];
    return [{ text, reads: ts.isIdentifier(node) }];
  }
  return children.flatMap((child, index) =>
    ts.isJSDoc(child) ||
    (node.kind === ts.SyntaxKind.SyntaxList &&
      child.kind === ts.SyntaxKind.CommaToken &&
      index === children.length - 1)
      ? []
      : workerContractWireTokens(child, file),
  );
}

/** Tokens as the digest reads them, each name they read added to `reads`. */
function workerContractWireText(
  tokens: readonly WorkerContractWireToken[],
  reads: Set<string>,
): string {
  for (const token of tokens) if (token.reads) reads.add(token.text);
  return tokens.map((token) => token.text).join(" ");
}

/** A function's source as the digest reads it, each name it reads added to `reads`. */
export function workerContractWireSourceText(
  source: string,
  reads: Set<string>,
): string {
  const file = ts.createSourceFile(
    "held.ts",
    `(${source}\n)`,
    ts.ScriptTarget.Latest,
    true,
  );
  return workerContractWireText(workerContractWireTokens(file, file), reads);
}

/** A function as its tokens, or nothing where `held` is no function. */
function workerContractWireSource(
  held: unknown,
  reads: Set<string>,
): string | undefined {
  return typeof held === "function"
    ? workerContractWireSourceText(held.toString(), reads)
    : undefined;
}

/** A schema's refinements and transforms as their source, which is what its JSON Schema cannot state. */
function workerContractWireChecks(
  schema: z.core.$ZodType,
  reads: Set<string>,
): readonly string[] {
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
    (held) => workerContractWireSource(held, reads) ?? [],
  );
}

/** One schema in both directions, each node that holds source carrying it. */
function workerContractWireSchema(
  schema: z.ZodType,
  reads: Set<string>,
): unknown {
  return Object.fromEntries(
    (["input", "output"] as const).map((direction) => [
      direction,
      z.toJSONSchema(schema, {
        io: direction,
        unrepresentable: "any",
        override: ({ zodSchema, jsonSchema }) => {
          const checks = workerContractWireChecks(zodSchema, reads);
          if (checks.length > 0) jsonSchema["x-source"] = checks;
        },
      }),
    ]),
  );
}

/** One value as the digest reads it, an object's keys in order so the order they were written in is not a change. */
function workerContractWireValue(held: unknown, reads: Set<string>): unknown {
  if (held instanceof z.ZodType)
    return { schema: workerContractWireSchema(held, reads) };
  if (held instanceof RegExp)
    return { regexp: { source: held.source, flags: held.flags } };
  if (typeof held === "function")
    return { function: workerContractWireSource(held, reads) };
  if (held === undefined) return { undefined: true };
  if (Array.isArray(held))
    return held.map((item: unknown) => workerContractWireValue(item, reads));
  if (typeof held === "object" && held !== null)
    return Object.fromEntries(
      Object.keys(held)
        .sort()
        .map((key) => [
          key,
          workerContractWireValue(
            (held as Record<string, unknown>)[key],
            reads,
          ),
        ]),
    );
  return held;
}

/** One module of the contract: what it exports, and what it declares at its top level. */
interface WorkerContractModule {
  readonly source: string;
  readonly exports: Readonly<Record<string, unknown>>;
  readonly file: ts.SourceFile;
  readonly declared: ReadonlyMap<string, ts.Node>;
}

/** Whether a module binds a name a reader matching names by their text would lose: under another name, or out of a pattern. */
function workerContractUnfollowed(file: ts.SourceFile): boolean {
  return file.statements.some((statement) => {
    if (ts.isVariableStatement(statement))
      return statement.declarationList.declarations.some(
        (declaration) => !ts.isIdentifier(declaration.name),
      );
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      return (
        statement.importClause?.name !== undefined ||
        (bindings !== undefined &&
          ts.isNamedImports(bindings) &&
          bindings.elements.some(
            (element) => element.propertyName !== undefined,
          ))
      );
    }
    const exported = ts.isExportDeclaration(statement)
      ? statement.exportClause
      : undefined;
    return (
      exported !== undefined &&
      ts.isNamedExports(exported) &&
      exported.elements.some((element) => element.propertyName !== undefined)
    );
  });
}

/** Every module of the contract, whether an entry exports it or not. */
async function workerContractModules(): Promise<
  readonly WorkerContractModule[]
> {
  const directory = join(root, "src/contract");
  const sources = readdirSync(directory)
    .filter((source) => source.endsWith(".ts"))
    .sort();
  return Promise.all(
    sources.map(async (source) => {
      const path = join(directory, source);
      const file = ts.createSourceFile(
        source,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      if (workerContractUnfollowed(file))
        throw new Error(
          `${source} binds a name the digest cannot follow by its text`,
        );
      const declared = file.statements.flatMap(
        (statement): [string, ts.Node][] => {
          if (ts.isVariableStatement(statement))
            return statement.declarationList.declarations.flatMap(
              (declaration): [string, ts.Node][] =>
                ts.isIdentifier(declaration.name)
                  ? [[declaration.name.text, declaration]]
                  : [],
            );
          return (ts.isFunctionDeclaration(statement) ||
            ts.isClassDeclaration(statement)) &&
            statement.name !== undefined
            ? [[statement.name.text, statement]]
            : [];
        },
      );
      return {
        source,
        exports: {
          ...((await import(pathToFileURL(path).href)) as Record<
            string,
            unknown
          >),
        },
        file,
        declared: new Map(declared),
      };
    }),
  );
}

/**
 * The wire as it stands in this tree, as a sha256 over every export of every
 * entry and over every contract name their source reads, followed until no
 * source reads a name not yet read.
 */
export async function workerContractWire(): Promise<string> {
  const modules = await workerContractModules();
  const reads = new Set<string>();
  const entries = Object.entries(workspaceManifest().exports)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([entry, source]): [string, unknown] => {
      const module = modules.find((held) => `./${held.source}` === source);
      if (module === undefined)
        throw new Error(`${entry} names ${source}, which the contract lacks`);
      return [entry, workerContractWireValue(module.exports, reads)];
    });
  const named: [string, unknown][] = [];
  /** Iterating `reads` visits each name the loop itself adds. */
  for (const name of reads)
    for (const module of modules) {
      const declaration = module.declared.get(name);
      if (declaration === undefined) continue;
      named.push([
        `${module.source}#${name}`,
        name in module.exports
          ? workerContractWireValue(module.exports[name], reads)
          : {
              declared: workerContractWireText(
                workerContractWireTokens(declaration, module.file),
                reads,
              ),
            },
      ]);
    }
  const wire = {
    entries: Object.fromEntries(entries),
    named: Object.fromEntries(
      named.sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
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
