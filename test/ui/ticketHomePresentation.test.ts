import assert from "node:assert/strict";
import test from "node:test";
import { content, elements } from "./domHarness.ts";
import type { TestElement } from "./domHarness.ts";

const ticketHomePresentationModule = "../../ui/console/dom/ticketHomeView.js";
const { ticketHomePage } = (await import(ticketHomePresentationModule)) as {
  ticketHomePage: (controller: unknown) => unknown;
};

function controller() {
  const tickets: number[] = [];
  let creations = 0;
  return {
    tickets,
    creations: () => creations,
    value: {
      state: {
        tickets: {
          state: "Data",
          project: {
            partition: { tenant: "acme", project: "atlas" },
            sequence: 40,
            tickets: [
              { ticket: 8, phase: "Working", sequence: 39 },
              { ticket: 3, phase: "Done", sequence: 30 },
            ],
            nextCursor: "opaque",
          },
          nextCursor: "opaque",
        },
      },
      refresh: () => Promise.resolve(),
      next: () => Promise.resolve(),
      ticket: (ticket: number) => tickets.push(ticket),
      newTicket: () => {
        creations += 1;
      },
    },
  };
}

test("tickets render in server order with activity, phase, and accessible links", () => {
  const fixture = controller();
  const view = ticketHomePage(fixture.value) as TestElement;
  assert.match(content(view), /Ticket 8WorkingLatest activitySequence 39/);
  assert.match(content(view), /Ticket 3DoneLatest activitySequence 30/);
  const links = elements(view, "a");
  assert.deepEqual(
    links.map((link) => link.attributes.get("href")),
    ["/tickets/8", "/tickets/3"],
  );
  links[0]?.listeners.get("click")?.({ preventDefault: () => undefined });
  assert.deepEqual(fixture.tickets, [8]);
});

test("the floating new-ticket action is prominent and invokes its callback", () => {
  const fixture = controller();
  const view = ticketHomePage(fixture.value) as TestElement;
  const button = elements(view, "button").find(
    (entry) => entry.attributes.get("aria-label") === "Create a new ticket",
  );
  assert.notEqual(button, undefined);
  assert.equal(button?.styles.get("position"), "fixed");
  button?.listeners.get("click")?.({ preventDefault: () => undefined });
  assert.equal(fixture.creations(), 1);
});

test("loading and failed refreshes remain explicit while retaining tickets", () => {
  const fixture = controller();
  const data = fixture.value.state.tickets;
  const state = fixture.value.state as { tickets: unknown };
  state.tickets = {
    state: "Error",
    held: { project: data.project, nextCursor: data.nextCursor },
    error: { kind: "Unavailable", reason: "Tickets could not be refreshed." },
  };
  const view = ticketHomePage(fixture.value) as TestElement;
  assert.match(content(view), /Tickets could not be refreshed/);
  assert.match(content(view), /Ticket 8/);
  assert.equal(elements(view, "p")[0]?.attributes.get("role"), "alert");
});
