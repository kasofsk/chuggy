import assert from "node:assert/strict";
import { test } from "node:test";

import {
  jobIdentityIssuerBasePath,
  jobIdentityIssuerSettings,
  jobIdentityKeyFileCharsMax,
  jobIdentityKeyFilesMax,
} from "../../src/interpreter/jobIdentityIssuerSettings.ts";
import { jobIdentityIssuerCharsMax } from "../../src/interpreter/jobIdentityToken.ts";

const named = { issuerBaseUrl: "ISSUER", keyFiles: "KEY_FILES" };
const keyFiles = JSON.stringify(["/keys/next.pem", "/keys/current.pem"]);

function read(environment: Readonly<Record<string, string>>) {
  return jobIdentityIssuerSettings(named, environment);
}

test("naming neither is no issuer, an empty value being no value", () => {
  assert.deepEqual(read({}), { read: "Absent" });
  assert.deepEqual(read({ ISSUER: "", KEY_FILES: "" }), { read: "Absent" });
});

test("a base URL with or without a path is read exactly, its key files in their order", () => {
  for (const issuerBaseUrl of [
    "https://identity.example",
    "https://identity.example/chuggy/v1",
    "https://identity.example/a.b_c-d",
  ])
    assert.deepEqual(read({ ISSUER: issuerBaseUrl, KEY_FILES: keyFiles }), {
      read: "Settings",
      issuerBaseUrl,
      keyFiles: ["/keys/next.pem", "/keys/current.pem"],
    });
});

test("one named without the other is refused, naming both", () => {
  for (const environment of [
    { ISSUER: "https://identity.example" },
    { KEY_FILES: keyFiles },
  ])
    assert.deepEqual(read(environment), {
      read: "Refused",
      why: "ISSUER and KEY_FILES are named together or not at all",
    });
});

test("a base URL breaking a rule is refused by its variable, never normalised", () => {
  for (const [issuerBaseUrl, why] of [
    ["identity.example", "is not a URL"],
    ["http://identity.example", "is not https"],
    ["https://user:pass@identity.example", "carries credentials"],
    ["https://user@identity.example", "carries credentials"],
    ["https://identity.example:8443", "carries a port"],
    ["https://identity.example/a?b=c", "carries a query"],
    ["https://identity.example/a?", "carries a query"],
    ["https://identity.example/a#b", "carries a fragment"],
    ["https://identity.example/", "ends in a slash"],
    ["https://identity.example/a/", "ends in a slash"],
    ["https://identity.example/a//b", "has a path segment"],
    ["https://identity.example/:tenant", "has a path segment"],
    ["https://identity.example/a%20b", "has a path segment"],
    ["https://identity.example/*", "has a path segment"],
    ["https://Identity.example", "is not written as it reads back"],
    ["https://identity.example:443", "is not written as it reads back"],
    ["https://identity.example/a/../b", "is not written as it reads back"],
    [
      `https://identity.example/${"x".repeat(jobIdentityIssuerCharsMax)}`,
      "leaves no room for a tenant",
    ],
  ] as const) {
    const answer = read({ ISSUER: issuerBaseUrl, KEY_FILES: keyFiles });
    assert.equal(answer.read, "Refused", issuerBaseUrl);
    assert.ok(
      answer.read === "Refused" && answer.why.startsWith(`ISSUER ${why}`),
      `${issuerBaseUrl}: ${JSON.stringify(answer)}`,
    );
  }
});

test("a key file list that is not a non-empty JSON list of paths is refused by its variable", () => {
  for (const [encoded, why] of [
    ["not json", "KEY_FILES is not JSON"],
    ...[
      "[]",
      '"/keys/one.pem"',
      "[1]",
      '[""]',
      '{"file":"/keys/one.pem"}',
      JSON.stringify(["x".repeat(jobIdentityKeyFileCharsMax + 1)]),
      JSON.stringify(
        Array.from(
          { length: jobIdentityKeyFilesMax + 1 },
          (_, key) => `/keys/${String(key)}.pem`,
        ),
      ),
    ].map(
      (each) =>
        [each, "KEY_FILES is not a non-empty JSON list of file paths"] as const,
    ),
  ] as const)
    assert.deepEqual(
      read({ ISSUER: "https://identity.example", KEY_FILES: encoded }),
      { read: "Refused", why },
      encoded,
    );
});

test("the base path is the base URL's path, and nothing where it has none", () => {
  assert.equal(jobIdentityIssuerBasePath("https://identity.example"), "");
  assert.equal(
    jobIdentityIssuerBasePath("https://identity.example/chuggy/v1"),
    "/chuggy/v1",
  );
});
