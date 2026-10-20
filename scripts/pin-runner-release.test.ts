import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  pinRunnerRelease,
  runnerReleaseUrl,
  type PinRunnerReleasePorts,
} from "./pin-runner-release.ts";

const tarball = Buffer.from("a runner package's tarball");
const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
const darwin = {
  version: "0.2.0",
  url: runnerReleaseUrl("chuggy-darwin", "0.2.0"),
  integrity: `sha512-${"A".repeat(85)}g==`,
};

/** A GitHub answering `answer` to every fetch, and a pin file holding `kept`, recording each fetch and each write. */
function faked(
  answer: () => Promise<Response> = () =>
    Promise.resolve(new Response(tarball)),
  kept = "{}\n",
): {
  readonly fetched: string[];
  readonly written: string[];
  readonly ports: PinRunnerReleasePorts;
} {
  const fetched: string[] = [];
  const written: string[] = [];
  return {
    fetched,
    written,
    ports: {
      fetch: (url) => {
        fetched.push(url);
        return answer();
      },
      read: () => kept,
      write: (text) => {
        written.push(text);
      },
    },
  };
}

test("a release is fetched from its package's own release downloads and pinned beside the others in package order", async () => {
  const { fetched, written, ports } = faked(
    undefined,
    `${JSON.stringify({ "chuggy-darwin": darwin })}\n`,
  );
  const pinned = await pinRunnerRelease(ports, "chuggy-linux", "0.14.0");
  const url =
    "https://github.com/kasofsk/chuggy-linux/releases/download/v0.14.0/chuggy-linux-0.14.0.tgz";
  assert.deepEqual(pinned, {
    pinned: "Pinned",
    release: { package: "chuggy-linux", version: "0.14.0", url, integrity },
  });
  assert.deepEqual(fetched, [url]);
  assert.equal(written.length, 1);
  assert.equal(
    written[0],
    `${JSON.stringify(
      {
        "chuggy-darwin": darwin,
        "chuggy-linux": { version: "0.14.0", url, integrity },
      },
      null,
      2,
    )}\n`,
  );
});

test("pinning a package again replaces its pin and says which version it replaced", async () => {
  const { written, ports } = faked(
    undefined,
    JSON.stringify({ "chuggy-darwin": darwin }),
  );
  const pinned = await pinRunnerRelease(ports, "chuggy-darwin", "0.3.0");
  assert.equal(pinned.pinned === "Pinned" ? pinned.replaced : "", "0.2.0");
  assert.deepEqual(JSON.parse(written[0] ?? ""), {
    "chuggy-darwin": {
      version: "0.3.0",
      url: runnerReleaseUrl("chuggy-darwin", "0.3.0"),
      integrity,
    },
  });
});

test("a pin that cannot be made whole writes nothing and says why", async () => {
  for (const [why, named, version, answer, kept, refusal] of [
    [
      "a package outside the grammar",
      "Chuggy",
      "0.14.0",
      undefined,
      undefined,
      /not a runner package's name/u,
    ],
    [
      "a version outside the grammar",
      "chuggy-linux",
      "v0.14.0",
      undefined,
      undefined,
      /not a release's version/u,
    ],
    [
      "pins kept that do not parse",
      "chuggy-linux",
      "0.14.0",
      undefined,
      `{"chuggy-linux":{}}`,
      /the pins kept do not parse/u,
    ],
    [
      "a release that is not there",
      "chuggy-linux",
      "0.14.0",
      () => Promise.resolve(new Response("Not Found", { status: 404 })),
      undefined,
      /answered 404/u,
    ],
    [
      "a fetch that fails",
      "chuggy-linux",
      "0.14.0",
      () => Promise.reject(new Error("socket hang up")),
      undefined,
      /could not be fetched: socket hang up/u,
    ],
    [
      "a body past the bound",
      "chuggy-linux",
      "0.14.0",
      () => Promise.resolve(new Response(Buffer.alloc(9))),
      undefined,
      /could not be read whole: HTTP response exceeds its byte bound/u,
    ],
  ] as const) {
    const { written, ports } = faked(answer, kept);
    const pinned = await pinRunnerRelease(ports, named, version, 8);
    assert.equal(pinned.pinned, "Refused", why);
    assert.match(pinned.pinned === "Refused" ? pinned.why : "", refusal, why);
    assert.deepEqual(written, [], why);
  }
});

test("a body at the bound is read whole", async () => {
  const { ports } = faked(() => Promise.resolve(new Response(tarball)));
  assert.equal(
    (await pinRunnerRelease(ports, "chuggy-linux", "0.14.0", tarball.length))
      .pinned,
    "Pinned",
  );
});
