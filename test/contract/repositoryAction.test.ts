/**
 * The action document's schema: what it takes, and every refusal, including a
 * field it has no place for, which is refused rather than dropped.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  repositoryActionDocumentSchema,
  repositoryActionIdentityCharsMax,
  repositoryActionNameCharsMax,
} from "../../src/contract/repositoryAction.ts";
import { repositoryIdentityCharsMax } from "../../src/contract/http.ts";

const document = {
  version: 1,
  action: "deploy-production",
  name: "Deploy to production",
  repository: "github.com/example/service",
};

test("a document naming an identity, a name and a repository is taken whole", () => {
  assert.deepEqual(repositoryActionDocumentSchema.parse(document), document);
});

test("a field the document has no place for is refused rather than dropped", () => {
  for (const extra of [
    { command: "make deploy" },
    { trigger: "push" },
    { runsOn: "cluster" },
  ])
    assert.equal(
      repositoryActionDocumentSchema.safeParse({ ...document, ...extra })
        .success,
      false,
      JSON.stringify(extra),
    );
});

test("a document missing any of its fields is refused", () => {
  for (const key of ["version", "action", "name", "repository"]) {
    const missing: Record<string, unknown> = { ...document };
    delete missing[key];
    assert.equal(
      repositoryActionDocumentSchema.safeParse(missing).success,
      false,
      key,
    );
  }
});

test("an envelope version this tree does not read is refused", () => {
  assert.equal(
    repositoryActionDocumentSchema.safeParse({ ...document, version: 2 })
      .success,
    false,
  );
});

test("an identity that is not a stable token is refused", () => {
  for (const action of [
    "",
    "deploy production",
    "-deploy",
    "deploy-",
    "deploy:production",
    "a".repeat(repositoryActionIdentityCharsMax + 1),
  ])
    assert.equal(
      repositoryActionDocumentSchema.safeParse({ ...document, action }).success,
      false,
      action,
    );
  assert.equal(
    repositoryActionDocumentSchema.safeParse({
      ...document,
      action: "a".repeat(repositoryActionIdentityCharsMax),
    }).success,
    true,
  );
});

test("a name or repository no stored row could hold is refused", () => {
  for (const name of [
    "",
    "\ud800",
    "a\u0000b",
    "a".repeat(repositoryActionNameCharsMax + 1),
  ])
    assert.equal(
      repositoryActionDocumentSchema.safeParse({ ...document, name }).success,
      false,
      JSON.stringify(name),
    );
  for (const repository of ["", "a".repeat(repositoryIdentityCharsMax + 1)])
    assert.equal(
      repositoryActionDocumentSchema.safeParse({ ...document, repository })
        .success,
      false,
      repository,
    );
});
