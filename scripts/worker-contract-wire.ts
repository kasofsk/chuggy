/**
 * The worker contract's wire as one digest, and the history that names the
 * release each wire was published as.
 *
 * THE DIGEST IS TAKEN OVER EVERY EXPORT OF EVERY ENTRY THE PACKAGE NAMES, read
 * off the modules rather than listed, so an export added or removed moves it
 * like a value changed. A schema is the JSON Schema it reads and the one it
 * writes, a refinement, a transform and a function are their tokens, and
 * every other value is itself. Tokens leave out comments, whitespace, trailing
 * commas and types, and a number is its value, so a formatter moves no digest.
 *
 * EVERY NAME SOURCE READS IS RESOLVED, by TypeScript's checker over the modules
 * the package ships. A name bound inside the source is the source's own, a zod
 * import and a global are themselves, and a module's top-level declaration is
 * followed: as the value its module exports, or as its tokens where the module
 * keeps it. Anything else, such as a bound a factory's closure carries, is
 * refused by module and name, because the digest cannot read it and so would
 * not move when it changed.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { z } from "zod";

import { workerContractVersionOf } from "../src/contract/workerContract.ts";
import { workspaceManifestOf } from "./pack-worker-contract.ts";

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

/** One token of source: its text, and the name it is where it is one. */
interface WorkerContractWireToken {
  readonly text: string;
  readonly name: ts.Identifier | undefined;
}

/** The modifiers only TypeScript writes, which the runtime never sees. */
const workerContractWireTypeModifiers: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.OverrideKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
]);

/** The punctuation that introduces a type annotation or assertion. */
const workerContractWireTypeMarks: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AsKeyword,
  ts.SyntaxKind.ColonToken,
  ts.SyntaxKind.SatisfiesKeyword,
]);

/** Which of `node`'s children are type syntax, the same syntax the runtime strips before it runs a module. */
function workerContractWireTyping(
  node: ts.Node,
  children: readonly ts.Node[],
  file: ts.SourceFile,
): ReadonlySet<number> {
  const typed = node as {
    readonly type?: ts.Node;
    readonly typeArguments?: ts.NodeArray<ts.Node>;
    readonly typeParameters?: ts.NodeArray<ts.Node>;
  };
  const typing = new Set<number>();
  for (const [index, child] of children.entries()) {
    const listed =
      child.kind === ts.SyntaxKind.SyntaxList
        ? child.getChildren(file)[0]
        : undefined;
    const before = children[index - 1];
    if (child === typed.type) {
      typing.add(index);
      if (before !== undefined && workerContractWireTypeMarks.has(before.kind))
        typing.add(index - 1);
    } else if (
      listed !== undefined &&
      (listed === typed.typeArguments?.[0] ||
        listed === typed.typeParameters?.[0])
    )
      typing
        .add(index - 1)
        .add(index)
        .add(index + 1);
    else if (
      (child.kind === ts.SyntaxKind.ExclamationToken &&
        (ts.isNonNullExpression(node) || ts.isVariableDeclaration(node))) ||
      (child.kind === ts.SyntaxKind.QuestionToken &&
        (ts.isParameter(node) ||
          ts.isPropertyDeclaration(node) ||
          ts.isMethodDeclaration(node))) ||
      (node.kind === ts.SyntaxKind.SyntaxList &&
        workerContractWireTypeModifiers.has(child.kind)) ||
      ts.isTypeAliasDeclaration(child) ||
      ts.isInterfaceDeclaration(child) ||
      (ts.isHeritageClause(child) &&
        child.token === ts.SyntaxKind.ImplementsKeyword)
    )
      typing.add(index);
  }
  return typing;
}

/** `node`'s tokens without the comments, whitespace, trailing commas and types a formatter or the runtime moves, each number as its value. */
function workerContractWireTokens(
  node: ts.Node,
  file: ts.SourceFile,
): readonly WorkerContractWireToken[] {
  const children = node.getChildren(file);
  if (children.length === 0) {
    const text = node.getText(file);
    if (text === "") return [];
    if (ts.isNumericLiteral(node))
      return [
        { text: String(Number(text.replaceAll("_", ""))), name: undefined },
      ];
    return [{ text, name: ts.isIdentifier(node) ? node : undefined }];
  }
  const typing = workerContractWireTyping(node, children, file);
  return children.flatMap((child, index) =>
    typing.has(index) ||
    ts.isJSDoc(child) ||
    (node.kind === ts.SyntaxKind.SyntaxList &&
      child.kind === ts.SyntaxKind.CommaToken &&
      index === children.length - 1)
      ? []
      : workerContractWireTokens(child, file),
  );
}

