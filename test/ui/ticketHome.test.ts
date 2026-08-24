import assert from "node:assert/strict";
import test from "node:test";

import {
  ticketHomeData,
  ticketHomeInitial,
  ticketHomeNext,
  ticketHomeReceived,
  ticketHomeRefresh,
} from "../../ui/app/ticketHome.js";

const partition = { tenant: "acme", project: "atlas" };

function page(
  tickets: readonly { ticket: number; phase: string; sequence: number }[],
  nextCursor?: string,
) {
  return {
    partition,
    sequence: 40,
    tickets,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

test("ticket home requests recent activity and preserves the opaque cursor", () => {
  const initial = ticketHomeInitial("token", partition, 25);
  assert.equal(
    initial.request.url,
    "/api/v1/tenants/acme/projects/atlas/tickets?order=RecentActivity&limit=25",
  );
  const first = ticketHomeReceived(initial.state, {
    outcome: "Ok",
    body: page(
      [
        { ticket: 8, phase: "Working", sequence: 39 },
        { ticket: 3, phase: "Done", sequence: 30 },
      ],
      "opaque+/cursor==",
    ),
  });
  assert.equal(first.state, "Data");
  const next = ticketHomeNext(first, "token", partition, 10);
  assert.notEqual(next, undefined);
  if (next === undefined) return;
  assert.equal(
    next.request.url,
    "/api/v1/tenants/acme/projects/atlas/tickets?order=RecentActivity&cursor=opaque%2B%2Fcursor%3D%3D&limit=10",
  );
});

test("continuation appends tickets in server activity order", () => {
  const current = ticketHomeReceived(
    ticketHomeInitial("token", partition).state,
    {
      outcome: "Ok",
      body: page([{ ticket: 8, phase: "Working", sequence: 39 }], "next"),
    },
  );
  const next = ticketHomeNext(current, "token", partition);
  assert.notEqual(next, undefined);
  if (next === undefined) return;
  assert.deepEqual(
    ticketHomeReceived(next.state, {
      outcome: "Ok",
      body: page([{ ticket: 3, phase: "Done", sequence: 30 }]),
    }),
    {
      state: "Data",
      project: {
        ...page([
          { ticket: 8, phase: "Working", sequence: 39 },
          { ticket: 3, phase: "Done", sequence: 30 },
        ]),
        nextAfter: undefined,
        nextCursor: undefined,
      },
      nextCursor: undefined,
    },
  );
});

test("refresh and errors retain the last visible tickets", () => {
  const current = ticketHomeReceived(
    ticketHomeInitial("token", partition).state,
    {
      outcome: "Ok",
      body: page([{ ticket: 8, phase: "Working", sequence: 39 }], "next"),
    },
  );
  const refresh = ticketHomeRefresh(current, "token", partition);
  assert.deepEqual(ticketHomeData(refresh.state), ticketHomeData(current));
  const failed = ticketHomeReceived(refresh.state, {
    outcome: "Fault",
    code: "Unreachable",
    status: 0,
  });
  assert.deepEqual(ticketHomeData(failed), ticketHomeData(current));
  assert.equal(failed.state, "Error");
});

test("a page without a cursor has no continuation", () => {
  const state = ticketHomeReceived(
    ticketHomeInitial("token", partition).state,
    { outcome: "Ok", body: page([]) },
  );
  assert.equal(ticketHomeNext(state, "token", partition), undefined);
});
