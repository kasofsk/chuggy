/**
 * The change identity the commit ancestry adapter answers, against real
 * repositories: a ticket's change, the same change after its work merged a
 * moved target, also where the target edited a line beside the change's own,
 * and the change once a conflict was resolved or an edit added.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  emptyChangeIdentity,
  type ChangeIdentityQuestion,
} from "../../src/interpreter/changeIdentity.ts";
import {
  asGitObjectId,
  type GitObjectId,
} from "../../src/interpreter/finalizer.ts";

import {
  type Fixture,
  fixtureGit,
  fixtureOpen,
  fixturePort,
  fixtureQuestion,
} from "./gitCommitAncestryFixture.ts";

/** Writes one file over whatever is checked out and commits it, pushing the branch it is on. */
function changeCommit(
  fixture: Fixture,
  file: string,
  content: string,
): GitObjectId {
  writeFileSync(join(fixture.seed, file), content);
  fixtureGit(fixture.seed, "add", "-A");
  fixtureGit(fixture.seed, "commit", "-qm", `${file}: ${content}`);
  return changeHead(fixture);
}

/** The commit the seed's checkout is at, pushed to the remote under the branch it is on. */
function changeHead(fixture: Fixture): GitObjectId {
  fixtureGit(fixture.seed, "push", "-q", fixture.remote, "HEAD");
  return asGitObjectId(fixtureGit(fixture.seed, "rev-parse", "HEAD"));
}

function changeQuestion(
  fixture: Fixture,
  work: GitObjectId,
  target: GitObjectId,
  repository: string = fixture.remote,
): ChangeIdentityQuestion {
  return {
    repository: fixtureQuestion(fixture, work, target, repository).repository,
    work,
    target,
  };
}

/** A ticket's work on its own branch over the remote's `main`, which is where it lands. */
function changeOpen(t: TestContext): {
  readonly fixture: Fixture;
  readonly landed: GitObjectId;
  readonly work: GitObjectId;
} {
  const fixture = fixtureOpen(t);
  const landed = fixture.tip;
  fixtureGit(fixture.seed, "checkout", "-q", "-b", "ticket", landed);
  const work = changeCommit(fixture, "change", "one\ntwo\n");
  return { fixture, landed, work };
}

/** A ticket's branch, not yet worked on, over a `main` that has just landed one file. */
function changeOpenOver(
  t: TestContext,
  file: string,
  content: string,
): { readonly fixture: Fixture; readonly landed: GitObjectId } {
  const fixture = fixtureOpen(t);
  fixtureGit(fixture.seed, "checkout", "-q", "main");
  const landed = changeCommit(fixture, file, content);
  fixtureGit(fixture.seed, "checkout", "-q", "-b", "ticket");
  return { fixture, landed };
}

/** Moves `main` on by one commit, and returns the seed to the ticket's branch. */
function changeTargetMoved(
  fixture: Fixture,
  file: string,
  content: string,
): GitObjectId {
  fixtureGit(fixture.seed, "checkout", "-q", "main");
  const moved = changeCommit(fixture, file, content);
  fixtureGit(fixture.seed, "checkout", "-q", "ticket");
  return moved;
}

test("a change and the same change after a clean merge of a moved target have one identity", async (t) => {
  const { fixture, landed, work } = changeOpen(t);
  const port = fixturePort(fixture);
  const before = await port.changeIdentity(
    changeQuestion(fixture, work, landed),
  );
  assert.match(before ?? "", /^[0-9a-f]{40}$/u);
  const moved = changeTargetMoved(fixture, "elsewhere", "moved\n");
  fixtureGit(fixture.seed, "merge", "-q", "--no-ff", "-m", "merge", "main");
  const merged = changeHead(fixture);
  assert.equal(
    await port.changeIdentity(changeQuestion(fixture, merged, moved)),
    before,
  );
  assert.equal(
    await port.changeIdentity(changeQuestion(fixture, work, moved)),
    before,
  );
});

/** The lines of a file numbered one to seven, the third and fifth as given. */
function changeNumbered(third: string, fifth: string): string {
  return ["1", "2", third, "4", fifth, "6", "7", ""].join("\n");
}

/** The stable patch-id of the diff with context between two commits, whitespace stripped. */
function changeStrippedWithContext(
  fixture: Fixture,
  base: GitObjectId,
  work: GitObjectId,
): string {
  const diff = fixtureGit(fixture.seed, "diff-tree", "-p", base, work);
  const [patchId] = execFileSync("git", ["patch-id", "--stable"], {
    input: `${diff}\n`,
    encoding: "utf8",
  }).split(" ");
  assert.match(patchId ?? "", /^[0-9a-f]{40}$/u);
  return patchId ?? "";
}

test("a change keeps its identity over a clean merge of a target that edited a line beside its own", async (t) => {
  const { fixture, landed } = changeOpenOver(
    t,
    "numbered",
    changeNumbered("3", "5"),
  );
  const work = changeCommit(fixture, "numbered", changeNumbered("three", "5"));
  const port = fixturePort(fixture);
  const before = await port.changeIdentity(
    changeQuestion(fixture, work, landed),
  );
  assert.match(before ?? "", /^[0-9a-f]{40}$/u);
  const moved = changeTargetMoved(
    fixture,
    "numbered",
    changeNumbered("3", "five"),
  );
  fixtureGit(fixture.seed, "merge", "-q", "--no-ff", "-m", "merge", "main");
  const merged = changeHead(fixture);
  assert.equal(
    await port.changeIdentity(changeQuestion(fixture, merged, moved)),
    before,
  );
});

