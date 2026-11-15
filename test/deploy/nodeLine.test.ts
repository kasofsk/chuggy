/**
 * Every node image this tree builds on or runs is on the line `package.json`
 * types the tree against, so the typechecker vouches for the node each one
 * runs. A pin moved to another line, or the types moved without the pins,
 * turns this red until the two agree.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);

/** The files that pin a node image: each image's Dockerfile, and the console's local compose file. */
function nodeLinePinFiles(): string[] {
  const images = readdirSync(new URL("images/", root), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `images/${entry.name}/Dockerfile`);
  return [...images, "ui/chuggy-ui/dev/compose.yaml"];
}

/** The major of every `node:` image a file's `FROM` or `image:` lines name, comments dropped. */
function nodeLinePinsOf(text: string): string[] {
  const majors: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*#/u.test(line)) continue;
    const pinned = /^\s*(?:FROM\s+(?:--\S+\s+)*|image:\s*)node:(\d+)\./u.exec(
      line,
    );
    if (pinned?.[1] !== undefined) majors.push(pinned[1]);
  }
  return majors;
}

/** The major of `@types/node`'s range in the root manifest. */
function nodeLineTyped(): string {
  const manifest = JSON.parse(
    readFileSync(new URL("package.json", root), "utf8"),
  ) as { devDependencies?: Record<string, string> };
  const range = manifest.devDependencies?.["@types/node"];
  const major = range === undefined ? undefined : /^\^(\d+)\./u.exec(range);
  assert.ok(major?.[1] !== undefined, `@types/node's range is ${range}`);
  return major[1];
}

test("every node image the tree pins is on the line its types are", () => {
  const typed = nodeLineTyped();
  const files = nodeLinePinFiles();
  for (const file of files) {
    const pins = nodeLinePinsOf(readFileSync(new URL(file, root), "utf8"));
    assert.ok(pins.length > 0, `${file} pins no node image`);
    for (const major of pins) assert.equal(major, typed, file);
  }
});

test("a pin is read from a stage's FROM and a service's image, and not from a comment", () => {
  assert.deepEqual(
    nodeLinePinsOf(
      [
        "# FROM node:26.7.0-trixie",
        "FROM --platform=$BUILDPLATFORM node:24.22.3-trixie@sha256:0 AS base",
        "FROM node:26.7.0-trixie-slim",
        "    image: node:24.22.3-trixie-slim@sha256:0",
        "FROM base AS core",
      ].join("\n"),
    ),
    ["24", "26", "24"],
  );
});
