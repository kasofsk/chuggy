/** The Git snapshot adapter against real repositories and immutable commits. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test, type TestContext } from "node:test";

import { gitCommitAncestry } from "../../src/adapters/git/gitCommitAncestry.ts";
import {
  gitRepositoryConfiguration,
  gitRepositoryConfigurationReadsInFlightMax,
} from "../../src/adapters/git/gitRepositoryConfiguration.ts";
import {
  gitCredentialHelperText,
  type GitEnvironment,
} from "../../src/adapters/git/gitRun.ts";
import {
  asGitObjectId,
  asRepositoryCredential,
  asRepositoryId,
  type CredentialResolved,
  type GitObjectId,
  type RepositoryBinding,
  type RepositoryCredentialPort,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { repositoryActionRoot } from "../../src/interpreter/repositoryAction.ts";
import { repositoryConfigurationRoot } from "../../src/interpreter/repositoryConfiguration.ts";
import {
  repositoryDeclarationFileCharsMax,
  repositoryDeclarationRoot,
  repositoryDeclarationsMax,
} from "../../src/interpreter/repositoryDeclaration.ts";
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

// jscpd:ignore-start -- this suite owns its real repository lifecycle
function fixtureOpen(t: TestContext): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "chuggy-config-git-"));
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
// jscpd:ignore-end -- fixture lifecycle region ends

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

function fixtureBinding(
  repository: string,
  project = "project",
): RepositoryBinding {
  return {
    partition: {
      tenant: asTenantId("tenant"),
      project: asProjectId(project),
    },
    repository: asRepositoryId(repository),
    recoveryEpoch: asRecoveryEpoch("epoch"),
  };
}

function fixtureCredentials(
  resolved: CredentialResolved,
): RepositoryCredentialPort {
  return { credential: () => Promise.resolve(resolved) };
}

/** The credential every port is given unless a test says otherwise. */
const fixtureCredential: CredentialResolved = {
  resolved: "Credential",
  credential: asRepositoryCredential("credential"),
};

/** The root every port of one fixture opens its scratch beneath. */
function fixtureScratch(fixture: Fixture): string {
  return join(fixture.directory, "scratch");
}

function fixturePort(
  fixture: Fixture,
  resolved: CredentialResolved | RepositoryCredentialPort = fixtureCredential,
  environment: GitEnvironment = process.env,
  remoteTimeoutSecsMax?: number,
) {
  return gitRepositoryConfiguration({
    scratchDirectory: fixtureScratch(fixture),
    identity: { name: "chug", email: "chug@example.test" },
    environment,
    credentials:
      "resolved" in resolved ? fixtureCredentials(resolved) : resolved,
    ...(remoteTimeoutSecsMax === undefined ? {} : { remoteTimeoutSecsMax }),
  });
}

/** A port whose calls of one verb go through the git stand-in one way, every other call reaching git as it is. */
function fixtureStoodIn(
  fixture: Fixture,
  verb: string,
  fault: GitStandInFault,
  remoteTimeoutSecsMax?: number,
) {
  const standIn = join(fixture.directory, "stand-in");
  const path = gitStandInOpen(standIn, [verb]);
  gitStandInFaulted(standIn, verb, fault);
  return fixturePort(
    fixture,
    undefined,
    { ...process.env, PATH: path },
    remoteTimeoutSecsMax,
  );
}

test("a moving branch cannot change a snapshot pinned to an earlier commit", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "old\n");
  const pinned = fixtureCommit(fixture, "old configuration");
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "new\n");
  fixtureCommit(fixture, "new configuration");

  assert.deepEqual(
    await fixturePort(fixture).snapshot({
      repository: fixtureBinding(fixture.remote),
      commit: asGitObjectId(pinned),
    }),
    {
      read: "Snapshot",
      files: [
        {
          path: `${repositoryConfigurationRoot}work.json`,
          kind: "File",
          content: "old\n",
        },
      ],
    },
  );
});

test("symlinks and nested declarations reach the pure parser unchanged", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(
    fixture,
    `${repositoryConfigurationRoot}nested/work.json`,
    "nested\n",
  );
  symlinkSync(
    "nested/work.json",
    join(fixture.seed, `${repositoryConfigurationRoot}link.json`),
  );
  const commit = fixtureCommit(fixture, "path shapes");

  assert.deepEqual(
    await fixturePort(fixture).snapshot({
      repository: fixtureBinding(fixture.remote),
      commit: asGitObjectId(commit),
    }),
    {
      read: "Snapshot",
      files: [
        {
          path: `${repositoryConfigurationRoot}link.json`,
          kind: "Symlink",
          content: "nested/work.json",
        },
        {
          path: `${repositoryConfigurationRoot}nested/work.json`,
          kind: "File",
          content: "nested\n",
        },
      ],
    },
  );
});

