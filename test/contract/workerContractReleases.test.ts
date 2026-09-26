/**
 * The older releases this server still serves, held to what this tree
 * installs: each is an alias of the asset its tag was published with, holding
 * the files its history entry records, and nothing else is installed. What each
 * is replayed against is the server's own suites: the planes' answers and
 * requests in `test/adapters/workerPlaneContract.test.ts`, the pod documents in
 * `test/contract/workerTask.test.ts`, and the documents a harness writes in
 * `test/contract/workerDocuments.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { z } from "zod";

import {
  workerContractFilesDigest,
  workspaceManifest,
} from "../../scripts/pack-worker-contract.ts";
import { workerContractHistory } from "../../scripts/worker-contract-wire.ts";
import { workerContractHeader } from "../../src/contract/workerContract.ts";
import {
  workerContractAlias,
  workerContractAliases,
  workerContractAsset,
  workerContractInstalled,
  workerContractPlanes,
  workerContractReleaseExport,
  workerContractReleasesBelow,
  workerContractReplayed,
  type WorkerContractPlane,
} from "./workerContractReleases.ts";

/** Every release some plane serves below this tree's own. */
const replayed = [
  ...new Set(
    Object.keys(workerContractPlanes).flatMap((plane) =>
      workerContractReplayed(plane as WorkerContractPlane),
    ),
  ),
];

test("every release some plane serves below this tree's own is installed from its asset, and no other is", () => {
  const aliases = workerContractAliases();
  assert.deepEqual(
    [...aliases.keys()].sort(),
    replayed.map(workerContractAlias).sort(),
  );
  for (const release of replayed)
    assert.equal(
      aliases.get(workerContractAlias(release)),
      workerContractAsset(release),
    );
});

test("each installed release is the package and the version it is installed as", () => {
  for (const release of replayed)
    assert.deepEqual(
      z
        .object({ name: z.string(), version: z.string() })
        .parse(
          JSON.parse(
            readFileSync(
              join(workerContractInstalled(release), "package.json"),
              "utf8",
            ),
          ),
        ),
      { name: workspaceManifest().name, version: release },
    );
});

test("each installed release holds the files its history entry records", () => {
  const history = workerContractHistory();
  for (const release of replayed)
    assert.equal(
      workerContractFilesDigest(workerContractInstalled(release)),
      history.find((entry) => entry.release === release)?.files,
      `${workerContractInstalled(release)} is not the asset ${release} was published as`,
    );
});

test("a plane replays each release below the served one its floor accepts, so raising the floor drops one and a new release adds one", () => {
  const history = ["1.0.0", "1.0.1", "1.1.0", "1.2.0"].map((release) => ({
    release,
  }));
  const range = (minor: number) => ({
    min: { major: 1, minor },
    max: { major: 1, minor: 2 },
  });
  assert.deepEqual(workerContractReleasesBelow(history, range(0), "1.2.0"), [
    "1.0.0",
    "1.0.1",
    "1.1.0",
  ]);
  assert.deepEqual(workerContractReleasesBelow(history, range(1), "1.2.0"), [
    "1.1.0",
  ]);
  assert.deepEqual(workerContractReleasesBelow(history, range(2), "1.2.0"), []);
  assert.deepEqual(
    workerContractReleasesBelow(
      [...history, { release: "1.3.0" }],
      range(2),
      "1.3.0",
    ),
    ["1.2.0"],
  );
});

test("the pool plane serves no release below its own, which is why nothing replays one on it", () => {
  assert.deepEqual(
    workerContractReplayed("pool"),
    [],
    "a pool release below the served one is replayed by nothing yet",
  );
});

test("each installed release names its release in the header this server reads", async () => {
  for (const release of replayed) {
    assert.equal(
      await workerContractReleaseExport(
        release,
        "workerContract",
        "workerContractHeader",
        z.string(),
      ),
      workerContractHeader,
    );
    assert.equal(
      await workerContractReleaseExport(
        release,
        "workerContract",
        "workerContractRelease",
        z.string(),
      ),
      release,
    );
  }
});
