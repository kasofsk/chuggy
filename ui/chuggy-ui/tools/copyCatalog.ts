/**
 * The console's copy catalog, read as a whole: what
 * `.chug/tasks/check-console-copy.sh` holds it to, and the modules generated
 * from it.
 *
 * `node ui/chuggy-ui/tools/copyCatalog.ts` writes two modules for each file of
 * the base language: its ids and their variables as types, under
 * `app/core/generated/`, and its text, under `app/copy/generated/`, which is
 * what the catalog loads. Every vernacular's text is one module beside them,
 * so a vernacular is offered by adding its files. `--check` writes nothing,
 * and reports a module that differs from what would be written as stale. `--catalog=<dir>` and
 * `--generated=<dir>` name another catalog and another directory for the
 * types. Exits 0 clean, 1 on a finding, 2 when it could not run.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { FluentParser } from "@fluent/syntax";
import type { Entry, Message, Term } from "@fluent/syntax";

const consoleDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The language every vernacular is a layer over. */
const copyBase = "en";

/** A vernacular's directory: the base language with a private-use subtag. */
const copyLayerPattern = /^en-x-[a-z0-9]{1,8}$/u;

/** The wording drawn from the base language itself, which no directory may
 * claim. */
const copyPseudo = "en-x-pseudo";

/** The module every vernacular's text is generated in. */
const copyVernacularsModule = "vernaculars.ts";

/** Where beside the catalog its files are generated as modules a bundler and
 * Node alike can import. */
const copySourcesDir = "generated";

/** The file that holds the terms, and the only one that does. */
const copyTermsFile = "terms.ftl";

/** The line beside a message that lets it spell a term's English. */
const copyExemptionPattern = /^spells (-[a-zA-Z][\w-]*): \S/u;

interface CopyFile {
  readonly path: string;
  readonly source: string;
  readonly section: string;
  readonly entries: readonly (Message | Term)[];
}

interface CopyLayer {
  readonly name: string;
  readonly files: readonly CopyFile[];
}

class CopyUnreadable extends Error {}

function copyArguments(argv: readonly string[]): {
  readonly check: boolean;
  readonly catalog: string;
  readonly generated: string;
} {
  let check = false;
  let catalog = join(consoleDir, "app/copy");
  let generated = join(consoleDir, "app/core/generated");
  for (const given of argv) {
    if (given === "--check") check = true;
    else if (given.startsWith("--catalog=")) catalog = given.slice(10);
    else if (given.startsWith("--generated=")) generated = given.slice(12);
    else throw new CopyUnreadable(`${given} is not an argument`);
  }
  return { check, catalog, generated };
}

function copyShown(path: string): string {
  return relative(process.cwd(), path) || path;
}

/** A file's entries, each piece of it the parser could not read a finding. */
function copyFileRead(path: string, findings: string[]): CopyFile {
  const source = readFileSync(path, "utf8");
  const resource = new FluentParser({ withSpans: true }).parse(source);
  const entries: (Message | Term)[] = [];
  for (const entry of resource.body) {
    if (entry.type === "Junk") {
      const line = source.slice(0, entry.span?.start ?? 0).split("\n").length;
      const why = entry.annotations.map((note) => note.message).join("; ");
      findings.push(
        `${copyShown(path)}:${String(line)}: does not parse: ${why}`,
      );
    } else if (entry.type === "Message" || entry.type === "Term") {
      entries.push(entry);
    }
  }
  return { path, source, section: basename(path, ".ftl"), entries };
}

function copyDirectoryRead(dir: string, findings: string[]): CopyFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ftl"))
    .sort()
    .map((name) => copyFileRead(join(dir, name), findings));
}

/** Every node under one, depth first, so a check reads a pattern whole. */
function copyNodes(node: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const item of node) copyNodes(item, found);
  } else if (typeof node === "object" && node !== null) {
    found.push(node);
    for (const [key, value] of Object.entries(node))
      if (key !== "span") copyNodes(value, found);
  }
  return found;
}

