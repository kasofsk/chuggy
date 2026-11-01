/**
 * The one property the inbox screen owns that no pure function can express: an
 * answered row stays until the project says it moved.
 *
 * The core has no seam for the answer path — the click, the follow and the
 * cache are shell code by construction — so this is the lowest tier that can
 * express it, and the providers are `screenHarness.tsx`'s. The operation stays
 * pending, so the row is looked at while its answer is still in flight.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { ticketLatestExecutionSchema } from "../../../src/contract/responses.ts";
import type { ProjectTicket } from "../../../src/contract/responses.ts";
import { InboxScreen } from "../app/browser/Inbox.tsx";
import {
  answer,
  apiDouble,
  heldAnswer,
  openedStream,
  operationAt,
  ScreenHarness,
  press,
  settled,
  turned,
  visitHeld,
} from "./screenHarness.tsx";
import type { ApiDouble } from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import {
  inboxAnswered,
  inboxAsked,
  inboxBody,
  inboxEntry,
} from "./inboxFixture.ts";
import { leadRefusals } from "./leadFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import {
  abilitiesEvery,
  abilitiesOver,
  abilitiesUnrefusing,
} from "./projectAbilitiesFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  repositoryImportListed,
  repositoryImportRefusedBinding,
} from "./repositoryImportFixture.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

/** Whether the wait between polls ever ends: held, a follow stays in flight. */
const waiting = vi.hoisted(() => ({ held: false }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () =>
    waiting.held ? new Promise<void>(() => undefined) : Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => atlas,
}));

beforeEach(resizeObserverStubbed);

/** The stubbed global goes back whatever a case did with it, including a case
 * that stops partway; the rendered tree is torn down here rather than by the
 * library's own hook, which this runner has no global `afterEach` for. */
afterEach(() => {
  cleanup();
  waiting.held = false;
  vi.unstubAllGlobals();
});

const escalated: ProjectTicket = {
  ticket: 4,
  title: "Serve the reason",
  phase: "Escalated",
  sequence: 9,
  escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
  ...ticketInstants,
};

const working: ProjectTicket = {
  ticket: 4,
  phase: "Work",
  sequence: 11,
  ...ticketInstants,
};

/** The inbox holding one escalated ticket, nothing else open and nothing that
 * has run, or the tickets a case names in its place. */
function served(
  url: string,
  tickets: readonly ProjectTicket[] = [escalated],
): Response {
  return (
    inboxAnswered(
      url,
      tickets.map((ticket) => inboxEntry(ticket)),
    ) ?? answer({ partition: atlas, sequence: 9, tickets: [] })
  );
}

/** A ticket the lead is refusing to dispatch, which keeps its phase. */
const refused: ProjectTicket = {
  ticket: 42,
  phase: "Pending",
  sequence: 8,
  ...ticketInstants,
};

/** The same project with the refused ticket in the inbox beside the escalated one. */
function servedWithRefusal(url: string): Response {
  return (
    inboxAnswered(url, [
      inboxEntry(escalated),
      inboxEntry(refused, { refusals: leadRefusals(false).refusals }),
    ]) ?? served(url)
  );
}

/** The inbox over the routes a case names, the abilities read answering as
 * those routes do unless the case hands a `fetch` of its own over them. */
function drawInbox(
  route: (url: string) => Response,
  over: (served: typeof fetch) => typeof fetch = (served) => served,
): ApiDouble {
  const api = apiDouble({ operation: operationAt("Pending"), route });
  vi.stubGlobal("fetch", over(api.fetch));
  render(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <InboxScreen partition={atlas} />
    </ScreenHarness>,
  );
  return api;
}

/** The inbox over `api`, and the stream its frames are pushed down. */
function drawInboxOver(api: ApiDouble): ReturnType<typeof openedStream> {
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={server.ports.fetch}
    >
      <InboxScreen partition={atlas} />
    </ScreenHarness>,
  );
  return server;
}

test("a row names the ticket it is about beside its number", async () => {
  drawInbox(served);
  expect(await screen.findByText("Serve the reason")).toBeDefined();
});

