import assert from "node:assert/strict";
import test from "node:test";

import {
  contractVersionRefusalSchema,
  workerContractRelease,
  workerContractVersionOf,
  workerContractVersionText,
} from "../../src/contract/workerContract.ts";

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
