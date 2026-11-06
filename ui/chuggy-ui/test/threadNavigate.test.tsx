/**
 * The console following a `navigate`: it moves to the page named, from the
 * page the message was sent from, once — a page drawn again, as a reload or a
 * second tab draws it, does not move it again — and never for a member's own
 * chat.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ConsolePage } from "../../../src/contract/consolePage.ts";
import { ThreadNavigateFollowed } from "../app/browser/thread/ThreadNavigate.tsx";
import type { ConversationExchange } from "../app/core/conversation.ts";
import { threadNavigateAppliedKey } from "../app/core/threadOffers.ts";
import { threadBody, threadHome } from "./threadFixture.ts";
import type * as RouterModule from "@tanstack/react-router";

const navigated: { readonly href: string }[] = [];

/** The route the router stands on, which a case moves. */
let standing = {
  routeId: "/$tenant/$project/tickets/$ticket",
  params: { tenant: "acme", project: "atlas", ticket: "41" },
};

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useNavigate: () => (to: { readonly href: string }) => {
    navigated.push(to);
    return Promise.resolve();
  },
  useRouterState: (options: { readonly select: (state: unknown) => unknown }) =>
    options.select({
      location: { pathname: "/", search: {} },
      matches: [standing],
    }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  navigated.length = 0;
  localStorage.clear();
  standing = {
    routeId: "/$tenant/$project/tickets/$ticket",
    params: { tenant: "acme", project: "atlas", ticket: "41" },
  };
});

afterEach(() => {
  cleanup();
});

const sentFrom: ConsolePage = { page: "Ticket", ticket: 41 };

const exchanges: readonly ConversationExchange[] = [
  {
    id: "x1",
    ask: { ask: "Message", text: "open it for editing", page: sentFrom },
    work: [
      {
        step: "ToolCall",
        id: "toolu_navigate",
        name: "mcp__chuggy__navigate",
        input: { page: "TicketEdit", ticket: 41 },
        result: { text: "ok", isError: false },
      },
    ],
    standing: { standing: "Answered" },
    before: [],
  },
];

test("the console moves to the page the thread named, and a page drawn again does not move it again", () => {
  const first = render(
    <ThreadNavigateFollowed
      home={threadHome}
      thread={threadBody({})}
      exchanges={exchanges}
    />,
  );
  expect(navigated).toStrictEqual([{ href: "/acme/atlas/tickets/41/edit" }]);
  expect(localStorage.getItem(threadNavigateAppliedKey)).toBe(
    JSON.stringify(["toolu_navigate"]),
  );
  first.unmount();
  render(
    <ThreadNavigateFollowed
      home={threadHome}
      thread={threadBody({})}
      exchanges={exchanges}
    />,
  );
  expect(navigated).toHaveLength(1);
});

test("a console no longer on the page the message was sent from is not moved", () => {
  standing = {
    routeId: "/$tenant/$project/inbox",
    params: { tenant: "acme", project: "atlas", ticket: "41" },
  };
  render(
    <ThreadNavigateFollowed
      home={threadHome}
      thread={threadBody({})}
      exchanges={exchanges}
    />,
  );
  expect(navigated).toStrictEqual([]);
  expect(localStorage.getItem(threadNavigateAppliedKey)).toBeNull();
});

test("another member's thread and a member's own chat move nothing", () => {
  render(
    <>
      <ThreadNavigateFollowed
        home={threadHome}
        thread={threadBody({ mine: false })}
        exchanges={exchanges}
      />
      <ThreadNavigateFollowed
        home={{ scope: "Member", tenant: "acme" }}
        thread={threadBody({})}
        exchanges={exchanges}
      />
    </>,
  );
  expect(navigated).toStrictEqual([]);
});
