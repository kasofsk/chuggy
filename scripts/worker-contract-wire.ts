/**
 * The worker contract's wire as one digest, and the history that names the
 * release each wire was published as.
 *
 * THE DIGEST IS TAKEN OVER EVERY EXPORT OF EVERY ENTRY THE PACKAGE NAMES, read
 * off the modules rather than listed, so an export added or removed moves it
 * like a value changed. A value is read only as a kind the reader knows, and
 * anything else is refused, naming the module, the export and where in the
 * value it sits:
 *
 * - a zod schema or check is its kind and every key of its definition, and a
 *   kind or a key outside the allowlist below is refused, as is a schema
 *   carrying metadata, a `when` zod did not write, and an error that is not a
 *   message;
 * - a function is the tokens of the shipped source that declares it, and a
 *   language built-in is its name; any other function, and one carrying
 *   properties of its own, is refused;
 * - a plain object is its own enumerable data keys, an array its items and a
 *   regular expression its source and flags, each refused where it has an
 *   accessor, a hidden or symbol key, a hole, or a key its kind does not have;
 *   a string, number, bigint, boolean, null or undefined is itself, NaN, the
 *   infinities and minus zero included. Any other object, a symbol and a value
 *   that holds itself are refused.
 *
 * Tokens leave out comments, whitespace, trailing commas and types, and a
 * number is its value, so a formatter moves no digest.
 *
 * EVERY NAME SOURCE READS IS RESOLVED, by TypeScript's checker over the modules
 * the package ships. A name bound inside the source is the source's own, a zod
 * import is zod's, a global the language defines is itself, and a module's
 * top-level declaration is followed: as the value its module exports, or as its
 * tokens where the module keeps it. Anything else is refused by module and
 * name: a name bound in an enclosing scope or imported from another package,
 * `this` or `super` bound outside the source, `arguments`, `import.meta`,
 * `new.target`, a dynamic import, and `eval`, `Function` and `globalThis`,
 * which reach past the names the checker binds.
 *
 * A SHIPPED MODULE DOES NOTHING WHILE IT LOADS BUT DECLARE, so a declaration
 * read as its tokens holds what they say. Its top-level statements are
 * imports, exports, `const`, function, class, type and interface declarations
 * and empty statements; an import that is not type-only names its members,
 * zod's namespace aside, and no export re-exports a namespace. Everything else
 * is refused, as is an assignment, an update or a delete in code that runs
 * while it loads. What the digest does not see is a declaration written by a
 * call the module makes while it loads.
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

/** Two strings in code-unit order, which no locale moves. */
function workerContractWireOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** One token of source: its text, and the node it is. */
interface WorkerContractWireToken {
  readonly text: string;
  readonly node: ts.Node;
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
    return [
      {
        text: ts.isNumericLiteral(node)
          ? String(Number(text.replaceAll("_", "")))
          : text,
        node,
      },
    ];
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

/**
 * The globals the language defines, each itself wherever source reads it.
 * `eval`, `Function` and `globalThis` are not among them: each reaches names
 * the checker never binds.
 */
const workerContractWireGlobals: ReadonlySet<string> = new Set([
  "AggregateError",
  "Array",
  "ArrayBuffer",
  "Atomics",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Boolean",
  "DataView",
  "Date",
  "Error",
  "EvalError",
  "FinalizationRegistry",
  "Float32Array",
  "Float64Array",
  "Infinity",
  "Int16Array",
  "Int32Array",
  "Int8Array",
  "Intl",
  "Iterator",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "Promise",
  "Proxy",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "RegExp",
  "Set",
  "SharedArrayBuffer",
  "String",
  "Symbol",
  "SyntaxError",
  "TypeError",
  "URIError",
  "Uint16Array",
  "Uint32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "WeakMap",
  "WeakRef",
  "WeakSet",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "undefined",
]);

/** Each built-in function a global holds, by the name source would read it as: the global, or the global and its member. */
const workerContractWireBuiltIns: ReadonlyMap<unknown, string> = (() => {
  const named = new Map<unknown, string>();
  for (const global of [...workerContractWireGlobals].sort(
    workerContractWireOrder,
  )) {
    const held: unknown = (globalThis as Record<string, unknown>)[global];
    if (typeof held === "function" && !named.has(held)) named.set(held, global);
    if (typeof held !== "function" && (typeof held !== "object" || !held))
      continue;
    for (const key of Object.getOwnPropertyNames(held).sort(
      workerContractWireOrder,
    )) {
      const member: unknown = Object.getOwnPropertyDescriptor(held, key)?.value;
      if (typeof member === "function" && !named.has(member))
        named.set(member, `${global}.${key}`);
    }
  }
  return named;
})();

/** How a key of a zod definition is read: as a value, as zod's own default `when`, or as a message zod wrapped in a function. */
type WorkerContractWireReading = "value" | "when" | "message";

/**
 * The zod schemas the digest reads, by kind: the type, then the check and the
 * format where the schema is one. Each names every key it may carry beyond
 * those that make its kind, and those are the kinds the contract uses.
 */
const workerContractWireSchemaKinds: ReadonlyMap<
  string,
  ReadonlyMap<string, WorkerContractWireReading>
> = new Map(
  Object.entries({
    array: { checks: "value", element: "value" },
    boolean: {},
    "custom/custom": { error: "message", fn: "value" },
    enum: { entries: "value" },
    literal: { values: "value" },
    never: {},
    nullable: { innerType: "value" },
    number: { checks: "value" },
    "number/number_format:safeint": { abort: "value" },
    object: { catchall: "value", checks: "value", shape: "value" },
    optional: { innerType: "value" },
    record: { keyType: "value", valueType: "value" },
    string: { checks: "value" },
    "string/string_format:datetime": {
      local: "value",
      offset: "value",
      pattern: "value",
      precision: "value",
    },
    "string/string_format:url": { abort: "value" },
    union: { discriminator: "value", inclusive: "value", options: "value" },
    unknown: {},
  } as const).map(([kind, keys]) => [
    kind,
    new Map(Object.entries(keys) as [string, WorkerContractWireReading][]),
  ]),
);

/** The zod checks the digest reads, by kind: the check, then its format where it has one. */
const workerContractWireCheckKinds: ReadonlyMap<
  string,
  ReadonlyMap<string, WorkerContractWireReading>
> = new Map(
  Object.entries({
    greater_than: { inclusive: "value", value: "value" },
    less_than: { inclusive: "value", value: "value" },
    max_length: { maximum: "value", when: "when" },
    min_length: { minimum: "value", when: "when" },
    "string_format:regex": { pattern: "value" },
    "string_format:starts_with": { pattern: "value", prefix: "value" },
  } as const).map(([kind, keys]) => [
    kind,
    new Map(Object.entries(keys) as [string, WorkerContractWireReading][]),
  ]),
);

/** A function's source as the runtime prints it. */
function workerContractWirePrinted(held: unknown): string | undefined {
  return typeof held === "function"
    ? Function.prototype.toString.call(held)
    : undefined;
}

/** The source of the functions zod writes itself: a length check's default `when`, and the function a message becomes. */
const workerContractWireZodWritten = {
  when: new Set(
    [z.string().max(0), z.string().min(0)].map((schema) =>
      workerContractWirePrinted(schema._zod.def.checks?.[0]?._zod.def.when),
    ),
  ),
  message: new Set(
    [
      z.string().refine(() => true, "message"),
      z.string().refine(() => true, { error: "message" }),
    ].map((schema) =>
      workerContractWirePrinted(schema._zod.def.checks?.[0]?._zod.def.error),
    ),
  ),
};

/** Why nothing reads the value at `at`, as the refusal that says so. */
function workerContractWireRefuse(at: string, what: string): never {
  throw new Error(`${at}: ${what}, which the digest does not read`);
}

/** One module the package ships: where it is, its syntax, what it exports, and the name each declaration it exports goes by. */
interface WorkerContractModule {
  readonly source: string;
  readonly file: ts.SourceFile;
  readonly exports: Readonly<Record<string, unknown>>;
  readonly exported: ReadonlyMap<ts.Node, string>;
}

/** One function a shipped module declares, as its tokens. */
interface WorkerContractFunction {
  readonly module: WorkerContractModule;
  readonly node: ts.Node;
  readonly tokens: readonly WorkerContractWireToken[];
}

/** One package's wire as it is being read: its modules, the checker that binds them, every declaration followed so far, and the values being read. */
interface WorkerContractReader {
  readonly checker: ts.TypeChecker;
  readonly modules: ReadonlyMap<string, WorkerContractModule>;
  readonly functions: readonly WorkerContractFunction[];
  readonly named: Map<string, unknown>;
  readonly reading: Set<object>;
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

/** Each declaration `file` exports, by the first of its export names in code-unit order. */
function workerContractWireExported(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
): ReadonlyMap<ts.Node, string> {
  const exported = new Map<ts.Node, string>();
  const module = checker.getSymbolAtLocation(file);
  if (module === undefined) return exported;
  const names = [...checker.getExportsOfModule(module)].sort((left, right) =>
    workerContractWireOrder(left.name, right.name),
  );
  for (const name of names) {
    const target =
      (name.flags & ts.SymbolFlags.Alias) === 0
        ? name
        : checker.getAliasedSymbol(name);
    for (const declaration of target.declarations ?? [])
      if (!exported.has(declaration)) exported.set(declaration, name.name);
  }
  return exported;
}

/** Refuses an import of a default, or of a namespace other than zod's, whose members a name read through it cannot be followed to. */
function workerContractWireImport(
  module: WorkerContractModule,
  statement: ts.ImportDeclaration,
): void {
  const clause = statement.importClause;
  if (
    clause === undefined ||
    clause.phaseModifier === ts.SyntaxKind.TypeKeyword
  )
    return;
  if (clause.name !== undefined)
    throw new Error(
      `${module.source} imports a default, which the digest cannot follow`,
    );
  if (
    clause.namedBindings !== undefined &&
    ts.isNamespaceImport(clause.namedBindings) &&
    !(
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "zod"
    )
  )
    throw new Error(
      `${module.source} imports a namespace, whose members the digest cannot follow`,
    );
}

/** Refuses an assignment, an update or a delete in code that runs while `statement` loads, which could write a declaration after the tokens the digest reads it by. */
function workerContractWireLoading(
  module: WorkerContractModule,
  statement: ts.Statement,
): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionLike(node) ||
      (ts.isPropertyDeclaration(node) &&
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword,
        ) !== true)
    )
      return;
    const written =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ? node.left
        : (ts.isPrefixUnaryExpression(node) ||
              ts.isPostfixUnaryExpression(node)) &&
            (node.operator === ts.SyntaxKind.PlusPlusToken ||
              node.operator === ts.SyntaxKind.MinusMinusToken)
          ? node.operand
          : ts.isDeleteExpression(node)
            ? node.expression
            : undefined;
    if (written !== undefined)
      throw new Error(
        `${module.source} writes ${written.getText(module.file)} while it loads, which the digest cannot see`,
      );
    ts.forEachChild(node, visit);
  };
  visit(statement);
}