/** Tokens as the digest reads them. */
function workerContractWireText(
  tokens: readonly WorkerContractWireToken[],
): string {
  return tokens.map((token) => token.text).join(" ");
}

/** A function's source, as the runtime prints it, as its tokens. */
function workerContractWireSnippet(
  source: string,
): readonly WorkerContractWireToken[] {
  const file = ts.createSourceFile(
    "held.ts",
    `(${source}\n)`,
    ts.ScriptTarget.Latest,
    true,
  );
  return workerContractWireTokens(file, file).slice(1, -1);
}

/** A function's source as the digest reads it. */
export function workerContractWireSourceText(source: string): string {
  return workerContractWireText(workerContractWireSnippet(source));
}

/** One module the package ships: where it is, its syntax, and what it exports. */
interface WorkerContractModule {
  readonly source: string;
  readonly file: ts.SourceFile;
  readonly exports: Readonly<Record<string, unknown>>;
}

/** One function a shipped module declares, as its tokens. */
interface WorkerContractFunction {
  readonly module: WorkerContractModule;
  readonly node: ts.Node;
  readonly tokens: readonly WorkerContractWireToken[];
}

/** One package's wire as it is being read: its modules, the checker that binds them, and every declaration followed so far. */
interface WorkerContractReader {
  readonly checker: ts.TypeChecker;
  readonly modules: ReadonlyMap<string, WorkerContractModule>;
  readonly functions: readonly WorkerContractFunction[];
  readonly named: Map<string, unknown>;
}

/**
 * The package as the checker binds it: the entries and every module they
 * import, which is what the pack ships. Only a relative import resolves, so
 * the checker never reads zod, and a name no module declares is left unbound.
 */
function workerContractProgram(entries: readonly string[]): ts.Program {
  const options: ts.CompilerOptions = {
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    target: ts.ScriptTarget.Latest,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  host.resolveModuleNameLiterals = (literals, containing) =>
    literals.map((literal) => ({
      resolvedModule: literal.text.startsWith(".")
        ? {
            resolvedFileName: resolve(dirname(containing), literal.text),
            extension: ts.Extension.Ts,
          }
        : undefined,
    }));
  return ts.createProgram({ rootNames: entries, options, host });
}

/** Refuses a module importing a default or a namespace, whose members a name read through it cannot be followed to. */
function workerContractWireImports(module: WorkerContractModule): void {
  for (const statement of module.file.statements) {
    const clause = ts.isImportDeclaration(statement)
      ? statement.importClause
      : undefined;
    if (
      clause !== undefined &&
      clause.phaseModifier !== ts.SyntaxKind.TypeKeyword
    ) {
      if (clause.name !== undefined)
        throw new Error(
          `${module.source} imports a default, which the digest cannot follow`,
        );
      if (
        clause.namedBindings !== undefined &&
        ts.isNamespaceImport(clause.namedBindings)
      )
        throw new Error(
          `${module.source} imports a namespace, whose members the digest cannot follow`,
        );
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause !== undefined &&
      ts.isNamespaceExport(statement.exportClause)
    )
      throw new Error(
        `${module.source} exports a namespace, whose members the digest cannot follow`,
      );
  }
}

/** Every function a module declares, each as the tokens the runtime would print it as. */
function workerContractWireFunctions(
  module: WorkerContractModule,
): readonly WorkerContractFunction[] {
  const functions: WorkerContractFunction[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      (ts.isFunctionDeclaration(node) && node.body !== undefined) ||
      ts.isMethodDeclaration(node) ||
      ts.isAccessor(node) ||
      ts.isClassLike(node)
    ) {
      const tokens = [...workerContractWireTokens(node, module.file)];
      while (tokens[0]?.text === "export" || tokens[0]?.text === "default")
        tokens.shift();
      functions.push({ module, node, tokens });
    }
    ts.forEachChild(node, visit);
  };
  visit(module.file);
  return functions;
}

/** Whether a name is a property or a label rather than a binding the source reads. */
function workerContractWireIsProperty(name: ts.Identifier): boolean {
  const parent = name.parent;
  return (
    ((ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isAccessor(parent) ||
      ts.isEnumMember(parent) ||
      ts.isMetaProperty(parent)) &&
      parent.name === name) ||
    (ts.isBindingElement(parent) && parent.propertyName === name) ||
    ((ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) &&
      parent.label === name)
  );
}

