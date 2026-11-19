import assert from "node:assert/strict";
import { test } from "node:test";

import type { Connector } from "../../src/contract/connectors.ts";
import { workerHeldCredentialBundleSchema } from "../../src/contract/workerPlane.ts";
import { connectorAdaptor } from "../../src/interpreter/connectorAdaptor.ts";
import {
  jobIdentityClaims,
  type JobIdentitySubject,
  type JobIdentityTarget,
} from "../../src/interpreter/jobIdentityToken.ts";

const token = "header.payload.signature";
const expiresAtMs = 1_800_003_600_000;

const work: JobIdentitySubject = {
  tenant: "acme",
  project: "widgets",
  workload: "build",
  task: { taskKind: "Work" },
  ticket: 42,
};

const connectors: Record<Connector["kind"], Connector> = {
  Aws: {
    name: "deploy",
    kind: "Aws",
    settings: { roleArn: "arn:aws:iam::123456789012:role/deploy" },
  },
  Gcp: {
    name: "gcp-prod",
    kind: "Gcp",
    settings: { projectNumber: "123456", pool: "chuggy", provider: "acme" },
  },
  Azure: {
    name: "azure",
    kind: "Azure",
    settings: { tenantId: "tenant-1", clientId: "client-1" },
  },
  Anthropic: {
    name: "claude",
    kind: "Anthropic",
    settings: { organizationId: "org-1", federationRuleId: "rule-1" },
  },
};

const audiences: Record<Connector["kind"], string> = {
  Aws: "sts.amazonaws.com",
  Gcp: "https://iam.googleapis.com/projects/123456/locations/global/workloadIdentityPools/chuggy/providers/acme",
  Azure: "api://AzureADTokenExchange",
  Anthropic: "https://api.anthropic.com",
};

const subjectBytesMaxes: Record<Connector["kind"], number> = {
  Aws: 255,
  Gcp: 127,
  Azure: 600,
  Anthropic: 255,
};

function targetOf(
  connector: Connector,
  subject: JobIdentitySubject = work,
): JobIdentityTarget {
  const built = connectorAdaptor(connector).tokenTarget(subject);
  assert.equal(built.result, "Target");
  return built.target;
}

for (const connector of Object.values(connectors)) {
  test(`a ${connector.kind} token's shape is its provider's audience and subject bound, and its claims carry that audience`, () => {
    const target = targetOf(connector);
    assert.deepEqual(target, {
      audience: audiences[connector.kind],
      subjectBytesMax: subjectBytesMaxes[connector.kind],
      claims: {},
    });
    const built = jobIdentityClaims(
      work,
      "https://issuer.example",
      target,
      1_800_000_000_000,
    );
    assert.equal(built.result, "Claims");
    assert.equal(built.claims["aud"], audiences[connector.kind]);
  });

  test(`the ${connector.kind} bundle is the connector's credential, the token's expiry, and the token only in the token file as a secret`, () => {
    const bundle = connectorAdaptor(connector).credentialBundle(
      token,
      expiresAtMs,
    );
    assert.equal(bundle.credential, `chuggy.connector.${connector.name}`);
    assert.equal(bundle.expiresAtMs, expiresAtMs);
    assert.deepEqual(bundle.files[0], {
      file: "token",
      content: { kind: "Secret", secret: token },
    });
    for (const file of bundle.files.slice(1))
      assert.ok(
        file.content.kind === "Text" && !file.content.text.includes(token),
      );
    for (const variable of bundle.variables)
      assert.ok(variable.kind === "Path" || !variable.value.includes(token));
    assert.ok(workerHeldCredentialBundleSchema.safeParse(bundle).success);
  });
}

test("a subject of 200 bytes is taken under every shape but Google Cloud's", () => {
  const workload = "w".repeat(
    200 - "project:widgets:workload::task:work".length,
  );
  const subject = { ...work, workload };
  for (const connector of Object.values(connectors)) {
    const built = jobIdentityClaims(
      subject,
      "https://issuer.example",
      targetOf(connector, subject),
      1_800_000_000_000,
    );
    if (connector.kind === "Gcp")
      assert.deepEqual(built, {
        result: "Refused",
        refusal: { reason: "SubjectTooLong" },
      });
    else {
      assert.equal(built.result, "Claims");
      const sub = built.claims["sub"];
      assert.ok(typeof sub === "string");
      assert.equal(new TextEncoder().encode(sub).byteLength, 200);
    }
  }
});

test("a bundle refuses an empty token and an expiry that is no instant", () => {
  const adaptor = connectorAdaptor(connectors.Aws);
  assert.throws(() => adaptor.credentialBundle("", expiresAtMs), RangeError);
  assert.throws(() => adaptor.credentialBundle(token, -1), RangeError);
  assert.throws(() => adaptor.credentialBundle(token, 1.5), RangeError);
});
