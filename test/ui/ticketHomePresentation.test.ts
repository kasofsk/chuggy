import assert from "node:assert/strict";
import test from "node:test";

class TextNode {
  readonly textContent: string;
  constructor(textContent: string) {
    this.textContent = textContent;
  }
}

class TestElement {
  readonly attributes = new Map<string, string>();
  readonly children: (TestElement | TextNode)[] = [];
  readonly listeners = new Map<
    string,
    (event: { preventDefault: () => void }) => void
  >();
  readonly styles = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string) => this.styles.set(name, value),
  };
  readonly tagName: string;
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  append(...children: (TestElement | TextNode)[]) {
    this.children.push(...children);
  }
  addEventListener(
    name: string,
    listener: (event: { preventDefault: () => void }) => void,
  ) {
    this.listeners.set(name, listener);
  }
}

Object.defineProperty(globalThis, "document", {
  value: {
    createElement: (tag: string) => new TestElement(tag),
    createTextNode: (value: string) => new TextNode(value),
  },
});

const { ticketHomePage } = (await import("../../ui/dom/ticketHomeView.js")) as {
  ticketHomePage: (controller: unknown) => unknown;
};

function content(node: TestElement | TextNode): string {
  return node instanceof TextNode
    ? node.textContent
    : node.children.map(content).join("");
}

function elements(node: TestElement, tag: string): TestElement[] {
  const nested = node.children.flatMap((child) =>
    child instanceof TestElement ? elements(child, tag) : [],
  );
  return node.tagName === tag ? [node, ...nested] : nested;
}

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
    ["#ticket-8", "#ticket-3"],
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
