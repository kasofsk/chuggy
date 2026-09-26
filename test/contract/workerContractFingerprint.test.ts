import assert from "node:assert/strict";
import test from "node:test";

import {
  workerContractHistory,
  workerContractHistoryRefusal,
  workerContractWire,
  workerContractWireSourceText,
} from "../../scripts/worker-contract-wire.ts";
import { workerContractRelease } from "../../src/contract/workerContract.ts";

const wire = "a".repeat(64);
const moved = "b".repeat(64);

test("the history names the contract's release as the wire this tree holds", async () => {
  assert.equal(
    workerContractHistoryRefusal(
      workerContractHistory(),
      workerContractRelease,
      await workerContractWire(),
    ),
    undefined,
  );
});

test("a wire that moved under the same release is refused", () => {
  assert.match(
    workerContractHistoryRefusal(
      [{ release: "1.0.0", wire }],
      "1.0.0",
      moved,
    ) ?? "",
    /move the release/u,
  );
});

test("a release the history has no entry for is refused", () => {
  assert.match(
    workerContractHistoryRefusal([{ release: "1.0.0", wire }], "1.1.0", wire) ??
      "",
    /add its entry/u,
  );
});

test("a history whose releases do not rise is refused", () => {
  for (const later of ["1.0.0", "0.9.9"])
    assert.match(
      workerContractHistoryRefusal(
        [
          { release: "1.0.0", wire },
          { release: later, wire: moved },
        ],
        later,
        moved,
      ) ?? "",
      /does not follow/u,
    );
});

test("a wire moved in a patch is refused, and a minor or a major may move it", () => {
  const moving = (release: string) =>
    workerContractHistoryRefusal(
      [
        { release: "1.0.0", wire },
        { release, wire: moved },
      ],
      release,
      moved,
    );
  assert.match(moving("1.0.1") ?? "", /moved the wire in a patch/u);
  assert.equal(moving("1.1.0"), undefined);
  assert.equal(moving("2.0.0"), undefined);
});

test("a patch that leaves the wire alone is a release like any other", () => {
  assert.equal(
    workerContractHistoryRefusal(
      [
        { release: "1.0.0", wire },
        { release: "1.0.1", wire },
      ],
      "1.0.1",
      wire,
    ),
    undefined,
  );
});

test("a comment, a re-wrap or a trailing comma moves no source, and a literal, an operator or a name does", () => {
  const read = (source: string) =>
    workerContractWireSourceText(source, new Set());
  const written = read(
    "(value) => { const bounded = isBoundedText(value, sessionIdentityCharsMax); return bounded && value.length > 1; }",
  );
  for (const formatted of [
    "(value) => {\n  /** why */\n  const bounded = isBoundedText(value, sessionIdentityCharsMax); return bounded && value.length > 1; }",
    "(value) => { const bounded = /* why */ isBoundedText(value, sessionIdentityCharsMax); // and\n return bounded && value.length > 1; }",
    "(value) => {\n  const bounded = isBoundedText(\n    value,\n    sessionIdentityCharsMax,\n  );\n  return bounded && value.length > 1;\n}",
  ])
    assert.equal(read(formatted), written);
  for (const changed of [
    "(value) => { const bounded = isBoundedText(value, sessionIdentityCharsMax); return bounded && value.length > 2; }",
    "(value) => { const bounded = isBoundedText(value, sessionIdentityCharsMax); return bounded && value.length >= 1; }",
    "(value) => { const bounded = isBoundedText(value, repositoryIdentityCharsMax); return bounded && value.length > 1; }",
  ])
    assert.notEqual(read(changed), written);
});

test("the names a source reads are the ones the digest follows into the contract", () => {
  const reads = new Set<string>();
  workerContractWireSourceText(
    "(value) => isBoundedText(value, sessionIdentityCharsMax)",
    reads,
  );
  assert.deepEqual([...reads].sort(), [
    "isBoundedText",
    "sessionIdentityCharsMax",
    "value",
  ]);
});