test("non-JSON files beside declarations are ignored", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(
    fixture,
    `${repositoryConfigurationRoot}README.md`,
    "Repository configuration declarations.\n",
  );
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "work\n");
  const commit = fixtureCommit(fixture, "documented declaration");

  assert.deepEqual(
    await fixturePort(fixture).snapshot({
      repository: fixtureBinding(fixture.remote),
      commit: asGitObjectId(commit),
    }),
    {
      read: "Snapshot",
      files: [
        {
          path: `${repositoryConfigurationRoot}work.json`,
          kind: "File",
          content: "work\n",
        },
      ],
    },
  );
});

/** A tree whose `.chug/` holds a format no import reads, beside whatever `configurations` it is given. */
function fixtureOtherFormat(fixture: Fixture): void {
  const chug = repositoryDeclarationRoot;
  fixtureWrite(fixture, `${chug}project.yaml`, "version: 2\n");
  fixtureWrite(fixture, `${chug}workloads/build.yaml`, "build\n");
  fixtureWrite(fixture, `${chug}workloads/test.yaml`, "test\n");
  fixtureWrite(fixture, `${chug}evaluators/review.yaml`, "review\n");
  fixtureWrite(fixture, "README.md", "outside\n");
}

test("a `.chug/` declaring no configuration names what it holds instead, each directory once and nothing outside it", async (t) => {
  const chug = repositoryDeclarationRoot;
  const fixture = fixtureOpen(t);
  fixtureOtherFormat(fixture);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}notes.txt`, "notes\n");
  const bare = fixtureCommit(fixture, "another format");
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "work\n");
  const declared = fixtureCommit(fixture, "and a declaration");
  const port = fixturePort(fixture);
  const repository = fixtureBinding(fixture.remote);
  const others = [
    `${chug}evaluators/`,
    `${chug}project.yaml`,
    `${chug}workloads/`,
  ];

  assert.deepEqual(
    await port.snapshot({ repository, commit: asGitObjectId(bare) }),
    {
      read: "Absent",
      absent: "ConfigurationDirectory",
      ignored: {
        paths: [`${repositoryConfigurationRoot}notes.txt`, ...others].sort(),
        truncated: false,
      },
    },
  );
  assert.deepEqual(
    await port.snapshot({ repository, commit: asGitObjectId(declared) }),
    {
      read: "Snapshot",
      files: [
        {
          path: `${repositoryConfigurationRoot}work.json`,
          kind: "File",
          content: "work\n",
        },
      ],
    },
  );
  assert.deepEqual(
    await port.actionSnapshot({ repository, commit: asGitObjectId(bare) }),
    { read: "Snapshot", files: [] },
  );
});

test("a `.chug/` too large to list is said to be, and refuses none of the configurations later beside it", async (t) => {
  const fixture = fixtureOpen(t);
  for (let index = 0; index <= repositoryDeclarationsMax * 2; index += 1)
    fixtureWrite(
      fixture,
      `${repositoryDeclarationRoot}${String(index).padStart(240, "0")}.yaml`,
      "",
    );
  const crowded = fixtureCommit(fixture, "a crowded directory");
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "work\n");
  const declared = fixtureCommit(fixture, "and a declaration");
  const port = fixturePort(fixture);
  const repository = fixtureBinding(fixture.remote);

  assert.deepEqual(
    await port.snapshot({ repository, commit: asGitObjectId(crowded) }),
    {
      read: "Absent",
      absent: "ConfigurationDirectory",
      ignored: { paths: [], truncated: true },
    },
  );
  const read = await port.snapshot({
    repository,
    commit: asGitObjectId(declared),
  });
  assert.deepEqual(
    read.read === "Snapshot" ? read.files.map((file) => file.path) : read,
    [`${repositoryConfigurationRoot}work.json`],
  );
});

test("an absent directory and an absent commit are distinct", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, "README.md", "empty\n");
  const commit = fixtureCommit(fixture, "no declarations");
  const port = fixturePort(fixture);
  const repository = fixtureBinding(fixture.remote);

  assert.deepEqual(
    await port.snapshot({ repository, commit: asGitObjectId(commit) }),
    { read: "Absent", absent: "ConfigurationDirectory" },
  );
  assert.deepEqual(
    await port.snapshot({ repository, commit: asGitObjectId("f".repeat(40)) }),
    { read: "Absent", absent: "Commit" },
  );
});

test("an unreachable repository is unavailable", async (t) => {
  const fixture = fixtureOpen(t);
  assert.deepEqual(
    await fixturePort(fixture).snapshot({
      repository: fixtureBinding(join(fixture.directory, "missing.git")),
      commit: asGitObjectId("f".repeat(40)),
    }),
    {
      read: "Unavailable",
      unavailable: "Repository",
      evidence: { git: "ls-remote", exited: 128 },
    },
  );
});

test("an unmapped repository needs no credential while an outage remains distinct", async (t) => {
  const fixture = fixtureOpen(t);
  const request = {
    repository: fixtureBinding(fixture.remote),
    commit: asGitObjectId("f".repeat(40)),
  };
  assert.deepEqual(
    await fixturePort(fixture, { resolved: "Denied" }).snapshot(request),
    { read: "Absent", absent: "Commit" },
  );
  assert.deepEqual(
    await fixturePort(fixture, { resolved: "Unavailable" }).snapshot(request),
    {
      read: "Unavailable",
      unavailable: "Credential",
      evidence: { credential: "Unavailable" },
    },
  );
});

test("the adapter refuses snapshots beyond either collection or content bound", async (t) => {
  const tooMany = fixtureOpen(t);
  for (let index = 0; index <= repositoryDeclarationsMax; index += 1) {
    fixtureWrite(
      tooMany,
      `.chug/configurations/${String(index).padStart(3, "0")}.json`,
      "{}",
    );
  }
  const tooManyCommit = fixtureCommit(tooMany, "too many declarations");
  assert.deepEqual(
    await fixturePort(tooMany).snapshot({
      repository: fixtureBinding(tooMany.remote),
      commit: asGitObjectId(tooManyCommit),
    }),
    { read: "Refused", refused: "Snapshot" },
  );

  const tooLarge = fixtureOpen(t);
  fixtureWrite(
    tooLarge,
    `${repositoryConfigurationRoot}large.json`,
    "x".repeat(repositoryDeclarationFileCharsMax + 1),
  );
  const tooLargeCommit = fixtureCommit(tooLarge, "large declaration");
  assert.deepEqual(
    await fixturePort(tooLarge).snapshot({
      repository: fixtureBinding(tooLarge.remote),
      commit: asGitObjectId(tooLargeCommit),
    }),
    { read: "Refused", refused: "Snapshot" },
  );
});

test("the head read answers the branch the remote's own HEAD points at", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "one\n");
  const first = fixtureCommit(fixture, "one");
  assert.deepEqual(
    await fixturePort(fixture).defaultBranch(fixtureBinding(fixture.remote)),
    {
      read: "Branch",
      branch: "refs/heads/main",
      commit: asGitObjectId(first),
    },
  );
});

test("the head moves with the branch, because it is read and not remembered", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "one\n");
  fixtureCommit(fixture, "one");
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "two\n");
  const second = fixtureCommit(fixture, "two");
  const read = await fixturePort(fixture).defaultBranch(
    fixtureBinding(fixture.remote),
  );
  assert.equal(read.read === "Branch" ? read.commit : undefined, second);
});

test("a repository holding no commit is absent rather than an outage", async (t) => {
  const fixture = fixtureOpen(t);
  assert.deepEqual(
    await fixturePort(fixture).defaultBranch(fixtureBinding(fixture.remote)),
    { read: "Absent" },
  );
});

test("a remote nothing can reach is an outage and not an absent head", async (t) => {
  const fixture = fixtureOpen(t);
  assert.deepEqual(
    await fixturePort(fixture).defaultBranch(
      fixtureBinding(join(fixture.directory, "no-such.git")),
    ),
    { read: "Unavailable", evidence: { git: "ls-remote", exited: 128 } },
  );
});

test("a credential source that could not answer stops the head read", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "one\n");
  fixtureCommit(fixture, "one");
  assert.deepEqual(
    await fixturePort(fixture, { resolved: "Unavailable" }).defaultBranch(
      fixtureBinding(fixture.remote),
    ),
    { read: "Unavailable", evidence: { credential: "Unavailable" } },
  );
});

test("a credential the mint could not give says why, and no git runs", async (t) => {
  const fixture = fixtureOpen(t);
  for (const evidence of [
    { mint: "Status", status: 500 },
    { mint: "Throttle", status: 403 },
    { mint: "Key" },
  ] as const)
    assert.deepEqual(
      await fixturePort(fixture, {
        resolved: "Unavailable",
        evidence,
      }).defaultBranch(fixtureBinding(join(fixture.directory, "no-such.git"))),
      {
        read: "Unavailable",
        evidence: { credential: "Unavailable", ...evidence },
      },
    );
});

test("a denied credential and the git that then failed without one are both said", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, {
    resolved: "Denied",
    evidence: { mint: "Status", status: 404 },
  });
  const missing = fixtureBinding(join(fixture.directory, "no-such.git"));
  const both = {
    credential: "Denied",
    mint: "Status",
    status: 404,
    git: "ls-remote",
    exited: 128,
  };
  assert.deepEqual(await port.defaultBranch(missing), {
    read: "Unavailable",
    evidence: both,
  });
  assert.deepEqual(
    await port.snapshot({
      repository: missing,
      commit: asGitObjectId("f".repeat(40)),
    }),
    { read: "Unavailable", unavailable: "Repository", evidence: both },
  );
});

test("an ls-remote that outlived its bound says it timed out, on the head and on a snapshot's probe", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "one\n");
  const commit = asGitObjectId(fixtureCommit(fixture, "one"));
  const port = fixtureStoodIn(fixture, "ls-remote", "Stalled", 1);
  const repository = fixtureBinding(fixture.remote);
  const evidence = { git: "ls-remote", stopped: "Timeout" };

  assert.deepEqual(await port.defaultBranch(repository), {
    read: "Unavailable",
    evidence,
  });
  assert.deepEqual(await port.snapshot({ repository, commit }), {
    read: "Unavailable",
    unavailable: "Repository",
    evidence,
  });
  assert.deepEqual(await port.actionSnapshot({ repository, commit }), {
    read: "Unavailable",
    unavailable: "Repository",
    evidence,
  });
});

test("what git wrote when it failed reaches nothing the read answers", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "one\n");
  const commit = asGitObjectId(fixtureCommit(fixture, "one"));
  const port = fixtureStoodIn(fixture, "ls-remote", "Said");
  const repository = fixtureBinding(fixture.remote);

  const answers = [
    await port.defaultBranch(repository),
    await port.snapshot({ repository, commit }),
    await port.actionSnapshot({ repository, commit }),
  ];
  for (const answer of answers) {
    assert.deepEqual(answer.read === "Unavailable" ? answer.evidence : answer, {
      git: "ls-remote",
      exited: 128,
    });
    assert.equal(JSON.stringify(answer).includes(gitStandInMarker), false);
  }
});

/** What the action directory holds at one commit of the fixture's remote. */
function fixtureActions(fixture: Fixture, commit: string) {
  return fixturePort(fixture).actionSnapshot({
    repository: fixtureBinding(fixture.remote),
    commit: asGitObjectId(commit),
  });
}

test("a tree holding no action directory declares none, and neither does one holding only its page", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "work\n");
  const bare = fixtureCommit(fixture, "no action directory");
  fixtureWrite(fixture, `${repositoryActionRoot}README.md`, "Actions.\n");
  const documented = fixtureCommit(fixture, "only the page");

  for (const commit of [bare, documented])
    assert.deepEqual(await fixtureActions(fixture, commit), {
      read: "Snapshot",
      files: [],
    });
});

test("each directory is read for itself, at the commit named", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "work\n");
  fixtureWrite(fixture, `${repositoryActionRoot}build.json`, "old\n");
  const pinned = fixtureCommit(fixture, "one of each");
  fixtureWrite(fixture, `${repositoryActionRoot}build.json`, "new\n");
  fixtureWrite(fixture, `${repositoryActionRoot}deploy.json`, "deploy\n");
  fixtureCommit(fixture, "the actions moved");

  assert.deepEqual(await fixtureActions(fixture, pinned), {
    read: "Snapshot",
    files: [
      {
        path: `${repositoryActionRoot}build.json`,
        kind: "File",
        content: "old\n",
      },
    ],
  });
  const configurations = await fixturePort(fixture).snapshot({
    repository: fixtureBinding(fixture.remote),
    commit: asGitObjectId(pinned),
  });
  assert.deepEqual(
    configurations.read === "Snapshot"
      ? configurations.files.map((file) => file.path)
      : configurations,
    [`${repositoryConfigurationRoot}work.json`],
  );
});

test("a symlink and a nested document under the action directory reach its reader as they are", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryActionRoot}nested/build.json`, "nested\n");
  symlinkSync(
    "nested/build.json",
    join(fixture.seed, `${repositoryActionRoot}link.json`),
  );
  const commit = fixtureCommit(fixture, "path shapes");

  const read = await fixtureActions(fixture, commit);
  assert.deepEqual(
    read.read === "Snapshot"
      ? read.files.map((file) => `${file.kind} ${file.path}`)
      : read,
    [
      `Symlink ${repositoryActionRoot}link.json`,
      `File ${repositoryActionRoot}nested/build.json`,
    ],
  );
});