test("an edit to the change's own lines gives it another identity", async (t) => {
  const { fixture, landed, work } = changeOpen(t);
  const port = fixturePort(fixture);
  const before = await port.changeIdentity(
    changeQuestion(fixture, work, landed),
  );
  const edited = changeCommit(fixture, "change", "one\nTWO\n");
  const after = await port.changeIdentity(
    changeQuestion(fixture, edited, landed),
  );
  assert.notEqual(after, undefined);
  assert.notEqual(after, before);
});

test("no identity equals one taken with context and whitespace stripped for another change", async (t) => {
  const { fixture, landed } = changeOpenOver(t, "signed", "+x\n");
  const appended = changeCommit(fixture, "signed", "+x\ny\n");
  fixtureGit(fixture.seed, "checkout", "-q", "-b", "other", landed);
  const inserted = changeCommit(fixture, "signed", "+x\nx\ny\n");
  const stripped = changeStrippedWithContext(fixture, landed, appended);
  assert.notEqual(
    stripped,
    changeStrippedWithContext(fixture, landed, inserted),
  );
  const identity = await fixturePort(fixture).changeIdentity(
    changeQuestion(fixture, inserted, landed),
  );
  assert.notEqual(identity, undefined);
  assert.notEqual(identity, stripped);
});

test("an edit added to the change gives it another identity", async (t) => {
  const { fixture, landed, work } = changeOpen(t);
  const port = fixturePort(fixture);
  const before = await port.changeIdentity(
    changeQuestion(fixture, work, landed),
  );
  const edited = changeCommit(fixture, "change", "one\ntwo\nthree\n");
  const after = await port.changeIdentity(
    changeQuestion(fixture, edited, landed),
  );
  assert.notEqual(after, undefined);
  assert.notEqual(after, before);
});

test("a conflict resolved against a moved target gives the change another identity", async (t) => {
  const { fixture, landed, work } = changeOpen(t);
  const port = fixturePort(fixture);
  const before = await port.changeIdentity(
    changeQuestion(fixture, work, landed),
  );
  const moved = changeTargetMoved(fixture, "change", "one\nTWO\n");
  assert.throws(() =>
    fixtureGit(fixture.seed, "merge", "-q", "-m", "merge", "main"),
  );
  writeFileSync(join(fixture.seed, "change"), "one\ntwo, TWO\n");
  fixtureGit(fixture.seed, "add", "-A");
  fixtureGit(fixture.seed, "commit", "-qm", "resolved");
  const resolved = changeHead(fixture);
  const after = await port.changeIdentity(
    changeQuestion(fixture, resolved, moved),
  );
  assert.notEqual(after, undefined);
  assert.notEqual(after, before);
});

test("the user-interface configuration of the scratch's git leaves the identity as it was", async (t) => {
  const { fixture, landed, work } = changeOpen(t);
  const port = fixturePort(fixture);
  const before = await port.changeIdentity(
    changeQuestion(fixture, work, landed),
  );
  appendFileSync(
    join(fixture.directory, "gitconfig"),
    "[diff]\n\tnoprefix = true\n\tmnemonicPrefix = true\n\talgorithm = patience\n",
  );
  assert.equal(
    await fixturePort(fixture).changeIdentity(
      changeQuestion(fixture, work, landed),
    ),
    before,
  );
});

test("a work commit the target already holds is the empty change, which is an answer", async (t) => {
  const { fixture, work } = changeOpen(t);
  assert.equal(
    await fixturePort(fixture).changeIdentity(
      changeQuestion(fixture, fixture.base, work),
    ),
    emptyChangeIdentity,
  );
});

test("a repository that cannot be read answers nothing", async (t) => {
  const { fixture, landed, work } = changeOpen(t);
  assert.equal(
    await fixturePort(fixture).changeIdentity(
      changeQuestion(
        fixture,
        work,
        landed,
        join(fixture.directory, "absent.git"),
      ),
    ),
    undefined,
  );
});

test("two changes differing only in bytes that are binary, or not UTF-8, have two identities", async (t) => {
  const { fixture, landed } = changeOpen(t);
  const port = fixturePort(fixture);
  const identities = [];
  for (const bytes of [
    [0x00, 0x01],
    [0x00, 0x02],
    [0x61, 0xff, 0x0a],
    [0x61, 0xfe, 0x0a],
  ]) {
    fixtureGit(fixture.seed, "checkout", "-q", "-B", "ticket", landed);
    writeFileSync(join(fixture.seed, "bytes"), Buffer.from(bytes));
    fixtureGit(fixture.seed, "add", "-A");
    fixtureGit(fixture.seed, "commit", "-qm", "bytes");
    fixtureGit(fixture.seed, "push", "-qf", fixture.remote, "HEAD");
    const work = asGitObjectId(fixtureGit(fixture.seed, "rev-parse", "HEAD"));
    identities.push(
      await port.changeIdentity(changeQuestion(fixture, work, landed)),
    );
  }
  assert.equal(identities.includes(undefined), false);
  assert.equal(new Set(identities).size, identities.length);
});
