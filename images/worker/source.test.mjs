import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  commitAndPushSource,
  resultDocument,
  ticketBranch,
} from "./source.mjs";

const git = promisify(execFile);

test("ticket branch is deterministic, bounded, and names the ticket", () => {
  assert.equal(
    ticketBranch({ ticket: 42, attempt: "attempt-identity" }),
    "refs/heads/chuggy/tickets/42/attempts/" +
      "9a33b56cbbac4db829e4917c5ac9369958062635f18534cfc26b48071229a39f",
  );
});

test("source publication commits all changes and pushes a new attempt ref", async () => {
  const calls = [];
  const command = async (executable, args, options) => {
    calls.push({ executable, args, options });
    return args[0] === "rev-parse" ? { stdout: "abc123\n" } : { stdout: "" };
  };
  const environment = { GIT_ASKPASS: "askpass" };
  const source = await commitAndPushSource({
    task: {
      ticket: 7,
      attempt: "opaque",
      worker: { files: [{ path: ".claude/settings.json" }] },
    },
    repositoryId: "chuggy",
    repository: "http://git/rig.git",
    base: "base123",
    directory: "/workspace/repository",
    command,
    environment,
  });

  assert.deepEqual(source, {
    repository: "chuggy",
    ref: ticketBranch({ ticket: 7, attempt: "opaque" }),
    commit: "abc123",
    base: "base123",
  });
  assert.deepEqual(calls.at(-1), {
    executable: "git",
    args: ["push", "http://git/rig.git", `HEAD:${source.ref}`],
    options: { cwd: "/workspace/repository", env: environment },
  });
  assert.ok(calls.some(({ args }) => args[0] === "add" && args[1] === "--all"));
  assert.ok(
    calls.some(
      ({ args }) =>
        args[0] === "reset" && args.at(-1) === ".claude/settings.json",
    ),
  );
  assert.ok(
    calls.some(
      ({ args }) => args[0] === "commit" && args.includes("--allow-empty"),
    ),
  );
});

test("a push that can take a fresh credential takes one, and uses it", async () => {
  const calls = [];
  const command = async (executable, args, options) => {
    calls.push({ executable, args, options });
    return args[0] === "rev-parse" ? { stdout: "abc123\n" } : { stdout: "" };
  };
  const refreshed = {
    GIT_ASKPASS: "askpass",
    CHUG_WORKER_GIT_CREDENTIAL_FILE: "/tmp/later",
  };
  let refreshes = 0;

  await commitAndPushSource({
    task: { ticket: 7, attempt: "opaque", worker: {} },
    repositoryId: "chuggy",
    repository: "http://git/rig.git",
    base: "base123",
    directory: "/workspace/repository",
    command,
    environment: {
      GIT_ASKPASS: "askpass",
      CHUG_WORKER_GIT_CREDENTIAL_FILE: "/tmp/earlier",
    },
    refresh: async () => {
      assert.equal(
        calls.at(-1).args[0],
        "rev-parse",
        "the credential is taken after everything the commit needed, not before",
      );
      refreshes += 1;
      return refreshed;
    },
  });

  assert.equal(refreshes, 1);
  assert.equal(calls.at(-1).args[0], "push");
  assert.deepEqual(calls.at(-1).options.env, refreshed);
});

/** A checkout with a commit already in it, and the bare remote its attempt pushes to. */
async function checkoutWithRemote(root) {
  const remote = join(root, "remote.git");
  const directory = join(root, "checkout");
  await git("git", ["init", "--bare", remote]);
  await git("git", ["init", directory]);
  await writeFile(join(directory, "README.md"), "# what the ticket found\n");
  await git("git", ["add", "README.md"], { cwd: directory });
  const author = ["-c", "user.email=suite@chuggy.invalid", "-c", "user.name=s"];
  await git("git", [...author, "commit", "-m", "before"], { cwd: directory });
  const { stdout } = await git("git", ["rev-parse", "HEAD"], {
    cwd: directory,
  });
  return { remote, directory, base: stdout.trim() };
}

/**
 * Driven against real repositories, because whether a commit exists when nothing
 * changed is git's answer and not the stub's. Catches a commit that stopped
 * being `--allow-empty`: the attempt would crash where it should have declared
 * the work its commands found nothing left to do.
 */
test("an attempt that changed nothing still declares a commit on its branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "chuggy-source-"));
  try {
    const { remote, directory, base } = await checkoutWithRemote(root);

    const source = await commitAndPushSource({
      task: { ticket: 9, attempt: "opaque", worker: {} },
      repositoryId: "chuggy",
      repository: remote,
      base,
      directory,
      command: git,
      environment: process.env,
    });

    const { stdout: changed } = await git(
      "git",
      ["diff", "--name-only", base, source.commit],
      { cwd: directory },
    );
    assert.equal(changed, "", "the attempt changed the tree it was given");
    assert.notEqual(source.commit, base);
    const { stdout: pushed } = await git("git", ["rev-parse", source.ref], {
      cwd: remote,
    });
    assert.equal(pushed.trim(), source.commit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every worker report uses the schema that carries its summary", () => {
  assert.equal(
    resultDocument({ verdict: "Fail", report: "failed" }).version,
    3,
  );
  assert.equal(
    resultDocument({
      verdict: "Pass",
      report: "passed",
      source: { repository: "chuggy" },
    }).version,
    3,
  );
});
