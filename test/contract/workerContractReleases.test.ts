/**
 * The releases replayed against this server, held to what this tree
 * installs: each is an alias of the asset its tag was published with, one the
 * history records holding the files its entry names, and nothing else is
 * installed. What each
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
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  workerContractFilesDigest,
  workspaceManifest,
} from "../../scripts/pack-worker-contract.ts";
import {
  workerContractHeader,
  workerContractRelease,
  workerContractCredentialOutcome,
  workerContractRunCredentialAbsent,
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
  sessionTurnAnswerSchema,
  sessionTurnClaimedSchema,
} from "../../src/contract/sessionPlane.ts";
import { resultManifestDocumentSchema } from "../../src/contract/workerDocuments.ts";
import {
  workerPoolReconciliationSchema,
  workerRunnerCredentialsHeader,
} from "../../src/contract/workerPool.ts";
import { workTaskDocumentSchema } from "../../src/contract/workerTask.ts";
import {
  contractVersionAccepted,
  workerContractAccepted,
  workerContractEvaluatedTrees,
  workerContractRunContexts,
  workerContractRunCredentials,
  workerContractRunnerCredentialPauses,
  workerContractRunUsages,
  workerContractSessionContexts,
  workerContractTargetRefs,
  workerContractThreadOffer,
} from "../../src/interpreter/workerPlane.ts";
import {
  workerContractAlias,
  workerContractAliases,
  workerContractAsset,
  workerContractBaselines,
  workerContractHistory,
  workerContractInstalled,
  workerContractPlanes,
  workerContractReleaseExport,
  workerContractReleaseSchema,
  workerContractPackageRefusal,
  workerContractReplayed,
  workerContractWireOf,
  type WorkerContractPlane,
} from "./workerContractReleases.ts";

/** Every release replayed on some plane. */
const replayed = [
  ...new Set(
    Object.keys(workerContractPlanes).flatMap((plane) =>
      workerContractReplayed(plane as WorkerContractPlane),
    ),
  ),
];

test("every release replayed on some plane is installed from its asset, and no other is", () => {
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

test("each installed release the history records holds the files its entry names", () => {
  const recorded = workerContractHistory().filter(({ release }) =>
    replayed.includes(release),
  );
  assert.notEqual(recorded.length, 0);
  for (const { release, files } of recorded)
    assert.equal(
      workerContractFilesDigest(workerContractInstalled(release)),
      files,
      `${workerContractInstalled(release)} is not the asset ${release} was published as`,
    );
});

test("a plane replays the release at each feature's first version, the last below it and the last recorded, and a field package, each where its range accepts the release its contract names", () => {
  const history = ["1.0.0", "1.1.0", "1.1.1", "1.2.0", "1.3.0", "1.4.0"].map(
    (release) => ({ release }),
  );
  const range = (minor: number) => ({
    min: { major: 1, minor },
    max: { major: 1, minor: 4 },
  });
  const first = [{ major: 1, minor: 2 }];
  const named = (label: string, wire = label) => ({ label, wire });
  assert.deepEqual(workerContractBaselines(history, first, range(0), []), [
    "1.1.1",
    "1.2.0",
    "1.4.0",
  ]);
  assert.deepEqual(workerContractBaselines(history, first, range(2), []), [
    "1.2.0",
    "1.4.0",
  ]);
  assert.deepEqual(
    workerContractBaselines(history, first, range(2), [
      named("1.0.0"),
      named("1.3.0"),
    ]),
    ["1.2.0", "1.3.0", "1.4.0"],
  );
  assert.deepEqual(
    workerContractBaselines(history, [{ major: 1, minor: 0 }], range(0), []),
    ["1.0.0", "1.4.0"],
  );
});

test("a package labelled past the history is replayed by the release its contract names, never by its label", () => {
  const history = [{ release: "1.3.0" }, { release: "1.4.0" }];
  const range = {
    min: { major: 1, minor: 4 },
    max: { major: 1, minor: 4 },
  };
  assert.deepEqual(
    workerContractBaselines(history, [], range, [
      { label: "7.8.9", wire: "1.4.0" },
      { label: "1.4.1", wire: "1.3.0" },
    ]),
    ["1.4.0", "7.8.9"],
  );
  const refusal = (label: string, wire: string) =>
    workerContractPackageRefusal(history, range, { label, wire });
  assert.equal(refusal("1.4.0", "1.4.0"), undefined);
  assert.equal(refusal("7.8.9", "1.4.0"), undefined);
  assert.match(refusal("1.3.0", "1.4.0") ?? "", /its contract names 1\.4\.0/u);
  assert.match(refusal("7.8.9", "7.8.9") ?? "", /the plane refuses/u);
  assert.match(refusal("7.8.9", "1.3.0") ?? "", /the plane refuses/u);
});

test("the release the worker image's core locks is replayed", () => {
  const { contractRelease } = z
    .object({ contractRelease: z.string() })
    .parse(
      JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL("../../images/worker/core.json", import.meta.url),
          ),
          "utf8",
        ),
      ),
    );
  assert.ok(replayed.includes(contractRelease), contractRelease);
});

