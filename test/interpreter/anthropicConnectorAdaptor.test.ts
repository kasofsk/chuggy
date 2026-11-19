import assert from "node:assert/strict";
import { test } from "node:test";

import { workerHeldCredentialBundleSchema } from "../../src/contract/workerPlane.ts";
import { anthropicCredentialBundle } from "../../src/interpreter/anthropicConnectorAdaptor.ts";

const required = { organizationId: "org-1", federationRuleId: "rule-1" };

const base = [
  { kind: "Path", variable: "ANTHROPIC_IDENTITY_TOKEN_FILE", file: "token" },
  { kind: "Value", variable: "ANTHROPIC_ORGANIZATION_ID", value: "org-1" },
  { kind: "Value", variable: "ANTHROPIC_FEDERATION_RULE_ID", value: "rule-1" },
] as const;

function variablesOf(
  settings: Parameters<typeof anthropicCredentialBundle>[0]["settings"],
): unknown {
  const bundle = anthropicCredentialBundle(
    { name: "claude", kind: "Anthropic", settings },
    "t.o.k",
    1_000,
  );
  assert.ok(workerHeldCredentialBundleSchema.safeParse(bundle).success);
  assert.equal(bundle.credential, "chuggy.connector.claude");
  assert.deepEqual(bundle.files, [
    { file: "token", content: { kind: "Secret", secret: "t.o.k" } },
  ]);
  return bundle.variables;
}

test("an Anthropic bundle names the token file, the organization and the federation rule", () => {
  assert.deepEqual(variablesOf(required), base);
});

test("an Anthropic bundle names a service account and a workspace only where the connector has them", () => {
  assert.deepEqual(variablesOf({ ...required, serviceAccountId: "sa-1" }), [
    ...base,
    { kind: "Value", variable: "ANTHROPIC_SERVICE_ACCOUNT_ID", value: "sa-1" },
  ]);
  assert.deepEqual(variablesOf({ ...required, workspaceId: "ws-1" }), [
    ...base,
    { kind: "Value", variable: "ANTHROPIC_WORKSPACE_ID", value: "ws-1" },
  ]);
  assert.deepEqual(
    variablesOf({ ...required, serviceAccountId: "sa-1", workspaceId: "ws-1" }),
    [
      ...base,
      {
        kind: "Value",
        variable: "ANTHROPIC_SERVICE_ACCOUNT_ID",
        value: "sa-1",
      },
      { kind: "Value", variable: "ANTHROPIC_WORKSPACE_ID", value: "ws-1" },
    ],
  );
});
