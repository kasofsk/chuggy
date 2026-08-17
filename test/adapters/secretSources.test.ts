/**
 * The two secret sources against exactly what they touch: the file tree a
 * deployment mounts pre-synced material into, and a faked Secret Manager
 * endpoint speaking the one access call the source makes. The GCP source is
 * tested to the depth it is built — it sends a ready bearer re-read from a
 * token file and performs no exchange of its own.
 */

import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";

import { secretFileSource } from "../../src/adapters/secretFileSource.ts";
import { secretGcpSource } from "../../src/adapters/secretGcpSource.ts";

/** A temp directory the case owns, removed with it. */
function sourceDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "chuggy-secrets-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("the file source answers a named file's material, trimmed like a mounted token", async (t) => {
  const dir = sourceDir(t);
  writeFileSync(join(dir, "author.key"), "the-material\n");
  const source = secretFileSource(dir);
  assert.equal(await source("author.key"), "the-material");
});

test("the file source refuses a reference that is not a plain file name, unread", async (t) => {
  const dir = sourceDir(t);
  writeFileSync(join(dir, "author.key"), "the-material\n");
  const source = secretFileSource(dir);
  for (const escape of ["../author.key", "a/b.key", ".hidden", ""]) {
    await assert.rejects(source(escape), /not a plain file name/);
  }
  await assert.rejects(source("absent.key"));
});

test("the file source refuses construction over a directory nobody mounted", (t) => {
  const dir = sourceDir(t);
  assert.throws(() => secretFileSource(join(dir, "absent")), /not a directory/);
});

/** What the faked Secret Manager saw and answers: every request's path and bearer, and a scripted reply. */
interface FakeSecretManager {
  readonly base: string;
  readonly asked: readonly {
    path: string;
    authorization?: string | undefined;
  }[];
  reply: { status: number; body: string };
}

/** A faked Secret Manager on an ephemeral local port, recording each access call. */
function fakeSecretManager(t: TestContext): Promise<FakeSecretManager> {
  const asked: { path: string; authorization?: string | undefined }[] = [];
  const held: FakeSecretManager = {
    base: "",
    asked,
    reply: { status: 200, body: "{}" },
  };
  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      asked.push({
        path: request.url ?? "",
        authorization: request.headers.authorization,
      });
      response.writeHead(held.reply.status, {
        "content-type": "application/json",
      });
      response.end(held.reply.body);
    },
  );
  t.after(
    () =>
      new Promise<void>((closed) => {
        server.closeAllConnections();
        server.close(() => closed());
      }),
  );
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(
        Object.assign(held, {
          base: `http://127.0.0.1:${String(address.port)}`,
        }),
      );
    });
  });
}

const gcpReference = "projects/p/secrets/author-key/versions/latest";

test("the GCP source forms the access path, sends the token file's bearer, and decodes the payload", async (t) => {
  const dir = sourceDir(t);
  const tokenPath = join(dir, "bearer.token");
  writeFileSync(tokenPath, "first-token\n");
  const fake = await fakeSecretManager(t);
  fake.reply = {
    status: 200,
    body: JSON.stringify({
      name: gcpReference,
      payload: { data: Buffer.from("the-material").toString("base64") },
    }),
  };
  const source = secretGcpSource({
    base: fake.base,
    bearerTokenPath: tokenPath,
  });
  assert.equal(await source(gcpReference), "the-material");

  writeFileSync(tokenPath, "rotated-token\n");
  assert.equal(await source(gcpReference), "the-material");
  assert.deepEqual(fake.asked, [
    { path: `/v1/${gcpReference}:access`, authorization: "Bearer first-token" },
    {
      path: `/v1/${gcpReference}:access`,
      authorization: "Bearer rotated-token",
    },
  ]);
});

test("the GCP source refuses a reference that is not a version name, before any request", async (t) => {
  const dir = sourceDir(t);
  const tokenPath = join(dir, "bearer.token");
  writeFileSync(tokenPath, "token\n");
  const fake = await fakeSecretManager(t);
  const source = secretGcpSource({
    base: fake.base,
    bearerTokenPath: tokenPath,
  });
  for (const bent of [
    "author-key",
    "projects/p/secrets/s",
    "projects/p/secrets/s/versions/1/extra",
  ]) {
    await assert.rejects(source(bent), /not a secret version name/);
  }
  assert.equal(fake.asked.length, 0);
});

test("the GCP source rejects a refusal and a payload it cannot read", async (t) => {
  const dir = sourceDir(t);
  const tokenPath = join(dir, "bearer.token");
  writeFileSync(tokenPath, "token\n");
  const fake = await fakeSecretManager(t);
  const source = secretGcpSource({
    base: fake.base,
    bearerTokenPath: tokenPath,
  });
  fake.reply = { status: 403, body: JSON.stringify({ error: {} }) };
  await assert.rejects(source(gcpReference), /answered 403/);
  fake.reply = { status: 200, body: JSON.stringify({ name: gcpReference }) };
  await assert.rejects(source(gcpReference), /no payload/);
});
