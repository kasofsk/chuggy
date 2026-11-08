/**
 * The older releases this server still serves, held to what this tree
 * installs: each is an alias of the asset its tag was published with, holding
 * the files its history entry records, and nothing else is installed. What each
 * is replayed against is the server's own suites: the planes' answers and
 * requests in `test/adapters/workerPlaneContract.test.ts`, a pool's polls and
 * settlements in `test/adapters/poolPlaneServer.test.ts`, the pod documents in
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
import {
  workerContractHeader,
  workerContractRelease,
  workerContractRunDiskLow,
} from "../../src/contract/workerContract.ts";
import {
  runEndedEvidences,
  workerPlaneRoutes,
  workerRunEndedSchema,
  workerRunTotalsSchema,
  workerRunTurnsSchema,
} from "../../src/contract/workerPlane.ts";
import {
  sessionFactsAnswerSchema,
  sessionTurnClaimedSchema,
} from "../../src/contract/sessionPlane.ts";
import { resultManifestDocumentSchema } from "../../src/contract/workerDocuments.ts";
import { workTaskDocumentSchema } from "../../src/contract/workerTask.ts";
import {
  contractVersionAccepted,
  workerContractAccepted,
  workerContractEvaluatedTrees,
  workerContractRunContexts,
  workerContractRunUsages,
  workerContractTargetRefs,
  workerContractThreadOffer,
} from "../../src/interpreter/workerPlane.ts";
import {
  workerContractAlias,
  workerContractAliases,
  workerContractAsset,
  workerContractInstalled,
  workerContractPlanes,
  workerContractReleaseExport,
  workerContractReleaseSchema,
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

test("a run ends `RunDiskLow` from the version a runner holds a plane's release to, and no release below it names that label", async () => {
  const from = {
    min: workerContractRunDiskLow,
    max: workerContractAccepted.max,
  };
  assert.ok(runEndedEvidences.includes("RunDiskLow"));
  assert.ok(contractVersionAccepted(from, workerContractRelease));
  for (const release of workerContractReplayed("job"))
    assert.equal(
      (
        await workerContractReleaseExport(
          release,
          "workerPlane",
          "runEndedEvidences",
          z.array(z.string()).optional(),
        )
      )?.includes("RunDiskLow") ?? false,
      contractVersionAccepted(from, release),
      release,
    );
});

test("a run sends its account's usage and its limit from the version a runner holds a plane's release to, and no release below it takes either", async () => {
  const carried = (schema: z.ZodType, field: string) =>
    schema instanceof z.ZodObject && Object.hasOwn(schema.shape, field);
  assert.ok(carried(workerRunTotalsSchema, "usage"));
  assert.ok(carried(workerRunEndedSchema, "limit"));
  assert.ok(
    contractVersionAccepted(workerContractRunUsages, workerContractRelease),
  );
  for (const release of workerContractReplayed("job"))
    for (const [name, field] of [
      ["workerRunTotalsSchema", "usage"],
      ["workerRunEndedSchema", "limit"],
    ] as const)
      assert.equal(
        carried(
          await workerContractReleaseExport(
            release,
            "workerPlane",
            name,
            workerContractReleaseSchema,
          ),
          field,
        ),
        contractVersionAccepted(workerContractRunUsages, release),
        `${release} ${name}`,
      );
});

/** Whether a turn page's schema lets a turn name the subagent call it was made under. */
function workerRunTurnNamesParent(schema: z.ZodType): boolean {
  if (!(schema instanceof z.ZodObject)) return false;
  const turns: unknown = schema.shape["turns"];
  return (
    turns instanceof z.ZodArray &&
    turns.element instanceof z.ZodObject &&
    Object.hasOwn(turns.element.shape, "parentToolUseId")
  );
}

test("a run offers its context readings and a turn its subagent call from the version a runner holds a plane's release to, and no release below it takes either", async () => {
  assert.ok(Object.hasOwn(workerPlaneRoutes, "runContext"));
  assert.ok(workerRunTurnNamesParent(workerRunTurnsSchema));
  assert.ok(
    contractVersionAccepted(workerContractRunContexts, workerContractRelease),
  );
  for (const release of workerContractReplayed("job")) {
    const taken = contractVersionAccepted(workerContractRunContexts, release);
    const routes = await workerContractReleaseExport(
      release,
      "workerPlane",
      "workerPlaneRoutes",
      z.record(z.string(), z.unknown()),
    );
    assert.equal(Object.hasOwn(routes, "runContext"), taken, release);
    assert.equal(
      workerRunTurnNamesParent(
        await workerContractReleaseExport(
          release,
          "workerPlane",
          "workerRunTurnsSchema",
          workerContractReleaseSchema,
        ),
      ),
      taken,
      release,
    );
  }
});

test("a work task names the ref its finalization lands on from the version a plane answers it to, and no release below it carries that field", async () => {
  assert.ok(Object.hasOwn(workTaskDocumentSchema.shape, "targetRef"));
  assert.ok(
    contractVersionAccepted(workerContractTargetRefs, workerContractRelease),
  );
  for (const release of workerContractReplayed("job")) {
    const document = await workerContractReleaseExport(
      release,
      "workerTask",
      "workTaskDocumentSchema",
      workerContractReleaseSchema,
    );
    assert.equal(
      document instanceof z.ZodObject &&
        Object.hasOwn(document.shape, "targetRef"),
      contractVersionAccepted(workerContractTargetRefs, release),
      release,
    );
  }
});

test("a manifest names the tree an evaluation checked out from the version a runner holds a plane's release to, and no release below it takes the key", async () => {
  const carried = (schema: z.ZodType) =>
    schema instanceof z.ZodObject &&
    Object.hasOwn(schema.shape, "evaluatedTree");
  assert.ok(carried(resultManifestDocumentSchema));
  assert.ok(
    contractVersionAccepted(
      workerContractEvaluatedTrees,
      workerContractRelease,
    ),
  );
  for (const release of workerContractReplayed("job"))
    assert.equal(
      carried(
        await workerContractReleaseExport(
          release,
          "workerDocuments",
          "resultManifestDocumentSchema",
          workerContractReleaseSchema,
        ),
      ),
      contractVersionAccepted(workerContractEvaluatedTrees, release),
      release,
    );
});

test("a session's facts name `ThreadOffer` and its mailbox hands over an `OfferReply` from the version a pod holds the plane to, and no release below it reads either", async () => {
  const read = (schema: z.ZodType, field: string, value: unknown) =>
    schema instanceof z.ZodObject &&
    Object.hasOwn(schema.shape, field) &&
    (schema.shape[field] as z.ZodType).safeParse(value).success;
  const members = [
    ["sessionFactsAnswerSchema", "capabilities", ["ThreadOffer"]],
    ["sessionTurnClaimedSchema", "inputKind", "OfferReply"],
  ] as const;
  assert.ok(read(sessionFactsAnswerSchema, "capabilities", ["ThreadOffer"]));
  assert.ok(read(sessionTurnClaimedSchema, "inputKind", "OfferReply"));
  assert.ok(
    contractVersionAccepted(workerContractThreadOffer, workerContractRelease),
  );
  for (const release of workerContractReplayed("session"))
    for (const [name, field, value] of members)
      assert.equal(
        read(
          await workerContractReleaseExport(
            release,
            "sessionPlane",
            name,
            workerContractReleaseSchema,
          ),
          field,
          value,
        ),
        contractVersionAccepted(workerContractThreadOffer, release),
        `${release} ${name}`,
      );
});
