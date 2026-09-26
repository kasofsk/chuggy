import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  type PublishedManifest,
  publishedManifest,
  workerContractFilesDigest,
  workspaceManifest,
  workspaceManifestOf,
} from "../../scripts/pack-worker-contract.ts";
import { workerContractRelease } from "../../src/contract/workerContract.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const manifest = workspaceManifest();
const entries = Object.keys(manifest.exports);

let work = "";
let printed = "";
let tarball = "";
let consumer = "";

/** A consumer outside this tree, holding the extracted tarball and the tree's zod and nothing else to resolve against. */
before(() => {
  work = mkdtempSync(join(tmpdir(), "worker-contract-pack-"));
  const packed = spawnSync(
    process.execPath,
    ["scripts/pack-worker-contract.ts", "--out", join(work, "out")],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(packed.status, 0, packed.stderr);
  printed = packed.stdout;
  const [packedFile, ...others] = readdirSync(join(work, "out"));
  assert.ok(packedFile !== undefined && others.length === 0, "one tarball");
  tarball = join(work, "out", packedFile);

  consumer = join(work, "consumer");
  const installed = join(consumer, "node_modules", manifest.name);
  mkdirSync(join(work, "extracted"));
  mkdirSync(dirname(installed), { recursive: true });
  const extracted = spawnSync(
    "tar",
    ["-xzf", tarball, "-C", join(work, "extracted")],
    { encoding: "utf8" },
  );
  assert.equal(extracted.status, 0, extracted.stderr);
  renameSync(join(work, "extracted", "package"), installed);
  symlinkSync(
    realpathSync(join(root, "node_modules/zod")),
    join(consumer, "node_modules/zod"),
  );
  writeFileSync(join(consumer, "package.json"), '{ "type": "module" }\n');
});

after(() => {
  rmSync(work, { recursive: true, force: true });
});

test("the printed digests are the tarball's own and its extracted files'", () => {
  const sha256 = createHash("sha256")
    .update(readFileSync(tarball))
    .digest("hex");
  const files = workerContractFilesDigest(
    join(consumer, "node_modules", manifest.name),
  );
  assert.equal(printed, `${sha256}  ${tarball}\nfiles ${files}\n`);
});

test("the files digest moves with a file's bytes or its path, and refuses a link and a package that is not a directory", () => {
  const copy = join(work, "copy");
  cpSync(join(consumer, "node_modules", manifest.name), copy, {
    recursive: true,
  });
  const files = workerContractFilesDigest(copy);
  appendFileSync(join(copy, "workerPlane.js"), " ");
  assert.notEqual(workerContractFilesDigest(copy), files);
  renameSync(join(copy, "workerPlane.js"), join(copy, "workerPlanes.js"));
  const renamed = workerContractFilesDigest(copy);
  renameSync(join(copy, "workerPlanes.js"), join(copy, "workerPlane.js"));
  assert.notEqual(renamed, workerContractFilesDigest(copy));
  assert.throws(() => workerContractFilesDigest(join(copy, "package.json")));
  symlinkSync(join(copy, "package.json"), join(copy, "linked.json"));
  assert.throws(() => workerContractFilesDigest(copy), /linked\.json/u);
});

test("the tarball's manifest is the workspace's, versioned by the release and pointed at the emit", () => {
  const packed = JSON.parse(
    readFileSync(
      join(consumer, "node_modules", manifest.name, "package.json"),
      "utf8",
    ),
  ) as PublishedManifest;
  assert.deepEqual(packed, publishedManifest(manifest, workerContractRelease));
  assert.deepEqual(Object.keys(packed.exports), entries);
  assert.equal(packed.version, workerContractRelease);
  assert.equal(packed.license, "MIT");
});

test("the tarball carries the workspace's licence", () => {
  assert.equal(
    readFileSync(
      join(consumer, "node_modules", manifest.name, "LICENSE"),
      "utf8",
    ),
    readFileSync(join(root, "src/contract/LICENSE"), "utf8"),
  );
});

test("every entry imports by its package name from the emitted JavaScript, exporting what its source does", async () => {
  const imported = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const [name, ...entries] = process.argv.slice(1);
       const exported = {};
       for (const entry of entries)
         exported[entry] = Object.keys(await import(name + entry.slice(1)));
       process.stdout.write(JSON.stringify(exported));`,
      manifest.name,
      ...entries,
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);
  const sources: Record<string, string[]> = {};
  for (const [entry, source] of Object.entries(manifest.exports))
    sources[entry] = Object.keys(
      (await import(
        pathToFileURL(join(root, "src/contract", source)).href
      )) as object,
    );
  assert.deepEqual(JSON.parse(imported.stdout), sources);
});

test("a consumer typechecks against every entry's declarations, the declarations included", () => {
  writeFileSync(
    join(consumer, "consumer.ts"),
    entries
      .map(
        (entry) =>
          `export * as ${entry.slice(2)} from "${manifest.name}${entry.slice(1)}";\n`,
      )
      .join(""),
  );
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "esnext",
        module: "nodenext",
        moduleResolution: "nodenext",
        lib: ["ES2023", "DOM"],
        types: [],
        strict: true,
        noEmit: true,
        /** The emitted declarations are what is under test, so they are checked rather than skipped. */
        skipLibCheck: false,
      },
      files: ["consumer.ts"],
    }),
  );
  const checked = spawnSync(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
      "-p",
      join(consumer, "tsconfig.json"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(checked.status, 0, checked.stdout);
});

test("a workspace field the published manifest has no rule for is refused, and so is an entry that is not a module", () => {
  for (const refused of [
    { ...manifest, dependencies: { zod: "^4.4.3" } },
    { ...manifest, main: "./workerPlane.ts" },
    { ...manifest, exports: { "./workerPlane": "./workerPlane.js" } },
    { ...manifest, private: false },
  ])
    assert.throws(() => workspaceManifestOf(refused), JSON.stringify(refused));
  assert.deepEqual(workspaceManifestOf({ ...manifest }), manifest);
});
