/**
 * Minting the commit a stacked evaluation runs over, against real bare
 * repositories on disk: the same inputs are the same commit however many
 * scratches mint it, a conflict is no stack, a ref the remote will not take is
 * a failure, and a plain clone fetches what was published.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { gitPromotion } from "../../src/adapters/git/gitPromotion.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryCredential,
  asRepositoryId,
  type GitObjectId,
  type GitPromotionPort,
  type RepositoryBinding,
  type StackMinting,
} from "../../src/interpreter/finalizer.ts";
import { stackRefOf } from "../../src/interpreter/evaluationStack.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";

interface Fixture {
  readonly directory: string;
  readonly remote: string;
  readonly seed: string;
  readonly binding: RepositoryBinding;
}

function run(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
  }).trim();
}

/** Commits one file on a branch cut from `main`, pushes it, and returns its commit. */
function branchCommit(
  fixture: Fixture,
  branch: string,
  path: string,
  content: string,
): GitObjectId {
  run(fixture.seed, "checkout", "-q", "-B", branch, "main");
  writeFileSync(join(fixture.seed, path), content);
  run(fixture.seed, "add", "-A");
  run(fixture.seed, "-c", "commit.gpgsign=false", "commit", "-qm", branch);
  run(fixture.seed, "push", "-q", fixture.remote, `${branch}:${branch}`);
  return asGitObjectId(run(fixture.seed, "rev-parse", "HEAD"));
}

function open(t: TestContext): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "chuggy-stack-"));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const remote = join(directory, "origin.git");
  const seed = join(directory, "seed");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  run(seed, "config", "user.name", "fixture");
  run(seed, "config", "user.email", "fixture@example.test");
  writeFileSync(join(seed, "base.txt"), "base\n");
  run(seed, "add", "-A");
  run(seed, "-c", "commit.gpgsign=false", "commit", "-qm", "base");
  run(seed, "push", "-q", remote, "main:main");
  return {
    directory,
    remote,
    seed,
    binding: {
      partition: {
        tenant: asTenantId("tenant"),
        project: asProjectId("project"),
      },
      repository: asRepositoryId(remote),
      recoveryEpoch: asRecoveryEpoch("epoch-1"),
    },
  };
}

function port(fixture: Fixture, scratch: string): GitPromotionPort {
  return gitPromotion({
    scratchDirectory: join(fixture.directory, scratch),
    identity: { name: "chug", email: "chug@example.test" },
    environment: process.env,
    credentials: {
      credential: () =>
        Promise.resolve({
          resolved: "Credential",
          credential: asRepositoryCredential("fixture-secret-a1b2c3"),
        }),
    },
  });
}

function minting(
  fixture: Fixture,
  beneath: readonly GitObjectId[],
  candidate: GitObjectId,
): StackMinting {
  return {
    repository: fixture.binding,
    tip: {
      ref: asGitRefName("refs/heads/main"),
      commit: asGitObjectId(run(fixture.remote, "rev-parse", "main")),
    },
    beneath,
    candidate,
    ref: stackRefOf(7, 1),
  };
}

test("a stack is the tip with each commit beneath and then the candidate merged in", async (t) => {
  const fixture = open(t);
  const below = branchCommit(fixture, "below", "below.txt", "below\n");
  const top = branchCommit(fixture, "top", "top.txt", "top\n");
  const minted = await port(fixture, "scratch").mintStack(
    minting(fixture, [below], top),
  );
  assert.equal(minted.minted, "Stack");
  if (minted.minted !== "Stack") return;
  assert.equal(
    run(fixture.remote, "rev-parse", "refs/heads/chuggy/stack/7/1"),
    minted.commit,
  );
  assert.equal(
    run(fixture.remote, "ls-tree", "-r", "--name-only", minted.commit),
    "base.txt\nbelow.txt\ntop.txt",
  );
  assert.equal(
    run(fixture.remote, "rev-parse", `${minted.commit}^{tree}`),
    minted.tree,
  );
  assert.equal(
    run(
      fixture.remote,
      "log",
      "-1",
      "--format=%an <%ae> %at %cn <%ce> %ct",
      minted.commit,
    ),
    "Chug Stack <chug-stack@invalid> 0 Chug Stack <chug-stack@invalid> 0",
  );
});

test("the same stack is the same commit from any scratch and any number of mints", async (t) => {
  const fixture = open(t);
  const below = branchCommit(fixture, "below", "below.txt", "below\n");
  const top = branchCommit(fixture, "top", "top.txt", "top\n");
  const one = port(fixture, "first");
  const first = await one.mintStack(minting(fixture, [below], top));
  const again = await one.mintStack(minting(fixture, [below], top));
  const elsewhere = await port(fixture, "second").mintStack(
    minting(fixture, [below], top),
  );
  assert.deepEqual(again, first);
  assert.deepEqual(elsewhere, first);
});

test("a stack the candidate alone reaches is the candidate", async (t) => {
  const fixture = open(t);
  const top = branchCommit(fixture, "top", "top.txt", "top\n");
  const minted = await port(fixture, "scratch").mintStack(
    minting(fixture, [], top),
  );
  assert.equal(minted.minted === "Stack" && minted.commit, top);
});

