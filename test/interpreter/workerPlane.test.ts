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
import { workerPoolContractAccepted } from "../../src/interpreter/workerPool.ts";

const served = workerContractAccepted.max;
const accepted = (offered: string | undefined) =>
  contractVersionAccepted(workerContractAccepted, offered);
const poolAccepted = (offered: string | undefined) =>
  contractVersionAccepted(workerPoolContractAccepted, offered);

test("the latest version served is the one the plane was built with", () => {
  assert.deepEqual(served, workerContractVersionOf(workerContractRelease));
  assert.deepEqual(workerPoolContractAccepted.max, served);
});

test("a request naming no release speaks the first version, which is served", () => {
  assert.ok(accepted(undefined));
  assert.ok(accepted("1.0.0"));
});

test("a release is accepted whatever its patch, which moves only the packaging", () => {
  for (const offered of [
    workerContractRelease,
    `${String(served.major)}.${String(served.minor)}.7`,
  ]) {
    assert.ok(accepted(offered), offered);
    assert.ok(poolAccepted(offered), offered);
  }
});

test("a later minor, a later major and a release before the first are refused", () => {
  for (const offered of [
    `${String(served.major)}.${String(served.minor + 1)}.0`,
    `${String(served.major + 1)}.0.0`,
    `${String(served.major + 1)}.${String(served.minor)}.0`,
    "0.9.0",
  ]) {
    assert.ok(!accepted(offered), offered);
    assert.ok(!poolAccepted(offered), offered);
  }
});

test("the pool plane refuses a pool naming no release or the first, whose assignment names no image", () => {
  for (const offered of [undefined, "1.0.0", "1.0.9"])
    assert.ok(!poolAccepted(offered), String(offered));
  assert.ok(poolAccepted("1.1.0"));
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
    assert.ok(!accepted(offered), JSON.stringify(offered));
});

test("each plane's refusal is the contract's own and names the range that plane serves", () => {
  for (const [range, min] of [
    [workerContractAccepted, "1.0"],
    [workerPoolContractAccepted, "1.1"],
  ] as const) {
    const refusal = contractVersionRefusal(range);
    assert.deepEqual(contractVersionRefusalSchema.parse(refusal), refusal);
    assert.deepEqual(refusal.accepted, {
      min,
      max: workerContractVersionText(served),
    });
  }
});
