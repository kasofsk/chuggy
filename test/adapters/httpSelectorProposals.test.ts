/**
 * The lead's held proposals over the real boundary: what a principal who may
 * dispatch reads and answers, what anyone else is told, and what a review of a
 * decision no longer held becomes on the wire.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { nativeHttpEndpoints } from "../../src/contract/endpoints.ts";
import {
  nativeHttpMediaType,
  selectorReviewFeedbackCharsMax,
} from "../../src/contract/http.ts";
import type { HttpErrorEnvelope } from "../../src/contract/http.ts";
import { selectorProposalNotHeldCode } from "../../src/contract/rosters.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { Authority } from "../../src/interpreter/operationInbox.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type { SelectorDelivery } from "../../src/interpreter/selector.ts";
import {
  selectorProposalReviews,
  type SelectorProposalReviewStore,
} from "../../src/interpreter/selectorReview.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { servedNativeHttpApp, unservedNativeWeb } from "./threadFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
/** The principal `servedNativeHttpApp` authenticates the valid bearer as. */
const caller = asPrincipal("issuer geoff");
const listed = "/api/v1/tenants/acme/projects/atlas/selector-proposals";
const authorized = { authorization: "Bearer valid" };

/** One review the store was asked for, as the definer would have recorded it. */
interface Reviewed {
  readonly outcome: "Approved" | "Rejected";
  readonly decision: string;
  readonly reviewer: Authority;
  readonly feedback: string | undefined;
}

/** A held delivery carrying only what the read groups by; the command is never read here. */
function held(decision: string, ticket: number): SelectorDelivery {
  return {
    decision,
    ticket: asTicketId(ticket),
    partition,
    operation: `${decision}-${String(ticket)}`,
    attempts: 0,
  } as unknown as SelectorDelivery;
}

/** The decisions still held, which a review moves out exactly as the definer does. */
function storeOver(holding: SelectorDelivery[], reviewed: Reviewed[]) {
  const review =
    (outcome: Reviewed["outcome"]) =>
    (
      _partition: unknown,
      decision: string,
      reviewer: Authority,
      feedback?: string,
    ) => {
      const before = holding.length;
      holding.splice(
        0,
        holding.length,
        ...holding.filter((delivery) => delivery.decision !== decision),
      );
      if (holding.length === before) return Promise.resolve(false);
      reviewed.push({ outcome, decision, reviewer, feedback });
      return Promise.resolve(true);
    };
  const store: SelectorProposalReviewStore = {
    awaitingApproval: (_partition, limit) =>
      Promise.resolve(holding.slice(0, limit)),
    approve: review("Approved"),
    reject: review("Rejected"),
    reviewFeedback: () => Promise.resolve([]),
    recentReviewFeedback: () => Promise.resolve([]),
  };
  return store;
}

function appOver(
  access: ReadonlySet<ProjectAccessKind>,
  holding: SelectorDelivery[],
  reviewed: Reviewed[] = [],
) {
  const granted = memoryProjectAccess();
  granted.grant({ partition, principal: caller, access });
  return servedNativeHttpApp(
    unservedNativeWeb,
    undefined,
    undefined,
    undefined,
    selectorProposalReviews(granted, storeOver(holding, reviewed)),
  );
}

function review(decision: string, body: unknown) {
  return {
    method: "POST" as const,
    url: `${listed}/${encodeURIComponent(decision)}/review`,
    headers: { ...authorized, "content-type": nativeHttpMediaType },
    payload: JSON.stringify(body),
  };
}

const dispatcher = new Set<ProjectAccessKind>(["Read", "DispatchTicket"]);

test("a dispatcher reads each held decision whole, with every ticket it names", async () => {
  await using app = appOver(dispatcher, [
    held("first", 3),
    held("first", 4),
    held("second", 7),
  ]);
  const found = await app.inject({ url: listed, headers: authorized });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(
    nativeHttpEndpoints.selectorProposals.response.parse(found.json()),
    {
      proposals: [
        { decision: "first", tickets: [3, 4] },
        { decision: "second", tickets: [7] },
      ],
      more: false,
    },
  );
});

test("an approval and a rejection reach the store as the reviewer's, with the note", async () => {
  const reviewed: Reviewed[] = [];
  await using app = appOver(
    dispatcher,
    [held("first", 3), held("second", 7)],
    reviewed,
  );
  const approved = await app.inject(
    review("first", { outcome: "Approved", feedback: "this one first" }),
  );
  assert.equal(approved.statusCode, 200);
  assert.deepEqual(
    nativeHttpEndpoints.reviewSelectorProposal.response.parse(approved.json()),
    { decision: "first", outcome: "Approved" },
  );
  const rejected = await app.inject(
    review("second", { outcome: "Rejected", feedback: "after the migration" }),
  );
  assert.equal(rejected.statusCode, 200);
  assert.deepEqual(reviewed, [
    {
      outcome: "Approved",
      decision: "first",
      reviewer: memberAuthority(caller),
      feedback: "this one first",
    },
    {
      outcome: "Rejected",
      decision: "second",
      reviewer: memberAuthority(caller),
      feedback: "after the migration",
    },
  ]);
  const left = await app.inject({ url: listed, headers: authorized });
  assert.deepEqual(left.json(), { proposals: [], more: false });
});

test("a decision no longer held is a conflict naming why", async () => {
  await using app = appOver(dispatcher, [held("first", 3)]);
  assert.equal(
    (await app.inject(review("first", { outcome: "Approved" }))).statusCode,
    200,
  );
  for (const outcome of ["Approved", "Rejected"]) {
    const again = await app.inject(review("first", { outcome }));
    assert.equal(again.statusCode, 409);
    assert.equal(
      again.json<HttpErrorEnvelope>().error.code,
      selectorProposalNotHeldCode,
    );
  }
});

test("a reader who may not dispatch is not found, and nothing is reviewed", async () => {
  const reviewed: Reviewed[] = [];
  await using app = appOver(
    new Set<ProjectAccessKind>(["Read", "ProposeDispatch"]),
    [held("first", 3)],
    reviewed,
  );
  const found = await app.inject({ url: listed, headers: authorized });
  assert.equal(found.statusCode, 404);
  const answered = await app.inject(review("first", { outcome: "Approved" }));
  assert.equal(answered.statusCode, 404);
  assert.deepEqual(reviewed, []);
});

test("a review body the contract does not admit is refused before the store", async () => {
  const reviewed: Reviewed[] = [];
  await using app = appOver(dispatcher, [held("first", 3)], reviewed);
  for (const body of [
    { outcome: "Deferred" },
    { outcome: "Rejected", feedback: "" },
    {
      outcome: "Rejected",
      feedback: "x".repeat(selectorReviewFeedbackCharsMax + 1),
    },
    { outcome: "Approved", ticket: 3 },
  ]) {
    const refused = await app.inject(review("first", body));
    assert.equal(refused.statusCode, 400, JSON.stringify(body));
  }
  const unversioned = await app.inject({
    ...review("first", { outcome: "Approved" }),
    headers: { ...authorized, "content-type": "application/json" },
  });
  assert.equal(unversioned.statusCode, 415);
  assert.deepEqual(reviewed, []);
});

test("a caller with no bearer is unauthenticated", async () => {
  await using app = appOver(dispatcher, [held("first", 3)]);
  const found = await app.inject({ url: listed });
  assert.equal(found.statusCode, 401);
});
