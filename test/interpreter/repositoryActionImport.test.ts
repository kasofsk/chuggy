/**
 * One commit's action declarations, imported through a reader and a store this
 * suite stands in for: what each read comes to, and that a store is asked only
 * for a set every document of which was read.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asGitObjectId,
  asRepositoryId,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  importRepositoryActions,
  repositoryActionRoot,
  type RepositoryActionDeclaration,
  type RepositoryActionImportOutcome,
  type RepositoryActionsImported,
} from "../../src/interpreter/repositoryAction.ts";
import type { RepositoryDeclarationFile } from "../../src/interpreter/repositoryDeclaration.ts";
import type { RepositoryDeclarationSnapshotRead } from "../../src/interpreter/repositoryDeclarationSnapshot.ts";

const binding: RepositoryBinding = {
  partition: { tenant: asTenantId("acme"), project: asProjectId("atlas") },
  repository: asRepositoryId("https://forge.example/acme/engine.git"),
  recoveryEpoch: asRecoveryEpoch("epoch-1"),
};
const commit = asGitObjectId("a".repeat(40));

function actionFile(action: string, name: string): RepositoryDeclarationFile {
  return {
    path: `${repositoryActionRoot}${action}.json`,
    kind: "File",
    content: JSON.stringify({ version: 1, action, name }),
  };
}

interface Imported {
  readonly outcome: RepositoryActionImportOutcome;
  readonly read: readonly string[];
  readonly stored: readonly (readonly RepositoryActionDeclaration[])[];
}

/** Imports at the commit through a reader answering `read` and a store answering `imported`. */
async function imported(
  read: RepositoryDeclarationSnapshotRead,
  answered: RepositoryActionsImported["imported"] = "Imported",
): Promise<Imported> {
  const asked: string[] = [];
  const stored: (readonly RepositoryActionDeclaration[])[] = [];
  const outcome = await importRepositoryActions({
    binding,
    commit,
    ports: {
      actionSnapshots: {
        actionSnapshot: (request) => {
          asked.push(`${request.repository.repository} ${request.commit}`);
          return Promise.resolve(read);
        },
      },
      actionStore: {
        importRepositoryActions: (input) => {
          assert.deepEqual(input.binding, binding);
          assert.equal(input.commit, commit);
          stored.push(input.declarations);
          return Promise.resolve({ imported: answered });
        },
      },
    },
  });
  return { outcome, read: asked, stored };
}

test("what a commit declares is read at that commit and stored whole", async () => {
  const { outcome, read, stored } = await imported({
    read: "Snapshot",
    files: [actionFile("build", "Build"), actionFile("deploy", "Deploy")],
  });

  assert.deepEqual(outcome, { result: "Imported", declarations: 2 });
  assert.deepEqual(read, [`${binding.repository} ${commit}`]);
  assert.deepEqual(
    stored.map((set) => set.map(({ action, name }) => `${action}=${name}`)),
    [["build=Build", "deploy=Deploy"]],
  );
});

test("a tree declaring nothing is a set of none, stored like any other", async () => {
  const { outcome, stored } = await imported({ read: "Snapshot", files: [] });

  assert.deepEqual(outcome, { result: "Imported", declarations: 0 });
  assert.deepEqual(stored, [[]]);
});

test("one refused document refuses the commit, and the store is asked nothing", async () => {
  const { outcome, stored } = await imported({
    read: "Snapshot",
    files: [
      actionFile("build", "Build"),
      { ...actionFile("deploy", "Deploy"), kind: "Symlink" },
    ],
  });

  assert.deepEqual(outcome, {
    result: "DeclarationsRefused",
    faults: [
      { path: `${repositoryActionRoot}deploy.json`, fault: "SymlinkRefused" },
    ],
  });
  assert.deepEqual(stored, []);
});

test("a read that found no snapshot is reported as what it found, and the store is asked nothing", async () => {
  for (const [read, outcome] of [
    [{ read: "Absent" }, { result: "CommitAbsent" }],
    [
      { read: "Unavailable", unavailable: "Credential" },
      { result: "Unavailable", unavailable: "Credential" },
    ],
    [
      { read: "Unavailable", unavailable: "Repository" },
      { result: "Unavailable", unavailable: "Repository" },
    ],
    [
      {
        read: "Unavailable",
        unavailable: "Credential",
        evidence: { credential: "Unavailable", mint: "Status", status: 500 },
      },
      {
        result: "Unavailable",
        unavailable: "Credential",
        evidence: { credential: "Unavailable", mint: "Status", status: 500 },
      },
    ],
    [
      {
        read: "Unavailable",
        unavailable: "Repository",
        evidence: { git: "ls-remote", stopped: "Timeout" },
      },
      {
        result: "Unavailable",
        unavailable: "Repository",
        evidence: { git: "ls-remote", stopped: "Timeout" },
      },
    ],
    [{ read: "Refused" }, { result: "SnapshotRefused" }],
  ] as const) {
    const found = await imported(read);
    assert.deepEqual(found.outcome, outcome);
    assert.deepEqual(found.stored, []);
  }
});

test("what the store refused is the import's outcome", async () => {
  const files = [actionFile("build", "Build")];
  for (const refused of ["IdentityConflict", "StaleBinding"] as const)
    assert.deepEqual(
      (await imported({ read: "Snapshot", files }, refused)).outcome,
      { result: refused },
    );
});
