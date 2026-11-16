// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  answer,
  apiDouble,
  heldAnswer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import {
  abilitiesEvery,
  abilitiesOver,
  abilitiesNone,
  abilitiesUnrefusing,
  unanswered,
} from "./projectAbilitiesFixture.ts";
import {
  ticketDispatchViewOf,
  ticketPageCandidate,
  ticketPageRoutes,
} from "./ticketPageFixture.ts";
import {
  dispatchAskTitle,
  dispatchButtonName,
} from "./ticketDispatchPressed.ts";
import { workRunnerOver, workRunnerUnreadable } from "./workRunnerReads.ts";
import type { WorkRunnerReads } from "./workRunnerReads.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import { TicketPageEveryTab, ticketHeader } from "./ticketPageEveryTab.tsx";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

beforeEach(() => {
  viewportAtEm(viewportDeskEm);
});

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a dispatchable ticket submits the version from the strict view", async () => {
  const api = apiDouble({
    operation: {
      operation: "op-one",
      acceptedAt: "2026-08-26T10:00:00Z",
      state: "Succeeded",
      decidedSequence: 8,
    },
    route: ticketPageRoutes(atlas, () =>
      ticketDispatchViewOf(atlas, [ticketPageCandidate]),
    ),
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  renderCopied(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={server.ports.fetch}
    >
      <TicketPageEveryTab />
    </ScreenHarness>,
  );
  await settled();

  const dispatch = within(ticketHeader()).getByRole("button", {
    name: dispatchButtonName,
  });
  expect(dispatch.classList.contains("btn-primary")).toBe(true);
  await turned(() => {
    dispatch.click();
  });
  expect(api.submitted()).toBeUndefined();
  await turned(() => {
    within(screen.getByRole("dialog", { name: dispatchAskTitle(11) }))
      .getByRole("button", { name: "Dispatch" })
      .click();
  });

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(api.submitted()).toMatchObject({
    mutation: {
      mutation: "ManualDispatch",
      ticket: 11,
      expectedTicketVersion: 4,
    },
  });
});

/** The page with the ticket a dispatch candidate or not as `candidate` says,
 * and the abilities read answering as the page's other reads do unless `over`
 * answers it. */
async function drawnDispatching(
  candidate = true,
  over: (served: typeof fetch) => typeof fetch = (served) => served,
): Promise<void> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: ticketPageRoutes(atlas, () =>
      ticketDispatchViewOf(atlas, candidate ? [ticketPageCandidate] : []),
    ),
  });
  vi.stubGlobal("fetch", over(api.fetch));
  const server = openedStream();
  renderCopied(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={server.ports.fetch}
    >
      <TicketPageEveryTab />
    </ScreenHarness>,
  );
  await settled();
}

const byHand = "No lead · Dispatched by hand";

/** A press is how every released ticket runs, so the header offers it and
 * says nothing of a hand beside it. */
test("a dispatch candidate is offered Dispatch, with no line of the hand", async () => {
  await drawnDispatching();
  expect(
    screen.getByRole("button", { name: dispatchButtonName }),
  ).toBeDefined();
  expect(screen.queryByText(byHand)).toBeNull();
});

test("a ticket offered no Dispatch draws no Dispatch", async () => {
  await drawnDispatching(false);
  expect(screen.queryByRole("button", { name: dispatchButtonName })).toBeNull();
});

function dispatchOffered(): boolean {
  return screen.queryByRole("button", { name: dispatchButtonName }) !== null;
}

test("a reader who may not dispatch is offered no Dispatch", async () => {
  await drawnDispatching(
    true,
    abilitiesOver({ ...abilitiesEvery, dispatch: false }),
  );
  expect(dispatchOffered()).toBe(false);
  expect(screen.getByText("Edit")).toBeDefined();
});

test("a reader who may dispatch and not mutate is offered Dispatch alone", async () => {
  await drawnDispatching(
    true,
    abilitiesOver({ ...abilitiesNone, dispatch: true }),
  );
  expect(dispatchOffered()).toBe(true);
  expect(screen.queryByText("Edit")).toBeNull();
});

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered Dispatch",
  async (_said, abilities) => {
    await drawnDispatching(true, abilitiesOver(abilities));
    expect(dispatchOffered()).toBe(true);
    expect(screen.getByText("Edit")).toBeDefined();
  },
);

