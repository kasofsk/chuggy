/**
 * The file-tree secret source: a configured directory where each reference
 * names one file holding the material. It is how a suite hands material to a
 * spawn and equally how a deployment mounts pre-synced secrets beside the
 * dispatcher, which is why it is an adapter and not a fixture.
 *
 * A REFERENCE IS A FILE NAME, NEVER A PATH. One reaching for a separator or a
 * leading dot is refused before anything is read, so a registry row —
 * operator-written, but a row all the same — cannot walk this source out of
 * its directory.
 *
 * THE MATERIAL IS TRIMMED the way the fabric client reads the platform's own
 * mounted token file: a file ends with the newline the tool that wrote it
 * left, and a newline inside an env value is a bug no job can see.
 */

import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { SecretSource } from "../interpreter/secretSource.ts";

/** The one shape a reference may take here: a plain file name that stays in the directory. */
const secretFileName = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** The source over a directory that must already exist: a deployment with no mounted secrets can resolve nothing. */
export function secretFileSource(directory: string): SecretSource {
  if (statSync(directory, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(
      `secretFileSource: ${directory} is not a directory this deployment mounted`,
    );
  }
  return async (reference) => {
    if (!secretFileName.test(reference)) {
      throw new Error(
        `secretFileSource: ${reference} is not a plain file name`,
      );
    }
    return (await readFile(join(directory, reference), "utf8")).trim();
  };
}
