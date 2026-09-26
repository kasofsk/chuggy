import assert from "node:assert/strict";
import test from "node:test";

import {
  contractVersionRefusalSchema,
  workerContractRelease,
  workerContractVersionOf,
  workerContractVersionText,
} from "../../src/contract/workerContract.ts";
import {
  contractVersionAccepted,
  contractVersionRefusal,
  workerContractAccepted,
} from "../../src/interpreter/workerPlane.ts";

const served = workerContractAccepted.max;

test("the latest version served is the one the plane was built with", () => {
  assert.deepEqual(served, workerContractVersionOf(workerContractRelease));
});

test("a request naming no release speaks the first version, which is served", () => {
  assert.ok(contractVersionAccepted(undefined));
  assert.ok(contractVersionAccepted("1.0.0"));
});

test("a release is accepted whatever its patch, which moves only the packaging", () => {
  for (const offered of [
    workerContractRelease,
    `${String(served.major)}.${String(served.minor)}.7`,
  ])
    assert.ok(contractVersionAccepted(offered), offered);
});

test("a later minor, a later major and a release before the first are refused", () => {
  for (const offered of [
    `${String(served.major)}.${String(served.minor + 1)}.0`,
    `${String(served.major + 1)}.0.0`,
    `${String(served.major + 1)}.${String(served.minor)}.0`,
    "0.9.0",
  ])
    assert.ok(!contractVersionAccepted(offered), offered);
});

test("text that is no release is refused rather than read as the nearest one", () => {
  for (const offered of [
    "",
    "1",
    "1.0",
    "v1.0.0",
    "01.0.0",
    "1.00.0",
    "1.0.0-rc.1",
    " 1.0.0",
    "1.0.0, 1.0.0",
    "1.0.x",
    `${"9".repeat(10)}.0.0`,
  ])
    assert.ok(!contractVersionAccepted(offered), JSON.stringify(offered));
});

test("the refusal is the contract's own and names the range served", () => {
  assert.deepEqual(
    contractVersionRefusalSchema.parse(contractVersionRefusal),
    contractVersionRefusal,
  );
  assert.deepEqual(contractVersionRefusal.accepted, {
    min: "1.0",
    max: workerContractVersionText(served),
  });
});
