/**
 * The chat pane's history: which threads it offers, in what order, and what
 * choosing one hands back.
 *
 * It is the whole of what the Threads page used to be, so the cases that page
 * carried about ordering and about a hidden thread are here instead.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ChatPaneHistory } from "../app/browser/shell/ChatPaneHistory.tsx";
import {
  threadEntry,
  threadMineSession,
  threadOtherSession,
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

/** Hiding is the reader saying they are done with a thread, so the history
 * honours it rather than offering it back on every open. */
test("a hidden thread is not offered", async () => {
  await historyOpened(vi.fn(), [
    ...threads,
    threadEntry({ session: "gone", title: "hidden", hidden: true }),
  ]);
  expect(screen.queryByRole("menuitemradio", { name: "hidden" })).toBeNull();
});

test("a listing with nothing to offer draws no control", () => {
  render(
    <ChatPaneHistory threads={[]} session={undefined} onChoose={vi.fn()} />,
  );
  expect(screen.queryByRole("button", { name: "History" })).toBeNull();
});
