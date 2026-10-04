/**
 * The conversation surface while an answer is being written: what the line of
 * its work says is going on and for how long, how its words come out, where
 * each text and each part of the work is drawn, and what does not move when
 * the transcript's own copy takes the place of what was heard.
 *
 * The surface is handed exchanges and nothing else, so each case draws the
 * moments of a turn as the exchanges a page would hand it and reads the
 * document after each.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
import type {
  ConversationActivity,
  ConversationExchange,
} from "../app/core/conversation.ts";
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
import { moving, running } from "./conversationMoving.ts";
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
    const trigger = view.container.querySelector(".conversation-work-line");
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

  test("a thought under way is named, and its line is what moves", () => {
    expect(label({ activity: "Thinking" })).toEqual({
      words: "Thinking",
      filled: true,
      moving: true,
      named: undefined,
    });
  });

  test("a tool under way is named as a step of the work names it", () => {
    expect(label({ activity: "ToolUse", name: "Read" })).toEqual({
      words: "Read",
      filled: true,
      moving: true,
      named: "Read",
    });
    expect(label({ activity: "ToolUse", name: "" }).words).toBe("Working");
  });

  test("work nothing more is known of is the word it always was, and the one place that says it", () => {
    expect(label(undefined)).toEqual({
      words: "Working",
      filled: true,
      moving: true,
      named: undefined,
    });
    const view = render(drawn(running({ work: [thought, read] })));
    expect(moving(view.container)).toEqual(["card"]);
    expect(
      view.container.querySelector(
        '.conversation-meta p [role="status"]:not(.visually-hidden)',
      ),
    ).toBe(null);
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

describe("how long what is under way has been", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function line(container: HTMLElement): string {
    return (
      container.querySelector(".conversation-work-line")?.textContent ?? ""
    );
  }

  function lasting(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  const thinking = { activity: "Thinking" } as const;
  const reading = { activity: "ToolUse", name: "Read" } as const;

  test("is counted in seconds on its line once it has lasted one, and from nothing for the step after it", () => {
    const view = render(
      drawn(running({ work: [thought], activity: thinking })),
    );
    expect(line(view.container)).toBe("Thinking");
    lasting(999);
    expect(line(view.container)).toBe("Thinking");
    lasting(1);
    expect(line(view.container)).toBe("Thinking1s");
    lasting(14_000);
    expect(line(view.container)).toBe("Thinking15s");
    view.rerender(drawn(running({ work: [thought, read], activity: reading })));
    expect(line(view.container)).toBe("Read");
    lasting(2000);
    expect(line(view.container)).toBe("Read2s");
  });

  test("is said no longer once the work is over, when the line reads as the record will", () => {
    const view = render(
      drawn(running({ work: [thought], activity: thinking })),
    );
    lasting(5000);
    expect(line(view.container)).toBe("Thinking5s");
    view.rerender(
      drawn(
        running({
          work: [thought],
          answer: "It is",
          activity: { activity: "Writing" },
        }),
      ),
    );
    expect(line(view.container)).toBe("Thought");
    lasting(5000);
    expect(line(view.container)).toBe("Thought");
  });
});

describe("a line of the work is a control only where it opens to something", () => {
  function control(
    work: ConversationExchange["work"],
    activity?: ConversationActivity,
  ): {
    readonly line: string;
    readonly opens: boolean;
  } {
    const view = render(
      drawn(running({ work, ...(activity === undefined ? {} : { activity }) })),
    );
    const line = view.container.querySelector(".conversation-work-line");
    const read_ = {
      line: line?.textContent ?? "",
      opens: line?.tagName === "BUTTON",
    };
    cleanup();
    return read_;
  }

  test("a thought the record keeps no words of is a line and nothing to press, under way and over", () => {
    expect(control([thought], { activity: "Thinking" })).toEqual({
      line: "Thinking",
      opens: false,
    });
    expect(control([thought], { activity: "Whole" })).toEqual({
      line: "Thought",
      opens: false,
    });
  });

  test("a thought with words, and a call, are", () => {
    expect(
      control([{ step: "Thinking", text: "weighed it" }], {
        activity: "Whole",
      }),
    ).toEqual({ line: "Thought", opens: true });
    expect(control([read], { activity: "Whole" })).toEqual({
      line: "1 tool",
      opens: true,
    });
  });

  test("what it opens to leaves out the thought with no words, and a call nothing is held of is its name and no control", () => {
    const view = render(
      drawn(
        running({ work: [thought, read], activity: { activity: "Whole" } }),
      ),
    );
    const trigger = view.container.querySelector(".conversation-work-line");
    if (trigger === null) throw new Error("no line of work is drawn");
    fireEvent.click(trigger);
    const steps = view.container.querySelectorAll("ol > li");
    expect(steps).toHaveLength(1);
    expect(steps[0]?.textContent).toBe("Read");
    expect(steps[0]?.querySelector("button")).toBe(null);
    styleless();
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

describe("where each text of an answer is drawn", () => {
  test("a newer text is written under the work that followed the one before it, which stays as it was", async () => {
    const writing = { activity: "Writing" } as const;
    const view = render(
      drawn(running({ answer: "Looking at 41.", activity: writing })),
    );
    await written(view.container, "Looking at 41.");
    const first = report(view.container);
    view.rerender(
      drawn(
        running({
          work: [{ step: "Text", text: "Looking at 41." }, read],
          answer: "It is",
          activity: writing,
        }),
      ),
    );
    view.rerender(
      drawn(
        running({
          work: [{ step: "Text", text: "Looking at 41." }, read],
          answer: "It is blocked by 40.",
          activity: writing,
        }),
      ),
    );
    expect(report(view.container)).toBe(first);
    expect(first.textContent).toBe("Looking at 41.");
    const drawnParts = Array.from(
      view.container.querySelectorAll(".run-report, .conversation-work-line"),
      (part) => part.classList.contains("run-report"),
    );
    expect(drawnParts).toEqual([true, false, true]);
    const second = view.container.querySelectorAll(".run-report").item(1);
    expect("It is blocked by 40.".startsWith(second.textContent)).toBe(true);
    await waitFor(() => {
      expect(second.textContent).toBe("It is blocked by 40.");
    });
    expect(
      view.container.querySelectorAll(".conversation-writing"),
    ).toHaveLength(1);
    expect(first.closest(".conversation-writing")).toBe(null);
  });

  test("work the record comes to hold between two texts takes neither text's node", async () => {
    const earlier = { step: "Text", text: "Looking at 41." } as const;
    const view = render(
      drawn(running({ work: [earlier], answer: "It is blocked by 40." })),
    );
    await waitFor(() => {
      expect(view.container.querySelectorAll(".run-report")).toHaveLength(2);
    });
    const texts = Array.from(view.container.querySelectorAll(".run-report"));
    view.rerender(
      drawn(
        running({ work: [earlier, thought], answer: "It is blocked by 40." }),
      ),
    );
    expect(
      Array.from(
        view.container.querySelectorAll(".run-report, .conversation-work-line"),
        (part) => texts.indexOf(part),
      ),
    ).toEqual([0, -1, 1]);
  });
});

describe("what of an answer is let out at a pace", () => {
  test("a text something is written after is drawn whole at once, so nothing is drawn under a text still arriving", () => {
    const writing = { activity: "Writing" } as const;
    const view = render(drawn(running({ answer: "It is", activity: writing })));
    const whole = "It is blocked by 40, and 40 is waiting on a review.";
    view.rerender(
      drawn(
        running({
          work: [{ step: "Text", text: whole }, read],
          activity: { activity: "ToolUse", name: "Read" },
        }),
      ),
    );
    expect(said(view.container)).toBe(whole);
    expect(view.container.querySelector(".conversation-writing")).toBe(null);
    expect(moving(view.container)).toEqual(["card"]);
  });

  test("a text there when the page is first drawn is drawn whole, and only what is added is let out", async () => {
    const writing = { activity: "Writing" } as const;
    const held = "It is blocked by 40, and 40 is waiting on a review.";
    const view = render(drawn(running({ answer: held, activity: writing })));
    expect(said(view.container)).toBe(held);
    const more = `${held} That review is due tomorrow.`;
    view.rerender(drawn(running({ answer: more, activity: writing })));
    expect(said(view.container)).toBe(held);
    await written(view.container, more);
  });

  test("a text the transcript says differently is drawn as the transcript has it, at once and never from nothing", async () => {
    const writing = { activity: "Writing" } as const;
    const view = render(
      drawn(running({ answer: "It is blocked by 40", activity: writing })),
    );
    const seen: string[] = [];
    const watching = new MutationObserver(() => {
      seen.push(said(view.container));
    });
    watching.observe(view.container, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    view.rerender(
      drawn(running({ answer: "It is held up by 40.", activity: writing })),
    );
    await written(view.container, "It is held up by 40.");
    watching.disconnect();
    expect(seen.filter((text) => text !== "It is held up by 40.")).toEqual([]);
  });
});

describe("what an answer being written is drawn as", () => {
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

  test("a surface that is not paced draws what it is handed at once, and marks only the text a turn is still at", () => {
    const view = render(drawn(running({ answer: "It is" }), false));
    view.rerender(drawn(running({ answer: "It is blocked" }), false));
    expect(said(view.container)).toBe("It is blocked");
    expect(
      view.container.querySelectorAll(".conversation-writing"),
    ).toHaveLength(1);
    view.rerender(
      drawn(
        running({
          answer: "It is blocked by 40.",
          standing: { standing: "Answered" },
        }),
        false,
      ),
    );
    expect(said(view.container)).toBe("It is blocked by 40.");
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

describe("the end of an answer is one step", () => {
  const whole = "It is blocked by 40, and 40 is waiting on a review.";

  function copying(exchange: ConversationExchange): ReactNode {
    return (
      <CopyProvider write={() => Promise.resolve(true)}>
        {drawn(exchange)}
      </CopyProvider>
    );
  }

  function copy(container: HTMLElement): Element | null {
    return container.querySelector(".conversation-meta .copy-button");
  }

  test("the mark stays until the last character is drawn, and the copy is there the moment it goes", async () => {
    const view = render(
      copying(running({ answer: "It is", activity: { activity: "Writing" } })),
    );
    view.rerender(
      copying(running({ answer: whole, activity: { activity: "Whole" } })),
    );
    const seen: { said: string; mark: boolean; copy: boolean }[] = [];
    const watch = (): void => {
      seen.push({
        said: said(view.container),
        mark: moving(view.container).includes("mark"),
        copy: copy(view.container) !== null,
      });
    };
    const watching = new MutationObserver(watch);
    watching.observe(view.container, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    watch();
    await written(view.container, whole);
    await waitFor(() => {
      expect(copy(view.container)).not.toBe(null);
    });
    watching.disconnect();
    expect(seen.length).toBeGreaterThan(2);
    for (const moment of seen) {
      expect(moment.mark).toBe(moment.said !== whole);
      expect(moment.copy).toBe(moment.said === whole);
    }
    expect(moving(view.container)).toEqual([]);
    styleless();
  });

  test("the mailbox settling the turn puts its word and what it took beside the copy, which keeps its node", () => {
    const view = render(
      copying(running({ answer: whole, activity: { activity: "Whole" } })),
    );
    const control = copy(view.container);
    expect(control).not.toBe(null);
    const line = view.container.querySelector(".conversation-meta");
    expect(line?.textContent).toBe("");
    view.rerender(
      copying(
        running({
          answer: whole,
          standing: { standing: "Answered" },
          measures: { tokens: 900 },
        }),
      ),
    );
    expect(copy(view.container)).toBe(control);
    expect(view.container.querySelector(".conversation-meta")).toBe(line);
    expect(screen.getByText("Answered")).toBeDefined();
  });
});

describe("what the end of an answer offers", () => {
  function copying(exchange: ConversationExchange): ReactNode {
    return (
      <CopyProvider write={() => Promise.resolve(true)}>
        {drawn(exchange)}
      </CopyProvider>
    );
  }

  test("a turn that ended saying nothing offers nothing to copy", () => {
    const view = render(
      copying(running({ work: [read], activity: { activity: "Whole" } })),
    );
    expect(
      view.container.querySelector(".conversation-meta .copy-button"),
    ).toBe(null);
  });
});

describe("the engine", () => {
  test("stops once anything is heard of the turn, and for a turn heard to be whole though nothing was said", () => {
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
    expect(waiting({ activity: "Thinking" })).toBe(false);
    expect(waiting({ activity: "Whole" })).toBe(false);
  });
});

describe("the engine of a turn behind one heard to end", () => {
  test("waits until that one's last character is drawn", async () => {
    const whole = "It is blocked by 40, and 40 is waiting on a review.";
    const composer = {
      takes: true,
      charsMax: 4000,
      onSend: () => Promise.resolve("Sent" as const),
    };
    const behind = running({
      id: "turn-2",
      turn: "turn-2",
      ask: { ask: "Message", text: "and 42" },
      standing: { standing: "Running", state: "Queued" },
    });
    const both = (first: ConversationExchange): ReactNode => (
      <Conversation
        exchanges={[first, behind]}
        composer={composer}
        paced
        pane
      />
    );
    const view = render(
      both(running({ answer: "It is", activity: { activity: "Writing" } })),
    );
    view.rerender(
      both(running({ answer: whole, activity: { activity: "Whole" } })),
    );
    const seen: (readonly string[])[] = [];
    const watch = (): void => {
      seen.push(moving(view.container));
    };
    const watching = new MutationObserver(watch);
    watching.observe(view.container, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    watch();
    await waitFor(() => {
      expect(moving(view.container)).toEqual(["engine"]);
    });
    watching.disconnect();
    expect(seen).toContainEqual(["mark"]);
    for (const moment of seen) expect(moment.length).toBe(1);
    expect(said(view.container)).toBe(whole);
    styleless();
  });
});