test("an answered row stays until a Ticket frame moves it out of the section", async () => {
  let tickets = [escalated];
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: (url) => served(url, tickets),
  });
  const server = drawInboxOver(api);
  await settled();
  expect(screen.getByRole("button", { name: "resume" })).toBeDefined();

  await turned(() => {
    screen.getByRole("button", { name: "resume" }).click();
  });
  expect(api.submissions()).toBe(1);
  expect(
    screen.queryByRole("button", { name: "resume" }),
    "the answered row left the inbox before a frame said the ticket had moved",
  ).not.toBeNull();
  expect(screen.queryByText("Inbox is clear")).toBeNull();

  tickets = [];
  await turned(() => {
    server.push(
      frame("Ticket", "7", {
        version: 1,
        resource: "4",
        representation: working,
      }),
    );
  });
  await settled();
  expect(screen.queryByRole("button", { name: "resume" })).toBeNull();
  expect(screen.getByText("Inbox is clear")).toBeDefined();
});

/** Revoke ends the ticket for good, so a row asks before it sends one: the
 * press and Cancel send nothing, and the ask stays, busy, once it has. */
test("revoke asks before it is sent, and only the ask's own button sends it", async () => {
  waiting.held = true;
  const api = drawInbox(served);
  await settled();
  const ask = (): HTMLElement | null =>
    screen.queryByRole("group", { name: "Revoke this ticket?" });

  await turned(() => {
    screen.getByRole("button", { name: "revoke" }).click();
  });
  const group = ask();
  if (group === null) throw new Error("revoke opened no ask");
  expect(api.submissions()).toBe(0);
  await turned(() => {
    within(group).getByRole("button", { name: "Cancel" }).click();
  });
  expect(ask()).toBeNull();
  expect(api.submissions()).toBe(0);

  await turned(() => {
    screen.getByRole("button", { name: "revoke" }).click();
  });
  await turned(() => {
    screen.getByRole("button", { name: "Revoke ticket" }).click();
  });
  expect(api.submissions()).toBe(1);
  expect(api.submitted()).toMatchObject({
    mutation: { mutation: "RevokeTicket", ticket: 4 },
  });
  expect(
    screen
      .getByRole("button", { name: "Revoke ticket" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

/** The bar's current entry already says Inbox and how many it holds, so the
 * page draws no row of its own saying either. */
test("the inbox names itself only for a reader who does not see the bar", async () => {
  drawInbox(served);
  await settled();
  const heading = screen.getByRole("heading", { name: "Inbox" });
  expect(heading.className).toBe("visually-hidden");
  expect(heading.nextElementSibling?.textContent).not.toBe("1");
});

test("an answer's button still opens the sentence it sends", async () => {
  drawInbox(served);
  await settled();
  const button = screen.getByRole("button", { name: "resume" });
  const trigger = button.closest('[tabindex="0"]');
  if (trigger === null) throw new Error("no tooltip trigger around resume");
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "rejoin the pipeline at the point this ticket was parked at",
  );
});

/**
 * A refused ticket keeps its phase and has no open question behind it, so the
 * reason the refusal names is what the reader came for.
 */
test("a ticket the lead refused is a row of its own, marked and reasoned", async () => {
  drawInbox(servedWithRefusal);
  await settled();
  expect(screen.getByRole("link", { name: "42" })).toBeDefined();
  const trigger = screen.getByText("Standing").closest('[tabindex="0"]');
  if (trigger === null) throw new Error("no tooltip trigger around Standing");
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "the brief names no reference",
  );
});

/** The served policy refuses `style-src` but `'self'`, so nothing this screen
 * draws — a tooltip open included — may append a runtime style element. */
test("nothing the inbox screen draws is a runtime style element", async () => {
  drawInbox(servedWithRefusal);
  await settled();
  expect(document.querySelectorAll("style").length).toBe(0);
  const trigger = screen.getByText("Standing").closest('[tabindex="0"]');
  if (trigger === null) throw new Error("no tooltip trigger around Standing");
  fireEvent.focus(trigger);
  await screen.findByRole("tooltip");
  expect(document.querySelectorAll("style").length).toBe(0);
});

/** The run the escalated ticket last held, which has ended in a failure. */
const failedRun = {
  execution: "e4",
  ticket: 4,
  task: 1,
  taskKind: "Work",
  identity: { type: "WorkTask", value: { ticket: 4, cycle: 1 } },
  cluster: "rig",
  configurationRevision: "r1",
  requirementIdentity: "requirement-a",
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: "chuggy/worker",
  },
  requirementDigest: "b".repeat(64),
  requirementSource: "TicketDefault",
  platformDefaultVersion: 1,
  status: "Terminal",
  outcome: "Failed",
  retriesSpent: 0,
  registeredAt: "2026-08-26T10:00:00.000Z",
  terminalAt: "2026-08-26T10:30:00.000Z",
};

/** The inbox above, its escalated ticket carrying `run` as its latest. */
function servedCarrying(run: unknown): (url: string) => Response {
  const carrying = {
    ...escalated,
    latestExecution: ticketLatestExecutionSchema.parse(run),
  };
  return (url) => served(url, [carrying]);
}

test("a row says how its last run ended, and never Terminal", async () => {
  drawInbox(servedCarrying(failedRun));
  await settled();
  expect(screen.getByText("Failed").className).toContain("pill-fail");
  expect(document.body.textContent).not.toContain("Terminal");
});

/** The escalated ticket's run admitted again and not yet begun, which its
 * ticket page draws as Starting rather than as the status the wire sends. */
const admittedRun = {
  ...failedRun,
  status: "Admitted",
  outcome: undefined,
  terminalAt: undefined,
};

test("a row draws a run still waiting for its worker as its ticket page does", async () => {
  drawInbox(servedCarrying(admittedRun));
  await settled();
  expect(screen.getByText("Starting").className).toBe("pill pill-queued");
  expect(document.body.textContent).not.toContain("Admitted");
});

test("opening the inbox issues no executions read", async () => {
  const asked: string[] = [];
  drawInbox(
    servedCarrying(failedRun),
    (served) =>
      ((url: string, init?: RequestInit) => {
        asked.push(url);
        return served(url, init);
      }) as typeof fetch,
  );
  await settled();
  expect(await screen.findByText("Failed")).toBeDefined();
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.filter((url) => url.includes("/executions"))).toStrictEqual([]);
});

/** The frame carries no latest execution, so the row it brings in is the one
 * the inbox's read answers, which does. */
test("a ticket escalating while the inbox is open draws how its last run ended", async () => {
  let tickets: readonly ProjectTicket[] = [];
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: (url) => served(url, tickets),
  });
  const server = drawInboxOver(api);
  await settled();
  expect(screen.getByText("Inbox is clear")).toBeDefined();
  tickets = [
    {
      ...escalated,
      latestExecution: ticketLatestExecutionSchema.parse(failedRun),
    },
  ];
  await turned(() => {
    server.push(
      frame("Ticket", "7", {
        version: 1,
        resource: "4",
        representation: escalated,
      }),
    );
  });
  await settled();
  expect(screen.getByText("Serve the reason")).toBeDefined();
  expect(screen.getByText("Failed").className).toContain("pill-fail");
});

