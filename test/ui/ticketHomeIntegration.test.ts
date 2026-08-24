import assert from "node:assert/strict";
import test from "node:test";

import { createTicketHome } from "../../ui/dom/ticketHomeController.js";

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