/** The line the bar draws where a Dispatch gave way, or nothing where it
 * draws none. */
function noRunnerLine(): HTMLElement | null {
  return (
    screen.queryByRole("link", { name: "Add runner" })?.parentElement ?? null
  );
}

/** The page with the reads its runner is decided from answering as the case
 * says. */
async function drawnWithRunner(
  reads: WorkRunnerReads,
  candidate = true,
  over: (served: typeof fetch) => typeof fetch = (served) => served,
): Promise<void> {
  await drawnDispatching(candidate, (served) =>
    workRunnerOver(reads)(over(served)),
  );
}

/** A press there would escalate the ticket, so the header draws the way to a
 * runner where the press would be. */
test("a ticket whose project has no runner for its work draws the way to one in Dispatch's place", async () => {
  await drawnWithRunner({ runners: "Unregistered" });
  expect(dispatchOffered()).toBe(false);
  const line = noRunnerLine();
  expect(line?.textContent).toBe("No runner · Add runner");
  expect(line !== null && ticketHeader().contains(line)).toBe(true);
  expect(screen.getByText("Edit")).toBeDefined();
});

/** A read the API refuses, answered afresh for each request. */
function refusedRead(): Promise<Response> {
  return Promise.resolve(answer({}, 403));
}

const runnerReadsStartable: readonly (readonly [string, WorkRunnerReads])[] = [
  ["with a runner that is live", { runners: "Live" }],
  ["with a runner that is offline", { runners: "Offline" }],
  [
    "with no runner, whose owner's own may take its work",
    { runners: "Unregistered", mine: "Unregistered", fallback: "Strict" },
  ],
  [
    "whose work the cluster runs, with no runner",
    { runners: "Unregistered", work: "InCluster" },
  ],
  ["whose runners read has not come back", { runners: unanswered }],
  [
    "whose route read has not come back",
    { runners: "Unregistered", work: unanswered },
  ],
  ["whose runners read failed", { runners: workRunnerUnreadable }],
  [
    "whose route read failed",
    { runners: "Unregistered", work: workRunnerUnreadable },
  ],
  ["whose runners read was refused", { runners: refusedRead }],
  [
    "whose route read was refused",
    { runners: "Unregistered", work: refusedRead },
  ],
];

test.each(runnerReadsStartable)(
  "a ticket in a project %s is offered Dispatch as it was",
  async (_project, reads) => {
    await drawnWithRunner(reads);
    expect(dispatchOffered()).toBe(true);
    expect(noRunnerLine()).toBeNull();
  },
);

test("a Dispatch offered while the runners read was out gives way once it answers none", async () => {
  const held = heldAnswer();
  await drawnWithRunner({ runners: () => held.answered });
  expect(dispatchOffered()).toBe(true);
  await turned(() => {
    held.release(answer(sessionPlacementBody({ project: "Unregistered" })));
  });
  await settled();
  expect(dispatchOffered()).toBe(false);
  expect(noRunnerLine()?.textContent).toBe("No runner · Add runner");
});

/** The line stands in for a Dispatch, so a ticket that would have been
 * offered none is told nothing of a runner. */
test("a ticket offered no Dispatch is told nothing of a runner, with none registered", async () => {
  await drawnWithRunner({ runners: "Unregistered" }, false);
  expect(dispatchOffered()).toBe(false);
  expect(noRunnerLine()).toBeNull();
});

test("a reader who may not dispatch is told nothing of a runner, with none registered", async () => {
  await drawnWithRunner(
    { runners: "Unregistered" },
    true,
    abilitiesOver({ ...abilitiesEvery, dispatch: false }),
  );
  expect(dispatchOffered()).toBe(false);
  expect(noRunnerLine()).toBeNull();
  expect(screen.getByText("Edit")).toBeDefined();
});
