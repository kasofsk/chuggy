/**
 * The chat pane's history: which threads it offers, in what order, and what
 * choosing one hands back. And the actions offered on the thread the pane
 * holds: Rename and Close, beside its own header controls.
 *
 * It is the whole of what the Threads page used to be, so the cases that page
 * carried about ordering are here instead.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { SessionProvider } from "../app/browser/session.tsx";
import {
  ChatPaneHistory,
  ChatPaneThreadActions,
} from "../app/browser/shell/ChatPaneHistory.tsx";
import { holderDouble } from "./screenHarness.tsx";
import {
  threadEntry,
  threadMineSession,
  threadOtherSession,
  threadPartition,
} from "./threadFixture.ts";

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

function renderedActions(thread: Parameters<typeof threadEntry>[0]) {
  return render(
    <SessionProvider holder={holderDouble()}>
      <ChatPaneThreadActions
        partition={threadPartition}
        thread={threadEntry(thread)}
      />
    </SessionProvider>,
  );
}

/** The header draws Rename and Close as plain buttons rather than behind a
 * menu that has to be opened first, so a reader with no pointer reaches them
 * by role and name alone — each now sits inside its own tooltip trigger too,
 * which is a focus stop of its own before the button, asserted below. */
test("the header offers Rename and Close with no hover", () => {
  renderedActions({ session: threadMineSession, mine: true });
  const rename = screen.getByRole("button", { name: "Rename" });
  const close = screen.getByRole("button", { name: "Close" });
  expect(rename.tagName).toBe("BUTTON");
  expect(close.tagName).toBe("BUTTON");
});

/** Rename and Close double their hidden name as a tooltip on focus — the same
 * string spoken once, not stated a second way under a second word. */
test("Rename and Close name themselves again as a tooltip on focus", async () => {
  renderedActions({ session: threadMineSession, mine: true });
  for (const name of ["Rename", "Close"]) {
    const button = screen.getByRole("button", { name });
    const trigger = button.closest('[tabindex="0"]');
    if (trigger === null) throw new Error(`no tooltip trigger around ${name}`);
    fireEvent.focus(trigger);
    expect((await screen.findByRole("tooltip")).textContent).toBe(name);
    fireEvent.blur(trigger);
  }
});

test("neither Hide nor Show is offered anywhere", () => {
  renderedActions({ session: threadMineSession, mine: true });
  expect(screen.queryByText("Hide")).toBeNull();
  expect(screen.queryByText("Show")).toBeNull();
  expect(screen.queryByRole("button", { name: "Thread actions" })).toBeNull();
  expect(screen.queryByText("…")).toBeNull();
});

test("a stranger's thread offers Close alone", () => {
  renderedActions({ session: threadOtherSession, mine: false });
  expect(screen.getByRole("button", { name: "Close" }).tagName).toBe("BUTTON");
  expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
});

/** Closing cannot be undone, so Close asks first and Cancel sends nothing. */
test("Close asks what closing does before it closes", () => {
  const fetched = vi.fn();
  vi.stubGlobal("fetch", fetched);
  renderedActions({ session: threadOtherSession, mine: false });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  const asked = screen.getByRole("group", { name: "Close this thread?" });
  expect(asked.textContent).toContain("cannot be undone");
  expect(asked.textContent).toContain("not yours");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.queryByRole("group", { name: "Close this thread?" }),
  ).toBeNull();
  expect(fetched).not.toHaveBeenCalled();
});

/** A rename the reader walked away from is one they did not mean to save. */
test("leaving the title editor abandons the rename", () => {
  renderedActions({ session: threadMineSession, mine: true });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  const editor = screen.getByRole("textbox", { name: "Thread title" });
  fireEvent.change(editor, { target: { value: "never saved" } });
  fireEvent.blur(editor);
  expect(screen.queryByRole("textbox", { name: "Thread title" })).toBeNull();
  expect(screen.getByRole("button", { name: "Rename" })).toBeDefined();
});