test("a commit the repository does not hold, and a repository or a credential that cannot be reached, are told apart for the action directory", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryActionRoot}build.json`, "build\n");
  fixtureCommit(fixture, "one action");
  const request = {
    repository: fixtureBinding(fixture.remote),
    commit: asGitObjectId("f".repeat(40)),
  };

  assert.deepEqual(await fixturePort(fixture).actionSnapshot(request), {
    read: "Absent",
  });
  assert.deepEqual(
    await fixturePort(fixture).actionSnapshot({
      ...request,
      repository: fixtureBinding(join(fixture.directory, "missing.git")),
    }),
    {
      read: "Unavailable",
      unavailable: "Repository",
      evidence: { git: "ls-remote", exited: 128 },
    },
  );
  assert.deepEqual(
    await fixturePort(fixture, { resolved: "Unavailable" }).actionSnapshot(
      request,
    ),
    {
      read: "Unavailable",
      unavailable: "Credential",
      evidence: { credential: "Unavailable" },
    },
  );
});

test("an action directory past either bound of one read is refused", async (t) => {
  const tooMany = fixtureOpen(t);
  for (let index = 0; index <= repositoryDeclarationsMax; index += 1)
    fixtureWrite(tooMany, `${repositoryActionRoot}${String(index)}.json`, "{}");
  const tooLarge = fixtureOpen(t);
  fixtureWrite(
    tooLarge,
    `${repositoryActionRoot}large.json`,
    "x".repeat(repositoryDeclarationFileCharsMax + 1),
  );

  for (const fixture of [tooMany, tooLarge])
    assert.deepEqual(
      await fixtureActions(fixture, fixtureCommit(fixture, "past a bound")),
      { read: "Refused" },
    );
});

test("an action directory holding as many documents as one read takes is read whole", async (t) => {
  const fixture = fixtureOpen(t);
  for (let index = 0; index < repositoryDeclarationsMax; index += 1)
    fixtureWrite(fixture, `${repositoryActionRoot}${String(index)}.json`, "{}");

  const read = await fixtureActions(fixture, fixtureCommit(fixture, "full"));
  assert.equal(
    read.read === "Snapshot" ? read.files.length : read.read,
    repositoryDeclarationsMax,
  );
});

/** Where the reference tests write the files a catalog would name. */
const promptRoot = `${repositoryDeclarationRoot}prompts/`;

test("a referenced path is read exactly: a file's text, a symbolic link, and nothing a file as absent", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${promptRoot}work.md`, "Do the work.\n");
  fixtureWrite(fixture, `${promptRoot}nested/review.md`, "Review it.\n");
  symlinkSync("work.md", join(fixture.seed, `${promptRoot}link.md`));
  fixtureWrite(
    fixture,
    `${promptRoot}large.md`,
    "x".repeat(repositoryDeclarationFileCharsMax + 1),
  );
  const commit = fixtureCommit(fixture, "referenced files");

  assert.deepEqual(
    await fixturePort(fixture).referenced(
      {
        repository: fixtureBinding(fixture.remote),
        commit: asGitObjectId(commit),
      },
      [
        `${promptRoot}work.md`,
        `${promptRoot}link.md`,
        `${promptRoot}nested`,
        `${promptRoot}*.md`,
        `${promptRoot}missing.md`,
        `${promptRoot}large.md`,
      ],
    ),
    {
      read: "Referenced",
      files: [
        {
          path: `${promptRoot}work.md`,
          found: "File",
          content: "Do the work.\n",
        },
        { path: `${promptRoot}link.md`, found: "Symlink" },
        { path: `${promptRoot}nested`, found: "Absent" },
        { path: `${promptRoot}*.md`, found: "Absent" },
        { path: `${promptRoot}missing.md`, found: "Absent" },
        { path: `${promptRoot}large.md`, found: "TooLarge" },
      ],
    },
  );
});

