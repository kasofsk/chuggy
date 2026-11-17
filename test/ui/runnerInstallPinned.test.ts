/**
 * The console's install command for each runner package, held to the release
 * chuggy pins for it: the console cannot read the pin, so it names the
 * release's tarball itself, and a pin moved by `just pin-runner-release` is a
 * finding here until the console names the same tarball.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { workerRunnerReleasesRead } from "../../src/interpreter/workerRunnerRelease.ts";
import { runnerPackages } from "../../ui/chuggy-ui/app/core/runners.ts";

test("each package the console offers installs the tarball of the release chuggy pins for it", () => {
  const pins = workerRunnerReleasesRead(
    JSON.parse(
      readFileSync(
        new URL("../../src/roots/runnerReleases.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  for (const offered of Object.values(runnerPackages)) {
    const pin = pins.get(offered.program);
    assert.ok(pin, `${offered.program} has no pinned release`);
    assert.equal(
      offered.installCommand,
      `npm i -g https://github.com/kasofsk/${offered.program}/releases/download/v${pin.version}/${offered.program}-${pin.version}.tgz`,
    );
    assert.equal(offered.installCommand, `npm i -g ${pin.url}`);
  }
});
