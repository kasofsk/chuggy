import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import * as contract from "../../src/contract/workerContract.ts";
import {
  contractVersionRefusalSchema,
  workerContractFeatures,
  workerContractFeaturesHeader,
  workerContractFeaturesOf,
  workerContractFeaturesText,
  workerContractImplements,
  workerContractRelease,
  workerContractVersionOf,
  workerContractVersionText,
  type WorkerContractFeature,
} from "../../src/contract/workerContract.ts";
import {
  sessionPlaneRouteFeatures,
  sessionPlaneRoutes,
} from "../../src/contract/sessionPlane.ts";
import {
  workerPlaneRouteFeatures,
  workerPlaneRoutes,
} from "../../src/contract/workerPlane.ts";
import {
  workerPoolPollRoute,
  workerPoolRouteFeatures,
  workerPoolSettlementRoutes,
  workerRunnerReportRoute,
} from "../../src/contract/workerPool.ts";
import * as plane from "../../src/interpreter/workerPlane.ts";

const versionSchema = z.strictObject({ major: z.number(), minor: z.number() });

/** Every version constant the contract exports that a gate was held to, by the feature named after it. */
const versioned = Object.entries(contract).flatMap(([name, value]) =>
  name.startsWith("workerContract") &&
  name !== "workerContractUnnamed" &&
  versionSchema.safeParse(value).success
    ? [[name.slice("workerContract".length), value] as const]
    : [],
);

/** The features a range of the planes first gated: each range that floors itself rather than at a version constant, by the feature named after it. */
const ranged = Object.entries(plane).flatMap(([name, value]) => {
  if (name === "workerContractAccepted") return [];
  if (!z.object({ min: versionSchema }).safeParse(value).success) return [];
  const { min } = value as { readonly min: unknown };
  return versioned.some(([, version]) => version === min)
    ? []
    : [[name.slice("workerContract".length), min] as const];
});

test("a release speaks its major and minor, and its patch says nothing of the wire", () => {
  assert.deepEqual(workerContractVersionOf("12.34.5"), {
    major: 12,
    minor: 34,
  });
  assert.deepEqual(
    workerContractVersionOf("12.34.0"),
    workerContractVersionOf("12.34.5"),
  );
  assert.equal(workerContractVersionText({ major: 12, minor: 34 }), "12.34");
});

test("the contract's own release is one", () => {
  assert.notEqual(workerContractVersionOf(workerContractRelease), undefined);
});

test("the contract's release is the one it was frozen at", () => {
  assert.equal(
    workerContractRelease,
    "1.106.0",
    "the wire's version is frozen: a contract change no longer moves it, and the package's label is the publisher's",
  );
});

test("a refusal names the range as versions, never as releases", () => {
  const refusal = {
    action: "stop",
    reason: "UnsupportedContractVersion",
    accepted: { min: "1.0", max: "1.2" },
  };
  assert.deepEqual(contractVersionRefusalSchema.parse(refusal), refusal);
  for (const max of ["1.2.0", "01.2", "1", ""])
    assert.ok(
      !contractVersionRefusalSchema.safeParse({
        ...refusal,
        accepted: { min: "1.0", max },
      }).success,
      max,
    );
});

test("each version constant is the version of the feature named after it", () => {
  assert.notEqual(versioned.length, 0);
  const features: Readonly<Record<string, unknown>> = workerContractFeatures;
  for (const [name, version] of versioned)
    assert.deepEqual(features[name], version, name);
});

test("each range that floors itself has its floor as the version of the feature named after it", () => {
  assert.notEqual(ranged.length, 0);
  const features: Readonly<Record<string, unknown>> = workerContractFeatures;
  for (const [name, floor] of ranged)
    assert.deepEqual(features[name], floor, name);
});

test("every feature is named after a version constant or a range, and none after both", () => {
  assert.deepEqual(
    Object.keys(workerContractFeatures).sort(),
    [...versioned, ...ranged].map(([name]) => name).sort(),
  );
});

test("a features header reads back as the names it was written with, and one this tree does not know is kept", () => {
  const names = ["RunUsage", "ThreadOffer"] as const;
  assert.equal(workerContractFeaturesHeader, "chuggy-worker-features");
  assert.equal(workerContractFeaturesText(names), "RunUsage, ThreadOffer");
  assert.deepEqual(
    workerContractFeaturesOf(workerContractFeaturesText(names)),
    names,
  );
  assert.deepEqual(workerContractFeaturesOf("RunUsage, NotAFeatureYet"), [
    "RunUsage",
    "NotAFeatureYet",
  ]);
});

test("a features header is read past its spacing and its empty names", () => {
  assert.deepEqual(workerContractFeaturesOf(" RunUsage ,,ThreadOffer\t, "), [
    "RunUsage",
    "ThreadOffer",
  ]);
});

test("a features header not sent, or naming nothing, is no list", () => {
  for (const text of [undefined, "", "  ", " , ,"])
    assert.equal(workerContractFeaturesOf(text), undefined, String(text));
});

test("a peer that lists its features implements exactly those, whatever release it names", () => {
  for (const release of [undefined, "1.0.0", "9.0.0", "not a release"]) {
    const peer = { release, features: ["ThreadOffer", "NotAFeatureYet"] };
    assert.ok(workerContractImplements("ThreadOffer", peer));
    assert.ok(!workerContractImplements("RunnerSessions", peer));
  }
});

test("a peer that lists no features implements each from the version it first shipped in", () => {
  const { major, minor } = workerContractFeatures.RunUsage;
  const naming = (release: string | undefined) =>
    workerContractImplements("RunUsage", { release, features: undefined });
  assert.ok(!naming(`${String(major)}.${String(minor - 1)}.9`));
  assert.ok(naming(`${String(major)}.${String(minor)}.0`));
  assert.ok(naming(`${String(major)}.${String(minor + 1)}.0`));
  assert.ok(naming(`${String(major + 1)}.0.0`));
  assert.ok(!naming(`${String(major - 1)}.${String(minor + 1)}.0`));
});

test("a peer that names no release and lists no features speaks the first version, and one whose release cannot be read implements nothing", () => {
  for (const feature of Object.keys(
    workerContractFeatures,
  ) as WorkerContractFeature[]) {
    assert.ok(
      !workerContractImplements(feature, {
        release: undefined,
        features: undefined,
      }),
      feature,
    );
    assert.ok(
      !workerContractImplements(feature, {
        release: "latest",
        features: undefined,
      }),
      feature,
    );
  }
});

test("each plane's routes are each named with a feature in the roster or with none, and every route of its table is named", () => {
  const planes = [
    [workerPlaneRouteFeatures, Object.keys(workerPlaneRoutes)],
    [sessionPlaneRouteFeatures, Object.keys(sessionPlaneRoutes)],
    [
      workerPoolRouteFeatures,
      [
        workerPoolPollRoute,
        workerRunnerReportRoute,
        ...Object.values(workerPoolSettlementRoutes),
      ],
    ],
  ] as const;
  for (const [features, routes] of planes) {
    assert.deepEqual(Object.keys(features).sort(), [...routes].sort());
    for (const feature of Object.values(features))
      assert.ok(
        feature === null || Object.hasOwn(workerContractFeatures, feature),
      );
  }
});