test("a reader who may not mutate keeps the row and is offered no answer", async () => {
  drawInbox(served, abilitiesOver({ ...abilitiesEvery, mutate: false }));
  await settled();
  expect(screen.getByText("Serve the reason")).toBeDefined();
  expect(screen.queryByRole("button", { name: "resume" })).toBeNull();
  expect(screen.queryByRole("button", { name: "revoke" })).toBeNull();
});

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered the row's answers",
  async (_said, abilities) => {
    drawInbox(served, abilitiesOver(abilities));
    await settled();
    expect(screen.getByRole("button", { name: "resume" })).toBeDefined();
    expect(screen.getByRole("button", { name: "revoke" })).toBeDefined();
  },
);

/** The notice a refused import raises over the rows, as a reader reads it. */
function importRefusedNotice(): string | null {
  return screen.queryByText(/^Import refused/u)?.textContent ?? null;
}

test("a live binding whose newest import was refused raises one notice naming it, and how many more were", async () => {
  drawInbox(
    repositoryImportListed(
      [
        repositoryImportRefusedBinding("https://github.com/acme/widgets.git"),
        repositoryImportRefusedBinding("https://github.com/acme/gears.git"),
      ],
      served,
    ),
  );
  await settled();
  expect(importRefusedNotice()).toBe("Import refused · acme/widgets · 1 more");
  expect(screen.getByRole("link", { name: "acme/widgets" })).toBeDefined();
});

