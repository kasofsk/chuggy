import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import {
  renderShipwrightBuildRequest,
  shipwrightBuildRequestProfile,
  shipwrightBuildRequestRenderer,
} from "../../src/interpreter/shipwrightBuildRequest.ts";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const input = {
  repositoryId: "vteng.chuggy",
  sourceUrl: "https://github.com/vteng/chuggy.git",
  sourceCommit: asGitObjectId("a".repeat(40)),
  sourceCredentialReference: "chuggy-source-read",
  contextDirectory: ".",
  dockerfile: "images/web/Dockerfile",
  targetImageRepository: "registry.chuggy.internal/chuggy/web",
  outputCredentialReference: "chuggy-registry-push",
};

test("renders the fabric contract at its content-addressed path", () => {
  const rendered = renderShipwrightBuildRequest(input, digest);
  assert.equal(shipwrightBuildRequestRenderer, "shipwright-build-request/v1");
  assert.equal(
    shipwrightBuildRequestProfile.name,
    "shipwright-buildkit-rootless-mini/v1",
  );
  assert.match(
    rendered.path,
    /^builds\/vteng\.chuggy\/a{40}\/[0-9a-f]{64}\.yaml$/u,
  );
  assert.match(
    rendered.content,
    /dockerfile\n[ ]{6}value: "images\/web\/Dockerfile"/u,
  );
  assert.match(
    rendered.content,
    /target-image-repository: "registry\.chuggy\.internal\/chuggy\/web"/u,
  );
  assert.match(rendered.content, /source-commit: a{40}/u);
  assert.match(rendered.digest, /^sha256:[0-9a-f]{64}$/u);
});

test("rendering is byte stable and credentials do not enter the destination path", () => {
  const first = renderShipwrightBuildRequest(input, digest);
  const second = renderShipwrightBuildRequest(input, digest);
  const changedCredential = renderShipwrightBuildRequest(
    { ...input, sourceCredentialReference: "replacement-source-read" },
    digest,
  );
  assert.deepEqual(first, second);
  assert.notEqual(first.path, changedCredential.path);
  assert.doesNotMatch(first.path, /credential|source-read|registry-push/u);
});

test("component inputs produce independent immutable requests", () => {
  const web = renderShipwrightBuildRequest(input, digest);
  const api = renderShipwrightBuildRequest(
    {
      ...input,
      dockerfile: "images/api/Dockerfile",
      targetImageRepository: "registry.chuggy.internal/chuggy/api",
    },
    digest,
  );
  assert.notEqual(web.path, api.path);
  assert.notEqual(web.content, api.content);
  assert.match(api.content, /images\/api\/Dockerfile/u);
});
