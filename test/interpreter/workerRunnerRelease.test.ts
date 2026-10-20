import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { workerContractRelease } from "../../src/contract/workerContract.ts";
import {
  workerRunnerListed,
  workerRunnerReleaseAnswered,
  workerRunnerReleasesRead,
} from "../../src/interpreter/workerRunnerRelease.ts";

const integrity = `sha512-${"A".repeat(85)}g==`;
const pin = {
  version: "0.14.1",
  url: "https://github.com/kasofsk/chuggy-linux/releases/download/v0.14.1/chuggy-linux-0.14.1.tgz",
  integrity,
};
const releases = workerRunnerReleasesRead({ "chuggy-linux": pin });
const runner = { package: "chuggy-linux", version: "0.14.0" };

test("the pins are each package's release, the package read off its key", () => {
  assert.deepEqual(
    [...releases],
    [["chuggy-linux", { package: "chuggy-linux", ...pin }]],
  );
  assert.deepEqual([...workerRunnerReleasesRead({})], []);
});

test("the pins this tree keeps parse, so a start reading them is not refused", () => {
  assert.doesNotThrow(() =>
    workerRunnerReleasesRead(
      JSON.parse(
        readFileSync(
          new URL("../../src/roots/runnerReleases.json", import.meta.url),
          "utf8",
        ),
      ),
    ),
  );
});

test("a pin that is not a release of the package it is kept under is refused, never read as no pin", () => {
  for (const kept of [
    [],
    null,
    "chuggy-linux",
    { "Chuggy-linux": pin },
    { "chuggy-linux": { ...pin, version: "latest" } },
    { "chuggy-linux": { ...pin, url: "http://github.com/a.tgz" } },
    { "chuggy-linux": { ...pin, integrity: "sha512-short" } },
    { "chuggy-linux": { ...pin, package: "chuggy-darwin" } },
    { "chuggy-linux": { version: pin.version, url: pin.url } },
  ])
    assert.throws(
      () => workerRunnerReleasesRead(kept),
      Error,
      JSON.stringify(kept),
    );
});

test("a poll is answered with its runner's pin only where it named a pinned package and its release reads one", () => {
  const pinned = releases.get("chuggy-linux");
  assert.deepEqual(
    workerRunnerReleaseAnswered(releases, runner, workerContractRelease),
    pinned,
  );
  assert.deepEqual(
    workerRunnerReleaseAnswered(
      releases,
      { ...runner, version: "0.15.0" },
      workerContractRelease,
    ),
    pinned,
    "the pin is named whatever version the runner runs",
  );
  for (const [named, offered] of [
    [runner, "1.10.0"],
    [runner, undefined],
    [runner, "not-a-release"],
    [undefined, workerContractRelease],
    [{ package: "chuggy-darwin", version: "0.1.0" }, workerContractRelease],
  ] as const)
    assert.equal(
      workerRunnerReleaseAnswered(releases, named, offered),
      undefined,
      `${JSON.stringify(named)} ${String(offered)}`,
    );
});

test("a runner is shown with its package's pinned version where one is pinned, and alone where none is", () => {
  assert.deepEqual(workerRunnerListed(releases, runner), {
    ...runner,
    pinned: "0.14.1",
  });
  assert.deepEqual(
    workerRunnerListed(releases, {
      package: "chuggy-darwin",
      version: "0.1.0",
    }),
    { package: "chuggy-darwin", version: "0.1.0" },
  );
  assert.equal(workerRunnerListed(releases, undefined), undefined);
});