function copyOfType<T>(entry: Entry, type: string): T[] {
  return copyNodes(entry).filter(
    (node): node is T => (node as { readonly type?: unknown }).type === type,
  );
}

/** The variables an entry is formatted with, in the order first named. */
function copyVariables(entry: Message | Term): readonly string[] {
  const names = copyOfType<{ readonly id: { readonly name: string } }>(
    entry,
    "VariableReference",
  ).map((reference) => reference.id.name);
  return [...new Set(names)];
}

/** The words a term is drawn as, across every variant it has. */
function copyTermWords(term: Term): readonly string[] {
  const words = copyOfType<{ readonly value: string }>(term, "TextElement")
    .map((text) => text.value.trim())
    .filter((text) => /\p{L}/u.test(text));
  return [...new Set(words)];
}

/** The words a message says itself, outside every placeable it references. */
function copyMessageText(message: Message): string {
  return copyOfType<{ readonly value: string }>(message, "TextElement")
    .map((text) => text.value)
    .join(" ");
}

function copySpelled(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

function copyExemptions(message: Message): readonly string[] {
  const lines = message.comment?.content.split("\n") ?? [];
  return lines.flatMap((line) => {
    const named = copyExemptionPattern.exec(line.trim());
    return named?.[1] === undefined ? [] : [named[1]];
  });
}

/**
 * A message that spells a term's English instead of referencing it, unless a
 * line beside it says which term and why; and such a line that names a term
 * the message does not spell, which outlives the word it excused.
 */
function copyTermsSpelled(
  files: readonly CopyFile[],
  findings: string[],
): void {
  const terms = new Map(
    files
      .flatMap((file) => file.entries)
      .filter((entry): entry is Term => entry.type === "Term")
      .map((term) => [`-${term.id.name}`, copyTermWords(term)]),
  );
  for (const file of files)
    for (const entry of file.entries) {
      if (entry.type !== "Message") continue;
      const text = copyMessageText(entry);
      const exempt = copyExemptions(entry);
      for (const [term, words] of terms) {
        const spelled = words.some((word) => copySpelled(text, word));
        const at = `${copyShown(file.path)}: ${entry.id.name}`;
        if (spelled && !exempt.includes(term))
          findings.push(`${at}: spells ${term} instead of referencing it`);
        if (!spelled && exempt.includes(term))
          findings.push(
            `${at}: is exempt for ${term}, which it does not spell`,
          );
      }
      for (const term of exempt)
        if (!terms.has(term))
          findings.push(
            `${copyShown(file.path)}: ${entry.id.name}: is exempt for ${term}, which is no term`,
          );
    }
}

/** Ids prefixed by their section, unique, and terms in their own file. */
function copyIdsPlaced(files: readonly CopyFile[], findings: string[]): void {
  const seen = new Set<string>();
  for (const file of files)
    for (const entry of file.entries) {
      const id = `${entry.type === "Term" ? "-" : ""}${entry.id.name}`;
      const at = `${copyShown(file.path)}: ${id}`;
      if (seen.has(id)) findings.push(`${at}: is defined twice`);
      seen.add(id);
      const inTerms = basename(file.path) === copyTermsFile;
      if (entry.type === "Term" && !inTerms)
        findings.push(`${at}: a term belongs in ${copyTermsFile}`);
      if (entry.type === "Message" && inTerms)
        findings.push(`${at}: ${copyTermsFile} holds terms and no message`);
      if (
        entry.type === "Message" &&
        !new RegExp(`^${file.section}(-[a-z0-9]+)+$`, "u").test(id)
      )
        findings.push(`${at}: is not kebab-case under ${file.section}-`);
    }
}

/** What a layer may define: an id the base defines, with its variables. */
function copyLayerHeld(
  base: readonly CopyFile[],
  layer: CopyLayer,
  findings: string[],
): void {
  const key = (entry: Message | Term) =>
    `${entry.type === "Term" ? "-" : ""}${entry.id.name}`;
  const defined = new Map(
    base.flatMap((file) => file.entries).map((entry) => [key(entry), entry]),
  );
  for (const file of layer.files)
    for (const entry of file.entries) {
      const at = `${copyShown(file.path)}: ${key(entry)}`;
      const over = defined.get(key(entry));
      if (over === undefined) {
        findings.push(`${at}: is not defined by ${copyBase}`);
        continue;
      }
      const mine = [...copyVariables(entry)].sort().join(", ");
      const theirs = [...copyVariables(over)].sort().join(", ");
      if (mine !== theirs)
        findings.push(
          `${at}: takes { ${mine} } where ${copyBase} takes { ${theirs} }`,
        );
    }
}

function copyCamel(section: string): string {
  return section.replace(/-([a-z0-9])/gu, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

/** The module a section's ids and variables are typed in. */
function copyModuleName(section: string): string {
  return `${copyCamel(section)}Copy.ts`;
}

function copyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(name) ? name : JSON.stringify(name);
}

/** A section's module, in the formatter's own layout. */
function copyModule(file: CopyFile, catalogShown: string): string {
  const name = copyCamel(file.section);
  const lines = [
    `/** Generated by ui/chuggy-ui/tools/copyCatalog.ts from ${catalogShown}/${copyBase}/${file.section}.ftl.`,
    " * Do not edit by hand; run `node ui/chuggy-ui/tools/copyCatalog.ts`. */",
    "",
    `export interface ${name.charAt(0).toUpperCase()}${name.slice(1)}Copy {`,
  ];
  for (const entry of file.entries) {
    if (entry.type !== "Message") continue;
    const variables = copyVariables(entry);
    const id = JSON.stringify(entry.id.name);
    if (variables.length === 0) {
      lines.push(`  readonly ${id}: Record<never, never>;`);
      continue;
    }
    lines.push(`  readonly ${id}: {`);
    for (const variable of variables)
      lines.push(`    readonly ${copyKey(variable)}: string | number;`);
    lines.push("  };");
  }
  lines.push("}", "");
  return lines.join("\n");
}

function copyLayersRead(catalog: string, findings: string[]): CopyLayer[] {
  return readdirSync(catalog)
    .filter((name) => statSync(join(catalog, name)).isDirectory())
    .filter((name) => name !== copyBase && name !== copySourcesDir)
    .sort()
    .flatMap((name) => {
      if (name === copyPseudo) {
        findings.push(
          `${copyShown(join(catalog, name))}: ${copyPseudo} is drawn from ${copyBase}, not from files`,
        );
        return [];
      }
      if (copyLayerPattern.test(name))
        return [
          { name, files: copyDirectoryRead(join(catalog, name), findings) },
        ];
      findings.push(
        `${copyShown(join(catalog, name))}: a vernacular is named ${copyBase}-x-<name>`,
      );
      return [];
    });
}

function copyTemplate(source: string): string {
  return `\`${source.replace(/[\\`]|\$\{/gu, (found) => `\\${found}`)}\``;
}