/** Refuses a shipped module that does more while it loads than declare, or whose imports and exports name members the digest cannot follow. */
function workerContractWireStatements(module: WorkerContractModule): void {
  for (const statement of module.file.statements) {
    if (ts.isImportDeclaration(statement))
      workerContractWireImport(module, statement);
    else if (ts.isExportDeclaration(statement)) {
      if (
        !statement.isTypeOnly &&
        statement.exportClause !== undefined &&
        ts.isNamespaceExport(statement.exportClause)
      )
        throw new Error(
          `${module.source} exports a namespace, whose members the digest cannot follow`,
        );
    } else if (ts.isVariableStatement(statement)) {
      const flags: number = statement.declarationList.flags;
      if (
        (flags & ts.NodeFlags.Const) === 0 ||
        (flags & ts.NodeFlags.Using) !== 0
      )
        throw new Error(
          `${module.source} declares a top-level let or var, which a later write would change unseen`,
        );
    } else if (!(
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isExportAssignment(statement) ||
      ts.isEmptyStatement(statement)
    ))
      throw new Error(
        `${module.source} runs a top-level ${ts.SyntaxKind[statement.kind]}, which could write what the digest reads`,
      );
    workerContractWireLoading(module, statement);
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
      const member = ts.isMethodDeclaration(node) || ts.isAccessor(node);
      while (
        tokens[0]?.text === "export" ||
        tokens[0]?.text === "default" ||
        (member && tokens[0]?.text === "static")
      )
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
      ts.isEnumMember(parent)) &&
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

/** The node that binds a `this` or `super`: the nearest function that is not an arrow, class field or static block, or the module. */
function workerContractWireBinder(keyword: ts.Node): ts.Node {
  return (
    ts.findAncestor(
      keyword.parent,
      (node) =>
        ts.isSourceFile(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isClassStaticBlockDeclaration(node) ||
        (ts.isFunctionLike(node) && !ts.isArrowFunction(node)),
    ) ?? keyword.getSourceFile()
  );
}

/**
 * Resolves everything `tokens` read inside `node`: a name, `this` or `super`
 * bound inside `node` is its own, a zod import and a language global are
 * themselves, and a name a shipped module declares at its top level is
 * followed. Anything else is refused.
 */
function workerContractWireResolve(
  reader: WorkerContractReader,
  module: WorkerContractModule,
  node: ts.Node,
  tokens: readonly WorkerContractWireToken[],
): void {
  for (const { node: leaf } of tokens) {
    if (
      leaf.kind === ts.SyntaxKind.ThisKeyword ||
      leaf.kind === ts.SyntaxKind.SuperKeyword
    ) {
      const binder = workerContractWireBinder(leaf);
      if (
        ts.isSourceFile(binder) ||
        binder.pos < node.pos ||
        binder.end > node.end
      )
        throw new Error(
          `${module.source}: ${leaf.getText(module.file)} is bound outside the source the digest reads`,
        );
      continue;
    }
    if (
      ts.isMetaProperty(leaf.parent) ||
      (leaf.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isCallExpression(leaf.parent))
    )
      throw new Error(
        `${module.source}: ${leaf.parent.getText(module.file)} reads what no name declares`,
      );
    if (!ts.isIdentifier(leaf) || workerContractWireIsProperty(leaf)) continue;
    if (leaf.text === "arguments")
      throw new Error(
        `${module.source}: arguments is read, which the digest cannot follow to a call`,
      );
    const parent = leaf.parent;
    const symbol =
      ts.isShorthandPropertyAssignment(parent) && parent.name === leaf
        ? reader.checker.getShorthandAssignmentValueSymbol(parent)
        : reader.checker.getSymbolAtLocation(leaf);
    const declarations = symbol?.declarations ?? [];
    if (symbol === undefined || declarations.length === 0) {
      if (workerContractWireGlobals.has(leaf.text)) continue;
      throw new Error(
        `${module.source}: ${leaf.text} is declared nowhere the digest can read, and is no global the language defines`,
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
        : workerContractWireImported(reader, module, leaf, symbol);
    if (declared !== undefined)
      workerContractWireFollow(reader, module, leaf, declared);
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

/** Takes a shipped module's top-level declaration into the digest: the value its module exports it as, or its tokens where the module keeps it. */
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
  if (declaration === undefined || top === undefined || owner === undefined)
    throw new Error(
      `${module.source}: ${name.text} is bound in an enclosing scope, which the digest cannot read`,
    );
  const key = `${owner.source}#${symbol.name}`;
  if (reader.named.has(key)) return;
  reader.named.set(key, undefined);
  const exported = owner.exported.get(declaration);
  if (exported !== undefined && Object.hasOwn(owner.exports, exported)) {
    reader.named.set(
      key,
      workerContractWireValue(reader, owner.exports[exported], key),
    );
    return;
  }
  const tokens = workerContractWireTokens(top, owner.file);
  workerContractWireResolve(reader, owner, top, tokens);
  reader.named.set(key, { declared: workerContractWireText(tokens) });
}

/** A function as its tokens, each declaration that prints as it resolved; a built-in as its name. */
function workerContractWireSource(
  reader: WorkerContractReader,
  held: (...parameters: never[]) => unknown,
  at: string,
): string {
  const source = Function.prototype.toString.call(held);
  if (/\{\s*\[native code\]\s*\}$/u.test(source)) {
    const builtIn = workerContractWireBuiltIns.get(held);
    if (builtIn !== undefined) return `built-in ${builtIn}`;
    throw new Error(`${at}: no module the package ships declares its source`);
  }
  const tokens = workerContractWireSnippet(source);
  const text = workerContractWireText(tokens);
  const declaring = reader.functions.filter(
    (candidate) => workerContractWireText(candidate.tokens) === text,
  );
  if (declaring.length === 0)
    throw new Error(`${at}: no module the package ships declares its source`);
  for (const { module, node, tokens: declared } of declaring)
    workerContractWireResolve(reader, module, node, declared);
  return text;
}

/** A `when` on a zod check, read only where it is the default zod writes itself. */
function workerContractWireWhen(held: unknown, at: string): string {
  if (workerContractWireZodWritten.when.has(workerContractWirePrinted(held)))
    return "zod";
  return workerContractWireRefuse(at, "a when zod did not write");
}

/** An error on a zod schema, read only where it is the function zod makes of a message, as that message. */
function workerContractWireMessage(held: unknown, at: string): unknown {
  if (
    typeof held === "function" &&
    workerContractWireZodWritten.message.has(workerContractWirePrinted(held))
  ) {
    const message: unknown = (held as () => unknown)();
    if (typeof message === "string") return { message };
  }
  return workerContractWireRefuse(at, "an error that is not a message");
}

/** A zod schema or check as its kind and each key of its definition, refused where the allowlist does not name its kind or a key. */
function workerContractWireZod(
  reader: WorkerContractReader,
  held: z.core.$ZodType | z.core.$ZodCheck,
  at: string,
): unknown {
  const definition = held._zod.def as unknown as Readonly<
    Record<PropertyKey, unknown>
  >;
  const isSchema = held instanceof z.core.$ZodType;
  const [type, check, format] = [
    definition["type"],
    definition["check"],
    definition["format"],
  ].map((part) =>
    typeof part === "string" || part === undefined ? part : "?",
  );
  const kind = `${[type, check].filter((part) => part !== undefined).join("/")}${format === undefined ? "" : `:${format}`}`;
  const keys = (
    isSchema ? workerContractWireSchemaKinds : workerContractWireCheckKinds
  ).get(kind);
  if (keys === undefined)
    return workerContractWireRefuse(
      at,
      `a zod ${isSchema ? "schema" : "check"} of kind ${kind}`,
    );
  if (isSchema && z.globalRegistry.has(held))
    return workerContractWireRefuse(at, "zod metadata");
  const read: Record<string, unknown> = { kind };
  for (const key of Reflect.ownKeys(definition)) {
    if (typeof key === "symbol")
      return workerContractWireRefuse(at, `a symbol key on a zod ${kind}`);
  }
  for (const key of (Reflect.ownKeys(definition) as string[]).sort(
    workerContractWireOrder,
  )) {
    if (key === "type" || key === "check" || key === "format") continue;
    const reading = keys.get(key);
    if (reading === undefined)
      return workerContractWireRefuse(
        `${at}.${key}`,
        `a key a zod ${kind} is not read with`,
      );
    const value = definition[key];
    if (value === undefined) continue;
    read[key] =
      reading === "when"
        ? workerContractWireWhen(value, `${at}.${key}`)
        : reading === "message"
          ? workerContractWireMessage(value, `${at}.${key}`)
          : workerContractWireValue(reader, value, `${at}.${key}`);
  }
  return read;
}

/** A plain object's own keys and values, refused where one is a symbol, hidden or an accessor. */
function workerContractWireEntries(
  held: object,
  at: string,
): readonly (readonly [string, unknown])[] {
  return Reflect.ownKeys(held).map((key) => {
    if (typeof key === "symbol")
      return workerContractWireRefuse(at, "a symbol key");
    const property = Object.getOwnPropertyDescriptor(held, key);
    if (property?.enumerable !== true || !("value" in property))
      return workerContractWireRefuse(
        `${at}.${key}`,
        "a hidden key or an accessor",
      );
    return [key, property.value] as const;
  });
}

/** An object as the digest reads it: a zod schema or check, a regular expression, an array or a plain object. */
function workerContractWireObject(
  reader: WorkerContractReader,
  held: object,
  at: string,
): unknown {
  if (held instanceof z.core.$ZodType || held instanceof z.core.$ZodCheck)
    return { zod: workerContractWireZod(reader, held, at) };
  const prototype: unknown = Object.getPrototypeOf(held);
  const keys = Reflect.ownKeys(held);
  if (
    held instanceof RegExp &&
    prototype === RegExp.prototype &&
    keys.length === 1 &&
    keys[0] === "lastIndex"
  )
    return { regexp: { source: held.source, flags: held.flags } };
  if (Array.isArray(held) && prototype === Array.prototype) {
    const items: readonly unknown[] = held;
    if (
      keys.length !== items.length + 1 ||
      !items.every((_item, index) => {
        const property = Object.getOwnPropertyDescriptor(items, index);
        return property?.enumerable === true && "value" in property;
      })
    )
      return workerContractWireRefuse(
        at,
        "an array with a hole, an accessor or a key of its own",
      );
    return items.map((item, index) =>
      workerContractWireValue(reader, item, `${at}[${String(index)}]`),
    );
  }
  if (prototype === Object.prototype)
    return {
      object: Object.fromEntries(
        [...workerContractWireEntries(held, at)]
          .sort(([left], [right]) => workerContractWireOrder(left, right))
          .map(([key, value]) => [
            key,
            workerContractWireValue(reader, value, `${at}.${key}`),
          ]),
      ),
    };
  const made: unknown =
    typeof prototype === "object" && prototype !== null
      ? Object.getOwnPropertyDescriptor(prototype, "constructor")?.value
      : undefined;
  return workerContractWireRefuse(
    at,
    typeof made === "function"
      ? `an object a ${made.name} made`
      : "an object whose prototype is not Object's",
  );
}

/** One value as the digest reads it, each kind tagged so that no two kinds read alike, or a refusal naming where it sits. */
function workerContractWireValue(
  reader: WorkerContractReader,
  held: unknown,
  at: string,
): unknown {
  if (held === null || typeof held === "string" || typeof held === "boolean")
    return held;
  if (held === undefined) return { undefined: true };
  if (typeof held === "number")
    return Number.isFinite(held) && !Object.is(held, -0)
      ? held
      : { number: Object.is(held, -0) ? "-0" : String(held) };
  if (typeof held === "bigint") return { bigint: String(held) };
  if (typeof held === "symbol") return workerContractWireRefuse(at, "a symbol");
  if (typeof held === "function") {
    const source = workerContractWireSource(
      reader,
      held as (...parameters: never[]) => unknown,
      at,
    );
    if (
      Reflect.ownKeys(held).some(
        (key) => key !== "length" && key !== "name" && key !== "prototype",
      )
    )
      return workerContractWireRefuse(at, "a function carrying properties");
    return { function: source };
  }
  if (reader.reading.has(held))
    return workerContractWireRefuse(at, "a value that holds itself");
  reader.reading.add(held);
  try {
    return workerContractWireObject(reader, held, at);
  } finally {
    reader.reading.delete(held);
  }
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
    .sort(([left], [right]) => workerContractWireOrder(left, right))
    .map(([, source]) => join(directory, source));
  const program = workerContractProgram(entries);
  const checker = program.getTypeChecker();
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
      exported: workerContractWireExported(checker, file),
    };
    workerContractWireStatements(module);
    modules.set(file.fileName, module);
  }
  const reader: WorkerContractReader = {
    checker,
    modules,
    functions: [...modules.values()].flatMap(workerContractWireFunctions),
    named: new Map(),
    reading: new Set(),
  };
  const read = entries.map((entry): readonly [string, unknown] => {
    const module = modules.get(entry);
    if (module === undefined)
      throw new Error(`the manifest names ${entry}, which is not there`);
    return [
      module.source,
      Object.fromEntries(
        Object.keys(module.exports)
          .sort(workerContractWireOrder)
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
      [...reader.named].sort(([left], [right]) =>
        workerContractWireOrder(left, right),
      ),
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