test("a retired binding's refused import raises no notice", async () => {
  drawInbox(
    repositoryImportListed(
      [
        repositoryImportRefusedBinding(
          "https://github.com/acme/widgets.git",
          "2026-10-18T00:00:00Z",
        ),
      ],
      served,
    ),
  );
  await settled();
  expect(await screen.findByText("Serve the reason")).toBeDefined();
  expect(importRefusedNotice()).toBeNull();
});

/** A frame of each kind that can move a ticket into or out of the inbox, and one that cannot. */
const inboxFrames: readonly (readonly [string, string, number])[] = [
  [
    "an open action",
    frame("NativeAction", "20", {
      version: 1,
      resource: "9",
      representation: { actions: [] },
    }),
    1,
  ],
  [
    "a refusal",
    frame("AgenticRefusal", "20", {
      version: 1,
      resource: "9",
      representation: null,
    }),
    1,
  ],
  [
    "a ticket the inbox holds",
    frame("Ticket", "20", {
      version: 1,
      resource: "4",
      representation: working,
    }),
    1,
  ],
  [
    "a ticket arriving in a phase the inbox holds",
    frame("Ticket", "20", {
      version: 1,
      resource: "9",
      representation: { ...escalated, ticket: 9 },
    }),
    1,
  ],
  [
    "a ticket the inbox neither holds nor would",
    frame("Ticket", "20", {
      version: 1,
      resource: "9",
      representation: { ...working, ticket: 9 },
    }),
    0,
  ],
];

test.each(inboxFrames)(
  "a frame about %s reads the inbox again that many times, and nothing else",
  async (_about, pushed, rereads) => {
    const asked: string[] = [];
    const api = apiDouble({
      operation: operationAt("Pending"),
      route: (url) => {
        asked.push(url);
        return served(url);
      },
    });
    const server = drawInboxOver(api);
    await settled();
    asked.length = 0;
    await turned(() => {
      server.push(pushed);
    });
    await settled();
    expect(asked.filter((url) => url.includes("/inbox"))).toHaveLength(rereads);
    expect(asked.filter((url) => !url.includes("/inbox"))).toStrictEqual([]);
  },
);

/** A second escalated ticket, which the inbox's second page holds. */
const escalatedLater: ProjectTicket = {
  ...escalated,
  ticket: 5,
  title: "Serve the second reason",
};

/** The inbox answered in two pages, the first carrying `first` and naming a
 * cursor to the second, which holds the later escalation; every other route
 * answers as `served` does. Each inbox read is recorded by the cursor it
 * asked from, and a read of the first page while `holding` answers once its
 * held answer is released. */
function drawInboxPaged(first: () => ProjectTicket) {
  const asked: (string | null)[] = [];
  const holds: ReturnType<typeof heldAnswer>[] = [];
  const paging = { holding: false };
  const api = apiDouble({
    operation: operationAt("Pending"),
    route: (url) => served(url),
  });
  const pages = (url: string): Response | Promise<Response> => {
    const cursor = new URL(url, "http://stub").searchParams.get("cursor");
    asked.push(cursor);
    if (cursor !== null) return answer(inboxBody([inboxEntry(escalatedLater)]));
    const page = (): Response =>
      answer(
        inboxBody([inboxEntry(first())], { count: 2, nextCursor: "inbox-2" }),
      );
    if (!paging.holding) return page();
    const hold = heldAnswer();
    holds.push(hold);
    return hold.answered.then(page);
  };
  const server = drawInboxOver({
    ...api,
    fetch: ((url: string, init?: RequestInit) =>
      inboxAsked(url)
        ? Promise.resolve(pages(url))
        : api.fetch(url, init)) as typeof fetch,
  });
  return { asked, holds, paging, server };
}