test("each installed release names, in the header this server reads, its own label where the history records it and a release its plane accepts where it does not", async () => {
  const history = workerContractHistory();
  for (const [plane, range] of Object.entries(workerContractPlanes))
    for (const label of workerContractReplayed(plane as WorkerContractPlane)) {
      assert.equal(
        await workerContractReleaseExport(
          label,
          "workerContract",
          "workerContractHeader",
          z.string(),
        ),
        workerContractHeader,
      );
      assert.equal(
        workerContractPackageRefusal(history, range, {
          label,
          wire: workerContractWireOf(label),
        }),
        undefined,
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
      contractVersionAccepted(from, workerContractWireOf(release)),
      release,
    );
});

test("a run ends `RunCredentialAbsent`, naming the credential and why, from the version a runner holds a plane's release to, and no release below it names that label or takes that field", async () => {
  const from = {
    min: workerContractRunCredentialAbsent,
    max: workerContractAccepted.max,
  };
  const carried = (schema: z.ZodType) =>
    schema instanceof z.ZodObject && Object.hasOwn(schema.shape, "absent");
  assert.ok(runEndedEvidences.includes("RunCredentialAbsent"));
  assert.ok(carried(workerRunEndedSchema));
  assert.ok(contractVersionAccepted(from, workerContractRelease));
  for (const release of workerContractReplayed("job")) {
    const accepted = contractVersionAccepted(
      from,
      workerContractWireOf(release),
    );
    assert.equal(
      (
        await workerContractReleaseExport(
          release,
          "workerPlane",
          "runEndedEvidences",
          z.array(z.string()).optional(),
        )
      )?.includes("RunCredentialAbsent") ?? false,
      accepted,
      release,
    );
    assert.equal(
      carried(
        await workerContractReleaseExport(
          release,
          "workerPlane",
          "workerRunEndedSchema",
          workerContractReleaseSchema,
        ),
      ),
      accepted,
      release,
    );
  }
});

test("a run ends `RunCreditsExhausted` from the version a harness holds a plane's release to, and no release below it names that label", async () => {
  const from = {
    min: workerContractCredentialOutcome,
    max: workerContractAccepted.max,
  };
  assert.ok(runEndedEvidences.includes("RunCreditsExhausted"));
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
      )?.includes("RunCreditsExhausted") ?? false,
      contractVersionAccepted(from, workerContractWireOf(release)),
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
        contractVersionAccepted(
          workerContractRunUsages,
          workerContractWireOf(release),
        ),
        `${release} ${name}`,
      );
});

/** Whether the limit a release's run end takes may name the credential it stopped, read through the end because early releases export no limit schema of its own. */
function workerRunLimitNamesCredential(schema: z.ZodType): boolean {
  if (!(schema instanceof z.ZodObject)) return false;
  const limit: unknown = schema.shape["limit"];
  const held =
    limit instanceof z.ZodOptional || limit instanceof z.ZodExactOptional
      ? limit.unwrap()
      : limit;
  return held instanceof z.ZodObject && Object.hasOwn(held.shape, "credential");
}

