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

const document = golden as {
  routes: Readonly<Record<string, string>>;
  schemas: Readonly<Record<string, unknown>>;
};

test("the golden names every route and not an empty stand-in", () => {
  assert.deepEqual(Object.keys(document.routes).sort(), [
    "contract",
    "events",
    "forgeApps",
    "forgeCredentials",
    "forgeInstallationRepositories",
    "forgeInstallations",
    "installation",
    "lead",
    "leadInquiries",
    "leadInquiry",
    "leadTranscript",
    "project",
    "projectRepositories",
    "projectRepositoriesNew",
    "projectRepositoryLanding",
    "projectRepositoryRetirement",
    "projects",
    "thread",
    "threadClose",
    "threadHide",
    "threadMessages",
    "threadRename",
    "threadTranscript",
    "threads",
    "ticket",
    "ticketCatalog",
    "ticketExecution",
    "ticketExecutionConfiguration",
    "ticketExecutionTranscript",
    "ticketExecutionTurns",
    "ticketExecutions",
    "ticketMachineAdmission",
    "ticketOperation",
    "ticketOperations",
    "ticketValidation",
    "tickets",
  ]);
});

test("the golden names every request schema", () => {
  assert.deepEqual(Object.keys(document.schemas).sort(), [
    "forgeCredential",
    "forgeInstallationClaim",
    "leadInquiry",
    "projectRepositoryBind",
    "projectRepositoryCreate",
    "projectRepositoryLanding",
    "projectRepositoryRetirement",
    "threadHide",
    "threadMessage",
    "threadRename",
  ]);
});
