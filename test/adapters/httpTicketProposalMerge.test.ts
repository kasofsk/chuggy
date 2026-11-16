/**
 * A ticket's pull request merge route as the API answers it: a merge with its
 * commit and link, each refusal by name beside the link, a reader who may not
 * merge told so by the permit, and a caller who cannot see the ticket answered
 * as any absence is.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  errorEnvelopeSchema,
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import {
  ticketProposalMergeRefusedResponseSchema,
  ticketProposalMergeResponseSchema,
} from "../../src/contract/responses.ts";
import {
  proposalMergeRefusals,
  proposalMergeRefusedCode,
} from "../../src/contract/rosters.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type {
  TicketProposalMerged,
  TicketProposalMerges,
} from "../../src/interpreter/ticketProposalMerge.ts";
import { callerApp } from "./callerAppFixture.ts";

const headers = {
  authorization: "Bearer valid",
  "content-type": nativeHttpMediaType,
};
const member = asPrincipal("member");
const url = "https://github.com/acme/atlas/pull/9";
const mergeCommit = asGitObjectId("b".repeat(40));
const path = nativeHttpRoutes.ticketProposalMerge
  .replace(":tenant", "acme")
  .replace(":project", "atlas")
  .replace(":ticket", "7");

/** Merges answering `merged` to every press, recording which ticket each was. */
function mergesAnswering(
  merged: TicketProposalMerged,
  asked: string[],
): TicketProposalMerges {
  return {
    merge: (principal, partition, ticket) => {
      asked.push(
        `${partition.tenant}/${partition.project}#${String(ticket)} by ${principal}`,
      );
      return Promise.resolve(merged);
    },
  };
}

async function pressed(merged: TicketProposalMerged, asked: string[] = []) {
  await using app = callerApp(member, {
    proposalMerges: mergesAnswering(merged, asked),
  });
  return await app.inject({ method: "POST", url: path, headers, payload: {} });
}

test("a merge answers Merged with its commit and the pull request's link, on the ticket the path names", async () => {
  const asked: string[] = [];
  const answered = await pressed({ result: "Merged", mergeCommit, url }, asked);
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(ticketProposalMergeResponseSchema.parse(answered.json()), {
    outcome: "Merged",
    mergeCommit,
    url,
  });
  assert.deepEqual(asked, [`acme/atlas#7 by ${member}`]);
});

test("each refusal is a 409 naming it beside the pull request's link", async () => {
  for (const refused of proposalMergeRefusals) {
    const answered = await pressed({ result: "Refused", refused, url });
    assert.equal(answered.statusCode, 409, refused);
    const body = ticketProposalMergeRefusedResponseSchema.parse(
      answered.json(),
    );
    assert.equal(body.refused, refused);
    assert.equal(body.url, url);
    assert.equal(body.error.code, proposalMergeRefusedCode);
  }
});

test("a reader who may not merge is refused by the permit, a ticket they cannot see is not found, and an unreachable forge is unavailable", async () => {
  const forbidden = await pressed({ result: "Forbidden" });
  assert.equal(forbidden.statusCode, 403);
  const refusal = errorEnvelopeSchema.parse(forbidden.json());
  assert.equal(refusal.error.code, "ProposalMergeForbidden");
  assert.match(refusal.error.message, /merge_proposals/u);
  const missing = await pressed({ result: "NotFound" });
  assert.equal(missing.statusCode, 404);
  assert.equal(
    errorEnvelopeSchema.parse(missing.json()).error.code,
    "NotFound",
  );
  const unavailable = await pressed({ result: "Unavailable" });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(
    errorEnvelopeSchema.parse(unavailable.json()).error.code,
    "ForgeUnavailable",
  );
});

test("a deployment composing no merges serves no merge route", async () => {
  await using app = callerApp(member, {});
  const answered = await app.inject({
    method: "POST",
    url: path,
    headers,
    payload: {},
  });
  assert.equal(answered.statusCode, 404);
});
