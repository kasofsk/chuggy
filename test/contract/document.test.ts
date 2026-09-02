/**
 * `GET /api/v1/contract` renders what the committed golden holds, and a
 * difference is a finding rather than a diff nobody reads.
 *
 * The comparison is over both sides re-serialised canonically, because the
 * golden is a JSON file and the formatter owns its whitespace; every other
 * difference survives that — a key added, removed, reordered or revalued. The
 * document is generated from the request schemas rather than written beside
 * them, so a change to any of them changes what every client is told.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { nativeHttpContractDocument } from "../../src/contract/document.ts";

const golden: unknown = JSON.parse(
  readFileSync(new URL("./contractDocument.json", import.meta.url), "utf8"),
);

const canonical = (value: unknown) => JSON.stringify(value, null, 2);

test("the contract document renders the committed golden", () => {
  assert.equal(canonical(nativeHttpContractDocument()), canonical(golden));
});

test("the wire names both bearer formats it accepts, and what the second one means", () => {
  const document = nativeHttpContractDocument() as {
    authentication: { formats: readonly string[]; session: string };
  };
  assert.deepEqual(Object.keys(document.authentication), [
    "scheme",
    "formats",
    "principal",
    "session",
  ]);
  assert.deepEqual(document.authentication.formats, [
    "OIDC JWT",
    "session bearer",
  ]);
  assert.match(document.authentication.session, /recorded on the operation/u);
});

test("the golden is the document and not an empty stand-in", () => {
  const document = golden as {
    routes: Readonly<Record<string, string>>;
    schemas: Readonly<Record<string, unknown>>;
  };
  assert.deepEqual(Object.keys(document.routes).sort(), [
    "configuration",
    "configurationImports",
    "configurations",
    "contract",
    "dispatchView",
    "draft",
    "draftInitialization",
    "drafts",
    "events",
    "execution",
    "executions",
    "installation",
    "nativeActions",
    "notifications",
    "operation",
    "operationalStatus",
    "operations",
    "outputContent",
    "project",
    "projects",
    "runConfiguration",
    "runTranscript",
    "runTurns",
    "selectorContext",
    "selectorSettings",
    "selectorSettingsHistory",
    "ticket",
    "ticketNativeActions",
    "tickets",
  ]);
  assert.deepEqual(Object.keys(document.schemas).sort(), [
    "configurationCreation",
    "draftCreation",
    "draftRevision",
    "publicMutation",
    "repositoryConfigurationImport",
    "selectorProjectSettings",
  ]);
});
