/**
 * The head of a chat's own page: the thread's title as the page's one
 * heading, the line naming what it belongs to, its standing, Context, and the
 * menu the pane's header offers on a thread, by the pane's names — Chat menu,
 * holding Copy link, Rename and Close.
 */

import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { consoleQueryClient } from "../app/core/consoleWrite.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { ThreadPageHeader } from "../app/browser/thread/ThreadPageDrawn.tsx";
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import type { CopyWrite } from "../app/browser/ui/copyHeld.tsx";
import { renderCopied } from "./copied.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { Routed } from "./routed.tsx";
import { holderDouble, settled, turned } from "./screenHarness.tsx";
import {
  threadBody,
  threadHome,
  threadMineSession,
  threadOtherSession,
  threadPartition,
} from "./threadFixture.ts";

beforeEach(() => {
  resizeObserverStubbed();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The head as a page draws it, once the router around it has drawn its
 * first page. */
async function renderedActions(
  thread: {
    readonly session: string;
    readonly mine?: boolean;
    readonly title?: string;
    readonly state?: "Open" | "Closed" | "Orphaned";
  },
  drawn: {
    readonly viewOnly?: boolean;
    readonly write?: CopyWrite;
  } = {},
): Promise<void> {
  const read = {
    ...threadBody({
      session: thread.session,
      mine: thread.mine ?? false,
      ...(thread.state === undefined ? {} : { state: thread.state }),
    }),
    ...(thread.title === undefined ? {} : { title: thread.title }),
  };
  renderCopied(
    <QueryClientProvider client={consoleQueryClient()}>
      <SessionProvider holder={holderDouble()}>
        <CopyProvider write={drawn.write ?? (() => Promise.resolve(true))}>
          <Routed>
            <ThreadPageHeader
              home={threadHome}
              thread={read}
              viewOnly={drawn.viewOnly ?? false}
              meta={<a href="/acme/atlas">In atlas</a>}
              context={false}
              onContext={() => undefined}
            />
          </Routed>
        </CopyProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  await settled();
}

/** The thread's page as the router addresses it, which is what its copied
 * address is built from. */
function threadPageHref(session: string): string {
  return `/${threadPartition.tenant}/${threadPartition.project}/threads/${session}`;
}

/** The thread's menu, opened from its trigger. */
async function threadMenuOpened(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole("button", { name: "Chat menu" }), {
    key: "ArrowDown",
  });
  return screen.findByRole("menu");
}

/** The names of what the thread's menu offers, in its order. */
async function threadMenuOffers(): Promise<readonly string[]> {
  const menu = await threadMenuOpened();
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
}

test("the head is the thread's title as its one heading, what it belongs to under it, its standing, Context and the menu, named again on focus", async () => {
  await renderedActions({
    session: threadOtherSession,
    title: "theirs",
    state: "Closed",
  });
  const header = screen.getByRole("banner");
  expect(header.classList.contains("page-header")).toBe(true);
  expect(
    screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent),
  ).toStrictEqual(["theirs"]);
  expect(
    within(header)
      .getByRole("link", { name: "In atlas" })
      .closest(".page-header-meta"),
  ).not.toBeNull();
  expect(
    within(header).getByText("Closed").closest(".page-header-status"),
  ).not.toBeNull();
  expect(
    within(header)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent),
  ).toStrictEqual(["Context", "Chat menu"]);
  const menu = screen.getByRole("button", { name: "Chat menu" });
  fireEvent.focus(menu);
  expect((await screen.findByRole("tooltip")).textContent).toBe("Chat menu");
});

test("the reader's own thread offers Copy link, Rename and Close, and neither Hide nor Show", async () => {
  await renderedActions({ session: threadMineSession, mine: true });
  expect(await threadMenuOffers()).toStrictEqual([
    "Copy link",
    "Rename",
    "Close",
  ]);
});

test("a stranger's thread offers no Rename", async () => {
  await renderedActions({ session: threadOtherSession, mine: false });
  expect(await threadMenuOffers()).toStrictEqual(["Copy link", "Close"]);
});

/** Closing cannot be undone, so Close asks first and Cancel sends nothing. */
test("Close asks what closing does before it closes", async () => {
  const fetched = vi.fn();
  vi.stubGlobal("fetch", fetched);
  await renderedActions({ session: threadOtherSession, mine: false });
  const menu = await threadMenuOpened();
  await turned(() => {
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Close" }));
  });
  expect(screen.queryByRole("menu")).toBeNull();
  const asked = screen.getByRole("group", { name: "Close this chat?" });
  expect(
    [...asked.querySelectorAll("p > span")].map((line) => line.textContent),
  ).toStrictEqual([
    "Not your chat · Ends it for its owner too",
    "Stays in History · Takes no more messages",
    "Drops any reply in progress · Cannot be undone",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("group", { name: "Close this chat?" })).toBeNull();
  expect(fetched).not.toHaveBeenCalled();
});

/** Rename opens the editor in the title's place, and a rename the reader
 * walked away from is one they did not mean to save. */
test("Rename puts the editor in the title's place, and leaving it abandons the rename", async () => {
  await renderedActions({ session: threadMineSession, mine: true });
  const menu = await threadMenuOpened();
  await turned(() => {
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));
  });
  await settled();
  const editor = screen.getByRole("textbox", { name: "Chat title" });
  expect(document.activeElement).toBe(editor);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Chat menu" })).toBeNull();
  fireEvent.change(editor, { target: { value: "never saved" } });
  fireEvent.blur(editor);
  expect(screen.queryByRole("textbox", { name: "Chat title" })).toBeNull();
  expect(screen.getByRole("button", { name: "Chat menu" })).toBeDefined();
});

/** The address is the router's own, written whole for a reader pasting it
 * anywhere else; the menu stays open on the item to say so. */
test("Copy link writes the whole address of the thread's page, and says it did", async () => {
  const write = vi.fn<CopyWrite>(() => Promise.resolve(true));
  await renderedActions({ session: "thread a/b", mine: true }, { write });
  const menu = await threadMenuOpened();
  await act(async () => {
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy link" }));
    await Promise.resolve();
  });
  expect(write).toHaveBeenCalledWith(
    `${location.origin}${threadPageHref(encodeURIComponent("thread a/b"))}`,
  );
  expect(screen.getByRole("menu")).toBe(menu);
  expect(within(menu).getByRole("menuitem", { name: "Copied" })).toBeDefined();
  expect(screen.getByRole("status").textContent).toBe("Copied");
});

test("a write the browser refused claims nothing", async () => {
  const write = vi.fn<CopyWrite>(() => Promise.resolve(false));
  await renderedActions({ session: threadMineSession, mine: true }, { write });
  const menu = await threadMenuOpened();
  await act(async () => {
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy link" }));
    await Promise.resolve();
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(within(menu).queryByRole("menuitem", { name: "Copied" })).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("");
});

/** Reading a thread is not changing it, so a reader who may change nothing
 * still reaches its address. */
test("a reader who may change nothing is still offered Copy link", async () => {
  await renderedActions(
    { session: threadMineSession, mine: true },
    { viewOnly: true },
  );
  expect(await threadMenuOffers()).toStrictEqual(["Copy link"]);
});
