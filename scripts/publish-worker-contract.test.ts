import assert from "node:assert/strict";
import test from "node:test";

import {
  publishWorkerContract,
  publishWorkerContractReleased,
  type WorkerContractPublishPorts,
} from "./publish-worker-contract.ts";

const wire = "a".repeat(64);
const name = "@chuggy/worker-contract";
const release = "1.2.0";

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
      history: () => [
        { release: "1.0.0", wire: "b".repeat(64) },
        { release, wire },
      ],
      wire: () => Promise.resolve(wire),
      pack: (outDirectory) => {
        made.push(`pack ${outDirectory}`);
        return { tarball: `${outDirectory}/contract.tgz`, sha256: "c" };
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

test("a release the history names is packed, released at its commit, and tagged", async () => {
  const { made, ports } = faked();
  const published = await publishWorkerContract(
    ports,
    name,
    release,
    "/out",
    false,
  );
  assert.equal(published.published, "Released");
  assert.deepEqual(made, [
    "pack /out",
    "release worker-contract-v1.2.0 packed-commit /out/contract.tgz @chuggy/worker-contract 1.2.0 Packed at packed-commit (sha256 c).",
    "tag worker-contract-v1.2.0 packed-commit",
  ]);
});

test("a dry run packs and neither releases nor tags", async () => {
  const { made, ports } = faked();
  const published = await publishWorkerContract(
    ports,
    name,
    release,
    "/out",
    true,
  );
  assert.equal(published.published, "Packed");
  assert.deepEqual(made, ["pack /out"]);
});

test("a release GitHub refuses tags nothing", async () => {
  const { made, ports } = faked({
    release: () => {
      throw new Error("gh release create exited 1");
    },
  });
  await assert.rejects(
    publishWorkerContract(ports, name, release, "/out", false),
    /gh release create/u,
  );
  assert.deepEqual(made, ["pack /out"]);
});

for (const [why, over, refusal] of [
  [
    "a working tree with changes",
    { clean: () => false },
    /working tree has changes/u,
  ],
  [
    "a release the history has no entry for",
    { history: () => [{ release: "1.1.0", wire }] },
    /add its entry/u,
  ],
  [
    "a wire the history's last entry does not name",
    { wire: () => Promise.resolve("d".repeat(64)) },
    /move the release/u,
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
    test(`${why} is refused before anything is packed${dryRun ? ", in a dry run too" : ""}`, async () => {
      const { made, ports } = faked(over);
      const published = await publishWorkerContract(
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

test("a GitHub that cannot say whether the release exists stops the release", async () => {
  const { made, ports } = faked({
    released: () => {
      throw new Error("gh could not say");
    },
  });
  await assert.rejects(
    publishWorkerContract(ports, name, release, "/out", false),
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
