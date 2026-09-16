import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import ts from "typescript";
import { format } from "prettier";

const root = resolve(import.meta.dirname, "..");
const vendored = resolve(root, "vendor/chuggernaut");
const checking = process.argv.includes("--check");

/**
 * THE DOMAIN IS A DEPENDENCY AND THE REST IS STILL VENDORED, so the compile
 * reads one tree that is neither. `@kasofsk/chug-ticket-domain` publishes the
 * core flat while the sources beside it import it nested, and a staged tree is
 * what lets both resolve without rewriting either. The package is pinned by the
 * lockfile, which is why its files carry no digest here.
 */
const packaged = dirname(
  createRequire(import.meta.url).resolve(
    "@kasofsk/chug-ticket-domain/package.json",
  ),
);
const staging = resolve(root, "node_modules/.cache");
mkdirSync(staging, { recursive: true });
const upstream = mkdtempSync(resolve(staging, "chug-ticket-domain-"));
cpSync(vendored, upstream, { recursive: true });
for (const name of ["ticket", "task", "evaluation", "testing"])
  cpSync(
    resolve(packaged, "src", `${name}.ts`),
    resolve(upstream, "chug/domain", `${name}.ts`),
  );
const manifest = JSON.parse(
  readFileSync(resolve(vendored, "source.json"), "utf8"),
) as {
  sha256: Record<string, string>;
};
for (const [file, expected] of Object.entries(manifest.sha256)) {
  const actual = createHash("sha256")
    .update(readFileSync(resolve(root, file)))
    .digest("hex");
  if (actual !== expected) throw new Error(`upstream source differs: ${file}`);
}
const sources = [
  ...["task", "evaluation", "ticket", "testing"].map(
    (name) => `chug/domain/${name}.ts`,
  ),
  "chug/app/codec.ts",
  "chug/app/codec_schema.ts",
  "chug/execution_profile.ts",
  "chug/json_schema.ts",
  "chug/runner/comments.ts",
  "chug/runner/commit_hooks.ts",
].map((name) => resolve(upstream, name));
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
if (diagnostics.length) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
}
function destination(name: string): string {
  if (
    name === "chug/execution_profile.js" ||
    name === "chug/execution_profile.d.ts"
  )
    return resolve(
      root,
      "src/interpreter/chuggernaut",
      name.slice("chug/".length),
    );
  if (name === "chug/json_schema.js" || name === "chug/json_schema.d.ts")
    return resolve(
      root,
      "src/adapters/catalog/chuggernaut",
      name.slice("chug/".length),
    );
  if (name.startsWith("chug/runner/"))
    return resolve(
      root,
      "src/adapters/runtime/chuggernaut",
      name.slice("chug/runner/".length),
    );
  if (name === "chug/domain/testing.js" || name === "chug/domain/testing.d.ts")
    return resolve(
      root,
      "test/chuggernaut/domain",
      name.slice("chug/domain/".length),
    );
  if (name.startsWith("chug/domain/"))
    return resolve(
      root,
      "src/domain/chuggernaut",
      name.slice("chug/domain/".length),
    );
  if (name.startsWith("chug/app/"))
    return resolve(
      root,
      "src/interpreter/chuggernaut",
      name.slice("chug/app/".length),
    );
  if (name === "chug/json.js" || name === "chug/json.d.ts")
    return resolve(
      root,
      "src/interpreter/chuggernaut",
      name.slice("chug/".length),
    );
  throw new Error(`unexpected upstream output: ${name}`);
}
const emitted = new Map<string, string>();
program.emit(undefined, (file, contents) => {
  const name = relative(options.outDir ?? "", file);
  const target = destination(name);
  const rewritten = contents
    .replace(
      /(["'])(\.[^"']+\.js)\1/g,
      (_match, quote: string, specifier: string) => {
        const dependency = relative(
          upstream,
          resolve(upstream, dirname(name), specifier),
        );
        const relocated = relative(dirname(target), destination(dependency));
        return `${quote}${relocated.startsWith(".") ? relocated : `./${relocated}`}${quote}`;
      },
    )
;
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
rmSync(upstream, { recursive: true, force: true });
process.stdout.write(
  "ticket domain: pinned upstream sources and compiled core agree\n",
);
