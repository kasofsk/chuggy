/**
 * A built console's document, held to the policy `images/web/nginx.conf`
 * serves it under.
 *
 * That policy is `default-src 'none'` with `script-src 'self'` and
 * `style-src 'self'` — no `'unsafe-inline'` and no nonce — so an inline script
 * or style in the emitted markup is a page that loads in a dev server and is
 * blank in production, and a reference to another origin is a page missing a
 * piece of itself. It reads what the build wrote rather than what the sources
 * say, because the inline script this is really about is one a bundler injects.
 *
 * Usage:
 *   node scripts/check-console-policy.ts <document-root>
 *
 * Exits 0 clean, 1 on a finding, 2 when it could not run.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const inlineScript = /<script(?![^>]*\ssrc\s*=)[^>]*>/iu;
const inlineStyleElement = /<style[\s>]/iu;
const inlineStyleAttribute = /\sstyle\s*=\s*"/iu;
const reference = /\s(?:src|href)\s*=\s*"([^"]*)"/giu;

function policyFindings(markup: string): readonly string[] {
  const findings: string[] = [];
  if (inlineScript.test(markup))
    findings.push("an inline <script>, which script-src 'self' refuses");
  if (inlineStyleElement.test(markup))
    findings.push("an inline <style>, which style-src 'self' refuses");
  if (inlineStyleAttribute.test(markup))
    findings.push("a style attribute, which style-src 'self' refuses");
  for (const found of markup.matchAll(reference)) {
    const url = found[1] ?? "";
    if (url.startsWith("/") || url.startsWith("./") || url.startsWith("data:"))
      continue;
    findings.push(`a reference to ${url}, which default-src 'none' refuses`);
  }
  return findings;
}

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

const findings = policyFindings(markup);
for (const finding of findings)
  process.stdout.write(
    `check-console-policy: ${documentPath} carries ${finding}\n`,
  );
if (findings.length > 0) process.exit(1);
process.stdout.write(
  `check-console-policy: ${documentPath} loads only same-origin files\n`,
);
