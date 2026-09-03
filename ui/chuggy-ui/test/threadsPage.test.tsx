/**
 * The project's threads: which one is the reader's own, what an owner nobody
 * has any more is drawn as, and who is offered a thread to open.
 *
 * THE `Open` CONTROL IS OFFERED FROM THE LISTING'S OWN `mine` AND NOTHING ELSE.
 * A page that worked out whose thread was whose in the browser would offer a
 * second thread to a member who has one, and the route — which is idempotent —
 * would answer with the thread they already had while the page said it had
 * opened one. So both arms are cases: offered where the listing carries no
 * thread of theirs, and absent where it does.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { ThreadsPage } from "../app/browser/ThreadsPage.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import {
  threadMineSession,
  threadOrphanSession,
  threadOtherSession,
  threadPartition,
  threadsBody,
  threadsBodyWithoutMine,
} from "./threadFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

const navigations: unknown[] = [];

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useNavigate: () => (to: unknown) => {
    navigations.push(to);
  },
  useParams: () => ({ ...threadPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  navigations.length = 0;
  vi.unstubAllGlobals();
});

/** The listing route answering one body, with every post recorded. */
function drawThreads(
  listing: () => unknown,
  opening: () => { readonly body: unknown; readonly status: number } = () => ({
    body: {
      session: threadMineSession,
      state: "Open",
      mine: true,
      turns: 0,
      owner: "geoff",
    },
    status: 201,
  }),
): { readonly posts: () => number } {
  let posts = 0;
  const fetching = (
    url: string,
    init?: { readonly method?: string },
  ): Promise<Response> => {
    if (init?.method === "POST") {
      posts += 1;
      const answered = opening();
      return Promise.resolve(answer(answered.body, answered.status));
    }
    if (url.includes("/threads"))
      return Promise.resolve(answer(listing() as object));
    return Promise.resolve(
      answer({ partition: threadPartition, sequence: 1, tickets: [] }),
    );
  };
  vi.stubGlobal("fetch", fetching);
  return { posts: () => posts };
}

async function mountThreads(): Promise<void> {
  const server = openedStream();
  render(
    <ScreenHarness
      partition={threadPartition}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <ThreadsPage />
    </ScreenHarness>,
  );
  await settled();
}

function rowSessions(): readonly string[] {
  return [...document.querySelectorAll("tbody tr td:first-child")].map(
    (cell) => cell.textContent ?? "",
  );
}

/** The listing answers the reader's own thread second, so a page that drew the
 * server's order would put someone else's at the top. */
test("my thread is drawn first and marked", async () => {
  drawThreads(threadsBody);
  await mountThreads();
  expect(rowSessions()[0], "the listing's own order was drawn").toBe(
    threadMineSession,
  );
  expect(rowSessions()).toContain(threadOtherSession);
  const marked = [
    ...document.querySelectorAll("tbody tr td:nth-child(2) .pill"),
  ];
  expect(marked.map((pill) => pill.textContent)).toStrictEqual(["Mine"]);
  expect(
    marked[0]?.closest("tr")?.querySelector("td")?.textContent,
    "a thread that is not the reader's own was marked as theirs",
  ).toBe(threadMineSession);
});

/** An open session whose owner's membership is gone still acts as that member,
 * and an administrator has to be able to see one. */
test("a thread whose owner is gone is listed as Orphaned", async () => {
  drawThreads(threadsBody);
  await mountThreads();
  expect(rowSessions()).toContain(threadOrphanSession);
  expect(screen.getByText("Orphaned")).toBeDefined();
});

test("a member with a thread is offered no Open", async () => {
  drawThreads(threadsBody);
  await mountThreads();
  expect(
    screen.queryByRole("button", { name: "Open" }),
    "a member who already has a thread was offered a second",
  ).toBeNull();
});

test("a member with no thread opens one and is taken to it", async () => {
  const server = drawThreads(threadsBodyWithoutMine);
  await mountThreads();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
  });
  await settled();
  expect(server.posts()).toBe(1);
  expect(navigations.at(-1)).toStrictEqual({
    to: "/$tenant/$project/threads/$session",
    params: { ...threadPartition, session: threadMineSession },
  });
});

/** A refused open is said with its reason and takes the reader nowhere: a
 * navigation to a thread the server did not open is a page that cannot load. */
test("an open the server refused says so and navigates nowhere", async () => {
  drawThreads(threadsBodyWithoutMine, () => ({
    body: { error: { code: "Forbidden", message: "no" } },
    status: 403,
  }));
  await mountThreads();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
  });
  await settled();
  expect(screen.getByText(/^Refused · /u)).toBeDefined();
  expect(navigations.length, "a refused open navigated anyway").toBe(0);
});

test("a project with no threads says so", async () => {
  drawThreads(() => ({ threads: [] }));
  await mountThreads();
  expect(screen.getByText("No threads")).toBeDefined();
});
