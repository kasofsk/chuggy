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

afterEach(cleanup);

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

/** The reader's own thread is the one they are most likely to want, so it
 * leads whatever order the server answered in. */
test("the reader's own threads are offered first", async () => {
  await historyOpened(vi.fn());
  expect(
    screen.getAllByRole("menuitemradio").map((item) => item.textContent),
  ).toStrictEqual(["mine", "theirs"]);
});

test("the thread the pane holds is the one checked", async () => {
  await historyOpened(vi.fn());
  expect(
    screen
      .getByRole("menuitemradio", { name: "mine" })
      .getAttribute("aria-checked"),
  ).toBe("true");
});

test("choosing a thread hands its session back", async () => {
  const onChoose = vi.fn();
  await historyOpened(onChoose);
  fireEvent.click(screen.getByRole("menuitemradio", { name: "theirs" }));
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
  const row = screen.getByRole("menuitemradio", { name: "hidden" });
  expect(row.textContent).toBe("hidden");
});

test("a listing with nothing to offer draws no control", () => {
  render(
    <ChatPaneHistory threads={[]} session={undefined} onChoose={vi.fn()} />,
  );
  expect(screen.queryByRole("button", { name: "History" })).toBeNull();
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

/** The header draws Rename and Close as plain buttons, so a reader with no
 * pointer reaches them without a hover or a focus landing on a hidden
 * trigger first. */
test("the header offers Rename and Close with no hover", () => {
  renderedActions({ session: threadMineSession, mine: true });
  const rename = screen.getByRole("button", { name: "Rename" });
  const close = screen.getByRole("button", { name: "Close" });
  expect(rename.tagName).toBe("BUTTON");
  expect(close.tagName).toBe("BUTTON");
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
  expect(screen.getByRole("button", { name: "Close" }).tagName).toBe(
    "BUTTON",
  );
  expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
});
