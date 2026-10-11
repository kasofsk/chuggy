/**
 * The lead's held decisions in the inbox: a row per ticket a decision names,
 * Approve and Reject answering the decision whole, and the row leaving only
 * when the held decisions read again no longer name it.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
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
import { selectorReviewFeedbackCharsMax } from "../../../src/contract/http.ts";
import type { SelectorProposalResponse } from "../../../src/contract/responses.ts";
import { selectorProposalNotHeldCode } from "../../../src/contract/rosters.ts";
import { InboxScreen } from "../app/browser/Inbox.tsx";
import { projectAbilitiesResource } from "../app/browser/projectAbilities.tsx";
import { projectResourceKey } from "../app/core/projectQueryKeys.ts";
import {
  abilitiesEvery,
  abilitiesFetch,
  abilitiesNone,
  addressesKept,
  unanswered,
} from "./projectAbilitiesFixture.ts";
import type { AbilitiesAnswer } from "./projectAbilitiesFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => atlas,
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const both: SelectorProposalResponse = { decision: "dec-one", tickets: [7, 8] };

interface Reviewed {
  readonly url: string;
  readonly body: unknown;
}

/** The inbox over whatever `fetch` the case has stubbed, and the cache it
 * reads into. */
function inboxDrawn(): QueryClient {
  const client = new QueryClient();
  render(
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <InboxScreen partition={atlas} />
    </ScreenHarness>,
  );
  return client;
}

/**
 * A project whose only questions are the lead's held decisions. A review ends
 * the decision it names.
 */
function drawProject(served: {
  readonly held: readonly SelectorProposalResponse[];
  /** Someone else ends the decision first, so the review is refused as no longer held. */
  readonly answeredElsewhere?: boolean;
  /** The review is refused as a fault. */
  readonly failing?: boolean;
  /** The review is never answered. */
  readonly unanswered?: boolean;
  /** The review is answered, but never the read after it. */
  readonly rereadHeld?: boolean;
  /** A reader who may not dispatch, whom the read answers as it answers a project they cannot see. */
  readonly absent?: boolean;
  /** What the abilities read answers: every door unless the case says, and `undefined` never answers it. */
  readonly abilities?: AbilitiesAnswer;
}): {
  readonly reviewed: readonly Reviewed[];
  readonly proposalsAsked: () => number;
  readonly client: QueryClient;
} {
  const reviewed: Reviewed[] = [];
  let held = [...served.held];
  let answered = false;
  const respond = (
    url: string,
    init?: { method?: string; body?: string },
  ): Response | undefined => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body ?? "null") as {
        readonly outcome: string;
      };
      reviewed.push({ url, body });
      if (served.unanswered === true) return undefined;
      if (served.failing === true)
        return answer(
          { error: { code: "InternalError", message: "fault" } },
          500,
        );
      const named = held.find((proposal) =>
        url.endsWith(`/selector-proposals/${proposal.decision}/review`),
      );
      held = held.filter((proposal) => proposal !== named);
      answered = named !== undefined;
      return named === undefined || served.answeredElsewhere === true
        ? answer(
            { error: { code: selectorProposalNotHeldCode, message: "held" } },
            409,
          )
        : answer({ decision: named.decision, outcome: body.outcome });
    }
    if (url.includes("/selector-proposals")) {
      if (answered && served.rereadHeld === true) return undefined;
      return served.absent === true
        ? answer({ error: { code: "NotFound", message: "absent" } }, 404)
        : answer({ proposals: held, more: false });
    }
    if (url.includes("/agentic-refusals"))
      return answer({ refusals: [], more: false });
    if (url.includes("/native-actions")) return answer({ actions: [] });
    if (url.includes("/executions")) return answer({ executions: [] });
    return answer({ partition: atlas, sequence: 9, tickets: [] });
  };
  const kept = addressesKept(
    abilitiesFetch(
      "abilities" in served ? served.abilities : abilitiesEvery,
      ((url: string, init?: { method?: string; body?: string }) =>
        respond(url, init) ?? unanswered()) as typeof fetch,
    ),
  );
  vi.stubGlobal("fetch", kept.fetch);
  return {
    reviewed,
    proposalsAsked: () => kept.sentTo("/selector-proposals"),
    client: inboxDrawn(),
  };
}

