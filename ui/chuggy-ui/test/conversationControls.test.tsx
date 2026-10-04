/**
 * The controls the conversation surface offers beside what it draws: the copy
 * of an answer and of a block of code, and the way back to the foot of the
 * column for a reader who scrolled away from it.
 *
 * jsdom scrolls nothing and measures nothing, so the column is given the
 * measures a scrolled one has and its events are sent by hand, in the order a
 * reader's own scroll sends them.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
import { copySaidMilliseconds } from "../app/browser/ui/CopyButton.tsx";
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import type { CopyWrite } from "../app/browser/ui/copyHeld.tsx";
import type { ConversationExchange } from "../app/core/conversation.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { styleless } from "./styleless.ts";

const answer =
  "It is **blocked** by 40.\n\n```sh\njust check\nnpm ci\n```\n\nThen claim it.";

function exchangeOf(
  exchange: Partial<ConversationExchange>,
): ConversationExchange {
  return {
    id: "turn-1",
    turn: "turn-1",
    ask: { ask: "Message", text: "where does 41 stand" },
    work: [],
    answer,
    standing: { standing: "Answered" },
    before: [],
    ...exchange,
  };
}

function copying(
  write: CopyWrite,
  exchanges: readonly ConversationExchange[],
): ReactNode {
  return (
    <CopyProvider write={write}>
      <Conversation exchanges={exchanges} pane />
    </CopyProvider>
  );
}

async function pressed(button: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(button);
    await Promise.resolve();
  });
}

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the copy of an answer", () => {
  test("puts the answer as it was written on the clipboard, and says so in the place it stands", async () => {
    const write = vi.fn<CopyWrite>(() => Promise.resolve(true));
    const view = render(copying(write, [exchangeOf({})]));
    const line = view.container.querySelector(".conversation-meta");
    const control = screen.getByRole("button", { name: "Copy answer" });
    expect(line?.contains(control)).toBe(true);
    expect(line?.textContent).toBe("Answered");
    await pressed(control);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(answer);
    expect(view.container.querySelector(".conversation-meta")).toBe(line);
    expect(line?.contains(control)).toBe(true);
    const said = Array.from(
      line?.querySelectorAll('[role="status"]') ?? [],
      (status) => status.textContent,
    );
    expect(said).toEqual(["Copied", "Answered"]);
    styleless();
  });

  test("is not offered while the turn is out, and takes the glyph's place when it settles", () => {
    const write = vi.fn<CopyWrite>(() => Promise.resolve(true));
    const view = render(
      copying(write, [
        exchangeOf({ standing: { standing: "Running", state: "Claimed" } }),
      ]),
    );
    const lead = view.container.querySelector(".conversation-meta-lead");
    expect(screen.queryByRole("button", { name: "Copy answer" })).toBeNull();
    expect(lead?.querySelector("svg circle")).not.toBeNull();
    view.rerender(copying(write, [exchangeOf({})]));
    expect(view.container.querySelector(".conversation-meta-lead")).toBe(lead);
    expect(
      lead?.contains(screen.getByRole("button", { name: "Copy answer" })),
    ).toBe(true);
    expect(lead?.querySelector("svg circle")).toBeNull();
  });

  test("is not offered for a turn that ended with no answer, nor where nothing can write", () => {
    const write = vi.fn<CopyWrite>(() => Promise.resolve(true));
    const failed: Partial<ConversationExchange> = {
      standing: { standing: "Failed" },
    };
    const unanswered = { ...exchangeOf(failed) };
    delete unanswered.answer;
    render(copying(write, [unanswered]));
    expect(screen.queryByRole("button", { name: "Copy answer" })).toBeNull();
    cleanup();
    render(<Conversation exchanges={[exchangeOf({})]} pane />);
    expect(screen.queryByRole("button", { name: /Copy/u })).toBeNull();
  });

  test("says nothing the browser did not do", async () => {
    const write = vi.fn<CopyWrite>(() => Promise.resolve(false));
    const view = render(copying(write, [exchangeOf({})]));
    await pressed(screen.getByRole("button", { name: "Copy answer" }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).not.toContain("Copied");
  });
});

describe("the copy of a block of code", () => {
  test("puts the code and not its fence on the clipboard, and says so in one word that then goes", async () => {
    vi.useFakeTimers();
    const write = vi.fn<CopyWrite>(() => Promise.resolve(true));
    const view = render(copying(write, [exchangeOf({})]));
    const panel = view.container.querySelector(".run-report-code");
    const control = screen.getByRole("button", { name: "Copy code" });
    expect(panel?.contains(control)).toBe(true);
    expect(panel?.querySelector(".run-report-code-bar")?.textContent).toBe(
      "sh",
    );
    await pressed(control);
    expect(write).toHaveBeenCalledWith("just check\nnpm ci");
    expect(panel?.querySelector(".run-report-code-bar")?.textContent).toBe(
      "shCopied",
    );
    act(() => {
      vi.advanceTimersByTime(copySaidMilliseconds - 1);
    });
    expect(panel?.textContent).toContain("Copied");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(panel?.textContent).not.toContain("Copied");
    expect(panel?.contains(control)).toBe(true);
  });
});

/** The column given the measures of one that scrolls, and a scroll that lands
 * where it is sent and says so. */
