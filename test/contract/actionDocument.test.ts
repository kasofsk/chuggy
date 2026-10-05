import assert from "node:assert/strict";
import test from "node:test";

import {
  actionDisplayNameCharsMax,
  actionDocumentSchema,
  actionRepositoryCharsMax,
} from "../../src/contract/actionDocument.ts";
import { repositoryConfigurationNameCharsMax } from "../../src/contract/http.ts";
import { finalizerIdentityCharsMax } from "../../src/interpreter/finalizer.ts";

const accepted = {
  version: 1,
  action: "deploy-staging",
  name: "Deploy to staging",
  repository: "acme/engine",
};

test("an action document names its identity, a display name and a repository", () => {
  assert.deepEqual(actionDocumentSchema.parse(accepted), accepted);
});

test("a field the document has no place for is refused rather than dropped", () => {
  for (const extra of [
    { trigger: "push" },
    { command: "./deploy.sh" },
    { environment: "staging" },
  ])
    assert.equal(
      actionDocumentSchema.safeParse({ ...accepted, ...extra }).success,
      false,
      JSON.stringify(extra),
    );
});

test("a missing field, another version, and malformed text are refused", () => {
  for (const key of ["version", "action", "name", "repository"]) {
    const rest: Record<string, unknown> = { ...accepted };
    delete rest[key];
    assert.equal(actionDocumentSchema.safeParse(rest).success, false, key);
  }
  for (const refused of [
    { version: 2 },
    { action: "" },
    { action: "deploy staging" },
    { action: "-deploy" },
    { action: "a".repeat(repositoryConfigurationNameCharsMax + 1) },
    { name: "" },
    { name: "x".repeat(actionDisplayNameCharsMax + 1) },
    { name: "\uD800" },
    { repository: "" },
    { repository: "acme\0engine" },
    { repository: "r".repeat(actionRepositoryCharsMax + 1) },
  ])
    assert.equal(
      actionDocumentSchema.safeParse({ ...accepted, ...refused }).success,
      false,
      JSON.stringify(refused),
    );
});

test("each bound is accepted at itself", () => {
  assert.equal(
    actionDocumentSchema.safeParse({
      ...accepted,
      action: "a".repeat(repositoryConfigurationNameCharsMax),
      name: "😀".repeat(actionDisplayNameCharsMax),
      repository: "r".repeat(actionRepositoryCharsMax),
    }).success,
    true,
  );
});

test("the repository bound is the one a repository identity is branded under", () => {
  assert.equal(actionRepositoryCharsMax, finalizerIdentityCharsMax);
});
