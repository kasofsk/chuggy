/**
 * The chat pane's history: which threads it offers, in what order, and what
 * choosing one hands back. And the menu of what is done to the thread the
 * pane holds: Open, Copy link, Rename and Close.
 *
 * It is the whole of what the Threads page used to be, so the cases that page
 * carried about ordering are here instead.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { consoleQueryClient } from "../app/core/consoleWrite.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import {
  ChatPaneHistory,
  ChatPaneThreadActions,
} from "../app/browser/shell/ChatPaneHistory.tsx";
import type { ChatPaneThreadActionsAt } from "../app/browser/shell/ChatPaneHistory.tsx";
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import type { CopyWrite } from "../app/browser/ui/copyHeld.tsx";
import { Routed } from "./routed.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { holderDouble, settled, turned } from "./screenHarness.tsx";
import {
  threadEntry,
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

const threads = [
  threadEntry({ session: threadOtherSession, owner: "ada", title: "theirs" }),
  threadEntry({
    session: threadMineSession,
    owner: "geoff",
    mine: true,
    title: "mine",
  }),
];

async function historyOpened(
  onChoose: (session: string) => void,
  rows = threads,
): Promise<void> {
  render(
    <ChatPaneHistory
      threads={rows}
      session={threadMineSession}
      onChoose={onChoose}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "History" }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
}

/** The reader's own threads lead, a divider stands between them and everyone
 * else's, and within each part an open thread comes before a closed one
 * whatever order the server answered in. */
test("the reader's own threads come first, divided from everyone else's", async () => {
  await historyOpened(vi.fn(), [
    threadEntry({ session: "ended", title: "ended", state: "Closed" }),
    threadEntry({
      session: "shut",
      title: "shut",
      mine: true,
      state: "Closed",
    }),
    ...threads,
  ]);
  const menu = screen.getByRole("menu");
  expect(
    [
      ...menu.querySelectorAll('[role="menuitemradio"], [role="separator"]'),
    ].map((item) =>
      item.getAttribute("role") === "separator"
        ? "—"
        : /mine|shut|theirs|ended/.exec(item.textContent ?? "")?.[0],
    ),
  ).toStrictEqual(["mine", "shut", "—", "theirs", "ended"]);
});

test("no divider is drawn where only one part has threads", async () => {
  await historyOpened(
    vi.fn(),
    threads.filter((thread) => thread.mine),
  );
  expect(screen.queryByRole("separator")).toBeNull();
});

/** Each part is headed so a reader can tell whose threads they are looking
 * at, whether or not both parts are present. */
test("both headings are drawn where both parts have threads", async () => {
  await historyOpened(vi.fn());
  expect(screen.getByText("Yours")).toBeDefined();
  expect(screen.getByText("Everyone else's")).toBeDefined();
});

test("only the present part's heading is drawn where the reader has only their own threads", async () => {
  await historyOpened(
    vi.fn(),
    threads.filter((thread) => thread.mine),
  );
  expect(screen.getByText("Yours")).toBeDefined();
  expect(screen.queryByText("Everyone else's")).toBeNull();
});

test("only the present part's heading is drawn where the reader has only everyone else's threads", async () => {
  await historyOpened(
    vi.fn(),
    threads.filter((thread) => !thread.mine),
  );
  expect(screen.queryByText("Yours")).toBeNull();
  expect(screen.getByText("Everyone else's")).toBeDefined();
});

/** A heading is not a row: it carries neither role the menu's rows are read
 * by, so it never appears in the sequence the first test asserts. */
test("a heading carries neither role a row or a divider is read by", async () => {
  await historyOpened(vi.fn());
  const heading = screen.getByText("Yours");
  expect(heading.getAttribute("role")).toBeNull();
});

