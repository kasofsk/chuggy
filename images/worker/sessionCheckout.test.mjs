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

import {
  sessionCheckout,
  sessionCheckoutTimeoutMs,
} from "./sessionCheckout.mjs";

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
    const { stdout } = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: checkout.directory,
    });
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

test("a credential the attempt's authority does not grant is refused, not raised", async () => {
  const taken = [];
  const checkout = await sessionCheckout(
    taskOf({ authority: { ...grant, credentials: ["claude-code"] } }),
    repositories("/nowhere"),
    credentialFiles,
    "/workspace",
    { run: (args) => taken.push(args), log: () => undefined },
  );

  assert.match(checkout.refused, /needs chuggy-git/u);
  assert.deepEqual(taken, [], "an ungranted credential still reached git");
});

test("a reference the site's map does not carry is refused, not raised", async () => {
  const checkout = await sessionCheckout(
    taskOf({ repository: { reference: "elsewhere" } }),
    repositories("/nowhere"),
    credentialFiles,
    "/workspace",
    { log: () => undefined },
  );

  assert.match(checkout.refused, /no repository configuration for elsewhere/u);
});

test("a refusal is scrubbed like every other line this pod would print", async () => {
  const checkout = await sessionCheckout(
    taskOf({ repository: { reference: "elsewhere" } }),
    repositories("/nowhere"),
    credentialFiles,
    "/workspace",
    {
      log: () => undefined,
      scrub: (text) => text.replace(/elsewhere/gu, "**"),
    },
  );

  assert.match(checkout.refused, /no repository configuration for \*\*/u);
});

/**
 * The mirror is a key of the site's map like any other, so the credential it is
 * cloned with is the map's answer for the mirror and not for the binding the
 * placement resolved it from.
 */
test("a mirror is resolved and granted from the site's map like any other reference", async () => {
  await scratch(async (root) => {
    const { url, head } = await remoteOf(root);
    const workspace = join(root, "workspace");
    const logged = [];

    const checkout = await sessionCheckout(
      taskOf({
        repository: { reference: "mirror" },
        authority: { ...grant, credentials: ["chuggy-git-mirror"] },
      }),
      {
        ...repositories("/nowhere"),
        mirror: {
          url,
          credential: "chuggy-git-mirror",
          credentialUsername: "worker",
        },
      },
      { ...credentialFiles, "chuggy-git-mirror": "/var/run/chuggy/mirror" },
      workspace,
      { log: (text) => logged.push(text) },
    );

    assert.deepEqual(checkout, {
      directory: join(workspace, "repository"),
      commit: head,
    });
    assert.deepEqual(logged, [`session checkout mirror at ${head}\n`]);
  });
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

test("every git call the clone makes carries a wall-clock bound", async () => {
  const options = [];

  await sessionCheckout(
    taskOf(),
    repositories("/nowhere"),
    credentialFiles,
    "/workspace",
    {
      run: (_args, given) => {
        options.push(given);
        return { stdout: `${"c".repeat(40)}\n` };
      },
      log: () => undefined,
    },
  );

  assert.equal(options.length, 2);
  for (const given of options)
    assert.equal(given.timeout, sessionCheckoutTimeoutMs);
});

test("a git call that runs past its bound leaves the session with no tree", async () => {
  await scratch(async (root) => {
    const logged = [];

    const checkout = await sessionCheckout(
      taskOf(),
      repositories("/nowhere"),
      credentialFiles,
      join(root, "workspace"),
      {
        run: (_args, given) =>
          Promise.reject(
            new Error(`git was killed after ${String(given.timeout)}ms`),
          ),
        log: (text) => logged.push(text),
      },
    );

    assert.equal(checkout, undefined);
    assert.match(logged[0], /killed after 300000ms/u);
  });
});

/**
 * A clone killed at its bound leaves its target behind, and the lead's `Read`
 * and `Bash` would walk into a half-tree while the pod reports no tree at all.
 */
test("a clone that did not finish leaves nothing of its tree behind", async () => {
  await scratch(async (root) => {
    const { url } = await remoteOf(root);
    const workspace = join(root, "workspace");
    const directory = join(workspace, "repository");

    const checkout = await sessionCheckout(
      taskOf(),
      repositories(url),
      credentialFiles,
      workspace,
      {
        run: async (args, given) => {
          await run("git", ["clone", url, directory], given);
          throw new Error("git was killed");
        },
        log: () => undefined,
      },
    );

    assert.equal(checkout, undefined);
    await assert.rejects(stat(directory), { code: "ENOENT" });
  });
});