test("a referenced read of a commit the remote does not hold says so as a snapshot does", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${promptRoot}work.md`, "Do the work.\n");
  fixtureCommit(fixture, "referenced files");

  assert.deepEqual(
    await fixturePort(fixture).referenced(
      {
        repository: fixtureBinding(fixture.remote),
        commit: asGitObjectId("b".repeat(40)),
      },
      [`${promptRoot}work.md`],
    ),
    { read: "Absent", absent: "Commit" },
  );
});

/** Has the fixture's remote honour a filter, as a forge does, so a fetch asking for less than everything is given less. */
function fixtureFiltering(fixture: Fixture): void {
  fixtureGit(fixture.remote, "config", "uploadpack.allowFilter", "true");
}

/** The blob one path stands at in one commit of the seed. */
function fixtureBlob(fixture: Fixture, commit: string, path: string): string {
  return fixtureGit(fixture.seed, "rev-parse", `${commit}:${path}`);
}

/** Every repository under the scratch root. */
function fixtureRepositories(fixture: Fixture): string[] {
  const root = fixtureScratch(fixture);
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => basename(entry) === "HEAD")
    .map((entry) => join(root, dirname(entry)))
    .filter((repository) => existsSync(join(repository, "objects")));
}

/**
 * Every object of one type held in any repository under the scratch root,
 * listed from each object store alone, which no listing fetches into.
 */
function fixtureHeld(fixture: Fixture, type: "commit" | "blob"): string[] {
  return fixtureRepositories(fixture)
    .flatMap((repository) =>
      fixtureGit(
        repository,
        "cat-file",
        "--batch-all-objects",
        "--batch-check=%(objecttype) %(objectname)",
      ).split("\n"),
    )
    .filter((row) => row.startsWith(`${type} `))
    .map((row) => row.slice(type.length + 1))
    .sort();
}

test("a read holds the commit it is asked at and the files it read, and no earlier commit and no file beside them", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureFiltering(fixture);
  const work = `${repositoryConfigurationRoot}work.json`;
  fixtureWrite(fixture, work, "old\n");
  fixtureWrite(fixture, "large.bin", "old\n".repeat(1 << 18));
  fixtureCommit(fixture, "earlier");
  fixtureWrite(fixture, work, "new\n");
  fixtureWrite(fixture, "large.bin", "new\n".repeat(1 << 18));
  const commit = fixtureCommit(fixture, "read");

  assert.deepEqual(
    await fixturePort(fixture).snapshot({
      repository: fixtureBinding(fixture.remote),
      commit: asGitObjectId(commit),
    }),
    {
      read: "Snapshot",
      files: [{ path: work, kind: "File", content: "new\n" }],
    },
  );
  assert.deepEqual(fixtureHeld(fixture, "commit"), [commit]);
  assert.deepEqual(fixtureHeld(fixture, "blob"), [
    fixtureBlob(fixture, commit, work),
  ]);
});

test("from a remote honouring the filter, each file arrives as its directory or its path is read, and none before", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureFiltering(fixture);
  const nested = `${repositoryConfigurationRoot}nested/work.json`;
  const link = `${repositoryConfigurationRoot}link.json`;
  const build = `${repositoryActionRoot}build.json`;
  fixtureWrite(fixture, nested, "nested\n");
  symlinkSync("nested/work.json", join(fixture.seed, link));
  fixtureWrite(fixture, build, "build\n");
  fixtureWrite(fixture, `${promptRoot}work.md`, "Do the work.\n");
  fixtureWrite(
    fixture,
    `${promptRoot}large.md`,
    "x".repeat(repositoryDeclarationFileCharsMax + 1),
  );
  const commit = fixtureCommit(fixture, "one of each");
  const port = fixturePort(fixture);
  const request = {
    repository: fixtureBinding(fixture.remote),
    commit: asGitObjectId(commit),
  };
  const blobs = (...paths: string[]) =>
    paths.map((path) => fixtureBlob(fixture, commit, path)).sort();

  assert.deepEqual(await port.actionSnapshot(request), {
    read: "Snapshot",
    files: [{ path: build, kind: "File", content: "build\n" }],
  });
  assert.deepEqual(fixtureHeld(fixture, "blob"), blobs(build));
  assert.deepEqual(await port.snapshot(request), {
    read: "Snapshot",
    files: [
      { path: link, kind: "Symlink", content: "nested/work.json" },
      { path: nested, kind: "File", content: "nested\n" },
    ],
  });
  assert.deepEqual(fixtureHeld(fixture, "blob"), blobs(build, link, nested));
  assert.deepEqual(
    await port.referenced(request, [
      `${promptRoot}work.md`,
      `${promptRoot}large.md`,
    ]),
    {
      read: "Referenced",
      files: [
        {
          path: `${promptRoot}work.md`,
          found: "File",
          content: "Do the work.\n",
        },
        { path: `${promptRoot}large.md`, found: "TooLarge" },
      ],
    },
  );
});

/**
 * What the remote runs in place of building a pack directly: it writes the
 * secret the fetch that asked was given, read through the adapter's own
 * helper text, pauses as long as it is told, and then builds the pack.
 */
function fixtureServeText(pauseSecs: number): string {
  return [
    "#!/bin/sh",
    'here=$(dirname "$0")',
    '"$here/helper" get | grep "^password=" >> "$here/served"',
    `sleep ${String(pauseSecs)}`,
    'exec "$@"',
    "",
  ].join("\n");
}

/** The environment of a port whose remote writes the secret of each fetch it serves a pack to, in order, and can take a while over each pack, so that a fetch holds what it locks while another read could reach it. */
function fixtureServing(fixture: Fixture, pauseSecs = 0): GitEnvironment {
  const here = fixture.directory;
  writeFileSync(join(here, "helper"), gitCredentialHelperText, { mode: 0o700 });
  writeFileSync(join(here, "serve"), fixtureServeText(pauseSecs), {
    mode: 0o755,
  });
  writeFileSync(
    join(here, "gitconfig"),
    `[uploadpack]\n\tpackObjectsHook = ${join(here, "serve")}\n`,
  );
  return { ...process.env, GIT_CONFIG_GLOBAL: join(here, "gitconfig") };
}

/** The secret each fetch the remote served a pack to was given, in the order served. */
function fixtureServed(fixture: Fixture): readonly string[] {
  const served = join(fixture.directory, "served");
  if (!existsSync(served)) return [];
  return readFileSync(served, "utf8").split("\n").filter(Boolean);
}

test("the commit and each blob a read fetches are fetched under the one credential", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureFiltering(fixture);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}build.json`, "build\n");
  fixtureWrite(fixture, `${repositoryConfigurationRoot}test.json`, "test\n");
  const commit = asGitObjectId(fixtureCommit(fixture, "two declarations"));
  const port = fixturePort(fixture, fixtureCredential, fixtureServing(fixture));

  const read = await port.snapshot({
    repository: fixtureBinding(fixture.remote),
    commit,
  });
  assert.deepEqual(
    read.read === "Snapshot" ? read.files.map((file) => file.content) : read,
    ["build\n", "test\n"],
  );
  assert.deepEqual(
    fixtureServed(fixture),
    ["password=credential", "password=credential", "password=credential"],
    "the commit and each of its blobs were served to a fetch given the credential",
  );
});