/** A base file as a module holding its text, which the catalog is loaded from. */
function copySourceModule(file: CopyFile, catalogShown: string): string {
  return [
    `/** Generated by ui/chuggy-ui/tools/copyCatalog.ts from ${catalogShown}/${copyBase}/${file.section}.ftl.`,
    " * Do not edit by hand; run `node ui/chuggy-ui/tools/copyCatalog.ts`. */",
    "",
    `export const ${copyCamel(file.section)}Ftl = ${copyTemplate(file.source)};`,
    "",
  ].join("\n");
}

/** Every vernacular's files' text, by its name, in the formatter's own layout. */
function copyVernacularsSource(layers: readonly CopyLayer[]): string {
  const lines = [
    "/** Generated by ui/chuggy-ui/tools/copyCatalog.ts from each vernacular's directory.",
    " * Do not edit by hand; run `node ui/chuggy-ui/tools/copyCatalog.ts`. */",
    "",
  ];
  const head =
    "export const copyVernaculars: Readonly<Record<string, readonly string[]>> =";
  if (layers.length === 0) return [...lines, `${head} {};`, ""].join("\n");
  lines.push(`${head} {`);
  for (const layer of layers) {
    lines.push(`  ${JSON.stringify(layer.name)}: [`);
    for (const file of layer.files)
      lines.push(`    ${copyTemplate(file.source)},`);
    lines.push("  ],");
  }
  lines.push("};", "");
  return lines.join("\n");
}