/** The row a ticket's number link sits in. */
function row(ticket: number): HTMLElement {
  const found = screen
    .getByRole("link", { name: String(ticket) })
    .closest("tr");
  if (found === null) throw new Error(`no row for ticket ${String(ticket)}`);
  return found;
}

function said(): string | undefined {
  return screen.queryByRole("status")?.textContent ?? undefined;
}

test("each ticket a held decision names is a row with Approve and Reject, counted in the badge", async () => {
  drawProject({ held: [both] });
  await settled();
  for (const ticket of [7, 8]) {
    expect(within(row(ticket)).getByText("Proposal")).toBeDefined();
    expect(
      within(row(ticket)).getByRole("button", { name: "approve" }),
    ).toBeDefined();
    expect(
      within(row(ticket)).getByRole("button", { name: "reject" }),
    ).toBeDefined();
    expect(
      within(row(ticket)).queryByText("no action can be sent from here yet"),
    ).toBeNull();
  }
  expect(
    screen.getByRole("heading", { name: "Inbox" }).nextElementSibling
      ?.textContent,
  ).toBe("2");
});

/** Either row's answer is the decision's, so both rows leave on the read that follows it. */
test("approve answers the decision whole, and its rows leave when the read no longer holds it", async () => {
  const api = drawProject({ held: [both] });
  await settled();
  await turned(() => {
    within(row(8)).getByRole("button", { name: "approve" }).click();
  });
  await settled();
  expect(api.reviewed.map((review) => review.body)).toStrictEqual([
    { outcome: "Approved" },
  ]);
  expect(api.reviewed[0]?.url).toMatch(
    /\/tenants\/acme\/projects\/atlas\/selector-proposals\/dec-one\/review$/u,
  );
  expect(screen.queryByText("Proposal")).toBeNull();
  expect(screen.getByText("Inbox is clear")).toBeDefined();
  expect(said()).toBe("Proposal 7, 8 · Approved");
});

test("reject asks first, sends nothing on Cancel, and sends the note it was given", async () => {
  const api = drawProject({ held: [both] });
  await settled();
  const ask = () =>
    screen.queryByRole("group", { name: "Reject this proposal?" });
  await turned(() => {
    within(row(7)).getByRole("button", { name: "reject" }).click();
  });
  const group = ask();
  if (group === null) throw new Error("reject opened no ask");
  await turned(() => {
    within(group).getByRole("button", { name: "Cancel" }).click();
  });
  expect(ask()).toBeNull();
  expect(api.reviewed).toStrictEqual([]);

  await turned(() => {
    within(row(7)).getByRole("button", { name: "reject" }).click();
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
    target: { value: "  after the migration " },
  });
  await turned(() => {
    screen.getByRole("button", { name: "Reject" }).click();
  });
  await settled();
  expect(api.reviewed.map((review) => review.body)).toStrictEqual([
    { outcome: "Rejected", feedback: "after the migration" },
  ]);
  expect(said()).toBe("Proposal 7, 8 · Rejected");
});

/** A second answer sent before the first settles would be refused as stale and
 * said over the answer that landed. */
test("a decision being answered cannot be answered again from either row", async () => {
  const api = drawProject({ held: [both], unanswered: true });
  await settled();
  await turned(() => {
    within(row(7)).getByRole("button", { name: "approve" }).click();
  });
  for (const ticket of [7, 8])
    for (const name of ["approve", "reject"])
      expect(
        within(row(ticket))
          .getByRole("button", { name })
          .hasAttribute("disabled"),
      ).toBe(true);
  expect(api.reviewed.length).toBe(1);
});

/** The rows of an answered decision stay on screen until the read after the answer lands, and stay unanswerable until then. */
test("an answered decision cannot be answered again before the read that removes it", async () => {
  const api = drawProject({ held: [both], rereadHeld: true });
  await settled();
  await turned(() => {
    within(row(7)).getByRole("button", { name: "approve" }).click();
  });
  await settled();
  expect(said()).toBe("Proposal 7, 8 · Approved");
  await turned(() => {
    within(row(8)).getByRole("button", { name: "approve" }).click();
  });
  await settled();
  expect(api.reviewed.length).toBe(1);
  expect(said()).toBe("Proposal 7, 8 · Approved");
});

