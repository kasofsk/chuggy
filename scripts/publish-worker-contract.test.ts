import assert from "node:assert/strict";
import test from "node:test";

import {
  publishWorkerContract,
  publishWorkerContractRegistered,
  type WorkerContractPublishPorts,
} from "./publish-worker-contract.ts";

const wire = "a".repeat(64);
const name = "@chuggy/worker-contract";
const release = "1.2.0";

/** A git and a registry that hold nothing yet, recording every change asked of them; `over` makes one of them refuse. */
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
      published: () => false,
      history: () => [
        { release: "1.0.0", wire: "b".repeat(64) },
        { release, wire },
      ],
      wire: () => Promise.resolve(wire),
      pack: (outDirectory) => {
        made.push(`pack ${outDirectory}`);
        return { tarball: `${outDirectory}/contract.tgz`, sha256: "c" };
      },
      publish: (tarball) => {
        made.push(`publish ${tarball}`);
      },
      tag: (tag, commit) => {
        made.push(`tag ${tag} ${commit}`);
      },
      ...over,
    },
  };
}

test("a release the history names is packed, published, and its commit tagged", async () => {
  const { made, ports } = faked();
  const published = await publishWorkerContract(
    ports,
    name,
    release,
    "/out",
    false,
  );
  assert.equal(published.published, "Published");
  assert.deepEqual(made, [
    "pack /out",
    "publish /out/contract.tgz",
    "tag worker-contract-v1.2.0 packed-commit",
  ]);
});

test("a dry run packs and neither publishes nor tags", async () => {
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

test("a publish npm refuses tags nothing", async () => {
  const { made, ports } = faked({
    publish: () => {
      throw new Error("npm publish exited 1");
    },
  });
  await assert.rejects(
    publishWorkerContract(ports, name, release, "/out", false),
    /npm publish/u,
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
    "a release already on the registry",
    {
      published: (named: string, version: string) =>
        named === name && version === release,
    },
    /@chuggy\/worker-contract@1\.2\.0 is already on the registry/u,
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

test("a registry that cannot say whether the release exists stops the publish", async () => {
  const { made, ports } = faked({
    published: () => {
      throw new Error("npm could not say");
    },
  });
  await assert.rejects(
    publishWorkerContract(ports, name, release, "/out", false),
    /could not say/u,
  );
  assert.deepEqual(made, []);
});

test("the registry's answer is read as held, as never seen, or as no answer", () => {
  const viewed = (status: number, stdout: string, stderr = "") =>
    publishWorkerContractRegistered({ status, stdout, stderr });
  assert.equal(viewed(0, '"1.2.0"\n'), true);
  assert.equal(viewed(0, ""), false);
  assert.equal(
    viewed(1, '{"error":{"code":"E404","summary":"Not Found"}}'),
    false,
  );
  assert.equal(viewed(1, "", "npm error code E404\n"), false);
  assert.throws(() => viewed(1, "", "npm error code ETIMEDOUT\n"));
});