/** Each module in `dir` that differs from what is wanted of it, or that
 * nothing wants, written instead where this is not a check. */
function copyWritten(
  dir: string,
  suffix: string,
  wanted: ReadonlyMap<string, string>,
  check: boolean,
): string[] {
  const stale: string[] = [];
  const present = existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith(suffix))
    : [];
  for (const name of present)
    if (!wanted.has(name))
      stale.push(
        `${copyShown(join(dir, name))}: is stale: no section generates it`,
      );
  for (const [name, text] of wanted) {
    const path = join(dir, name);
    const held = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (held === text) continue;
    if (check)
      stale.push(
        `${copyShown(path)}: is stale; run node ui/chuggy-ui/tools/copyCatalog.ts`,
      );
    else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, text);
    }
  }
  return stale;
}

/** The two modules each base file generates: its ids and variables as types
 * for the decision layer, and its text for the catalog to load; and the one
 * holding every vernacular's text. */
function copyGenerated(
  base: readonly CopyFile[],
  layers: readonly CopyLayer[],
  catalog: string,
  generated: string,
  check: boolean,
): string[] {
  const shown = relative(consoleDir, catalog) || "app/copy";
  const types = new Map(
    base
      .filter((file) => basename(file.path) !== copyTermsFile)
      .map((file) => [copyModuleName(file.section), copyModule(file, shown)]),
  );
  const sources = new Map(
    base.map((file) => [
      `${copyCamel(file.section)}Ftl.ts`,
      copySourceModule(file, shown),
    ]),
  );
  return [
    ...copyWritten(generated, "Copy.ts", types, check),
    ...copyWritten(join(catalog, copySourcesDir), "Ftl.ts", sources, check),
    ...copyWritten(
      join(catalog, copySourcesDir),
      copyVernacularsModule,
      new Map([[copyVernacularsModule, copyVernacularsSource(layers)]]),
      check,
    ),
  ];
}

function copyCatalogRun(argv: readonly string[]): 0 | 1 {
  const { check, catalog, generated } = copyArguments(argv);
  const baseDir = join(catalog, copyBase);
  if (!existsSync(baseDir))
    throw new CopyUnreadable(`${copyShown(baseDir)} is not there`);
  const findings: string[] = [];
  const base = copyDirectoryRead(baseDir, findings);
  const layers = copyLayersRead(catalog, findings);
  copyIdsPlaced(base, findings);
  copyTermsSpelled(base, findings);
  for (const layer of layers) copyLayerHeld(base, layer, findings);
  if (findings.length === 0)
    findings.push(...copyGenerated(base, layers, catalog, generated, check));
  for (const finding of findings) console.log(`ERROR ${finding}`);
  if (findings.length > 0) {
    console.log(`copyCatalog: ${String(findings.length)} finding(s)`);
    return 1;
  }
  const files =
    base.length + layers.reduce((sum, layer) => sum + layer.files.length, 0);
  console.log(
    `copyCatalog: ${String(files)} catalog file(s) clean across ${String(layers.length)} vernacular(s), generated modules ${check ? "current" : "written"}`,
  );
  return 0;
}

try {
  process.exitCode = copyCatalogRun(process.argv.slice(2));
} catch (error) {
  console.log(
    `copyCatalog: LINTER ERROR — ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
}
