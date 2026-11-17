/**
 * A person's merge of a ticket's pull request as this forge answers it: the
 * merge service composed over the GitHub adapter and a recorded forge, so each
 * status the forge refuses a merge with is followed to the answer it comes to.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { githubChangeProposals } from "../../src/adapters/forge/githubChangeProposals.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asChangeProposalRequestIdentity,
  asForgeBindingId,
  asForgeCredential,
  asProposalNumber,
  asProposalRemoteIdentity,
} from "../../src/interpreter/changeProposal.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  ticketProposalMerges,
  type TicketProposalMerged,
  type TicketProposedLanding,
} from "../../src/interpreter/ticketProposalMerge.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { fixtureForge } from "./forgeFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const member = asPrincipal("issuer-member");
const url = "https://github.com/kasofsk/chuggy/pull/17";
const headCommit = asGitObjectId("b".repeat(40));
const mergeCommit = asGitObjectId("f".repeat(40));

const landing: TicketProposedLanding = {
  repository: asRepositoryId("https://github.com/kasofsk/chuggy"),
  request: asChangeProposalRequestIdentity("a".repeat(64)),
  head: { ref: asGitRefName("refs/heads/chuggy/7"), commit: headCommit },
  baseRef: asGitRefName("refs/heads/main"),
  proposal: {
    forge: asForgeBindingId("github"),
    remote: asProposalRemoteIdentity("PR_kwDOnode17"),
    number: asProposalNumber(17),
  },
  url,
};

/** The pull request as this forge reports it by number, open and clean unless `overrides` says otherwise. */
function pull(overrides: Readonly<Record<string, unknown>> = {}): Response {
  return new Response(
    JSON.stringify({
      node_id: "PR_kwDOnode17",
      number: 17,
      html_url: url,
      title: "Publish the accepted revision",
      body: `chuggy-handoff:${landing.request}`,
      state: "open",
      merged_at: null,
      head: { ref: "chuggy/7", sha: headCommit },
      base: {
        ref: "main",
        sha: "c".repeat(40),
        repo: { full_name: "kasofsk/chuggy" },
      },
      mergeable: true,
      mergeable_state: "clean",
      ...overrides,
    }),
    { status: 200 },
  );
}

function refusal(status: number): Response {
  return new Response("{}", { status });
}

/** One press against a forge answering `answers` in turn, and the method and path of each request it was asked. */
async function pressed(answers: readonly Response[]): Promise<{
  readonly merged: TicketProposalMerged;
  readonly asked: readonly string[];
}> {
  const forge = fixtureForge(answers);
  const access = memoryProjectAccess();
  access.grant({
    partition,
    principal: member,
    access: new Set(["Read", "MergeProposals"]),
  });
  const merges = ticketProposalMerges({
    access,
    store: { proposed: () => Promise.resolve(landing) },
    proposals: githubChangeProposals({
      credentials: {
        credential: () =>
          Promise.resolve({
            resolved: "Credential",
            credential: asForgeCredential("portal-token"),
          }),
      },
      fetch: forge.requestFetch,
      mergeRefused: () => undefined,
    }),
  });
  const merged = await merges.merge(member, partition, asTicketId(7));
  return {
    merged,
    asked: forge.calls.map(
      (call) => `${call.method} ${new URL(call.url).pathname}`,
    ),
  };
}

const read = "GET /repos/kasofsk/chuggy/pulls/17";
const merge = "PUT /repos/kasofsk/chuggy/pulls/17/merge";

test("a pull request read clean is merged at the landing's head and answers the commit the merge left", async () => {
  const { merged, asked } = await pressed([
    pull(),
    new Response(JSON.stringify({ sha: mergeCommit, merged: true }), {
      status: 200,
    }),
  ]);
  assert.deepEqual(merged, { result: "Merged", mergeCommit, url });
  assert.deepEqual(asked, [read, merge]);
});

test("a 405 is named by the reading taken after it, and is NotMergeable where that reading stops nothing", async () => {
  const blocked = await pressed([
    pull(),
    refusal(405),
    pull({ mergeable_state: "blocked" }),
    new Response(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              viewerCanMergeAsAdmin: false,
              isMergeQueueEnabled: false,
            },
          },
        },
      }),
      { status: 200 },
    ),
  ]);
  assert.deepEqual(blocked.merged, {
    result: "Refused",
    refused: "Blocked",
    url,
  });
  assert.deepEqual(blocked.asked, [read, merge, read, "POST /graphql"]);
  const unnamed = await pressed([pull(), refusal(405), pull()]);
  assert.deepEqual(unnamed.merged, {
    result: "Refused",
    refused: "NotMergeable",
    url,
  });
});

test("a 409 is a head pushed since the landing evaluated it, and asks no second reading", async () => {
  const { merged, asked } = await pressed([pull(), refusal(409)]);
  assert.deepEqual(merged, { result: "Refused", refused: "HeadMoved", url });
  assert.deepEqual(asked, [read, merge]);
});

test("a 422 is read back once, and answers Merged where the pull request was merged after all", async () => {
  const landed = await pressed([
    pull(),
    refusal(422),
    pull({
      state: "closed",
      merged_at: "2026-08-28T09:00:00Z",
      merge_commit_sha: mergeCommit,
    }),
  ]);
  assert.deepEqual(landed.merged, { result: "Merged", mergeCommit, url });
  assert.deepEqual(landed.asked, [read, merge, read]);
  const behind = await pressed([
    pull(),
    refusal(422),
    pull({ mergeable_state: "behind" }),
  ]);
  assert.deepEqual(behind.merged, {
    result: "Refused",
    refused: "Behind",
    url,
  });
});

test("a pull request read conflicting is refused by that name and no merge is asked", async () => {
  const { merged, asked } = await pressed([
    pull({ mergeable: false, mergeable_state: "dirty" }),
  ]);
  assert.deepEqual(merged, { result: "Refused", refused: "Conflicting", url });
  assert.deepEqual(asked, [read]);
});