test("a run names the credential of its usage and its limit from the version a runner holds a plane's release to, and no release below it takes either", async () => {
  assert.ok(Object.hasOwn(workerRunTotalsSchema.shape, "credential"));
  assert.ok(workerRunLimitNamesCredential(workerRunEndedSchema));
  assert.ok(!Object.hasOwn(workerRunEndedSchema.shape, "credential"));
  assert.ok(
    contractVersionAccepted(
      workerContractRunCredentials,
      workerContractRelease,
    ),
  );
  for (const release of workerContractReplayed("job")) {
    const taken = contractVersionAccepted(
      workerContractRunCredentials,
      workerContractWireOf(release),
    );
    const totalsSchema = await workerContractReleaseExport(
      release,
      "workerPlane",
      "workerRunTotalsSchema",
      workerContractReleaseSchema,
    );
    assert.equal(
      totalsSchema instanceof z.ZodObject &&
        Object.hasOwn(totalsSchema.shape, "credential"),
      taken,
      `${release} totals`,
    );
    assert.equal(
      workerRunLimitNamesCredential(
        await workerContractReleaseExport(
          release,
          "workerPlane",
          "workerRunEndedSchema",
          workerContractReleaseSchema,
        ),
      ),
      taken,
      `${release} limit`,
    );
  }
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

test("a runner or a pool names its credentials and is answered their pauses from the version whose plane reads them, and no release below it names the header or reads the key", async () => {
  const pausesRead = (schema: z.ZodType) =>
    schema instanceof z.ZodObject &&
    Object.hasOwn(schema.shape, "credentialPauses");
  assert.ok(pausesRead(workerPoolReconciliationSchema));
  assert.ok(
    contractVersionAccepted(
      workerContractRunnerCredentialPauses,
      workerContractRelease,
    ),
  );
  for (const release of workerContractReplayed("pool")) {
    const taken = contractVersionAccepted(
      workerContractRunnerCredentialPauses,
      workerContractWireOf(release),
    );
    assert.equal(
      pausesRead(
        await workerContractReleaseExport(
          release,
          "workerPool",
          "workerPoolReconciliationSchema",
          workerContractReleaseSchema,
        ),
      ),
      taken,
      release,
    );
    assert.equal(
      await workerContractReleaseExport(
        release,
        "workerPool",
        "workerRunnerCredentialsHeader",
        z.string().optional(),
      ),
      taken ? workerRunnerCredentialsHeader : undefined,
      release,
    );
  }
});

test("a run offers its context readings and a turn its subagent call from the version a runner holds a plane's release to, and no release below it takes either", async () => {
  assert.ok(Object.hasOwn(workerPlaneRoutes, "runContext"));
  assert.ok(workerRunTurnNamesParent(workerRunTurnsSchema));
  assert.ok(
    contractVersionAccepted(workerContractRunContexts, workerContractRelease),
  );
  for (const release of workerContractReplayed("job")) {
    const taken = contractVersionAccepted(
      workerContractRunContexts,
      workerContractWireOf(release),
    );
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
      contractVersionAccepted(
        workerContractTargetRefs,
        workerContractWireOf(release),
      ),
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
      contractVersionAccepted(
        workerContractEvaluatedTrees,
        workerContractWireOf(release),
      ),
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
        contractVersionAccepted(
          workerContractThreadOffer,
          workerContractWireOf(release),
        ),
        `${release} ${name}`,
      );
});

test("a turn's answer carries its session's context readings from the version a pod holds the plane to, and no release below it takes the field", async () => {
  const carried = (schema: z.ZodType) =>
    schema instanceof z.ZodObject && Object.hasOwn(schema.shape, "readings");
  assert.ok(carried(sessionTurnAnswerSchema));
  assert.ok(
    contractVersionAccepted(
      workerContractSessionContexts,
      workerContractRelease,
    ),
  );
  for (const release of workerContractReplayed("session"))
    assert.equal(
      carried(
        await workerContractReleaseExport(
          release,
          "sessionPlane",
          "sessionTurnAnswerSchema",
          workerContractReleaseSchema,
        ),
      ),
      contractVersionAccepted(
        workerContractSessionContexts,
        workerContractWireOf(release),
      ),
      release,
    );
});
