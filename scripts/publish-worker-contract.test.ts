import assert from "node:assert/strict";
import test from "node:test";

import {
  publishWorkerContract,
  publishWorkerContractReleased,
  type WorkerContractPublishPorts,
} from "./publish-worker-contract.ts";

const name = "@chuggy/worker-contract";
const release = "1.2.0";
const files = "e".repeat(64);

/** A git and a GitHub that hold nothing yet, recording every change asked of them; `over` makes one of them refuse. */
function faked(over: Partial<WorkerContractPublishPorts> = {}): {
  readonly made: string[];
  readonly ports: WorkerContractPublishPorts;
} {
  const made: string[] = [];
  return {
    made,
    ports: {
      clean: () => true,
      commit: () => "packed-commit",
      tagged: () => false,
      released: () => false,
      pack: (outDirectory, label) => {
        made.push(`pack ${outDirectory} as ${label}`);
        return { tarball: `${outDirectory}/contract.tgz`, sha256: "c", files };
      },
      release: (tag, commit, tarball, title, notes) => {
        made.push(`release ${tag} ${commit} ${tarball} ${title} ${notes}`);
      },
      tag: (tag, commit) => {
        made.push(`tag ${tag} ${commit}`);
      },
      ...over,
    },
  };
}

test("a label is packed under, released at its commit, and tagged", () => {
  const { made, ports } = faked();
  const published = publishWorkerContract(ports, name, release, "/out", false);
  assert.equal(published.published, "Released");
  assert.deepEqual(made, [
    "pack /out as 1.2.0",
    "release worker-contract-v1.2.0 packed-commit /out/contract.tgz @chuggy/worker-contract 1.2.0 Packed at packed-commit (sha256 c).",
    "tag worker-contract-v1.2.0 packed-commit",
  ]);
});

test("a dry run packs and neither releases nor tags", () => {
  const { made, ports } = faked();
  const published = publishWorkerContract(ports, name, release, "/out", true);
  assert.equal(published.published, "Packed");
  assert.deepEqual(made, ["pack /out as 1.2.0"]);
});

test("a release GitHub refuses tags nothing", () => {
  const { made, ports } = faked({
    release: () => {
      throw new Error("gh release create exited 1");
    },
  });
  assert.throws(
    () => publishWorkerContract(ports, name, release, "/out", false),
    /gh release create/u,
  );
  assert.deepEqual(made, ["pack /out as 1.2.0"]);
});

for (const [why, over, refusal] of [
  [
    "a working tree with changes",
    { clean: () => false },
    /working tree has changes/u,
  ],
  [
    "a release already tagged",
    { tagged: (tag: string) => tag === "worker-contract-v1.2.0" },
    /worker-contract-v1\.2\.0 is already a tag/u,
  ],
  [
    "a release already made",
    { released: (tag: string) => tag === "worker-contract-v1.2.0" },
    /worker-contract-v1\.2\.0 is already released/u,
  ],
] as const)
  for (const dryRun of [false, true])
    test(`${why} is refused before anything is packed${dryRun ? ", in a dry run too" : ""}`, () => {
      const { made, ports } = faked(over);
      const published = publishWorkerContract(
        ports,
        name,
        release,
        "/out",
        dryRun,
      );
      assert.equal(published.published, "Refused");
      assert.match(
        published.published === "Refused" ? published.why : "",
        refusal,
      );
      assert.deepEqual(made, []);
    });

test("a label that is not a major, a minor and a patch is refused before anything is packed", () => {
  for (const label of ["1.2", "v1.2.0", "1.2.0-rc.1", "latest", ""]) {
    const { made, ports } = faked();
    const published = publishWorkerContract(ports, name, label, "/out", false);
    assert.equal(published.published, "Refused", label);
    assert.deepEqual(made, []);
  }
});

test("a GitHub that cannot say whether the release exists stops the release", () => {
  const { made, ports } = faked({
    released: () => {
      throw new Error("gh could not say");
    },
  });
  assert.throws(
    () => publishWorkerContract(ports, name, release, "/out", false),
    /could not say/u,
  );
  assert.deepEqual(made, []);
});

test("GitHub's answer is read as released, as never seen, or as no answer", () => {
  const viewed = (status: number, stderr = "") =>
    publishWorkerContractReleased({ status, stdout: "", stderr });
  assert.equal(viewed(0), true);
  assert.equal(viewed(1, "release not found\n"), false);
  assert.throws(() => viewed(1, "HTTP 401: Bad credentials\n"));
  assert.throws(() => viewed(1, "error connecting to api.github.com\n"));
});
