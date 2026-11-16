import assert from "node:assert/strict";
import test from "node:test";

import * as workerContract from "../../src/contract/workerContract.ts";
import * as workerPlane from "../../src/interpreter/workerPlane.ts";

/** The `WorkerContractVersion` constants `workerContract.ts` may export. */
const workerContractFrozenVersions: readonly string[] = [
  "workerContractCredentialBundles",
  "workerContractCredentialOutcome",
  "workerContractCredentialPauses",
  "workerContractEvaluatedTree",
  "workerContractMemoryRoom",
  "workerContractRunContext",
  "workerContractRunCredential",
  "workerContractRunCredentialAbsent",
  "workerContractRunDiskLow",
  "workerContractRunUsage",
  "workerContractRunnerAgentsAdvertised",
  "workerContractRunnerReport",
  "workerContractSessionCapabilitiesNamed",
  "workerContractSessionContext",
  "workerContractTargetRef",
  "workerContractUnnamed",
];

/** The `WorkerContractRange` constants `workerPlane.ts` may export. */
const workerContractFrozenRanges: readonly string[] = [
  "workerContractAccepted",
  "workerContractChatHost",
  "workerContractChatSessionThreads",
  "workerContractChatThreadsClosed",
  "workerContractCredentialBundlesServed",
  "workerContractEvaluatedTrees",
  "workerContractLiveStops",
  "workerContractProjectReads",
  "workerContractRunContexts",
  "workerContractRunCredentials",
  "workerContractRunUsages",
  "workerContractRunnerAgents",
  "workerContractRunnerCredentialOutcomes",
  "workerContractRunnerCredentialPauses",
  "workerContractRunnerJobsWaiting",
  "workerContractRunnerProjects",
  "workerContractRunnerReleases",
  "workerContractRunnerSessions",
  "workerContractSessionContexts",
  "workerContractTargetRefs",
  "workerContractThreadOffer",
  "workerContractTicketDispatch",
  "workerContractUnscopedChat",
];

const workerContractFrozenAdvice =
  "a new gate takes a feature name in `workerContractFeatures`, not a version constant or a range";

/** Whether `value` has the shape of a `WorkerContractVersion`. */
function workerContractFrozenIsVersion(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { major?: unknown }).major === "number" &&
    typeof (value as { minor?: unknown }).minor === "number"
  );
}

/** Whether `value` has the shape of a `WorkerContractRange`. */
function workerContractFrozenIsRange(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    workerContractFrozenIsVersion((value as { min?: unknown }).min) &&
    workerContractFrozenIsVersion((value as { max?: unknown }).max)
  );
}

/** The names `exports` gives a value `shaped` holds of that are not on `frozen`. */
function workerContractFrozenUnlisted(
  exports: Readonly<Record<string, unknown>>,
  shaped: (value: unknown) => boolean,
  frozen: readonly string[],
): string[] {
  return Object.entries(exports)
    .filter(([name, value]) => shaped(value) && !frozen.includes(name))
    .map(([name]) => name);
}

test("the shapes are told apart: a version, a range, and the feature roster that is neither", () => {
  const version = { major: 1, minor: 2 };
  assert.ok(workerContractFrozenIsVersion(version));
  assert.ok(!workerContractFrozenIsRange(version));
  assert.ok(workerContractFrozenIsRange({ min: version, max: version }));
  assert.ok(!workerContractFrozenIsVersion({ min: version, max: version }));
  assert.ok(
    !workerContractFrozenIsVersion(workerContract.workerContractFeatures),
  );
  assert.ok(
    !workerContractFrozenIsRange(workerContract.workerContractFeatures),
  );
  assert.ok(
    !workerContractFrozenIsVersion(workerContract.workerContractRelease),
  );
});

test("an unlisted version or range is found, and a listed one no longer exported is not asked for", () => {
  const version = { major: 1, minor: 2 };
  assert.deepEqual(
    workerContractFrozenUnlisted(
      { listed: version, added: version, other: "1.2.0" },
      workerContractFrozenIsVersion,
      ["listed", "retired"],
    ),
    ["added"],
  );
  assert.deepEqual(
    workerContractFrozenUnlisted(
      { added: { min: version, max: version } },
      workerContractFrozenIsRange,
      [],
    ),
    ["added"],
  );
});

test("the worker contract exports no version constant beyond those it had when versions stopped growing", () => {
  const unlisted = workerContractFrozenUnlisted(
    workerContract,
    workerContractFrozenIsVersion,
    workerContractFrozenVersions,
  );
  assert.deepEqual(
    unlisted,
    [],
    `${unlisted.join(", ")}: ${workerContractFrozenAdvice}`,
  );
});

test("the worker plane exports no version range beyond those it had when versions stopped growing", () => {
  const unlisted = workerContractFrozenUnlisted(
    workerPlane,
    workerContractFrozenIsRange,
    workerContractFrozenRanges,
  );
  assert.deepEqual(
    unlisted,
    [],
    `${unlisted.join(", ")}: ${workerContractFrozenAdvice}`,
  );
});
