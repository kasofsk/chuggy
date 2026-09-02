/**
 * The session's clone, driven against a real repository on this machine. A
 * stubbed `git` would prove that arguments were assembled and nothing about
 * whether a clone lands a working tree at the remote's own default branch,
 * which is the whole of what this module claims.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { sessionCheckout } from "./sessionCheckout.mjs";

const run = promisify(execFile);

const grant = {
  tools: [],
  credentials: ["chuggy-git"],
  network: true,
  filesystem: "WriteWorkspace",
  mayCompleteTask: false,
};

const credentialFiles = { "chuggy-git": "/var/run/chuggy/credentials/git" };

function repositories(url) {
  return {
    chuggy: { url, credential: "chuggy-git", credentialUsername: "chuggy" },
  };
}

function taskOf(extra = {}) {
  return {
    tenant: "vteng",
    project: "chuggy",
    authority: grant,
    repository: { reference: "chuggy" },
    ...extra,
  };
}

/** A repository with one commit on a branch that is not `main`, so the head is the remote's own. */
async function remoteOf(root) {
  const work = join(root, "work");
  await run("git", ["init", "--initial-branch=trunk", work]);
  await run("git", ["config", "user.email", "suite@chuggy.invalid"], {
    cwd: work,
  });
  await run("git", ["config", "user.name", "suite"], { cwd: work });
  await writeFile(join(work, "CLAUDE.md"), "# the tree's own notes\n");
  await run("git", ["add", "CLAUDE.md"], { cwd: work });
  await run("git", ["commit", "-m", "the tree"], { cwd: work });
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: work });
  return { url: work, head: stdout.trim() };
}

async function scratch(body) {
  const root = await mkdtemp(join(tmpdir(), "chuggy-session-checkout-"));
  try {
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a session bound to a repository is cloned at the remote's own default branch", async () => {
  await scratch(async (root) => {
    const { url, head } = await remoteOf(root);
    const workspace = join(root, "workspace");
    const logged = [];

    const checkout = await sessionCheckout(
      taskOf(),
      repositories(url),
      credentialFiles,
      workspace,
      { log: (text) => logged.push(text) },
    );

    assert.deepEqual(checkout, {
      directory: join(workspace, "repository"),
      commit: head,
    });
    assert.ok(
      (await stat(join(checkout.directory, "CLAUDE.md"))).isFile(),
      "the checkout has no working tree",
    );
    const { stdout } = await run(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: checkout.directory },
    );
    assert.equal(stdout.trim(), "trunk");
    assert.deepEqual(logged, [`session checkout chuggy at ${head}\n`]);
  });
});

test("a project that binds no repository takes its turns with no tree", async () => {
  const taken = [];
  const checkout = await sessionCheckout(
    taskOf({ repository: undefined }),
    repositories("/nowhere"),
    credentialFiles,
    "/workspace",
    { run: (args) => taken.push(args), log: () => undefined },
  );

  assert.equal(checkout, undefined);
  assert.deepEqual(taken, [], "a session with no binding reached git");
});

test("a credential the attempt's authority does not grant is loud", async () => {
  await assert.rejects(
    sessionCheckout(
      taskOf({ authority: { ...grant, credentials: ["claude-code"] } }),
      repositories("/nowhere"),
      credentialFiles,
      "/workspace",
      { log: () => undefined },
    ),
    /session authority does not grant chuggy-git/u,
  );
});

test("a reference the site's map does not carry is loud", async () => {
  await assert.rejects(
    sessionCheckout(
      taskOf({ repository: { reference: "elsewhere" } }),
      repositories("/nowhere"),
      credentialFiles,
      "/workspace",
      { log: () => undefined },
    ),
    /no repository configuration for elsewhere/u,
  );
});

test("a clone that does not finish leaves the session with no tree rather than no session", async () => {
  await scratch(async (root) => {
    const logged = [];

    const checkout = await sessionCheckout(
      taskOf(),
      repositories(join(root, "absent")),
      credentialFiles,
      join(root, "workspace"),
      { log: (text) => logged.push(text) },
    );

    assert.equal(checkout, undefined);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /^session checkout chuggy failed: /u);
  });
});

test("what a failed clone says is scrubbed before it is written", async () => {
  await scratch(async (root) => {
    const secret = "sk-ant-oat01-notreal";
    const logged = [];

    await sessionCheckout(
      taskOf(),
      repositories(join(root, secret)),
      credentialFiles,
      join(root, "workspace"),
      {
        log: (text) => logged.push(text),
        scrub: (text) => text.replaceAll(secret, "[redacted]"),
      },
    );

    assert.ok(!logged[0].includes(secret), "a failed clone printed a secret");
    assert.ok(logged[0].includes("[redacted]"));
  });
});