function scrolling(container: HTMLElement): {
  readonly sent: number[];
  readonly at: (scrollTop: number) => void;
  readonly grown: (scrollHeight: number) => void;
  readonly away: () => void;
} {
  const column = container.querySelector<HTMLElement>(".overflow-y-auto");
  if (column === null) throw new Error("no column scrolls");
  const measures = { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 };
  for (const name of ["scrollTop", "scrollHeight", "clientHeight"] as const)
    Object.defineProperty(column, name, {
      configurable: true,
      get: () => measures[name],
    });
  const sent: number[] = [];
  const at = (scrollTop: number): void => {
    measures.scrollTop = scrollTop;
    fireEvent.scroll(column);
  };
  column.scrollTo = ((options: ScrollToOptions) => {
    sent.push(options.top ?? 0);
    at((options.top ?? 0) - measures.clientHeight);
  }) as typeof column.scrollTo;
  return {
    sent,
    at,
    grown: (scrollHeight) => {
      measures.scrollHeight = scrollHeight;
    },
    away: () => {
      at(600);
      fireEvent.pointerDown(column);
      at(100);
    },
  };
}

/** Long enough for the frame the column asks for on mount, and for what it
 * hears of its own content changing. */
async function frame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

const first = exchangeOf({});
const second = exchangeOf({ id: "turn-2", turn: "turn-2", answer: "Done." });
const third = exchangeOf({ id: "turn-3", turn: "turn-3", answer: "Again." });

function back(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Scroll to bottom" });
}

describe("the way back to the foot of the column", () => {
  test("is not there while the reader is at the foot", () => {
    const view = render(<Conversation exchanges={[first]} pane />);
    const column = scrolling(view.container);
    act(() => {
      column.at(600);
    });
    expect(back()).toBe(null);
  });

  test("appears when they scroll away, and what is written then leaves them where they are", async () => {
    const view = render(<Conversation exchanges={[first]} pane />);
    const column = scrolling(view.container);
    await frame();
    act(column.away);
    const sentBefore = column.sent.length;
    expect(back()).not.toBe(null);
    column.grown(1200);
    view.rerender(<Conversation exchanges={[first, second]} pane />);
    await frame();
    expect(column.sent.length).toBe(sentBefore);
    expect(back()).not.toBe(null);
    styleless();
  });

  test("returns them there when pressed, goes, and holds them there as more is written", async () => {
    const view = render(<Conversation exchanges={[first]} pane />);
    const column = scrolling(view.container);
    await frame();
    act(column.away);
    column.grown(1200);
    view.rerender(<Conversation exchanges={[first, second]} pane />);
    await frame();
    const sentBefore = column.sent.length;
    const control = back();
    if (control === null) throw new Error("no way back is offered");
    act(() => {
      fireEvent.click(control);
    });
    expect(column.sent.slice(sentBefore)).toEqual([1200]);
    expect(back()).toBe(null);
    column.grown(1500);
    view.rerender(<Conversation exchanges={[first, second, third]} pane />);
    await frame();
    expect(column.sent.at(-1)).toBe(1500);
    expect(back()).toBe(null);
  });
});
