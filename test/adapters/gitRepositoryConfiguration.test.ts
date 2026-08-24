/** The Git snapshot adapter against real repositories and immutable commits. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";

import { gitRepositoryConfiguration } from "../../src/adapters/git/gitRepositoryConfiguration.ts";
import {
  asGitObjectId,
  asRepositoryCredential,
  asRepositoryId,
  type CredentialResolved,
  type RepositoryBinding,
  type RepositoryCredentialPort,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  repositoryConfigurationDeclarationsMax,
  repositoryConfigurationFileCharsMax,
  repositoryConfigurationRoot,
} from "../../src/interpreter/repositoryConfiguration.ts";

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

function fixtureBinding(repository: string): RepositoryBinding {
  return {
    partition: {
      tenant: asTenantId("tenant"),
      project: asProjectId("project"),
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

function fixturePort(
  fixture: Fixture,
  resolved: CredentialResolved = {
    resolved: "Credential",
    credential: asRepositoryCredential("credential"),
  },
) {
  return gitRepositoryConfiguration({
    scratchDirectory: join(fixture.directory, "scratch"),
    identity: { name: "chug", email: "chug@example.test" },
    environment: process.env,
    credentials: fixtureCredentials(resolved),
  });
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
    { read: "Unavailable", unavailable: "Repository" },
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
    { read: "Unavailable", unavailable: "Credential" },
  );
});

test("the adapter refuses snapshots beyond either collection or content bound", async (t) => {
  const tooMany = fixtureOpen(t);
  for (
    let index = 0;
    index <= repositoryConfigurationDeclarationsMax;
    index += 1
  ) {
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
    "x".repeat(repositoryConfigurationFileCharsMax + 1),
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