test("a textual conflict is no stack and publishes nothing", async (t) => {
  const fixture = open(t);
  const below = branchCommit(fixture, "below", "base.txt", "one\n");
  const top = branchCommit(fixture, "top", "base.txt", "two\n");
  const minted = await port(fixture, "scratch").mintStack(
    minting(fixture, [below], top),
  );
  assert.deepEqual(minted, { minted: "Conflicted" });
  assert.throws(() =>
    run(fixture.remote, "rev-parse", "--verify", "refs/heads/chuggy/stack/7/1"),
  );
});

test("a ref the remote holds elsewhere is a failed push, not a stack", async (t) => {
  const fixture = open(t);
  const below = branchCommit(fixture, "below", "below.txt", "below\n");
  const top = branchCommit(fixture, "top", "top.txt", "top\n");
  const other = branchCommit(fixture, "other", "other.txt", "other\n");
  run(fixture.remote, "update-ref", "refs/heads/chuggy/stack/7/1", other);
  const minted = await port(fixture, "scratch").mintStack(
    minting(fixture, [below], top),
  );
  assert.deepEqual(minted, { minted: "Failed", evidence: "RemoteDeclined" });
});

test("a commit nobody can fetch is a failure", async (t) => {
  const fixture = open(t);
  const top = branchCommit(fixture, "top", "top.txt", "top\n");
  const minted = await port(fixture, "scratch").mintStack(
    minting(fixture, [asGitObjectId("a".repeat(40))], top),
  );
  assert.deepEqual(minted, { minted: "Failed", evidence: "ObjectMissing" });
});

test("a plain clone fetches the published stack and checks out its tree", async (t) => {
  const fixture = open(t);
  const below = branchCommit(fixture, "below", "below.txt", "below\n");
  const top = branchCommit(fixture, "top", "top.txt", "top\n");
  const minted = await port(fixture, "scratch").mintStack(
    minting(fixture, [below], top),
  );
  assert.equal(minted.minted, "Stack");
  if (minted.minted !== "Stack") return;
  const clone = join(fixture.directory, "clone");
  execFileSync("git", ["clone", "-q", "--no-checkout", fixture.remote, clone]);
  run(clone, "checkout", "-q", "--detach", minted.commit);
  assert.equal(run(clone, "rev-parse", "HEAD^{tree}"), minted.tree);
});

test("a published stack is taken down, and one already gone is too", async (t) => {
  const fixture = open(t);
  const top = branchCommit(fixture, "top", "top.txt", "top\n");
  const git = port(fixture, "scratch");
  await git.mintStack(minting(fixture, [], top));
  const removal = { repository: fixture.binding, ref: stackRefOf(7, 1) };
  assert.deepEqual(await git.removeStack(removal), { removed: "Removed" });
  assert.throws(() =>
    run(fixture.remote, "rev-parse", "--verify", "refs/heads/chuggy/stack/7/1"),
  );
  assert.deepEqual(await git.removeStack(removal), { removed: "Removed" });
});

/** The merge of `candidate` over the reference's present tip, as a stacked landing computes it. */
async function landed(
  fixture: Fixture,
  git: GitPromotionPort,
  candidate: GitObjectId,
) {
  const integrated = await git.integrateCandidate({
    repository: fixture.binding,
    target: minting(fixture, [], candidate).tip,
    candidate,
    strategy: "Merge",
  });
  if (integrated.integrated !== "Candidate") {
    assert.fail(`the merge did not integrate: ${JSON.stringify(integrated)}`);
  }
  return integrated;
}

test("landsWhenTreeEqual: once the tickets beneath have landed, the merge of the top one is the tree its stack was minted with", async (t) => {
  const fixture = open(t);
  const below = branchCommit(fixture, "below", "below.txt", "below\n");
  const top = branchCommit(fixture, "top", "top.txt", "top\n");
  const git = port(fixture, "scratch");
  const minted = await git.mintStack(minting(fixture, [below], top));
  if (minted.minted !== "Stack") return assert.fail("no stack was minted");
  run(fixture.remote, "update-ref", "refs/heads/main", below);

  const integrated = await landed(fixture, git, top);

  assert.equal(integrated.tree, minted.tree);
  assert.notEqual(integrated.candidate, minted.commit, "another commit");
});

test("directLandingInvalidatesAStack: a landing that is not beneath moves the merge to another tree than the stack's", async (t) => {
  const fixture = open(t);
  const below = branchCommit(fixture, "below", "below.txt", "below\n");
  const top = branchCommit(fixture, "top", "top.txt", "top\n");
  const direct = branchCommit(fixture, "direct", "direct.txt", "direct\n");
  const git = port(fixture, "scratch");
  const minted = await git.mintStack(minting(fixture, [below], top));
  if (minted.minted !== "Stack") return assert.fail("no stack was minted");
  run(fixture.remote, "update-ref", "refs/heads/main", direct);

  const integrated = await landed(fixture, git, top);

  assert.notEqual(integrated.tree, minted.tree);
});
