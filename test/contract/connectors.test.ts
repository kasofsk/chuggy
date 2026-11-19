/**
 * A connector's kinds, settings and name, and the credential a workload asks
 * for one by.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  connectorIdentifierCharsMax,
  connectorKinds,
  connectorNameCharsMax,
  connectorRoleArnCharsMax,
  connectorSchema,
  connectorSettingsSchemas,
  isConnectorName,
  type ConnectorKind,
} from "../../src/contract/connectors.ts";
import {
  connectorCredentialOf,
  connectorCredentialPrefix,
  connectorNameOf,
} from "../../src/contract/workerEnvironment.ts";

/** Settings each kind admits, every optional one present. */
const admitted: Readonly<Record<ConnectorKind, Record<string, unknown>>> = {
  Aws: { roleArn: "arn:aws:iam::123456789012:role/jobs", sessionTags: true },
  Gcp: {
    projectNumber: "123456789012",
    pool: "chuggy",
    provider: "jobs",
    serviceAccount: "jobs@example.iam.gserviceaccount.com",
  },
  Azure: {
    tenantId: "00000000-0000-0000-0000-000000000001",
    clientId: "00000000-0000-0000-0000-000000000002",
  },
  Anthropic: {
    organizationId: "org-1",
    federationRuleId: "rule-1",
    serviceAccountId: "sa-1",
    workspaceId: "ws-1",
  },
};

/** The string setting of each kind the bounds are tried on, and the longest it may be. */
const bounded: Readonly<Record<ConnectorKind, readonly [string, number]>> = {
  Aws: ["roleArn", connectorRoleArnCharsMax],
  Gcp: ["pool", connectorIdentifierCharsMax],
  Azure: ["tenantId", connectorIdentifierCharsMax],
  Anthropic: ["organizationId", connectorIdentifierCharsMax],
};

function connectorsParse(kind: ConnectorKind, settings: unknown): boolean {
  return connectorSchema.safeParse({ name: "deploy", kind, settings }).success;
}

/** `value` grown to `length` characters, keeping the prefix it begins with. */
function connectorsGrown(value: string, length: number): string {
  return value + "a".repeat(length - value.length);
}

for (const kind of connectorKinds) {
  const settings = admitted[kind];
  const [setting, charsMax] = bounded[kind];
  const valid = String(settings[setting]);

  test(`${kind} admits its own settings, and its own schema agrees`, () => {
    assert.equal(connectorsParse(kind, settings), true);
    assert.equal(
      connectorSettingsSchemas[kind].safeParse(settings).success,
      true,
    );
  });

  test(`${kind} refuses every other kind's settings`, () => {
    for (const other of connectorKinds)
      if (other !== kind)
        assert.equal(connectorsParse(kind, admitted[other]), false, other);
  });

  test(`${kind} refuses a key it does not name`, () => {
    assert.equal(connectorsParse(kind, { ...settings, secret: "x" }), false);
  });

  test(`${kind} refuses an empty value`, () => {
    assert.equal(connectorsParse(kind, { ...settings, [setting]: "" }), false);
  });

  test(`${kind} holds a value to its longest and refuses one past it`, () => {
    assert.equal(
      connectorsParse(kind, {
        ...settings,
        [setting]: connectorsGrown(valid, charsMax),
      }),
      true,
    );
    assert.equal(
      connectorsParse(kind, {
        ...settings,
        [setting]: connectorsGrown(valid, charsMax + 1),
      }),
      false,
    );
  });

  test(`${kind} refuses a value holding a brace, whitespace or a control character`, () => {
    for (const held of ["{", "}", "{{file:token}}", " ", "\t", "\u0000", "é"])
      assert.equal(
        connectorsParse(kind, { ...settings, [setting]: `${valid}${held}` }),
        false,
        JSON.stringify(held),
      );
  });
}

test("an AWS role is an ARN, and a GCP project is its number", () => {
  assert.equal(connectorsParse("Aws", { roleArn: "role/jobs" }), false);
  assert.equal(
    connectorsParse("Gcp", { ...admitted.Gcp, projectNumber: "my-project" }),
    false,
  );
});

test("a GCP service account is an email", () => {
  assert.equal(
    connectorsParse("Gcp", { ...admitted.Gcp, serviceAccount: "jobs" }),
    false,
  );
});

test("AWS session tags are true, false or absent, and never a string", () => {
  const roleArn = admitted.Aws["roleArn"];
  for (const sessionTags of [true, false])
    assert.equal(connectorsParse("Aws", { roleArn, sessionTags }), true);
  assert.equal(connectorsParse("Aws", { roleArn }), true);
  assert.equal(connectorsParse("Aws", { roleArn, sessionTags: "true" }), false);
});

test("an optional setting is absent or a value, never undefined", () => {
  assert.equal(
    connectorsParse("Anthropic", {
      organizationId: "org-1",
      federationRuleId: "rule-1",
    }),
    true,
  );
  assert.equal(
    connectorsParse("Anthropic", {
      organizationId: "org-1",
      federationRuleId: "rule-1",
      workspaceId: undefined,
    }),
    false,
  );
});

test("a kind the roster does not name is no connector", () => {
  assert.equal(
    connectorSchema.safeParse({ name: "deploy", kind: "Oci", settings: {} })
      .success,
    false,
  );
});

test("a name is lower case, digits and inner hyphens, to its longest", () => {
  for (const name of ["a", "0", "deploy", "aws-prod-2", "a--b"])
    assert.equal(isConnectorName(name), true, name);
  for (const name of [
    "",
    "-a",
    "a-",
    "Deploy",
    "a_b",
    "a.b",
    "a b",
    "é",
    "a".repeat(connectorNameCharsMax + 1),
  ])
    assert.equal(isConnectorName(name), false, name);
  assert.equal(isConnectorName("a".repeat(connectorNameCharsMax)), true);
  assert.equal(
    connectorSchema.safeParse({
      name: "Deploy",
      kind: "Azure",
      settings: admitted.Azure,
    }).success,
    false,
  );
});

test("a connector's credential is its name in the connector prefix, and reads back to it", () => {
  assert.equal(connectorCredentialPrefix, "chuggy.connector.");
  assert.equal(connectorCredentialOf("aws-prod"), "chuggy.connector.aws-prod");
  assert.equal(connectorNameOf(connectorCredentialOf("aws-prod")), "aws-prod");
  assert.throws(() => connectorCredentialOf("Not a name"));
});

test("a credential outside the prefix, or naming no connector, reads as none", () => {
  for (const credential of [
    "chuggy.github-workflow-runs",
    "aws-prod",
    "chuggy.connector.",
    "chuggy.connector.Not_A_Name",
    "chuggy.connector.a.b",
  ])
    assert.equal(connectorNameOf(credential), undefined, credential);
});
