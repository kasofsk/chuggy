import assert from "node:assert/strict";
import { test } from "node:test";

import { connectorSchema } from "../../src/contract/connectors.ts";
import { workerHeldCredentialBundleSchema } from "../../src/contract/workerPlane.ts";
import {
  gcpCredentialBundle,
  gcpTokenTarget,
  type GcpConnector,
} from "../../src/interpreter/gcpConnectorAdaptor.ts";

const token = "t.o.k";

function gcpConnector(settings: GcpConnector["settings"]): GcpConnector {
  const connector = { name: "gcp-prod", kind: "Gcp" as const, settings };
  assert.ok(connectorSchema.safeParse(connector).success);
  return connector;
}

function configurationOf(connector: GcpConnector): unknown {
  const bundle = gcpCredentialBundle(connector, token, 1_000);
  assert.ok(workerHeldCredentialBundleSchema.safeParse(bundle).success);
  assert.equal(bundle.credential, "chuggy.connector.gcp-prod");
  assert.deepEqual(bundle.variables, [
    {
      kind: "Value",
      variable: "GOOGLE_APPLICATION_CREDENTIALS",
      value: "{{file:config.json}}",
    },
  ]);
  assert.equal(bundle.files.length, 2);
  assert.deepEqual(bundle.files[0], {
    file: "token",
    content: { kind: "Secret", secret: token },
  });
  const configuration = bundle.files[1];
  assert.ok(configuration !== undefined);
  assert.equal(configuration.file, "config.json");
  assert.equal(configuration.content.kind, "Text");
  const text =
    configuration.content.kind === "Text" ? configuration.content.text : "";
  assert.ok(!text.includes(token));
  return JSON.parse(text.replaceAll("{{file:token}}", "/run/bundle/token"));
}

function expected(settings: GcpConnector["settings"]): Record<string, unknown> {
  return {
    type: "external_account",
    audience: `//iam.googleapis.com/projects/${settings.projectNumber}/locations/global/workloadIdentityPools/${settings.pool}/providers/${settings.provider}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    credential_source: {
      file: "/run/bundle/token",
      format: { type: "text" },
    },
  };
}

test("a Google Cloud configuration names the pool's provider and the token file, with no impersonation where the connector has no service account", () => {
  const settings = {
    projectNumber: "123456",
    pool: "chuggy",
    provider: "acme",
  };
  assert.deepEqual(configurationOf(gcpConnector(settings)), expected(settings));
});

test("a Google Cloud configuration impersonates the connector's service account", () => {
  const settings = {
    projectNumber: "123456",
    pool: "chuggy",
    provider: "acme",
    serviceAccount: "deploy@acme.iam.gserviceaccount.com",
  };
  assert.deepEqual(configurationOf(gcpConnector(settings)), {
    ...expected(settings),
    service_account_impersonation_url:
      "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/deploy@acme.iam.gserviceaccount.com:generateAccessToken",
  });
});

test("a setting holding a quote or a backslash stays inside its field", () => {
  const settings = {
    projectNumber: "123456",
    pool: 'pool","type":"x\\',
    provider: 'a\\"b',
  };
  assert.deepEqual(configurationOf(gcpConnector(settings)), expected(settings));
});

test("the token's audience is the configuration's with a leading https:", () => {
  const settings = {
    projectNumber: "123456",
    pool: "chuggy",
    provider: "acme",
  };
  const connector = gcpConnector(settings);
  const configuration = configurationOf(connector) as { audience: string };
  assert.equal(
    gcpTokenTarget(connector).audience,
    `https:${configuration.audience}`,
  );
});
