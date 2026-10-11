/**
 * The console image against this tree: the setup program is answered as a
 * file or not at all.
 *
 * The image's fallback answers every path with no file behind it with the
 * console's document and a 200, and a terminal that fetched the program from
 * a build without one would save that document and hand it to Node. So
 * `images/chuggy-ui/nginx.conf` names the program's path exactly, and the path
 * is held equal here to the constant the build writes the file under, because
 * the configuration cannot import it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { setupProgramPath } from "../../ui/chuggy-ui/app/core/setupProgram.ts";

const configurationPath = new URL(
  "../../images/chuggy-ui/nginx.conf",
  import.meta.url,
);

/** Each location's directives by what it matches, with comment lines dropped as nginx drops them. */
function locations(text: string): Map<string, string> {
  const read = text
    .split("\n")
    .filter((line) => !/^\s*#/u.test(line))
    .join("\n");
  const found = new Map<string, string>();
  for (const [, matched = "", body = ""] of read.matchAll(
    /\blocation\s+([^{]+?)\s*\{([^{}]*)\}/gu,
  ))
    found.set(matched, body.trim().replace(/\s+/gu, " "));
  return found;
}

test("the image answers the setup program's own path with its file, or with a 404", () => {
  const served = locations(readFileSync(configurationPath, "utf8"));
  assert.equal(served.get(`= ${setupProgramPath}`), "try_files $uri =404;");
});

test("what the exact location stands ahead of is a fallback that answers any path with the document", () => {
  const served = locations(readFileSync(configurationPath, "utf8"));
  assert.equal(served.get("/"), "try_files $uri $uri/ /index.html;");
});
