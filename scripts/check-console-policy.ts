/**
 * A built console's document and the stylesheet it loads, held to the policy
 * `images/web/nginx.conf` serves it under and to the cascade order the design
 * system is built on.
 *
 * It reads what the build wrote rather than what the sources say, because the
 * inline script this is really about is one a bundler injects and the layer
 * order this is really about is one a minifier decides.
 * `scripts/console-policy.ts` is what decides; this reads the files, reports
 * and exits, and `test/scripts/consolePolicy.test.ts` is what holds the
 * decision to each finding it names. A document that loads no stylesheet is a
 * could-not-run: the cascade would be reported clean having been asked
 * nothing.
 *
 * Usage:
 *   node scripts/check-console-policy.ts <document-root>
 *
 * Exits 0 clean, 1 on a finding, 2 when it could not run.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  consoleCascadeFindings,
  consolePolicyFindings,
  consolePolicyStylesheetHrefs,
} from "./console-policy.ts";

const root = process.argv[2];
if (root === undefined || root === "") {
  process.stdout.write(
    "check-console-policy: LINTER ERROR — name the document root to read\n",
  );
  process.exit(2);
}

const documentPath = resolve(root, "index.html");
let markup = "";
try {
  markup = readFileSync(documentPath, "utf8");
} catch {
  process.stdout.write(
    `check-console-policy: LINTER ERROR — ${documentPath} could not be read\n`,
  );
  process.exit(2);
}
if (markup.trim() === "") {
  process.stdout.write(
    `check-console-policy: LINTER ERROR — ${documentPath} is empty\n`,
  );
  process.exit(2);
}

const findings = [...consolePolicyFindings(markup)];
for (const finding of findings)
  process.stdout.write(
    `check-console-policy: ${documentPath} carries ${finding}\n`,
  );

const hrefs = consolePolicyStylesheetHrefs(markup);
if (hrefs.length === 0) {
  process.stdout.write(
    `check-console-policy: LINTER ERROR — ${documentPath} loads no stylesheet, so its cascade could not be read\n`,
  );
  process.exit(2);
}
const layered: string[] = [];
for (const href of hrefs) {
  const sheetPath = resolve(root, href.replace(/^\//u, ""));
  let sheet = "";
  try {
    sheet = readFileSync(sheetPath, "utf8");
  } catch {
    process.stdout.write(
      `check-console-policy: LINTER ERROR — ${sheetPath} could not be read\n`,
    );
    process.exit(2);
  }
  const cascade = consoleCascadeFindings(sheet);
  for (const finding of cascade) {
    process.stdout.write(
      `check-console-policy: ${sheetPath} carries ${finding}\n`,
    );
    findings.push(finding);
  }
  layered.push(sheetPath);
}

if (findings.length > 0) process.exit(1);
process.stdout.write(
  `check-console-policy: ${documentPath} loads only same-origin files, and ${layered.join(", ")} declares its layers in the system's order\n`,
);
