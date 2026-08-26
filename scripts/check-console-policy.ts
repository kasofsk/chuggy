/**
 * A built console's document, held to the policy `images/web/nginx.conf`
 * serves it under.
 *
 * It reads what the build wrote rather than what the sources say, because the
 * inline script this is really about is one a bundler injects.
 * `scripts/console-policy.ts` is what decides; this reads the file, reports and
 * exits, and `test/scripts/consolePolicy.test.ts` is what holds the decision to
 * each finding it names.
 *
 * Usage:
 *   node scripts/check-console-policy.ts <document-root>
 *
 * Exits 0 clean, 1 on a finding, 2 when it could not run.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { consolePolicyFindings } from "./console-policy.ts";

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

const findings = consolePolicyFindings(markup);
for (const finding of findings)
  process.stdout.write(
    `check-console-policy: ${documentPath} carries ${finding}\n`,
  );
if (findings.length > 0) process.exit(1);
process.stdout.write(
  `check-console-policy: ${documentPath} loads only same-origin files\n`,
);