test("a more pressed while the inbox is read again keeps its page and a frame folded meanwhile, and the read is asked again for the pages held", async () => {
  let run: unknown = undefined;
  const drawn = drawInboxPaged(() =>
    run === undefined
      ? escalated
      : {
          ...escalated,
          latestExecution: ticketLatestExecutionSchema.parse(run),
        },
  );
  await settled();
  drawn.paging.holding = true;
  await turned(() => {
    drawn.server.push(
      frame("Ticket", "7", {
        version: 1,
        resource: "4",
        representation: escalated,
      }),
    );
  });
  run = failedRun;
  await turned(() => {
    drawn.server.push(
      frame("Execution", "8", {
        version: 1,
        resource: "e4",
        representation: failedRun,
      }),
    );
  });
  await settled();
  expect(screen.getByText("Failed")).toBeDefined();
  const pressedAt = drawn.asked.length;
  await press("more");
  expect(screen.getByText("Serve the second reason")).toBeDefined();
  expect(screen.getByText("Failed")).toBeDefined();
  const [stale, restarted] = drawn.holds;
  stale?.release(answer({}));
  await settled();
  expect(screen.getByText("Serve the second reason")).toBeDefined();
  restarted?.release(answer({}));
  await settled();
  expect(screen.getByText("Serve the reason")).toBeDefined();
  expect(screen.getByText("Serve the second reason")).toBeDefined();
  expect(screen.getByText("Failed")).toBeDefined();
  expect(drawn.asked.slice(pressedAt)).toStrictEqual([
    "inbox-2",
    null,
    "inbox-2",
  ]);
});

test("a more pressed while no read of the inbox is running starts none", async () => {
  const drawn = drawInboxPaged(() => escalated);
  await settled();
  const pressedAt = drawn.asked.length;
  await press("more");
  expect(screen.getByText("Serve the second reason")).toBeDefined();
  expect(drawn.asked.slice(pressedAt)).toStrictEqual(["inbox-2"]);
});

/** Every operation identity a request names, submitted or polled. */
function inboxIdentityNamed(
  url: string,
  init?: RequestInit,
): string | undefined {
  if (init?.method === "POST") {
    const body: unknown = JSON.parse(
      typeof init.body === "string" ? init.body : "null",
    );
    return (body as { readonly operation?: string }).operation;
  }
  return url.includes("/operations/")
    ? url.slice(url.lastIndexOf("/") + 1)
    : undefined;
}

/**
 * A submission whose answer was lost may still have been taken, so a press of
 * the row after it, on an inbox drawn again, asks about that submission rather
 * than drawing a second identity for the one intent.
 */
test("an inbox press after a lost answer sends the same operation identity as the first press", async () => {
  const api = apiDouble({ operation: operationAt("Pending"), route: served });
  const named: string[] = [];
  const lost = { answer: true };
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const identity = inboxIdentityNamed(url, init);
    if (identity !== undefined) named.push(identity);
    if (init?.method === "POST" && lost.answer) {
      lost.answer = false;
      return Promise.reject(new Error("the connection went"));
    }
    return api.fetch(url, init);
  });
  const visit = visitHeld();
  render(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <visit.Visited>
        <InboxScreen partition={atlas} />
      </visit.Visited>
    </ScreenHarness>,
  );
  await settled();
  await press("resume");
  const first = named[0];
  expect(first).toBeDefined();
  expect(
    screen.getByRole("button", { name: "resume" }).hasAttribute("disabled"),
  ).toBe(false);

  await visit.visited(false);
  await visit.visited(true);
  await press("resume");

  expect(named.length).toBeGreaterThan(1);
  expect(new Set(named)).toStrictEqual(new Set([first]));
});
