import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";

import {
  workerRepositories,
  workerRepository,
  workerRepositoryUrl,
} from "./repository.mjs";

const executeFile = promisify(execFile);
const askpass = fileURLToPath(new URL("./git-askpass.sh", import.meta.url));

test("a worker repository selects its own credential", () => {
  const repositories = {
    internal: {
      url: "http://git.internal/chuggy.git",
      credential: "internal-worker",
      credentialUsername: "worker",
    },
    github: {
      url: "https://github.com/kasofsk/chuggy.git",
      credential: "github-worker",
      credentialUsername: "x-access-token",
    },
  };

  const selected = workerRepository(
    repositories,
    {
      "internal-worker": "/credentials/internal",
      "github-worker": "/credentials/github",
    },
    "github",
  );

  assert.equal(selected.repository, repositories.github.url);
  assert.equal(selected.credential, repositories.github.credential);
  assert.equal(
    selected.environment.CHUG_WORKER_GIT_CREDENTIAL_FILE,
    "/credentials/github",
  );
  assert.equal(
    selected.environment.CHUG_WORKER_GIT_CREDENTIAL_USERNAME,
    repositories.github.credentialUsername,
  );
  assert.equal(
    selected.environment.GIT_ASKPASS,
    "/usr/local/lib/chuggy/git-askpass.sh",
  );
  assert.equal(selected.environment.GIT_TERMINAL_PROMPT, "0");
});

test("a worker repository refuses incomplete credential configuration", () => {
  assert.throws(
    () => workerRepository({}, {}, "missing"),
    /no repository configuration for missing/u,
  );
  assert.throws(
    () =>
      workerRepository(
        {
          repository: {
            url: "https://example.invalid/repository.git",
            credential: "repository-worker",
            credentialUsername: "worker",
          },
        },
        { "repository-worker": "relative/token" },
        "repository",
      ),
    /credential file is relative/u,
  );
  assert.throws(
    () => workerRepository({}, {}, "toString"),
    /no repository configuration for toString/u,
  );
});

test("a minted repository the map does not name is cloned at its own id", () => {
  assert.equal(
    workerRepositoryUrl({}, "https://github.com/kasofsk/chuggy.git"),
    "https://github.com/kasofsk/chuggy.git",
  );
  assert.equal(
    workerRepositoryUrl(
      { "https://github.com/kasofsk/chuggy.git": { credential: "github" } },
      "https://github.com/kasofsk/chuggy.git",
    ),
    "https://github.com/kasofsk/chuggy.git",
  );
});

test("a minted repository the map names is cloned at the map's url", () => {
  assert.equal(
    workerRepositoryUrl(
      {
        "https://github.com/kasofsk/chuggy.git": {
          url: "http://mirror.internal/chuggy.git",
        },
      },
      "https://github.com/kasofsk/chuggy.git",
    ),
    "http://mirror.internal/chuggy.git",
  );
  assert.throws(
    () =>
      workerRepositoryUrl(
        { "https://github.com/kasofsk/chuggy.git": { url: "" } },
        "https://github.com/kasofsk/chuggy.git",
      ),
    /has no URL/u,
  );
});

test("a mounted repository the map does not name is still refused", () => {
  assert.throws(
    () => workerRepository({}, {}, "https://github.com/kasofsk/chuggy.git"),
    /no repository configuration for https:\/\/github.com\/kasofsk\/chuggy.git/u,
  );
});

test("worker repositories are one keyed object", () => {
  assert.deepEqual(workerRepositories('{"repository":{"url":"url"}}'), {
    repository: { url: "url" },
  });
  assert.throws(
    () => workerRepositories("[]"),
    /worker repositories must be an object/u,
  );
});

test("git askpass reads the selected repository credential", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "chuggy-askpass-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credentialFile = join(directory, "token");
  await writeFile(credentialFile, "selected-token  \n");
  const environment = {
    ...process.env,
    CHUG_WORKER_GIT_CREDENTIAL_FILE: credentialFile,
    CHUG_WORKER_GIT_CREDENTIAL_USERNAME: "selected-user",
  };

  const username = await executeFile(
    "/bin/sh",
    [askpass, "Username for repository"],
    {
      env: environment,
    },
  );
  const password = await executeFile(
    "/bin/sh",
    [askpass, "Password for repository"],
    {
      env: environment,
    },
  );

  assert.equal(username.stdout, "selected-user\n");
  assert.equal(password.stdout, "selected-token\n");
});