/** The top-level statement that declares `declaration`, or nothing where it is bound inside one. */
function workerContractWireTopLevel(
  declaration: ts.Declaration,
): ts.Node | undefined {
  const declared = ts.isBindingElement(declaration)
    ? ts.walkUpBindingElementsAndPatterns(declaration)
    : declaration;
  if (
    ts.isVariableDeclaration(declared) &&
    ts.isVariableStatement(declared.parent.parent) &&
    ts.isSourceFile(declared.parent.parent.parent)
  )
    return declared;
  return (ts.isFunctionDeclaration(declared) ||
    ts.isClassDeclaration(declared)) &&
    ts.isSourceFile(declared.parent)
    ? declared
    : undefined;
}

/**
 * Resolves every name `tokens` read inside `node`: one bound inside `node` is
 * its own, a zod import and a global are themselves, and one a shipped module
 * declares at its top level is followed. Anything else is refused.
 */
function workerContractWireResolve(
  reader: WorkerContractReader,
  module: WorkerContractModule,
  node: ts.Node,
  tokens: readonly WorkerContractWireToken[],
): void {
  for (const { name } of tokens) {
    if (name === undefined || workerContractWireIsProperty(name)) continue;
    const parent = name.parent;
    const symbol =
      ts.isShorthandPropertyAssignment(parent) && parent.name === name
        ? reader.checker.getShorthandAssignmentValueSymbol(parent)
        : reader.checker.getSymbolAtLocation(name);
    const declarations = symbol?.declarations ?? [];
    if (symbol === undefined || declarations.length === 0) {
      if (name.text in globalThis) continue;
      throw new Error(
        `${module.source}: ${name.text} is declared nowhere the digest can read`,
      );
    }
    if (
      declarations.every(
        (declaration) =>
          declaration.getSourceFile() === module.file &&
          declaration.pos >= node.pos &&
          declaration.end <= node.end,
      )
    )
      continue;
    const declared =
      (symbol.flags & ts.SymbolFlags.Alias) === 0
        ? symbol
        : workerContractWireImported(reader, module, name, symbol);
    if (declared !== undefined)
      workerContractWireFollow(reader, module, name, declared);
  }
}

/** What an imported name is declared as, or nothing where it is zod's. */
function workerContractWireImported(
  reader: WorkerContractReader,
  module: WorkerContractModule,
  name: ts.Identifier,
  symbol: ts.Symbol,
): ts.Symbol | undefined {
  const importing = ts.findAncestor(
    symbol.declarations?.[0],
    ts.isImportDeclaration,
  );
  const specifier =
    importing !== undefined && ts.isStringLiteral(importing.moduleSpecifier)
      ? importing.moduleSpecifier.text
      : undefined;
  if (specifier === "zod") return undefined;
  const target = reader.checker.getAliasedSymbol(symbol);
  if (specifier?.startsWith(".") === true && target.declarations !== undefined)
    return target;
  throw new Error(
    `${module.source}: ${name.text} is imported from ${String(specifier)}, which the package does not ship`,
  );
}

/** Takes a shipped module's top-level declaration into the digest: the value its module exports, or its tokens where the module keeps it. */
function workerContractWireFollow(
  reader: WorkerContractReader,
  module: WorkerContractModule,
  name: ts.Identifier,
  symbol: ts.Symbol,
): void {
  const declaration = symbol.declarations?.find(
    (held) => !ts.isFunctionDeclaration(held) || held.body !== undefined,
  );
  const top =
    declaration === undefined
      ? undefined
      : workerContractWireTopLevel(declaration);
  const owner =
    top === undefined
      ? undefined
      : reader.modules.get(top.getSourceFile().fileName);
  if (top === undefined || owner === undefined)
    throw new Error(
      `${module.source}: ${name.text} is bound in an enclosing scope, which the digest cannot read`,
    );
  const key = `${owner.source}#${symbol.name}`;
  if (reader.named.has(key)) return;
  reader.named.set(key, undefined);
  if (symbol.name in owner.exports) {
    reader.named.set(
      key,
      workerContractWireValue(reader, owner.exports[symbol.name], key),
    );
    return;
  }
  const tokens = workerContractWireTokens(top, owner.file);
  workerContractWireResolve(reader, owner, top, tokens);
  reader.named.set(key, { declared: workerContractWireText(tokens) });
}