test("a read leaves the history the ancestry reader answers from whole, under the scratch root they share", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureFiltering(fixture);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "old\n");
  const earlier = asGitObjectId(fixtureCommit(fixture, "earlier"));
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "new\n");
  const tip = asGitObjectId(fixtureCommit(fixture, "tip"));
  const repository = fixtureBinding(fixture.remote);
  const ancestry = gitCommitAncestry({
    scratchDirectory: fixtureScratch(fixture),
    identity: { name: "chug", email: "chug@example.test" },
    environment: process.env,
    credentials: fixtureCredentials(fixtureCredential),
  });

  const read = await fixturePort(fixture).snapshot({ repository, commit: tip });
  assert.equal(read.read, "Snapshot");
  assert.equal(
    await ancestry.ancestry({ repository, candidate: earlier, tip }),
    "Ancestor",
  );
});

test("a blob of the commit that could not be fetched is a commit not held yet, and never a refusal", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureFiltering(fixture);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "work\n");
  fixtureWrite(fixture, `${repositoryActionRoot}build.json`, "build\n");
  fixtureWrite(fixture, `${promptRoot}work.md`, "Do the work.\n");
  const port = fixtureStoodIn(fixture, "cat-file", "Failed");
  const request = {
    repository: fixtureBinding(fixture.remote),
    commit: asGitObjectId(fixtureCommit(fixture, "one of each")),
  };

  assert.deepEqual(await port.snapshot(request), {
    read: "Absent",
    absent: "Commit",
  });
  assert.deepEqual(await port.actionSnapshot(request), { read: "Absent" });
  assert.deepEqual(await port.referenced(request, [`${promptRoot}work.md`]), {
    read: "Absent",
    absent: "Commit",
  });
});

