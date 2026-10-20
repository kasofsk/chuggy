#!/usr/bin/env node

/**
 * Pins the release chuggy answers a runner package's polls with: fetches the
 * package's tarball from its own repository's release downloads, computes the
 * integrity npm writes for those bytes, and keeps the pin in
 * `src/roots/runnerReleases.json` beside every other package's.
 *
 * IT WRITES NOTHING IT HAS NOT READ WHOLE. A package or version outside the
 * header's grammar, pins already kept that do not parse, a fetch answered other
 * than 200, a body past the bound or a fetch past its time is refused, and the
 * pins stay as they were.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  workerRunnerPackageSchema,
  workerRunnerReleaseSchema,
  workerRunnerVersionSchema,
  type WorkerRunnerRelease,
} from "../src/contract/workerPool.ts";
import { boundedResponseBytes } from "../src/adapters/http/boundedResponse.ts";
import { workerRunnerReleasesRead } from "../src/interpreter/workerRunnerRelease.ts";

/** The largest body read as a release; past it the fetch is refused rather than read on. */
export const pinRunnerReleaseBytesMax = 64 * 1024 * 1024;

/** The most chunks a body is read in, which is what ends a body yielding empty ones. */
export const pinRunnerReleaseReadsMax = 65_536;

/** How long one fetch may take, its redirects included. */
export const pinRunnerReleaseFetchMs = 120_000;

/** Everything a pin reads or changes outside this module, so a test can stand in for GitHub and the file. */
export interface PinRunnerReleasePorts {
  readonly fetch: (
    url: string,
    init: { signal: AbortSignal },
  ) => Promise<Response>;
  readonly read: () => string;
  readonly write: (text: string) => void;
}

export type RunnerReleasePinned =
  | { readonly pinned: "Refused"; readonly why: string }
  | {
      readonly pinned: "Pinned";
      readonly release: WorkerRunnerRelease;
      readonly replaced?: string;
    };

/** Where a package's release tarball is published: its own repository's release downloads, under the tag npm's version names. */
export function runnerReleaseUrl(named: string, version: string): string {
  return `https://github.com/kasofsk/${named}/releases/download/v${version}/${named}-${version}.tgz`;
}

/** The pins as the file keeps them: each package's release less its package, in package order. */
function pinRunnerReleasesText(
  pins: ReadonlyMap<string, WorkerRunnerRelease>,
): string {
  const kept = Object.fromEntries(
    [...pins]
      .sort(([one], [other]) => (one < other ? -1 : 1))
      .map(([named, { version, url, integrity }]) => [
        named,
        { version, url, integrity },
      ]),
  );
  return `${JSON.stringify(kept, null, 2)}\n`;
}

/** Pins `version` of `named` over whatever release it had, unless a refusal holds. */
export async function pinRunnerRelease(
  ports: PinRunnerReleasePorts,
  named: string,
  version: string,
  bytesMax: number = pinRunnerReleaseBytesMax,
): Promise<RunnerReleasePinned> {
  if (!workerRunnerPackageSchema.safeParse(named).success)
    return {
      pinned: "Refused",
      why: `${named} is not a runner package's name`,
    };
  if (!workerRunnerVersionSchema.safeParse(version).success)
    return { pinned: "Refused", why: `${version} is not a release's version` };
  let pins: Map<string, WorkerRunnerRelease>;
  try {
    pins = new Map(workerRunnerReleasesRead(JSON.parse(ports.read())));
  } catch (failure) {
    return {
      pinned: "Refused",
      why: `the pins kept do not parse: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
  const url = runnerReleaseUrl(named, version);
  let answered: Response;
  try {
    answered = await ports.fetch(url, {
      signal: AbortSignal.timeout(pinRunnerReleaseFetchMs),
    });
  } catch (failure) {
    return {
      pinned: "Refused",
      why: `${url} could not be fetched: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
  if (answered.status !== 200) {
    await answered.body?.cancel();
    return {
      pinned: "Refused",
      why: `${url} answered ${String(answered.status)}`,
    };
  }
  let body: Uint8Array;
  try {
    body = await boundedResponseBytes(
      answered,
      bytesMax,
      pinRunnerReleaseReadsMax,
    );
  } catch (failure) {
    return {
      pinned: "Refused",
      why: `${url} could not be read whole: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
  const release = workerRunnerReleaseSchema.parse({
    package: named,
    version,
    url,
    integrity: `sha512-${createHash("sha512").update(body).digest("base64")}`,
  });
  const replaced = pins.get(named)?.version;
  pins.set(named, release);
  ports.write(pinRunnerReleasesText(pins));
  return replaced === undefined
    ? { pinned: "Pinned", release }
    : { pinned: "Pinned", release, replaced };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { positionals } = parseArgs({ allowPositionals: true });
  const [named, version] = positionals;
  if (
    positionals.length !== 2 ||
    named === undefined ||
    version === undefined
  ) {
    process.stderr.write("pin-runner-release: usage: <package> <version>\n");
    process.exitCode = 2;
  } else {
    const kept = fileURLToPath(
      new URL("../src/roots/runnerReleases.json", import.meta.url),
    );
    const pinned = await pinRunnerRelease(
      {
        fetch: (url, init) => fetch(url, init),
        read: () => readFileSync(kept, "utf8"),
        write: (text) => {
          writeFileSync(kept, text);
        },
      },
      named,
      version,
    );
    if (pinned.pinned === "Refused") {
      process.stderr.write(`pin-runner-release: ${pinned.why}\n`);
      process.exitCode = 1;
    } else
      process.stdout.write(
        `pinned ${pinned.release.package} ${pinned.release.version}${pinned.replaced === undefined ? "" : ` over ${pinned.replaced}`}  ${pinned.release.integrity}\n`,
      );
  }
}