/** A function as its tokens, each declaration that prints as it resolved; a global as its name. */
function workerContractWireSource(
  reader: WorkerContractReader,
  held: (...parameters: never[]) => unknown,
  label: string,
): string {
  const source = Function.prototype.toString.call(held);
  if (/\{\s*\[native code\]\s*\}$/u.test(source)) {
    if ((globalThis as Record<string, unknown>)[held.name] === held)
      return `global ${held.name}`;
    throw new Error(
      `${label}: no module the package ships declares its source`,
    );
  }
  const tokens = workerContractWireSnippet(source);
  const text = workerContractWireText(tokens);
  const declaring = reader.functions.filter(
    (candidate) => workerContractWireText(candidate.tokens) === text,
  );
  if (declaring.length === 0)
    throw new Error(
      `${label}: no module the package ships declares its source`,
    );
  for (const { module, node, tokens: declared } of declaring)
    workerContractWireResolve(reader, module, node, declared);
  return text;
}

/** A schema's refinements and transforms as their source, which is what its JSON Schema cannot state. */
function workerContractWireChecks(
  reader: WorkerContractReader,
  schema: z.core.$ZodType,
  label: string,
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
  return [...refinements, ...pipeSides].flatMap((held) =>
    typeof held === "function"
      ? [
          workerContractWireSource(
            reader,
            held as (...parameters: never[]) => unknown,
            label,
          ),
        ]
      : [],
  );
}

/** One schema in both directions, each node that holds source carrying it. */
function workerContractWireSchema(
  reader: WorkerContractReader,
  schema: z.ZodType,
  label: string,
): unknown {
  return Object.fromEntries(
    (["input", "output"] as const).map((direction) => [
      direction,
      z.toJSONSchema(schema, {
        io: direction,
        unrepresentable: "any",
        override: ({ zodSchema, jsonSchema }) => {
          const checks = workerContractWireChecks(reader, zodSchema, label);
          if (checks.length > 0) jsonSchema["x-source"] = checks;
        },
      }),
    ]),
  );
}

/** One value as the digest reads it, an object's keys in order so the order they were written in is not a change. */
function workerContractWireValue(
  reader: WorkerContractReader,
  held: unknown,
  label: string,
): unknown {
  if (held instanceof z.ZodType)
    return { schema: workerContractWireSchema(reader, held, label) };
  if (held instanceof RegExp)
    return { regexp: { source: held.source, flags: held.flags } };
  if (typeof held === "function")
    return {
      function: workerContractWireSource(
        reader,
        held as (...parameters: never[]) => unknown,
        label,
      ),
    };
  if (held === undefined) return { undefined: true };
  if (Array.isArray(held))
    return held.map((item: unknown) =>
      workerContractWireValue(reader, item, label),
    );
  if (typeof held === "object" && held !== null)
    return Object.fromEntries(
      Object.keys(held)
        .sort()
        .map((key) => [
          key,
          workerContractWireValue(
            reader,
            (held as Record<string, unknown>)[key],
            label,
          ),
        ]),
    );
  return held;
}

/**
 * The wire of the package whose manifest is in `directory`, as a sha256 over
 * every export of every entry and over every declaration their source reads.
 */
export async function workerContractWireAt(directory: string): Promise<string> {
  const manifest = workspaceManifestOf(
    JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
  );
  const entries = Object.entries(manifest.exports)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, source]) => join(directory, source));
  const program = workerContractProgram(entries);
  const modules = new Map<string, WorkerContractModule>();
  for (const file of program.getSourceFiles()) {
    const module = {
      source: relative(directory, file.fileName),
      file,
      exports: {
        ...((await import(pathToFileURL(file.fileName).href)) as Record<
          string,
          unknown
        >),
      },
    };
    workerContractWireImports(module);
    modules.set(file.fileName, module);
  }
  const reader: WorkerContractReader = {
    checker: program.getTypeChecker(),
    modules,
    functions: [...modules.values()].flatMap(workerContractWireFunctions),
    named: new Map(),
  };
  const read = entries.map((entry): readonly [string, unknown] => {
    const module = modules.get(entry);
    if (module === undefined)
      throw new Error(`the manifest names ${entry}, which is not there`);
    return [
      module.source,
      Object.fromEntries(
        Object.keys(module.exports)
          .sort()
          .map((key) => [
            key,
            workerContractWireValue(
              reader,
              module.exports[key],
              `${module.source}#${key}`,
            ),
          ]),
      ),
    ];
  });
  const wire = {
    entries: Object.fromEntries(read),
    named: Object.fromEntries(
      [...reader.named].sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
  return createHash("sha256").update(JSON.stringify(wire)).digest("hex");
}

/** The wire as it stands in this tree. */
export async function workerContractWire(): Promise<string> {
  return workerContractWireAt(join(root, "src/contract"));
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
