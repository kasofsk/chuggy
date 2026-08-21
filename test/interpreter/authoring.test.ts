import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  encodeDraftAuthoring,
  parseDraftAuthoring,
  releaseConfigurationReadiness,
} from "../../src/interpreter/authoring.ts";
import { plainAuthoring } from "../actor/harness.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  encodeTicketCommand,
  parseTicketCommand,
} from "../../src/interpreter/wire.ts";

test("draft authoring round-trips through the generated domain codec", () => {
  assert.deepEqual(
    parseDraftAuthoring(encodeDraftAuthoring(plainAuthoring)),
    plainAuthoring,
  );
});

test("configuration must be canonical, bounded, and secret-free", () => {
  assert.equal(
    asCanonicalConfiguration('{"image":"worker:v1","limits":{"cpu":2}}'),
    '{"image":"worker:v1","limits":{"cpu":2}}',
  );
  assert.throws(
    () => asCanonicalConfiguration('{"limits":{},"image":"worker:v1"}'),
    /canonically encoded/,
  );
  assert.throws(
    () => asCanonicalConfiguration('{"apiToken":"value"}'),
    /secret-bearing/,
  );
  assert.throws(() => asCanonicalConfiguration("not-json"), SyntaxError);
});

test("release readiness is stricter than structurally valid draft configuration", () => {
  assert.deepEqual(
    releaseConfigurationReadiness(asCanonicalConfiguration("{}")),
    {
      readiness: "Incomplete",
    },
  );
  assert.equal(
    releaseConfigurationReadiness(
      asCanonicalConfiguration('{"image":"worker:v1"}'),
    ).readiness,
    "Ready",
  );
});

test("a raw ReleaseTicket is not a public Decide command", () => {
  const raw = `{"version":1,"command":"Decide","event":${encodeDraftAuthoring(plainAuthoring)}}`;
  assert.equal(parseTicketCommand(raw).parsed, "Refused");
});

test("ReleaseDraft round-trips as a revision-fenced public command", () => {
  const command = {
    version: 1 as const,
    command: "ReleaseDraft" as const,
    ticket: asTicketId(7),
    authoringVersion: 3,
    configurationRevision: asConfigurationRevisionId("config-3"),
  };
  assert.deepEqual(parseTicketCommand(encodeTicketCommand(command)), {
    parsed: "Ok",
    value: command,
  });
});
