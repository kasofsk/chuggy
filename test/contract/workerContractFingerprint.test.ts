import assert from "node:assert/strict";
import test from "node:test";

import {
  workerContractFilesRefusal,
  workerContractHistory,
  workerContractHistoryRefusal,
  workerContractWire,
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

test("a pack whose files the history does not record as the release's is refused, naming both and the pack's to record", () => {
  const earlier = "c".repeat(64);
  const files = "d".repeat(64);
  const history = [
    { release: "1.0.0", files: earlier },
    { release: "1.0.1", files },
  ];
  assert.equal(workerContractFilesRefusal(history, "1.0.1", files), undefined);
  assert.equal(
    workerContractFilesRefusal(history, "1.0.0", files),
    `the history records ${earlier} as 1.0.0's files, and the pack's are ${files}: record the pack's`,
  );
  assert.match(
    workerContractFilesRefusal(history, "1.1.0", files) ?? "",
    /records undefined as 1\.1\.0's files/u,
  );
});