test("reads of one repository begun together each answer their own commit, whether another or the same", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureFiltering(fixture);
  const work = `${repositoryConfigurationRoot}work.json`;
  fixtureWrite(fixture, work, "earlier\n");
  const earlier = asGitObjectId(fixtureCommit(fixture, "earlier"));
  fixtureWrite(fixture, work, "later\n");
  const later = asGitObjectId(fixtureCommit(fixture, "later"));
  const port = fixturePort(
    fixture,
    fixtureCredential,
    fixtureServing(fixture, 1),
  );
  const together = async (...commits: GitObjectId[]) =>
    (
      await Promise.all(
        commits.map((commit) =>
          port.snapshot({ repository: fixtureBinding(fixture.remote), commit }),
        ),
      )
    ).map((read) =>
      read.read === "Snapshot" ? read.files.map((file) => file.content) : read,
    );

  assert.deepEqual(
    [await together(earlier, later), await together(later, later)],
    [
      [["earlier\n"], ["later\n"]],
      [["later\n"], ["later\n"]],
    ],
  );
});

/** The environment of a port whose scratch is housekept at every pack past its first, by gc on every git, each housekeeping writing that it began and then taking a while before it does anything. */
function fixtureHousekeeping(fixture: Fixture): GitEnvironment {
  const hooks = join(fixture.directory, "hooks");
  mkdirSync(hooks);
  writeFileSync(
    join(hooks, "pre-auto-gc"),
    `#!/bin/sh\necho begun >> "${join(fixture.directory, "housekept")}"\nsleep 1\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(fixture.directory, "housekeeping-gitconfig"),
    `[gc]\n\tautoPackLimit = 1\n[maintenance]\n\tstrategy = gc\n[core]\n\thooksPath = ${hooks}\n`,
  );
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(fixture.directory, "housekeeping-gitconfig"),
  };
}

/** The packs each repository under the scratch root holds, counted from its object store alone. */
function fixturePacks(fixture: Fixture): number[] {
  return fixtureRepositories(fixture).map((repository) =>
    Number(
      /^packs: (\d+)$/mu.exec(
        fixtureGit(repository, "count-objects", "-v"),
      )?.[1],
    ),
  );
}

test("a read answers once the housekeeping its fetches set off has ended, and leaves none running after it", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureFiltering(fixture);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "work\n");
  const commit = asGitObjectId(fixtureCommit(fixture, "work"));
  const port = fixturePort(
    fixture,
    fixtureCredential,
    fixtureHousekeeping(fixture),
  );

  assert.deepEqual(
    await port.snapshot({ repository: fixtureBinding(fixture.remote), commit }),
    {
      read: "Snapshot",
      files: [
        {
          path: `${repositoryConfigurationRoot}work.json`,
          kind: "File",
          content: "work\n",
        },
      ],
    },
  );
  assert.ok(
    existsSync(join(fixture.directory, "housekept")),
    "the read's fetches set housekeeping off",
  );
  assert.deepEqual(
    fixturePacks(fixture),
    [1],
    "the housekeeping had packed the scratch whole when the read answered",
  );
});

/** A read as the shape of its answer alone, which is what reads begun together are told apart by. */
function fixtureAnswer(read: {
  readonly read: string;
  readonly absent?: string;
}): string {
  return read.absent === undefined ? read.read : `${read.read}/${read.absent}`;
}

test("a read begun while as many reads of its repository as may be are in flight is a commit not held yet at once, and runs no git", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "work\n");
  const commit = asGitObjectId(fixtureCommit(fixture, "work"));
  const port = fixtureStoodIn(fixture, "ls-remote", "Stalled", 1);
  const answered: number[] = [];

  const answers = await Promise.all(
    Array.from(
      { length: gitRepositoryConfigurationReadsInFlightMax + 1 },
      async (_, begun) => {
        const read = await port.snapshot({
          repository: fixtureBinding(fixture.remote),
          commit,
        });
        answered.push(begun);
        return fixtureAnswer(read);
      },
    ),
  );
  assert.deepEqual(answers, [
    ...Array<string>(gitRepositoryConfigurationReadsInFlightMax).fill(
      "Unavailable",
    ),
    "Absent/Commit",
  ]);
  assert.equal(
    answered[0],
    gitRepositoryConfigurationReadsInFlightMax,
    "the read begun past the count answered before any read it found in flight",
  );
  assert.equal(
    gitStandInLines(join(fixture.directory, "stand-in")).filter(
      (line) => line === "ls-remote",
    ).length,
    gitRepositoryConfigurationReadsInFlightMax,
    "the read begun past the count asked the remote nothing",
  );
});

test("probes of one repository begun together that stall each stop at their own bound, and none waits for another", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "work\n");
  const commit = asGitObjectId(fixtureCommit(fixture, "work"));
  const boundSecs = 1;
  const port = fixtureStoodIn(fixture, "ls-remote", "Stalled", boundSecs);
  const begunMs = performance.now();

  const answers = await Promise.all(
    Array.from(
      { length: gitRepositoryConfigurationReadsInFlightMax },
      async () => {
        const read = await port.snapshot({
          repository: fixtureBinding(fixture.remote),
          commit,
        });
        return {
          answer: fixtureAnswer(read),
          secs: (performance.now() - begunMs) / 1000,
        };
      },
    ),
  );
  assert.deepEqual(
    answers.map(({ answer }) => answer),
    Array<string>(gitRepositoryConfigurationReadsInFlightMax).fill(
      "Unavailable",
    ),
  );
  const slowestSecs = Math.max(...answers.map(({ secs }) => secs));
  assert.ok(
    slowestSecs < 2 * boundSecs,
    `the slowest probe answered after ${String(slowestSecs)}s, past one bound of its own`,
  );
});

test("a read fetches under a credential resolved once its turn has come, after the read before it has ended", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureFiltering(fixture);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "work\n");
  const commit = asGitObjectId(fixtureCommit(fixture, "work"));
  const environment = fixtureServing(fixture, 1);
  let minted = 0;
  const port = fixturePort(
    fixture,
    {
      credential: () => {
        minted += 1;
        const credential = `credential-${String(minted)}`;
        appendFileSync(
          join(fixture.directory, "served"),
          `minted=${credential}\n`,
        );
        return Promise.resolve({
          resolved: "Credential",
          credential: asRepositoryCredential(credential),
        });
      },
    },
    environment,
  );
  const read = () =>
    port.snapshot({ repository: fixtureBinding(fixture.remote), commit });

  assert.deepEqual((await Promise.all([read(), read()])).map(fixtureAnswer), [
    "Snapshot",
    "Snapshot",
  ]);
  assert.deepEqual(fixtureServed(fixture), [
    "minted=credential-1",
    "minted=credential-2",
    "minted=credential-3",
    "password=credential-3",
    "password=credential-3",
    "minted=credential-4",
    "password=credential-4",
  ]);
});

test("a credential source that raises once a read's turn has come ends that read alone, and leaves no read of it counted", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureWrite(fixture, `${repositoryConfigurationRoot}work.json`, "work\n");
  const commit = asGitObjectId(fixtureCommit(fixture, "work"));
  const calls = new Map<string, number>();
  const held = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const port = fixturePort(fixture, {
    credential: async (binding) => {
      const project = binding.partition.project;
      const call = (calls.get(project) ?? 0) + 1;
      calls.set(project, call);
      if (project === "project" || call % 2 === 1) return fixtureCredential;
      if (project === "held") {
        held.resolve(undefined);
        await release.promise;
      }
      throw new Error("the credential source raised");
    },
  });
  const read = (project?: string) =>
    port.snapshot({
      repository: fixtureBinding(fixture.remote, project),
      commit,
    });
  const snapshot = {
    read: "Snapshot",
    files: [
      {
        path: `${repositoryConfigurationRoot}work.json`,
        kind: "File",
        content: "work\n",
      },
    ],
  };

  const raising = read("held");
  const timer = setTimeout(() => {
    held.reject(new Error("the read never resolved a credential in its turn"));
  }, 10_000);
  t.after(() => {
    clearTimeout(timer);
  });
  await held.promise;
  const queued = read();
  release.resolve(undefined);
  await assert.rejects(raising, /the credential source raised/u);
  assert.deepEqual(await queued, snapshot);
  for (
    let raised = 0;
    raised < gitRepositoryConfigurationReadsInFlightMax;
    raised++
  )
    await assert.rejects(read("raising"), /the credential source raised/u);
  assert.deepEqual(await read(), snapshot);
});
