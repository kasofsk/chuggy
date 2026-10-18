/** The Git tree adapter against real repositories, with the git stand-in in front of the faulting cases. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  gitRepositoryTree,
  type GitRepositoryTreeOptions,
} from "../../src/adapters/git/gitRepositoryTree.ts";
import { repositoryTreeEntriesAnsweredMax } from "../../src/contract/http.ts";
// jscpd:ignore-start -- this suite owns its imports and its real repository lifecycle, as the configuration suite does
import {
  asGitObjectId,
  asRepositoryCredential,
  asRepositoryId,
  type CredentialResolved,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  asRepositoryTreeDirectory,
  repositoryTreeRoot,
} from "../../src/interpreter/repositoryTree.ts";
import {
  gitStandInFaulted,
  gitStandInLines,
  gitStandInMarker,
  gitStandInOpen,
  type GitStandInFault,
} from "./gitStandIn.ts";

interface Fixture {
  readonly directory: string;
  readonly remote: string;
  readonly seed: string;
}

function fixtureGit(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
  }).trim();
}

function fixtureOpen(t: TestContext): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "chuggy-tree-git-"));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const remote = join(directory, "origin.git");
  const seed = join(directory, "seed");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  fixtureGit(seed, "config", "user.name", "fixture");
  fixtureGit(seed, "config", "user.email", "fixture@example.test");
  return { directory, remote, seed };
}

function fixtureWrite(fixture: Fixture, path: string, content: string): void {
  mkdirSync(dirname(join(fixture.seed, path)), { recursive: true });
  writeFileSync(join(fixture.seed, path), content);
}

function fixtureCommit(fixture: Fixture, message: string): string {
  fixtureGit(fixture.seed, "add", "-A");
  fixtureGit(
    fixture.seed,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    message,
  );
  fixtureGit(fixture.seed, "push", "-q", fixture.remote, "main:main");
  return fixtureGit(fixture.seed, "rev-parse", "HEAD");
}

// jscpd:ignore-end -- fixture lifecycle region ends

/** A tree holding every mode git lists: a directory, a file, an executable, a symbolic link to the directory and a submodule. */
function fixtureEveryMode(fixture: Fixture): string {
  fixtureWrite(fixture, "book/chapter/intro.md", "intro\n");
  fixtureWrite(fixture, "readme.md", "readme\n");
  fixtureWrite(fixture, "run.sh", "#!/bin/sh\n");
  chmodSync(join(fixture.seed, "run.sh"), 0o755);
  symlinkSync("book", join(fixture.seed, "link"));
  fixtureGit(fixture.seed, "add", "-A");
  fixtureGit(
    fixture.seed,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${"1".repeat(40)},vendor`,
  );
  fixtureGit(
    fixture.seed,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "every mode",
  );
  fixtureGit(fixture.seed, "push", "-q", fixture.remote, "main:main");
  return fixtureGit(fixture.seed, "rev-parse", "HEAD");
}

function fixtureBinding(repository: string): RepositoryBinding {
  return {
    partition: { tenant: asTenantId("tenant"), project: asProjectId("p") },
    repository: asRepositoryId(repository),
    recoveryEpoch: asRecoveryEpoch("epoch"),
  };
}

const fixtureCredential: CredentialResolved = {
  resolved: "Credential",
  credential: asRepositoryCredential("credential"),
};

function fixtureSource(
  fixture: Fixture,
  overrides: Partial<GitRepositoryTreeOptions> = {},
) {
  return gitRepositoryTree({
    scratchDirectory: join(fixture.directory, "scratch"),
    identity: { name: "chug", email: "chug@example.test" },
    environment: process.env,
    credentials: { credential: () => Promise.resolve(fixtureCredential) },
    ...overrides,
  });
}

/** A source whose calls of one verb go through the git stand-in one way, and the directory the stand-in writes its calls in. */
function fixtureStoodIn(
  fixture: Fixture,
  verbs: readonly string[],
  verb: string,
  fault: GitStandInFault,
) {
  const standIn = join(fixture.directory, "stand-in");
  const path = gitStandInOpen(standIn, verbs);
  gitStandInFaulted(standIn, verb, fault);
  return {
    source: fixtureSource(fixture, {
      environment: { ...process.env, PATH: path },
    }),
    standIn,
  };
}

function fixtureRequest(
  fixture: Fixture,
  commit: string,
  directory = repositoryTreeRoot,
) {
  return {
    repository: fixtureBinding(fixture.remote),
    commit: asGitObjectId(commit),
    directory,
  };
}

test("a directory is listed at the commit named, and a branch moving on does not change it", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, "shelf/old.ts", "old\n");
  const pinned = fixtureCommit(fixture, "old");
  fixtureWrite(fixture, "shelf/new.ts", "new\n");
  fixtureCommit(fixture, "new");
  const { trees } = fixtureSource(fixture);
  assert.deepEqual(await trees.list(fixtureRequest(fixture, pinned)), {
    read: "Listed",
    entries: [{ name: "shelf", kind: "Directory" }],
    truncated: false,
  });
  assert.deepEqual(
    await trees.list(
      fixtureRequest(fixture, pinned, asRepositoryTreeDirectory("shelf")),
    ),
    {
      read: "Listed",
      entries: [{ name: "old.ts", kind: "File", executable: false }],
      truncated: false,
    },
  );
});

test("the default branch's head is read from the remote, and a directory listed at it", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, "one.txt", "one\n");
  fixtureCommit(fixture, "one");
  fixtureWrite(fixture, "two.txt", "two\n");
  const head = fixtureCommit(fixture, "two");
  const { heads, trees } = fixtureSource(fixture);
  const read = await heads.defaultBranch(fixtureBinding(fixture.remote));
  assert.deepEqual(read, {
    read: "Branch",
    branch: "refs/heads/main",
    commit: head,
  });
  assert.deepEqual(await trees.list(fixtureRequest(fixture, head)), {
    read: "Listed",
    entries: [
      { name: "one.txt", kind: "File", executable: false },
      { name: "two.txt", kind: "File", executable: false },
    ],
    truncated: false,
  });
});

test("a repository holding no commit has no head, which is not an outage", async (t) => {
  const fixture = fixtureOpen(t);
  const { heads } = fixtureSource(fixture);
  assert.deepEqual(await heads.defaultBranch(fixtureBinding(fixture.remote)), {
    read: "Absent",
  });
});

test("each of the five modes is named as its kind, and a nested directory is listed for itself", async (t) => {
  const fixture = fixtureOpen(t);
  const commit = fixtureEveryMode(fixture);
  const { trees } = fixtureSource(fixture);
  assert.deepEqual(await trees.list(fixtureRequest(fixture, commit)), {
    read: "Listed",
    entries: [
      { name: "book", kind: "Directory" },
      { name: "link", kind: "Symlink" },
      { name: "readme.md", kind: "File", executable: false },
      { name: "run.sh", kind: "File", executable: true },
      { name: "vendor", kind: "Submodule" },
    ],
    truncated: false,
  });
  assert.deepEqual(
    await trees.list(
      fixtureRequest(
        fixture,
        commit,
        asRepositoryTreeDirectory("book/chapter"),
      ),
    ),
    {
      read: "Listed",
      entries: [{ name: "intro.md", kind: "File", executable: false }],
      truncated: false,
    },
  );
});

test("a file, a symbolic link to a directory, a submodule and a path nothing stands at are no directory", async (t) => {
  const fixture = fixtureOpen(t);
  const commit = fixtureEveryMode(fixture);
  const { trees } = fixtureSource(fixture);
  for (const path of ["readme.md", "link", "vendor", "nowhere", "book/none"])
    assert.deepEqual(
      await trees.list(
        fixtureRequest(fixture, commit, asRepositoryTreeDirectory(path)),
      ),
      { read: "Absent", absent: "Directory" },
      path,
    );
});

test("a directory holding more entries than one read answers is cut at that count and says so", async (t) => {
  const fixture = fixtureOpen(t);
  for (let each = 0; each <= repositoryTreeEntriesAnsweredMax; each += 1)
    fixtureWrite(fixture, `many/${String(each).padStart(5, "0")}`, "");
  fixtureWrite(fixture, "few/only", "");
  const commit = fixtureCommit(fixture, "many");
  const { trees } = fixtureSource(fixture);
  const many = await trees.list(
    fixtureRequest(fixture, commit, asRepositoryTreeDirectory("many")),
  );
  assert.equal(many.read, "Listed");
  assert.ok(many.read === "Listed");
  assert.equal(many.truncated, true);
  assert.equal(many.entries.length, repositoryTreeEntriesAnsweredMax);
  assert.deepEqual(many.entries[0], {
    name: "00000",
    kind: "File",
    executable: false,
  });
  const few = await trees.list(
    fixtureRequest(fixture, commit, asRepositoryTreeDirectory("few")),
  );
  assert.ok(few.read === "Listed");
  assert.equal(few.truncated, false);
});

test("a commit the remote does not hold is absent, and is not fetched again inside the wait", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, "one.txt", "one\n");
  fixtureCommit(fixture, "one");
  const { source, standIn } = fixtureStoodIn(
    fixture,
    ["fetch", "ls-remote"],
    "fetch",
    "Whole",
  );
  const request = fixtureRequest(fixture, "0".repeat(40));
  assert.deepEqual(await source.trees.list(request), {
    read: "Absent",
    absent: "Commit",
  });
  assert.deepEqual(gitStandInLines(standIn), ["ls-remote", "fetch"]);
  assert.deepEqual(await source.trees.list(request), {
    read: "Absent",
    absent: "Commit",
  });
  assert.deepEqual(gitStandInLines(standIn), ["ls-remote", "fetch"]);
});

test("a commit fetched once is listed again with nothing asked of the remote", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, "one.txt", "one\n");
  const commit = fixtureCommit(fixture, "one");
  const { source, standIn } = fixtureStoodIn(
    fixture,
    ["fetch", "ls-remote"],
    "fetch",
    "Whole",
  );
  const listed = await source.trees.list(fixtureRequest(fixture, commit));
  rmSync(fixture.remote, { recursive: true, force: true });
  assert.deepEqual(
    await source.trees.list(fixtureRequest(fixture, commit)),
    listed,
  );
  assert.deepEqual(gitStandInLines(standIn), ["ls-remote", "fetch"]);
});

test("a remote that refuses is unavailable, says nothing git wrote, and is not asked again inside the wait", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, "one.txt", "one\n");
  const commit = fixtureCommit(fixture, "one");
  const { source, standIn } = fixtureStoodIn(
    fixture,
    ["fetch", "ls-remote"],
    "ls-remote",
    "Said",
  );
  const binding = fixtureBinding(fixture.remote);
  const answers = [
    await source.trees.list(fixtureRequest(fixture, commit)),
    await source.heads.defaultBranch(binding),
  ];
  assert.deepEqual(answers, [{ read: "Unavailable" }, { read: "Unavailable" }]);
  assert.deepEqual(gitStandInLines(standIn), ["ls-remote", "ls-remote"]);
  answers.push(
    await source.trees.list(fixtureRequest(fixture, commit)),
    await source.heads.defaultBranch(binding),
  );
  assert.deepEqual(answers.slice(2), [
    { read: "Unavailable" },
    { read: "Unavailable" },
  ]);
  assert.deepEqual(gitStandInLines(standIn), ["ls-remote", "ls-remote"]);
  assert.equal(JSON.stringify(answers).includes(gitStandInMarker), false);
});

test("a remote nothing can reach, and a credential source that could not answer, are unavailable", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, "one.txt", "one\n");
  const commit = fixtureCommit(fixture, "one");
  const outage = fixtureSource(fixture, {
    credentials: {
      credential: () => Promise.resolve({ resolved: "Unavailable" }),
    },
  });
  assert.deepEqual(await outage.trees.list(fixtureRequest(fixture, commit)), {
    read: "Unavailable",
  });
  const missing = {
    ...fixtureRequest(fixture, commit),
    repository: fixtureBinding(join(fixture.directory, "missing.git")),
  };
  assert.deepEqual(await fixtureSource(fixture).trees.list(missing), {
    read: "Unavailable",
  });
});

test("a fetch that fails saying something is a commit not held, and what git wrote reaches nothing answered", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, "one.txt", "one\n");
  const commit = fixtureCommit(fixture, "one");
  const { source } = fixtureStoodIn(fixture, ["fetch"], "fetch", "Said");
  const answer = await source.trees.list(fixtureRequest(fixture, commit));
  assert.deepEqual(answer, { read: "Absent", absent: "Commit" });
  assert.equal(JSON.stringify(answer).includes(gitStandInMarker), false);
});

test("a listing that fails saying something is never answered with what git wrote", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, "one.txt", "one\n");
  const commit = fixtureCommit(fixture, "one");
  const { source } = fixtureStoodIn(fixture, ["ls-tree"], "ls-tree", "Said");
  const answer = await source.trees.list(fixtureRequest(fixture, commit));
  assert.deepEqual(answer, { read: "Absent", absent: "Commit" });
  assert.equal(JSON.stringify(answer).includes(gitStandInMarker), false);
});

test("an asker whose bound passes while the fetch stalls is a commit not held, and the fetch it began holds the commit for the next", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, "one.txt", "one\n");
  const commit = fixtureCommit(fixture, "one");
  const standIn = join(fixture.directory, "stand-in");
  const path = gitStandInOpen(standIn, ["fetch"]);
  gitStandInFaulted(standIn, "fetch", "Stalled");
  const source = fixtureSource(fixture, {
    environment: { ...process.env, PATH: path },
    answerTimeoutSecsMax: 1,
  });
  assert.deepEqual(await source.trees.list(fixtureRequest(fixture, commit)), {
    read: "Absent",
    absent: "Commit",
  });
  while (!gitStandInLines(standIn).includes("ended"))
    await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(await source.trees.list(fixtureRequest(fixture, commit)), {
    read: "Listed",
    entries: [{ name: "one.txt", kind: "File", executable: false }],
    truncated: false,
  });
  assert.deepEqual(gitStandInLines(standIn), ["fetch", "ended"]);
});

test("a bound or a wait that is not a positive integer is refused at composition", (t) => {
  const fixture = fixtureOpen(t);
  for (const overrides of [
    { answerTimeoutSecsMax: 0 },
    { fetchesInFlightMax: 1.5 },
    { refetchWaitSecs: -1 },
  ])
    assert.throws(() => fixtureSource(fixture, overrides), RangeError);
});
