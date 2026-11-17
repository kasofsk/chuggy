/**
 * The history the reader's own chat offers: which threads, in what order, and
 * what choosing one hands back.
 *
 * It is the whole of what the Threads page used to be, so the cases that page
 * carried about ordering are here instead.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { CopyProvider as CatalogProvider } from "../app/copy/CopyProvider.tsx";
import { ChatPaneHistory } from "../app/browser/shell/ChatPaneHistory.tsx";
import { Routed } from "./routed.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, drawnStrict } from "./screenHarness.tsx";
import {
  threadEntry,
  threadMineSession,
  threadOtherSession,
  threadPartition,
} from "./threadFixture.ts";
import { renderCopied } from "./copied.tsx";

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
  renderCopied(
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

/** A standing is the wire's code, so each is drawn in its own label; a thread
 * not yet titled is a new chat, and one whose instant does not read says no
 * age rather than an empty one. */
test("an orphaned, untitled row is named by its standing's label, as a new chat, and with no age it cannot read", async () => {
  await historyOpened(vi.fn(), [
    threadEntry({ session: "left", state: "Orphaned" }),
    threadEntry({ session: "odd", title: "odd", lastActivityAt: "never" }),
  ]);
  const left = screen.getByRole("menuitemradio", {
    name: /^New chat, Orphaned, \d+[smhd] ago$/,
  });
  expect(left.textContent).toContain("New chat");
  expect(within(left).getByText("Orphaned")).toBeDefined();
  expect(
    screen.getByRole("menuitemradio", { name: "odd, Open" }),
  ).toBeDefined();
});

/** Under the pseudo wording every word the history says is the catalog's and
 * altered, and a thread's title, which is data, is drawn as it was typed. */
test("under the pseudo wording the history's words are altered and a title is not", async () => {
  render(
    <CatalogProvider wording="en-x-pseudo">
      <ChatPaneHistory
        threads={threads}
        session={threadMineSession}
        onChoose={vi.fn()}
      />
    </CatalogProvider>,
  );
  expect(screen.queryByRole("button", { name: "History" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("button"), { key: "ArrowDown" });
  await screen.findByRole("menu");
  expect(screen.getByText("mine")).toBeDefined();
  expect(screen.queryByText("Yours")).toBeNull();
  expect(screen.queryByText("Everyone else's")).toBeNull();
  for (const row of screen.getAllByRole("menuitemradio"))
    expect(row.getAttribute("aria-label")).not.toMatch(/Open|ago/);
});

test("a thread another project keeps is named by that project's name, and linked by its address", async () => {
  await drawnStrict(
    <Routed>
      <ChatPaneHistory
        threads={[]}
        session={undefined}
        onChoose={() => undefined}
        elsewhere={[
          {
            partition: threadPartition,
            thread: threadEntry({ session: threadOtherSession, title: "kept" }),
          },
        ]}
      />
    </Routed>,
    (request) =>
      request.url === "/api/v1/projects"
        ? answer({ projects: [{ ...threadPartition, name: "Atlas Billing" }] })
        : answer({}, 404),
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "History" }), {
    key: "ArrowDown",
  });
  const row = await screen.findByRole("menuitem", {
    name: /^Atlas Billing · kept, /u,
  });
  expect(row.getAttribute("href")).toBe(
    `/${threadPartition.tenant}/${threadPartition.project}/threads/${threadOtherSession}`,
  );
});

test("a listing still being read draws the control, loading in its menu", async () => {
  renderCopied(
    <ChatPaneHistory
      threads={undefined}
      session={undefined}
      onChoose={vi.fn()}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "History" }), {
    key: "Enter",
  });
  expect(await screen.findByText("Loading…")).toBeDefined();
});

test("a listing with nothing to offer says so in its menu", async () => {
  renderCopied(
    <ChatPaneHistory threads={[]} session={undefined} onChoose={vi.fn()} />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "History" }), {
    key: "Enter",
  });
  expect(await screen.findByText("No chats yet")).toBeDefined();
});

/** The trigger's hidden name is also the tooltip a pointer or a keyboard focus
 * reveals, so a reader who does not use a screen reader learns what History
 * means before ever opening the menu. */
test("the History trigger names itself again as a tooltip on focus", async () => {
  renderCopied(
    <ChatPaneHistory
      threads={threads}
      session={threadMineSession}
      onChoose={vi.fn()}
    />,
  );
  const button = screen.getByRole("button", { name: "History" });
  expect(button.parentElement?.closest("[tabindex]")).toBeNull();
  fireEvent.focus(button);
  expect((await screen.findByRole("tooltip")).textContent).toBe("History");
});
