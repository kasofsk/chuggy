/**
 * Compile the adopted ticket domain into this tree, from the dependency that
 * publishes it.
 *
 * THE CORE IS COMPILED IN RATHER THAN IMPORTED, because `src/domain/` reaches
 * nothing outside itself and a package is outside it like any other module.
 * Emitting the dependency's own sources here is what leaves this tree with one
 * core: its decisions test the types they made with `instanceof`, so a second
 * copy — the package's `dist`, imported beside this one — would refuse every
 * object the first produced.
 *
 * THE SUITES' BUILDERS COME THROUGH THE SAME COMPILE for that reason and no
 * other. They are fixtures rather than domain, so they land under `test/`,
 * while what they build must be the types the code under test holds.
 *
 * `--check` reads the emitted files back rather than writing them, which is the
 * gate: a hand-edited core, or a dependency moved without rebuilding, is a
 * difference here.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { format } from "prettier";

const root = resolve(import.meta.dirname, "..");
const checking = process.argv.includes("--check");
const upstream = resolve(
  dirname(
    createRequire(import.meta.url).resolve(
      "@kasofsk/chug-ticket-domain/package.json",
    ),
  ),
  "src",
);
const sources = ["task", "evaluation", "ticket", "testing"].map((name) =>
  resolve(upstream, `${name}.ts`),
);
const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  types: ["node"],
  skipLibCheck: true,
  declaration: true,
  rootDir: upstream,
  outDir: resolve(root, "src/domain/chuggernaut"),
};
const program = ts.createProgram(sources, options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length)
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
function destination(name: string): string {
  if (name === "testing.js" || name === "testing.d.ts")
    return resolve(root, "test/chuggernaut/domain", name);
  return resolve(root, "src/domain/chuggernaut", name);
}
const emitted = new Map<string, string>();
program.emit(undefined, (file, contents) => {
  const name = relative(options.outDir ?? "", file);
  const target = destination(name);
  const rewritten = contents.replace(
    /(["'])(\.[^"']+\.js)\1/g,
    (_match, quote: string, specifier: string) => {
      const relocated = relative(
        dirname(target),
        destination(relative(upstream, resolve(upstream, specifier))),
      );
      return `${quote}${relocated.startsWith(".") ? relocated : `./${relocated}`}${quote}`;
    },
  );
  emitted.set(target, rewritten);
});
for (const [file, contents] of emitted) {
  const output = await format(contents, { filepath: file });
  if (checking) {
    if (readFileSync(file, "utf8") !== output)
      throw new Error(`compiled core differs: ${relative(root, file)}`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, output);
  }
}
process.stdout.write("ticket domain: the dependency and compiled core agree\n");
