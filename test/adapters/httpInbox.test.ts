/**
 * The inbox over the real boundary: what a page answers, how its cursor walks
 * the rest, and what a principal who may not read the project is told. Which
 * tickets the inbox holds is the store's, and `test/postgres/inbox.test.ts`
 * holds the server to it; the store here pages a fixed list.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { nativeHttpEndpoints } from "../../src/contract/endpoints.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asPublicInstant,
  type TicketResource,
} from "../../src/interpreter/nativeWeb.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import {
  projectInbox,
  type InboxReadStore,
} from "../../src/interpreter/projectInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { selectorProposalReviews } from "../../src/interpreter/selectorReview.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { servedNativeHttpApp, unservedNativeWeb } from "./threadFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
/** The principal `servedNativeHttpApp` authenticates the valid bearer as. */
const caller = asPrincipal("issuer geoff");
const listed = "/api/v1/tenants/acme/projects/atlas/inbox";
const authorized = { authorization: "Bearer valid" };

/** One escalated ticket, its activity at `sequence`. */
function escalated(ticket: number, sequence: number): TicketResource {
  return {
    ticket: asTicketId(ticket),
    revision: 1,
    phase: "Escalated",
    sequence,
    changedAt: asPublicInstant("2026-10-01T00:00:00Z"),
    revokedDependencies: [],
    openDependencies: [],
  };
}

/** Three tickets, newest activity first, paged by position as the store would. */
const held = [escalated(9, 30), escalated(4, 20), escalated(7, 10)];

const store: InboxReadStore = {
  inbox: (_partition, query) => {
    const after = query.after;
    const rest =
      after === undefined
        ? held
        : held.filter((ticket) => ticket.sequence < after.sequence);
    const page = rest.slice(0, query.limit);
    const last = page.at(-1);
    return Promise.resolve({
      count: held.length,
      tickets: page,
      actions: [],
      ...(rest.length > query.limit && last !== undefined
        ? { nextAfter: { sequence: last.sequence, ticket: last.ticket } }
        : {}),
    });
  },
};

function appOver(access: ReadonlySet<ProjectAccessKind>) {
  const granted = memoryProjectAccess();
  granted.grant({ partition, principal: caller, access });
  const proposals = selectorProposalReviews(granted, {
    awaitingApproval: () => Promise.resolve([]),
    approve: () => Promise.resolve(false),
    reject: () => Promise.resolve(false),
    reviewFeedback: () => Promise.resolve([]),
    recentReviewFeedback: () => Promise.resolve([]),
  });
  return servedNativeHttpApp(
    unservedNativeWeb,
    undefined,
    undefined,
    undefined,
    proposals,
    projectInbox(granted, {
      store,
      operationalReads: { ticketLatestExecutions: () => Promise.resolve([]) },
      refusals: { binding: () => Promise.resolve([]) },
      proposals,
    }),
  );
}

test("a reader walks the inbox by the cursor each page answers, the count the same on every page", async () => {
  await using app = appOver(new Set(["Read"]));
  const pages: unknown[] = [];
  let url = `${listed}?limit=2`;
  for (let page = 0; page < 5; page += 1) {
    const found = await app.inject({ url, headers: authorized });
    assert.equal(found.statusCode, 200);
    const body = nativeHttpEndpoints.inbox.response.parse(found.json());
    pages.push([
      body.entries.map((entry) => entry.ticket.ticket),
      body.count,
      body.more,
    ]);
    if (body.nextCursor === undefined) break;
    url = `${listed}?limit=2&cursor=${encodeURIComponent(body.nextCursor)}`;
  }
  assert.deepEqual(pages, [
    [[9, 4], 3, true],
    [[7], 3, false],
  ]);
});

test("an entry answers the tickets list's row and every other read's part of it, each empty here", async () => {
  await using app = appOver(new Set(["Read"]));
  const found = await app.inject({ url: listed, headers: authorized });
  const body = nativeHttpEndpoints.inbox.response.parse(found.json());
  assert.deepEqual(body.entries[0], {
    ticket: { ...held[0], changedAt: "2026-10-01T00:00:00Z" },
    actions: [],
    refusals: [],
    proposals: [],
  });
});

test("a principal who may not read the project is told it is not there", async () => {
  await using app = appOver(new Set());
  const found = await app.inject({ url: listed, headers: authorized });
  assert.equal(found.statusCode, 404);
});

test("a cursor another project issued is refused", async () => {
  await using app = appOver(new Set(["Read"]));
  const first = nativeHttpEndpoints.inbox.response.parse(
    (
      await app.inject({ url: `${listed}?limit=1`, headers: authorized })
    ).json(),
  );
  assert.ok(first.nextCursor !== undefined);
  const other = await app.inject({
    url: `/api/v1/tenants/acme/projects/other/inbox?cursor=${encodeURIComponent(first.nextCursor)}`,
    headers: authorized,
  });
  assert.equal(other.statusCode, 400);
});
