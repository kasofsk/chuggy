/**
 * The image runbook's variable tables against the roots that read them. Each
 * table opens by claiming to list every variable its root reads, and nothing
 * was holding it to that: a variable added to the root and missed in the table
 * is a deployment an operator cannot configure from the one document that
 * claims to enumerate them, and it reads as a default rather than as an
 * omission.
 *
 * THE EXPECTED SET IS DERIVED FROM THE ROOT, never listed here, and the table
 * is read from its own section so that a name mentioned in the prose around it
 * neither adds to nor covers for a row. Only the root's own file is read, so a
 * variable named in a helper it imports is not seen.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const readmePath = "deploy/rig/images/README.md";

/** Each root a section of the runbook claims to enumerate, and that section's heading. */
const tables = [
  { rootPath: "src/roots/nativeHttp.ts", heading: "## Configuring the API" },
  {
    rootPath: "src/roots/accessPlane.ts",
    heading: "## Configuring the access plane",
  },
] as const;

/** Every environment variable the root names, which is every one it can read. */
function rootVariables(rootPath: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const [, name] of readFileSync(rootPath, "utf8").matchAll(
    /"(CHUG_[A-Z0-9_]+)"/gu,
  ))
    if (name !== undefined) found.add(name);
  assert.notEqual(found.size, 0, `${rootPath} names no environment variable`);
  return found;
}

/** Every variable the runbook's own table names, taken from that section alone. */
function tableVariables(heading: string): ReadonlySet<string> {
  const readme = readFileSync(readmePath, "utf8");
  const opened = readme.indexOf(`${heading}\n`);
  assert.notEqual(opened, -1, `${readmePath} has no ${heading}`);
  const rest = readme.slice(opened + heading.length);
  const closed = rest.indexOf("\n## ");
  const section = closed === -1 ? rest : rest.slice(0, closed);
  const found = new Set<string>();
  for (const [, name] of section.matchAll(/^\| `(CHUG_[A-Z0-9_]+)` \|/gmu))
    if (name !== undefined) found.add(name);
  return found;
}

for (const { rootPath, heading } of tables)
  test(`the runbook's table under "${heading}" names every variable ${rootPath} reads`, () => {
    assert.deepEqual(tableVariables(heading), rootVariables(rootPath));
  });