test("a note is held to what the wire takes as it is typed", async () => {
  drawProject({ held: [both] });
  await settled();
  await turned(() => {
    within(row(7)).getByRole("button", { name: "reject" }).click();
  });
  const note = screen.getByRole("textbox", { name: "Note" });
  fireEvent.change(note, {
    target: { value: "n".repeat(selectorReviewFeedbackCharsMax + 1) },
  });
  expect((note as HTMLInputElement).value.length).toBe(
    selectorReviewFeedbackCharsMax,
  );
});

test("a decision someone else answered first reads as stale, and its rows leave", async () => {
  const api = drawProject({ held: [both], answeredElsewhere: true });
  await settled();
  await turned(() => {
    within(row(7)).getByRole("button", { name: "approve" }).click();
  });
  await settled();
  expect(api.reviewed.length).toBe(1);
  expect(said()).toBe("Proposal 7, 8 · Stale");
  expect(screen.queryByText("Proposal")).toBeNull();
});

test("a review the server failed says why, and leaves the decision to answer again", async () => {
  drawProject({ held: [both], failing: true });
  await settled();
  await turned(() => {
    within(row(7)).getByRole("button", { name: "approve" }).click();
  });
  await settled();
  expect(said()).toBe("Proposal 7, 8 · Failed · InternalError");
  expect(
    within(row(7))
      .getByRole("button", { name: "approve" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

test("a reader who may not dispatch has no proposal and no notice", async () => {
  drawProject({ held: [both], absent: true });
  await settled();
  expect(screen.queryByText("Proposal")).toBeNull();
  expect(screen.queryByText(/^Proposals ·/u)).toBeNull();
  expect(screen.getByText("Inbox is clear")).toBeDefined();
});

test("a reader the abilities read says may not dispatch is never sent the held decisions read", async () => {
  const api = drawProject({
    held: [both],
    abilities: { ...abilitiesEvery, dispatch: false },
  });
  await settled();
  expect(api.proposalsAsked()).toBe(0);
  expect(screen.queryByText("Proposal")).toBeNull();
  expect(screen.getByText("Inbox is clear")).toBeDefined();
});

test("the held decisions are not read while the abilities read is unanswered", async () => {
  const api = drawProject({ held: [both], abilities: undefined });
  await settled();
  expect(api.proposalsAsked()).toBe(0);
  expect(screen.queryByText("Proposal")).toBeNull();
});

test("the held decisions are read once the abilities read says the reader may dispatch", async () => {
  const api = drawProject({
    held: [both],
    abilities: { ...abilitiesNone, dispatch: true },
  });
  await settled();
  expect(api.proposalsAsked()).toBeGreaterThan(0);
  expect(within(row(7)).getByText("Proposal")).toBeDefined();
});

/** A read that went wrong says nothing of what the reader may do, so the
 * decisions are read as they were before there was anything to ask. */
test.each([
  [
    "failed",
    answer({ error: { code: "InternalError", message: "fault" } }, 500),
  ],
  [
    "was absent",
    answer({ error: { code: "NotFound", message: "absent" } }, 404),
  ],
])(
  "the held decisions are read by a reader whose abilities read %s",
  async (_, refusal) => {
    const api = drawProject({
      held: [both],
      abilities: Promise.resolve(refusal),
    });
    await settled();
    expect(api.proposalsAsked()).toBeGreaterThan(0);
    expect(within(row(7)).getByText("Proposal")).toBeDefined();
  },
);

/** A poll that has stopped leaves its last answer in the cache, and a row
 * drawn from it would offer an answer the server now refuses. */
test("held decisions already read are not drawn once the reader may no longer dispatch", async () => {
  const api = drawProject({ held: [both] });
  await settled();
  expect(within(row(7)).getByText("Proposal")).toBeDefined();
  await turned(() => {
    api.client.setQueryData(
      projectResourceKey(atlas, "Project", projectAbilitiesResource),
      { ...abilitiesEvery, dispatch: false },
    );
  });
  await settled();
  expect(screen.queryByText("Proposal")).toBeNull();
});
