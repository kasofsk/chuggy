/**
 * The build's verdict on the worker contract the image installs: every entry
 * imports from where the pod's scripts live, and resolves the same `zod` those
 * scripts do, so there is one instance of it.
 */

import { readFileSync, realpathSync } from "node:fs";
import { findPackageJSON } from "node:module";
import process from "node:process";

const contractPackage = "@chuggy/worker-contract";

/** The real path of the manifest of whichever copy of a package resolves from `base`. */
function installed(specifier, base) {
  const manifest = findPackageJSON(specifier, base);
  if (manifest === undefined)
    throw new Error(`${specifier} does not resolve from ${base}`);
  return realpathSync(manifest);
}

const contract = JSON.parse(
  readFileSync(installed(contractPackage, import.meta.url), "utf8"),
);
const zod = installed("zod", import.meta.url);
const entries = Object.keys(contract.exports);
for (const entry of entries) {
  const specifier = `${contractPackage}${entry.slice(1)}`;
  await import(specifier);
  const reached = installed("zod", import.meta.resolve(specifier));
  if (reached !== zod)
    throw new Error(`${specifier} resolves ${reached}, the scripts ${zod}`);
}

process.stdout.write(
  `the worker contract's ${entries.length} entries import and share ${zod}\n`,
);
