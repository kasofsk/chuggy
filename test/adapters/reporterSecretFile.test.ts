/**
 * The read every reporter scheme takes its secret through, against real
 * files: what a regular file answers, and every other thing a path can name.
 *
 * A PIPE IS THE CASE THAT CANNOT BE LEFT TO FAIL BY ITSELF. Opening one nobody
 * writes to waits for a writer that never comes, so the case allows the read a
 * span, and then opens the pipe's other end so that a read which did wait
 * finishes and the process ends.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  reporterSecretBytes,
  reporterSecretBytesMax,
} from "../../src/adapters/reporters/secretFile.ts";

function directory(t: TestContext): string {
  const made = mkdtempSync(join(tmpdir(), "chuggy-secret-file-"));
  t.after(() => {
    rmSync(made, { recursive: true, force: true });
  });
  return made;
}

/** A file holding what a case writes, in a directory of the case's own. */
function fileHolding(t: TestContext, held: string | Uint8Array): string {
  const path = join(directory(t), "token");
  writeFileSync(path, held);
  return path;
}

/** How long a read is allowed before a case says it waited. */
const waitedAfterMs = 5_000;

/** What a read answers, or `"waited"` where it has not answered within the span. */
async function within<Answer>(
  read: Promise<Answer>,
): Promise<Answer | "waited"> {
  let timer: NodeJS.Timeout | undefined;
  const waited = new Promise<"waited">((resolve) => {
    timer = setTimeout(() => {
      resolve("waited");
    }, waitedAfterMs);
  });
  try {
    return await Promise.race([read, waited]);
  } finally {
    clearTimeout(timer);
  }
}

/** Opens and closes a pipe's writing end, which lets through a read waiting on the pipe and is refused where none is. */
function released(pipe: string): void {
  let writing: number;
  try {
    writing = openSync(pipe, constants.O_WRONLY | constants.O_NONBLOCK);
  } catch {
    return;
  }
  closeSync(writing);
}

test("a regular file is read as the bytes it holds, none trimmed and none decoded", async (t) => {
  const written = Buffer.from([
    0x20, 0x09, 0x73, 0x00, 0xff, 0xc3, 0xa0, 0x0d, 0x0a,
  ]);
  assert.deepEqual(await reporterSecretBytes(fileHolding(t, written)), written);
});

test("a file is read to the bound and is nothing past it", async (t) => {
  const atBound = Buffer.alloc(reporterSecretBytesMax, "s");
  assert.deepEqual(await reporterSecretBytes(fileHolding(t, atBound)), atBound);
  assert.equal(
    await reporterSecretBytes(
      fileHolding(t, Buffer.alloc(reporterSecretBytesMax + 1, "s")),
    ),
    undefined,
  );
});

test("a path that names no file is nothing", async (t) => {
  const root = directory(t);
  const file = fileHolding(t, "held");
  for (const path of [join(root, "absent"), join(file, "under"), ""])
    assert.equal(await reporterSecretBytes(path), undefined, path);
});

test("what is not a regular file is nothing, and is not waited for", async (t) => {
  const root = directory(t);
  const pipe = join(root, "pipe");
  execFileSync("mkfifo", [pipe]);
  const socket = join(root, "socket");
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(socket, resolve);
  });
  t.after(() => {
    server.close();
  });

  try {
    assert.equal(
      await within(reporterSecretBytes(pipe)),
      undefined,
      "a pipe nobody writes to",
    );
  } finally {
    released(pipe);
  }
  for (const [path, why] of [
    [socket, "a socket"],
    [root, "a directory"],
    ["/dev/null", "a device holding nothing"],
    ["/dev/zero", "a device holding no end of bytes"],
  ] as const)
    assert.equal(await reporterSecretBytes(path), undefined, why);
  assert.deepEqual(
    await reporterSecretBytes(fileHolding(t, "")),
    Buffer.alloc(0),
    "an empty file is no bytes, where a device holding nothing is nothing",
  );
});

test("a link is followed to the file it names, so a mounted secret swapped by its link is read anew", async (t) => {
  const mount = directory(t);
  for (const version of ["first", "second"]) {
    mkdirSync(join(mount, `..${version}`));
    writeFileSync(join(mount, `..${version}`, "token"), version);
  }
  symlinkSync("..first", join(mount, "..data"));
  symlinkSync(join("..data", "token"), join(mount, "token"));
  const path = join(mount, "token");
  assert.deepEqual(await reporterSecretBytes(path), Buffer.from("first"));

  symlinkSync("..second", join(mount, "..data.next"));
  renameSync(join(mount, "..data.next"), join(mount, "..data"));
  assert.deepEqual(await reporterSecretBytes(path), Buffer.from("second"));

  rmSync(join(mount, "..second"), { recursive: true });
  assert.equal(await reporterSecretBytes(path), undefined, "a link to nothing");
});
