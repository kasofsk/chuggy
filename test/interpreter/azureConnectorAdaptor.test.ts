import assert from "node:assert/strict";
import { test } from "node:test";

import { workerHeldCredentialBundleSchema } from "../../src/contract/workerPlane.ts";
import { azureCredentialBundle } from "../../src/interpreter/azureConnectorAdaptor.ts";

test("an Azure bundle points the SDK at the token file, the client, the tenant and the public cloud's authority", () => {
  const bundle = azureCredentialBundle(
    {
      name: "azure",
      kind: "Azure",
      settings: { tenantId: "tenant-1", clientId: "client-1" },
    },
    "t.o.k",
    1_000,
  );
  assert.deepEqual(bundle, {
    credential: "chuggy.connector.azure",
    files: [{ file: "token", content: { kind: "Secret", secret: "t.o.k" } }],
    variables: [
      { kind: "Path", variable: "AZURE_FEDERATED_TOKEN_FILE", file: "token" },
      { kind: "Value", variable: "AZURE_CLIENT_ID", value: "client-1" },
      { kind: "Value", variable: "AZURE_TENANT_ID", value: "tenant-1" },
      {
        kind: "Value",
        variable: "AZURE_AUTHORITY_HOST",
        value: "https://login.microsoftonline.com/",
      },
    ],
    expiresAtMs: 1_000,
  });
  assert.ok(workerHeldCredentialBundleSchema.safeParse(bundle).success);
});
