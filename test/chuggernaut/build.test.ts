import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const paths = [
  "scripts/build-ticket-domain.ts",
  "package.json",
  "vendor/chuggernaut",
  "model/task-contract",
  "model/ticket-domain",
  "model/application",
  "src/domain/chuggernaut",
  "src/interpreter/chuggernaut",
  "src/adapters/catalog/chuggernaut",
  "src/adapters/runtime/chuggernaut",
  "src/adapters/catalog/schemas",
  "test/chuggernaut/conformance",
  "test/chuggernaut/domain",
];

function build(directory: string) {
  return spawnSync(
    process.execPath,
    ["scripts/build-ticket-domain.ts", "--check"],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}

test("compiled adoption matches pinned sources and detects modified generated output", () => {
  const directory = mkdtempSync(join(tmpdir(), "chuggy-adopted-source-"));
  try {
    for (const path of paths) {
      const target = join(directory, path);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, path), target, { recursive: true });
    }
    symlinkSync(
      join(root, "node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    const clean = build(directory);
    assert.equal(clean.status, 0, clean.stderr);
    const generated = join(directory, "src/domain/chuggernaut/ticket.js");
    appendFileSync(generated, "\nexport const unexpected = true;\n");
    const changed = build(directory);
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /compiled core differs/);
    cpSync(join(root, "src/domain/chuggernaut/ticket.js"), generated);
    appendFileSync(
      join(directory, "vendor/chuggernaut/chug/app/codec.ts"),
      "\nexport const changed = true;\n",
    );
    const modifiedSource = build(directory);
    assert.equal(modifiedSource.status, 1);
    assert.match(modifiedSource.stderr, /upstream source differs/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