test("the thread the pane holds is the one checked", async () => {
  await historyOpened(vi.fn());
  expect(
    screen
      .getByRole("menuitemradio", { name: /^mine,/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
});

test("choosing a thread hands its session back", async () => {
  const onChoose = vi.fn();
  await historyOpened(onChoose);
  fireEvent.click(screen.getByRole("menuitemradio", { name: /^theirs,/ }));
  expect(onChoose).toHaveBeenCalledWith(threadOtherSession);
});

/** Hiding used to take a thread off the reader's own rail, but the rail is
 * gone and nothing sets the field any more — so a thread hidden before this
 * change is still one the reader can reach. */
test("a hidden thread is offered like any other", async () => {
  await historyOpened(vi.fn(), [
    ...threads,
    threadEntry({ session: "gone", title: "hidden", hidden: true }),
  ]);
  const row = screen.getByRole("menuitemradio", { name: /^hidden,/ });
  expect(row.textContent).toContain("hidden");
});

/** A row says whether its thread still takes messages and when it last moved,
 * so a reader can tell a live thread from one that ended without opening it. */
test("each row names its standing and how long ago it moved", async () => {
  await historyOpened(vi.fn(), [
    threadEntry({ session: threadMineSession, mine: true, title: "live" }),
    threadEntry({ session: "ended", title: "ended", state: "Closed" }),
  ]);
  expect(
    screen.getByRole("menuitemradio", { name: /^live, Open, \d+[smhd] ago$/ }),
  ).toBeDefined();
  expect(
    screen.getByRole("menuitemradio", {
      name: /^ended, Closed, \d+[smhd] ago$/,
    }),
  ).toBeDefined();
});

test("a listing with nothing to offer draws no control", () => {
  render(
    <ChatPaneHistory threads={[]} session={undefined} onChoose={vi.fn()} />,
  );
  expect(screen.queryByRole("button", { name: "History" })).toBeNull();
});

/** The trigger's hidden name is also the tooltip a pointer or a keyboard focus
 * reveals, so a reader who does not use a screen reader learns what History
 * means before ever opening the menu. */
test("the History trigger names itself again as a tooltip on focus", async () => {
  render(
    <ChatPaneHistory
      threads={threads}
      session={threadMineSession}
      onChoose={vi.fn()}
    />,
  );
  const button = screen.getByRole("button", { name: "History" });
  const trigger = button.closest('[tabindex="0"]');
  if (trigger === null) throw new Error("no tooltip trigger around History");
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe("History");
});

/** The actions as a header draws them, once the router around them has
 * drawn its first page. */
async function renderedActions(
  thread: Parameters<typeof threadEntry>[0],
  drawn: {
    readonly at?: ChatPaneThreadActionsAt;
    readonly viewOnly?: boolean;
    readonly write?: CopyWrite;
  } = {},
): Promise<void> {
  render(
    <QueryClientProvider client={consoleQueryClient()}>
      <SessionProvider holder={holderDouble()}>
        <CopyProvider write={drawn.write ?? (() => Promise.resolve(true))}>
          <Routed>
            <ChatPaneThreadActions
              home={threadHome}
              thread={threadEntry(thread)}
              viewOnly={drawn.viewOnly ?? false}
              at={drawn.at ?? "Pane"}
            />
          </Routed>
        </CopyProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  await settled();
}

/** The thread's page as the router addresses it, which is what both its link
 * and its copied address are built from. */
function threadPageHref(session: string): string {
  return `/${threadPartition.tenant}/${threadPartition.project}/threads/${session}`;
}

/** The thread's menu, opened from the one control beside its title. */
async function threadMenuOpened(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole("button", { name: "Thread actions" }), {
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

/** One control stands beside the title, so the title keeps the row's room,
 * and its name is said again as a tooltip on focus. */
test("what is done to the thread is one control beside its title, named again on focus", async () => {
  await renderedActions({ session: threadMineSession, mine: true });
  expect(screen.getAllByRole("button")).toHaveLength(1);
  const button = screen.getByRole("button", { name: "Thread actions" });
  const trigger = button.closest('[tabindex="0"]') ?? button;
  fireEvent.focus(trigger);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "Thread actions",
  );
});

test("the reader's own thread offers Open, Copy link, Rename and Close, and neither Hide nor Show", async () => {
  await renderedActions({ session: threadMineSession, mine: true });
  expect(await threadMenuOffers()).toStrictEqual([
    "Open",
    "Copy link",
    "Rename",
    "Close",
  ]);
});

test("a stranger's thread offers no Rename", async () => {
  await renderedActions({ session: threadOtherSession, mine: false });
  expect(await threadMenuOffers()).toStrictEqual([
    "Open",
    "Copy link",
    "Close",
  ]);
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
  const asked = screen.getByRole("group", { name: "Close this thread?" });
  expect(
    [...asked.querySelectorAll("p > span")].map((line) => line.textContent),
  ).toStrictEqual([
    "Not your thread · Ends it for its owner too",
    "Stays in History · Takes no more messages",
    "Drops any reply in progress · Cannot be undone",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.queryByRole("group", { name: "Close this thread?" }),
  ).toBeNull();
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
  const editor = screen.getByRole("textbox", { name: "Thread title" });
  expect(document.activeElement).toBe(editor);
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.queryByRole("button", { name: "Thread actions" })).toBeNull();
  fireEvent.change(editor, { target: { value: "never saved" } });
  fireEvent.blur(editor);
  expect(screen.queryByRole("textbox", { name: "Thread title" })).toBeNull();
  expect(screen.getByRole("button", { name: "Thread actions" })).toBeDefined();
});

/** A real anchor is what lets a reader open the page in a tab of its own,
 * or copy its address from the browser's own menu. */
test("Open is a link to the thread's own page", async () => {
  await renderedActions({ session: threadMineSession, mine: true });
  const open = within(await threadMenuOpened()).getByRole("menuitem", {
    name: "Open",
  });
  expect(open.tagName).toBe("A");
  expect(open.getAttribute("href")).toBe(threadPageHref(threadMineSession));
});

/** The address is the router's own, so it is the one the link goes to,
 * written whole for a reader pasting it anywhere else; the menu stays open on
 * the item to say so. */
test("Copy link writes the whole address of the page Open goes to, and says it did", async () => {
  const write = vi.fn<CopyWrite>(() => Promise.resolve(true));
  await renderedActions({ session: "thread a/b", mine: true }, { write });
  const menu = await threadMenuOpened();
  const href =
    within(menu).getByRole("menuitem", { name: "Open" }).getAttribute("href") ??
    "";
  await act(async () => {
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy link" }));
    await Promise.resolve();
  });
  expect(href).toBe(threadPageHref(encodeURIComponent("thread a/b")));
  expect(write).toHaveBeenCalledWith(`${location.origin}${href}`);
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
 * still reaches its page and its address. */
test("a reader who may change nothing is still offered Open and Copy link", async () => {
  await renderedActions(
    { session: threadMineSession, mine: true },
    { viewOnly: true },
  );
  expect(await threadMenuOffers()).toStrictEqual(["Open", "Copy link"]);
});

/** On the page itself the title is the page's, its standing is said beside
 * it, and a link to where the reader already is would go nowhere. */
test("over the thread's own page the title heads the page, with its standing, and Open is not offered", async () => {
  await renderedActions(
    { session: threadOtherSession, title: "theirs", state: "Closed" },
    { at: "Page" },
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "theirs" }),
  ).toBeDefined();
  expect(screen.getByText("Closed")).toBeDefined();
  expect(await threadMenuOffers()).toStrictEqual(["Copy link"]);
});
