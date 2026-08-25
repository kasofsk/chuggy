import assert from "node:assert/strict";
import test from "node:test";

import { createTicketHome } from "../../ui/console/dom/ticketHomeController.js";
import { deferred } from "./deferred.ts";
import type { ApiOutcome } from "../../ui/console/app/protocol.js";

const partition = { tenant: "acme", project: "atlas" };

test("select, refresh, and continuation drive recent ticket reads", async () => {
  const requests: string[] = [];
  let reads = 0;
  const controller = createTicketHome({
    session: { accessToken: () => Promise.resolve("token") },
    send: (request: { url: string }) => {
      requests.push(request.url);
      reads += 1;
      return Promise.resolve({
        outcome: "Ok" as const,
        body: {
          partition,
          sequence: reads,
          tickets: [{ ticket: reads, phase: "Pending", sequence: reads }],
          ...(reads === 1 ? { nextCursor: "opaque" } : {}),
        },
      });
    },
    onChanged: () => undefined,
    onTicket: () => undefined,
    onNewTicket: () => undefined,
  });

  await controller.select(partition);
  await controller.next();
  await controller.refresh();

  assert.deepEqual(requests, [
    "/api/v1/tenants/acme/projects/atlas/tickets?order=RecentActivity&limit=50",
    "/api/v1/tenants/acme/projects/atlas/tickets?order=RecentActivity&cursor=opaque&limit=50",
    "/api/v1/tenants/acme/projects/atlas/tickets?order=RecentActivity&limit=50",
  ]);
  assert.equal(controller.state.tickets.state, "Data");
});

test("navigation callbacks remain shell-owned", () => {
  const tickets: number[] = [];
  let creations = 0;
  const controller = createTicketHome({
    session: { accessToken: () => Promise.resolve("token") },
    send: () => Promise.reject(new Error("not used")),
    onChanged: () => undefined,
    onTicket: (ticket) => tickets.push(ticket),
    onNewTicket: () => {
      creations += 1;
    },
  });

  controller.ticket(7);
  controller.newTicket();

  assert.deepEqual(tickets, [7]);
  assert.equal(creations, 1);
});

test("a late ticket page cannot replace a newly selected project", async () => {
  const first = deferred<ApiOutcome>();
  const newer = { tenant: "acme", project: "beacon" };
  const controller = createTicketHome({
    session: { accessToken: () => Promise.resolve("token") },
    send: (request) =>
      request.url.includes("atlas")
        ? first.promise
        : Promise.resolve({
            outcome: "Ok" as const,
            body: {
              partition: newer,
              sequence: 2,
              tickets: [{ ticket: 2, phase: "Pending", sequence: 2 }],
            },
          }),
    onChanged: () => undefined,
    onTicket: () => undefined,
    onNewTicket: () => undefined,
  });
  const oldRead = controller.select(partition);
  await controller.select(newer);
  first.answer({
    outcome: "Ok",
    body: { partition, sequence: 1, tickets: [] },
  });
  await oldRead;
  assert.equal(controller.state.tickets.state, "Data");
  if (controller.state.tickets.state === "Data")
    assert.equal(controller.state.tickets.project.partition.project, "beacon");
});
