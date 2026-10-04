/**
 * The conversation surface while an answer is being written: what the line
 * over it says is going on, how its words come out, the one thing that moves,
 * and what does not when the transcript's own copy takes the place of what was
 * heard.
 *
 * The surface is handed exchanges and nothing else, so each case draws the
 * moments of a turn as the exchanges a page would hand it and reads the
 * document after each.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
import type {
  ConversationActivity,
  ConversationExchange,
} from "../app/core/conversation.ts";
import { running } from "./conversationMoving.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { styleless } from "./styleless.ts";

function drawn(exchange: ConversationExchange, paced = true): ReactNode {
  return <Conversation exchanges={[exchange]} paced={paced} pane />;
}

function report(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>(".run-report");
  if (found === null) throw new Error("no report is drawn");
  return found;
}

function said(container: HTMLElement): string {
  return container.querySelector(".run-report")?.textContent ?? "";
}

async function written(container: HTMLElement, text: string): Promise<void> {
  await waitFor(() => {
    expect(said(container)).toBe(text);
  });
}

const thought = { step: "Thinking", text: "" } as const;
const read = {
  step: "ToolCall",
  id: "",
  name: "Read",
  input: undefined,
} as const;

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("what the work's line says is going on", () => {
  function label(activity: ConversationActivity | undefined): {
    readonly words: string;
    readonly filled: boolean;
    readonly moving: boolean;
    readonly named: string | undefined;
  } {
    const view = render(
      drawn(
        running({
          work: [thought, read],
          ...(activity === undefined ? {} : { activity }),
        }),
      ),
    );
    const trigger = view.container.querySelector(".conversation-trigger");
    const read_ = {
      words: trigger?.textContent ?? "",
      filled:
        trigger?.querySelector("circle")?.getAttribute("fill") ===
        "currentColor",
      moving: trigger?.querySelector(".conversation-glyph-live") !== null,
      named: trigger?.querySelector("code")?.textContent ?? undefined,
    };
    styleless();
    cleanup();
    return read_;
  }

  test("a thought under way is named", () => {
    expect(label({ activity: "Thinking" })).toEqual({
      words: "Thinking",
      filled: true,
      moving: false,
      named: undefined,
    });
  });

  test("a tool under way is named as a step of the work names it", () => {
    expect(label({ activity: "ToolUse", name: "Read" })).toEqual({
      words: "Read",
      filled: true,
      moving: false,
      named: "Read",
    });
  });

  test("work nothing more is known of is the word it always was", () => {
    expect(label(undefined)).toEqual({
      words: "Working",
      filled: true,
      moving: false,
      named: undefined,
    });
    expect(label({ activity: "ToolUse", name: "" }).words).toBe("Working");
  });

  test("once the answer is being written, or is whole, the line says what the work was", () => {
    for (const activity of ["Writing", "Whole"] as const)
      expect(label({ activity })).toEqual({
        words: "Thought · 1 tool",
        filled: false,
        moving: false,
        named: undefined,
      });
  });
});

describe("an answer as it is written", () => {
  test("its words come out in order and none is taken back as more arrive", async () => {
    const writing = { activity: "Writing" } as const;
    const view = render(
      drawn(running({ answer: "It is blocked", activity: writing })),
    );
    await written(view.container, "It is blocked");
    view.rerender(
      drawn(running({ answer: "It is blocked by 40.", activity: writing })),
    );
    expect(said(view.container)).toBe("It is blocked");
    await written(view.container, "It is blocked by 40.");
    styleless();
  });

  test("the transcript naming its exchange anew does not write it out again", async () => {
    const whole = { activity: "Whole" } as const;
    const view = render(
      drawn(running({ answer: "It is blocked by 40.", activity: whole })),
    );
    await written(view.container, "It is blocked by 40.");
    view.rerender(
      drawn(
        running({
          id: "uuid-entry-a",
          answer: "It is blocked by 40.",
          activity: whole,
        }),
      ),
    );
    expect(said(view.container)).toBe("It is blocked by 40.");
  });
});

describe("what an answer being written is drawn as", () => {
  test("a newer text begins from nothing in the answer's place", async () => {
    const writing = { activity: "Writing" } as const;
    const view = render(
      drawn(running({ answer: "Looking at 41.", activity: writing })),
    );
    await written(view.container, "Looking at 41.");
    view.rerender(
      drawn(
        running({
          work: [{ step: "Text", text: "Looking at 41." }, read],
          answer: "It is blocked by 40.",
          activity: writing,
        }),
      ),
    );
    expect("It is blocked by 40.".startsWith(said(view.container))).toBe(true);
    await written(view.container, "It is blocked by 40.");
  });

  test("a mark its last line leaves open is drawn as what it is about to be", async () => {
    const view = render(
      drawn(
        running({ answer: "It is **block", activity: { activity: "Writing" } }),
      ),
    );
    await written(view.container, "It is block");
    expect(report(view.container).querySelector("strong")?.textContent).toBe(
      "block",
    );
  });

  test("the mark at its end stands while it is written and goes when it is whole", async () => {
    const view = render(
      drawn(running({ answer: "It is", activity: { activity: "Writing" } })),
    );
    await written(view.container, "It is");
    expect(view.container.querySelector(".conversation-writing")).not.toBe(
      null,
    );
    view.rerender(
      drawn(running({ answer: "It is", activity: { activity: "Whole" } })),
    );
    expect(view.container.querySelector(".conversation-writing")).toBe(null);
  });

  test("a reader who asked for less motion is shown it whole", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const view = render(
      drawn(
        running({ answer: "It is blocked", activity: { activity: "Writing" } }),
      ),
    );
    expect(said(view.container)).toBe("It is blocked");
  });

  test("a surface that is not paced draws what it is handed at once", () => {
    const view = render(drawn(running({ answer: "It is blocked" }), false));
    expect(said(view.container)).toBe("It is blocked");
    expect(view.container.querySelector(".conversation-writing")).toBe(null);
  });
});

describe("the mark at the end of an answer", () => {
  test("the mark stands on words already whole until the pace has let them all out", async () => {
    const view = render(
      drawn(running({ answer: "It is", activity: { activity: "Writing" } })),
    );
    await written(view.container, "It is");
    const whole = "It is blocked by 40, and 40 is waiting on a review.";
    view.rerender(
      drawn(running({ answer: whole, activity: { activity: "Whole" } })),
    );
    expect(said(view.container).length).toBeLessThan(whole.length);
    expect(view.container.querySelector(".conversation-writing")).not.toBe(
      null,
    );
    await written(view.container, whole);
    expect(view.container.querySelector(".conversation-writing")).toBe(null);
  });
});

describe("the turn ending", () => {
  const answer = "It is blocked by 40.\n\n- claim 40\n- then 41";
  const work = [thought, { ...read, result: { text: "ok", isError: false } }];

  test("nothing of the answer moves when the turn is whole, is stored and settles", async () => {
    const view = render(
      drawn(running({ work, answer, activity: { activity: "Writing" } })),
    );
    await waitFor(() => {
      expect(report(view.container).querySelectorAll("li")).toHaveLength(2);
    });
    await written(view.container, "It is blocked by 40.claim 40then 41");
    view.rerender(
      drawn(running({ work, answer, activity: { activity: "Whole" } })),
    );
    const whole = report(view.container);
    const markup = whole.outerHTML;
    const card = view.container.querySelector(".conversation-trigger");
    const cardMarkup = card?.outerHTML;
    view.rerender(
      drawn(
        running({
          id: "uuid-entry-a",
          work,
          answer,
          activity: { activity: "Whole" },
        }),
      ),
    );
    expect(report(view.container)).toBe(whole);
    expect(whole.outerHTML).toBe(markup);
    view.rerender(
      drawn(
        running({
          id: "uuid-entry-a",
          work,
          answer,
          standing: { standing: "Answered" },
          measures: { tokens: 900 },
        }),
      ),
    );
    expect(report(view.container)).toBe(whole);
    expect(whole.outerHTML).toBe(markup);
    expect(view.container.querySelector(".conversation-trigger")).toBe(card);
    expect(card?.outerHTML).toBe(cardMarkup);
    expect(screen.getByText("Answered")).toBeDefined();
    styleless();
  });
});

describe("the waiting engine", () => {
  test("a turn heard to be whole stops it though nothing was said", () => {
    const composer = {
      takes: true,
      charsMax: 4000,
      onSend: () => Promise.resolve("Sent" as const),
    };
    const waiting = (activity: ConversationActivity | undefined): boolean => {
      const view = render(
        <Conversation
          exchanges={[running(activity === undefined ? {} : { activity })]}
          composer={composer}
          paced
          pane
        />,
      );
      const engine = view.container.querySelector(
        ".conversation-waiting-engine",
      );
      cleanup();
      return engine !== null;
    };
    expect(waiting(undefined)).toBe(true);
    expect(waiting({ activity: "Thinking" })).toBe(true);
    expect(waiting({ activity: "Whole" })).toBe(false);
  });
});
