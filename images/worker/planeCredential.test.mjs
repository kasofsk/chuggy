import assert from "node:assert/strict";
import test from "node:test";

import {
  planeCredential,
  sessionCredentialPath,
  workerCredentialPath,
} from "./planeCredential.mjs";
import { mintedCredentialDirectory } from "./repository.mjs";
import { sessionRequest } from "./sessionTransport.mjs";

const task = { workerPlane: { url: "http://worker-plane.test:3001" } };
const password = "ghs_0123456789abcdefghijklmnopqrstuvwxyz";
const minted = { username: "x-access-token", password };
const mintedFile = `${mintedCredentialDirectory}/chuggy-git-credential`;

/** One plane answering one thing, recording everything it was asked. */
function planeOf(answer) {
  const asked = [];
  return {
    asked,
    request: async (_task, bearer, path, init, transport) => {
      asked.push({ bearer, path, init, transport });
      return answer;
    },
  };
}

/** Where the password went, instead of the pod's own filesystem. */
function writerOf() {
  const written = [];
  return {
    written,
    write: async (file, content, options) => {
      written.push({ file, content, options });
    },
  };
}

test("an attempt asks for nothing and is answered a credential git reads from a file", async () => {
  const plane = planeOf({ status: 200, ok: true, json: async () => minted });
  const writer = writerOf();

  const credential = await planeCredential({
    task,
    bearer: "capability",
    path: workerCredentialPath,
    request: plane.request,
    write: writer.write,
  });

  assert.equal(plane.asked.length, 1);
  assert.equal(plane.asked[0].path, workerCredentialPath);
  assert.equal(plane.asked[0].bearer, "capability");
  assert.equal(plane.asked[0].init.method, "POST");
  assert.equal(plane.asked[0].init.body, undefined);
  assert.deepEqual(writer.written, [
    {
      file: mintedFile,
      content: password,
      options: { mode: 0o600 },
    },
  ]);
  assert.equal(credential.file, mintedFile);
  assert.equal(credential.password, password);
  assert.equal(
    credential.environment.CHUG_WORKER_GIT_CREDENTIAL_FILE,
    mintedFile,
  );
  assert.equal(
    credential.environment.CHUG_WORKER_GIT_CREDENTIAL_USERNAME,
    minted.username,
  );
  assert.equal(
    credential.environment.GIT_ASKPASS,
    "/usr/local/lib/chuggy/git-askpass.sh",
  );
  assert.equal(credential.environment.GIT_TERMINAL_PROMPT, "0");
});

test("a not-found is an answer the transport hands back rather than retries", async () => {
  const plane = planeOf({
    status: 404,
    json: async () => ({ reason: "ForgeNotConfigured" }),
  });
  const writer = writerOf();

  const credential = await planeCredential({
    task,
    bearer: "capability",
    path: workerCredentialPath,
    request: plane.request,
    write: writer.write,
  });

  assert.equal(credential, undefined);
  assert.deepEqual(writer.written, []);
  assert.deepEqual(plane.asked[0].transport.settled, [404]);
});

test("a session names its repository and the plane is told nothing else", async () => {
  const plane = planeOf({ status: 200, ok: true, json: async () => minted });
  const writer = writerOf();

  await planeCredential({
    task,
    bearer: "chgs_0123456789abcdef0123456789abcdef",
    path: sessionCredentialPath,
    repository: "https://github.com/kasofsk/chuggy.git",
    request: plane.request,
    write: writer.write,
  });

  assert.equal(plane.asked[0].path, sessionCredentialPath);
  assert.equal(plane.asked[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(plane.asked[0].init.body), {
    repository: "https://github.com/kasofsk/chuggy.git",
  });
});

/**
 * A fake request takes the fifth argument and ignores it, so only the real
 * transport shows whether naming one field of it unset the rest.
 */
test("a session reaches the plane through the transport it is actually given", async () => {
  const writer = writerOf();
  const answers = [
    { status: 404, ok: false, json: async () => ({ reason: "NotMinted" }) },
    { status: 200, ok: true, json: async () => minted },
  ];
  const sent = [];
  const restore = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init });
    return answers[sent.length - 1];
  };
  try {
    const asked = {
      task,
      bearer: "chgs_0123456789abcdef0123456789abcdef",
      path: sessionCredentialPath,
      repository: "https://github.com/kasofsk/chuggy.git",
      request: sessionRequest,
      write: writer.write,
    };

    assert.equal(await planeCredential(asked), undefined);
    const credential = await planeCredential(asked);

    assert.equal(credential.file, mintedFile);
    assert.equal(sent.length, 2);
    assert.equal(
      sent[0].url,
      `http://worker-plane.test:3001${sessionCredentialPath}`,
    );
    assert.equal(
      sent[0].init.headers.authorization,
      "Bearer chgs_0123456789abcdef0123456789abcdef",
    );
  } finally {
    globalThis.fetch = restore;
  }
});

test("every refusal but a not-found is this pod's failure", async () => {
  const writer = writerOf();
  await assert.rejects(
    planeCredential({
      task,
      bearer: "capability",
      path: workerCredentialPath,
      request: planeOf({ status: 401, json: async () => ({}) }).request,
      write: writer.write,
    }),
    /answered 401 for a credential/u,
  );
  assert.deepEqual(writer.written, []);
});

test("an answer carrying no password is refused rather than written out", async () => {
  const writer = writerOf();
  for (const answered of [{}, { username: "x-access-token" }, { password }]) {
    await assert.rejects(
      planeCredential({
        task,
        bearer: "capability",
        path: workerCredentialPath,
        request: planeOf({ status: 200, ok: true, json: async () => answered })
          .request,
        environment: {},
        write: writer.write,
      }),
      /answered a credential it did not mint/u,
    );
  }
  assert.deepEqual(writer.written, []);
});
