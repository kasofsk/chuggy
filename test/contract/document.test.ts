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

/** Every route name the golden document names, sorted. */
const documentRouteNames = [
  "abilities",
  "actionReports",
  "agenticRefusals",
  "chatAbilities",
  "chatHost",
  "chatHostRegistrationTokens",
  "chatProjects",
  "chatThread",
  "chatThreadClose",
  "chatThreadHide",
  "chatThreadLive",
  "chatThreadMessages",
  "chatThreadRename",
  "chatThreadTranscript",
  "chatThreadTurnStop",
  "chatThreads",
  "configuration",
  "configurationHead",
  "configurationImports",
  "configurationSchema",
  "configurations",
  "contract",
  "dispatchView",
  "draft",
  "draftInitialization",
  "drafts",
  "events",
  "execution",
  "executionPlacement",
  "executions",
  "forgeApps",
  "forgeAuthorizations",
  "forgeCredentials",
  "forgeInstallationPermissions",
  "forgeInstallationRepositories",
  "forgeInstallations",
  "hostedRuns",
  "inbox",
  "installation",
  "lead",
  "leadInquiries",
  "leadInquiry",
  "leadTranscript",
  "nativeActions",
  "notifications",
  "operation",
  "operationalStatus",
  "operations",
  "outputContent",
  "ownerFallback",
  "personalRunner",
  "personalRunnerMember",
  "personalRunnerPermit",
  "personalRunnerProject",
  "personalRunnerRegistrationTokens",
  "personalRunnerRegistrations",
  "personalRunnerRunner",
  "project",
  "projectArtifact",
  "projectArtifacts",
  "projectRepositories",
  "projectRepositoryConfigurations",
  "projectRepositoryLanding",
  "projectRepositoryRetirement",
  "projects",
  "runConfiguration",
  "runError",
  "runTranscript",
  "runTurns",
  "selectorContext",
  "selectorHistory",
  "selectorProposalReview",
  "selectorProposals",
  "selectorSettings",
  "selectorSettingsHistory",
  "sessionPlacement",
  "thread",
  "threadClose",
  "threadHide",
  "threadLimit",
  "threadLive",
  "threadMessages",
  "threadRename",
  "threadTranscript",
  "threadTurnStop",
  "threads",
  "ticket",
  "ticketActionReach",
  "ticketAgenticRefusals",
  "ticketLandings",
  "ticketNativeActions",
  "tickets",
  "workerPoolRegistrationTokens",
  "workerPoolRegistrations",
  "workerPools",
];

test("the golden names every route and not an empty stand-in", () => {
  assert.deepEqual(Object.keys(document.routes).sort(), documentRouteNames);
});

test("the golden names every request schema", () => {
  assert.deepEqual(Object.keys(document.schemas).sort(), [
    "actionReport",
    "draftCreation",
    "draftRevision",
    "executionPlacement",
    "forgeAuthorization",
    "forgeCredential",
    "leadInquiry",
    "ownerFallback",
    "personalRunnerRedemption",
    "projectCreation",
    "projectRepositoryBind",
    "projectRepositoryConfigure",
    "projectRepositoryLanding",
    "projectRepositoryRetirement",
    "publicMutation",
    "repositoryConfigurationImport",
    "selectorProjectSettings",
    "selectorProposalReview",
    "sessionPlacement",
    "threadHide",
    "threadLimit",
    "threadMessage",
    "threadOpen",
    "threadRename",
    "workerPoolRedemption",
    "workerPoolRegistrationToken",
  ]);
});
