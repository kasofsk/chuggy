/**
 * The change identity the commit ancestry adapter answers, against real
 * repositories: a ticket's change, the same change after its work merged a
 * moved target, and the change once a conflict was resolved or an edit added.
 */

import assert from "node:assert/strict";
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
