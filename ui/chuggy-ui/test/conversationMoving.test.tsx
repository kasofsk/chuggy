/**
 * What the conversation surface holds still and what it lets move while a turn
 * is out: one indicator and never two, in one place; what is written later
 * drawn after what was written before; a member's word for where the turn
 * stands, said only where nothing else says it and only once it has lasted;
 * and what a reader who cannot see the text arriving is told.
 *
 * The surface is handed exchanges and nothing else, so each case draws the
 * moments of a turn as the exchanges a page would hand it. jsdom lays nothing
 * out, so a part keeping its place is asserted as its node being the same node
 * after; the offsets are measured in a browser.
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
import { conversationWaitWordAfterMs } from "../app/browser/conversation/ConversationLines.tsx";
import type {
  ConversationExchange,
  ConversationStep,
} from "../app/core/conversation.ts";
import { moving, running } from "./conversationMoving.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { styleless } from "./styleless.ts";

const composer = {
  takes: true,
  charsMax: 4000,
  onSend: () => Promise.resolve("Sent" as const),
};

function drawn(
  exchanges: readonly ConversationExchange[],
  composed = true,
): ReactNode {
  return (
    <Conversation
      exchanges={exchanges}
      {...(composed ? { composer } : {})}
      paced
      pane
    />
  );
}

const thought: ConversationStep = { step: "Thinking", text: "" };
const read: ConversationStep = {
  step: "ToolCall",
  id: "",
  name: "Read",
  input: undefined,
};
const reading = { activity: "ToolUse", name: "Read" } as const;
const writing = { activity: "Writing" } as const;
const answer = "It is blocked by 40.";
const said: ConversationStep = { step: "Text", text: answer };

/** The status under each answer, which a reader who cannot see is told. */
function word(container: HTMLElement): readonly string[] {
  return Array.from(
    container.querySelectorAll('.conversation-meta p [role="status"]'),
    (status) => status.textContent,
  );
}

/** The word under each answer a reader who can see is shown, and nothing for
 * a line that shows none. */
function shownWord(container: HTMLElement): readonly string[] {
  return Array.from(
    container.querySelectorAll('.conversation-meta p [role="status"]'),
    (status) =>
      status.classList.contains("visually-hidden") ? "" : status.textContent,
  );
}

function found(container: HTMLElement, selector: string): Element {
  const element = container.querySelector(selector);
  if (element === null) throw new Error(`nothing drawn matches ${selector}`);
  return element;
}

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settledOn(
  exchange: Partial<ConversationExchange>,
  expected: readonly string[],
): Promise<void> {
  const view = render(drawn([running(exchange)]));
  await waitFor(() => {
    expect(moving(view.container)).toEqual(expected);
  });
  styleless();
  cleanup();
}

describe("one thing moves while a turn is out", () => {
  test("the engine, until something of the turn is drawn", async () => {
    await settledOn({ standing: { standing: "Running", state: "Queued" } }, [
      "engine",
    ]);
    await settledOn({ standing: { standing: "Running", state: "Waiting" } }, [
      "engine",
    ]);
    await settledOn({}, ["engine"]);
  });

  test("the line of the work under way, while a thought or a tool is", async () => {
    await settledOn({ work: [thought], activity: { activity: "Thinking" } }, [
      "card",
    ]);
    await settledOn({ work: [read], activity: reading }, ["card"]);
    await settledOn({ work: [said, read], activity: reading }, ["card"]);
    await settledOn({ work: [read] }, ["card"]);
  });

  test("the mark at the end of the last text, while the turn is at it", async () => {
    await settledOn({ answer, activity: writing }, ["mark"]);
    await settledOn({ work: [thought], answer, activity: writing }, ["mark"]);
    await settledOn({ answer }, ["mark"]);
  });

  test("the glyph under the answer, where the turn has begun and nothing of it is drawn", async () => {
    await settledOn({ activity: { activity: "Thinking" } }, ["glyph"]);
  });

  test("nothing, once the turn is heard to end, though the mailbox has yet to settle it", async () => {
    await settledOn({ answer, activity: { activity: "Whole" } }, []);
    await settledOn({ activity: { activity: "Whole" } }, []);
  });

  test("nothing, once the turn has settled", async () => {
    await settledOn({ answer, standing: { standing: "Answered" } }, []);
    await settledOn({ standing: { standing: "Failed" } }, []);
    await settledOn({ standing: { standing: "Abandoned" } }, []);
  });
});

describe("the one thing that moves, where it is not the only turn or the only place", () => {
  test("a turn waiting behind one being answered is still", async () => {
    const view = render(
      drawn([
        running({ answer, activity: writing }),
        running({
          id: "turn-2",
          turn: "turn-2",
          standing: { standing: "Running", state: "Queued" },
        }),
      ]),
    );
    await waitFor(() => {
      expect(view.container.querySelector(".run-report")?.textContent).toBe(
        answer,
      );
    });
    expect(moving(view.container)).toEqual(["mark"]);
    expect(word(view.container)).toEqual(["Working", ""]);
    expect(
      view.container.querySelectorAll(".conversation-waiting"),
    ).toHaveLength(0);
  });

  test("where no engine is drawn the glyph under the first turn out moves in its place", async () => {
    const view = render(
      drawn(
        [running({ standing: { standing: "Running", state: "Queued" } })],
        false,
      ),
    );
    await waitFor(() => {
      expect(moving(view.container)).toEqual(["glyph"]);
    });
  });
});

const carried = `${answer} And 40 is waiting on a review of its own.`;

const carriedOn: readonly ConversationStep[] = [
  thought,
  { step: "Text", text: carried },
  read,
];

/** The moments of one turn, in the order a page hears them. */
const throughMoments: readonly Partial<ConversationExchange>[] = [
  {},
  { activity: { activity: "Thinking" } },
  { work: [thought], activity: { activity: "Thinking" } },
  { work: [thought], answer: "It is", activity: writing },
  { work: [thought], answer, activity: writing },
  { work: carriedOn, activity: reading },
  { work: carriedOn },
  { work: carriedOn, answer: "So it waits." },
  { work: carriedOn, answer: "So it waits.", activity: { activity: "Whole" } },
];

describe("a turn drawn through", () => {
  test("never has two things moving at once, at any moment", async () => {
    const view = render(
      drawn([running({ standing: { standing: "Running", state: "Queued" } })]),
    );
    const seen: (readonly string[])[] = [moving(view.container)];
    const watching = new MutationObserver(() => {
      seen.push(moving(view.container));
    });
    watching.observe(view.container, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    for (const moment of throughMoments.slice(0, -1)) {
      view.rerender(drawn([running(moment)]));
      await waitFor(() => {
        expect(moving(view.container)).toHaveLength(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await waitFor(() => {
      expect(moving(view.container)).toEqual(["mark"]);
    });
    view.rerender(drawn([running(throughMoments.at(-1) ?? {})]));
    await waitFor(() => {
      expect(moving(view.container)).toEqual([]);
    });
    view.rerender(
      drawn([running({ answer, standing: { standing: "Answered" } })]),
    );
    await waitFor(() => {
      expect(moving(view.container)).toEqual([]);
    });
    watching.disconnect();
    expect(seen.length).toBeGreaterThan(throughMoments.length);
    expect(seen.filter((live) => live.length > 1)).toEqual([]);
    expect(new Set(seen.flat())).toEqual(
      new Set(["engine", "card", "mark", "glyph"]),
    );
  });
});

describe("the word under an answer", () => {
  function words(exchange: Partial<ConversationExchange>): {
    readonly told: string;
    readonly shown: string;
  } {
    const view = render(drawn([running(exchange)]));
    const told = word(view.container);
    const shown = shownWord(view.container);
    const text = view.container.textContent;
    cleanup();
    expect(told).toHaveLength(1);
    expect(text).not.toContain("Claimed");
    return { told: told[0] ?? "", shown: shown[0] ?? "" };
  }

  test("is a member's, and never the mailbox's for a turn a runner has", () => {
    expect(
      words({ standing: { standing: "Running", state: "Waiting" } }),
    ).toEqual({ told: "Waiting", shown: "Waiting" });
    expect(words({ activity: { activity: "Thinking" } })).toEqual({
      told: "Working",
      shown: "Working",
    });
    expect(words({ answer })).toEqual({ told: "Working", shown: "" });
    expect(words({ work: [read] })).toEqual({ told: "Working", shown: "" });
    expect(words({ answer, standing: { standing: "Answered" } })).toEqual({
      told: "Answered",
      shown: "Answered",
    });
  });

  test("is not shown while something else on the answer shows what is under way", () => {
    for (const [moment, saysWorking] of [
      [{ work: [thought], activity: { activity: "Thinking" } }, false],
      [{ work: [read], activity: reading }, false],
      [{ work: [read] }, true],
      [{ answer, activity: writing }, false],
    ] as const) {
      const view = render(drawn([running(moment)]));
      expect(word(view.container)).toEqual(["Working"]);
      expect(shownWord(view.container)).toEqual([""]);
      expect(
        view.container
          .querySelector(".conversation-meta-lead")
          ?.classList.contains("invisible"),
      ).toBe(true);
      expect(
        view.container.querySelector(".conversation-work-line")?.textContent ===
          "Working",
      ).toBe(saysWorking);
      cleanup();
    }
  });
});

describe("what a reader who cannot see the answer arriving is told", () => {
  test("is one status that is there throughout, so a reader is told when it changes and of no word of the text", async () => {
    const view = render(drawn([running({})]));
    const status = found(
      view.container,
      '.conversation-meta p [role="status"]',
    );
    expect(status.textContent).toBe("");
    view.rerender(drawn([running({ answer, activity: writing })]));
    await waitFor(() => {
      expect(view.container.querySelector(".run-report")?.textContent).toBe(
        answer,
      );
    });
    expect(status.isConnected).toBe(true);
    expect(status.textContent).toBe("Working");
    const report = found(view.container, ".run-report");
    expect(
      report.closest(
        '[aria-live], [role="status"], [role="log"], [role="alert"]',
      ),
    ).toBe(null);
    view.rerender(
      drawn([running({ answer, standing: { standing: "Answered" } })]),
    );
    expect(status.isConnected).toBe(true);
    expect(status.textContent).toBe("Answered");
  });

  test("the answer is marked busy for as long as its turn is out", () => {
    const view = render(drawn([running({ answer, activity: writing })]));
    const root = found(view.container, ".conversation-answer");
    expect(root.getAttribute("aria-busy")).toBe("true");
    view.rerender(
      drawn([running({ answer, standing: { standing: "Answered" } })]),
    );
    expect(found(view.container, ".conversation-answer")).toBe(root);
    expect(root.getAttribute("aria-busy")).toBe("false");
  });
});

describe("the line under an answer, from the turn's last word to its settling", () => {
  const whole = { answer, activity: { activity: "Whole" } } as const;

  function held(container: HTMLElement): readonly Element[] {
    return [
      found(container, ".conversation-meta"),
      found(container, ".conversation-meta-lead"),
      found(container, '.conversation-meta p [role="status"]'),
    ];
  }

  test("says nothing and shows nothing, in the box, the lead and the status that were there", async () => {
    const view = render(drawn([running({ answer, activity: writing })]));
    await waitFor(() => {
      expect(view.container.querySelector(".run-report")?.textContent).toBe(
        answer,
      );
    });
    const working = held(view.container);
    const [line, lead, status] = working;
    expect(status?.textContent).toBe("Working");
    view.rerender(drawn([running(whole)]));
    held(view.container).forEach((node, at) => {
      expect(node).toBe(working[at]);
    });
    expect(line?.textContent).toBe("");
    expect(lead?.classList.contains("invisible")).toBe(true);
    expect(lead?.childElementCount).toBe(1);
    expect(moving(view.container)).toEqual([]);
    expect(
      found(view.container, ".conversation-answer").getAttribute("aria-busy"),
    ).toBe("true");
    view.rerender(
      drawn([running({ answer, standing: { standing: "Answered" } })]),
    );
    held(view.container).forEach((node, at) => {
      expect(node).toBe(working[at]);
    });
    expect(lead?.classList.contains("invisible")).toBe(false);
    expect(status?.textContent).toBe("Answered");
    styleless();
  });

  test("a turn that settles failed says so in the status that said nothing", () => {
    const view = render(drawn([running(whole)]));
    const quiet = held(view.container);
    expect(quiet[2]?.textContent).toBe("");
    const failed = { standing: "Failed", failure: "StoreRefused" } as const;
    view.rerender(drawn([running({ standing: failed })]));
    held(view.container).forEach((node, at) => {
      expect(node).toBe(quiet[at]);
    });
    expect(quiet[2]?.textContent).toBe("Failed");
    expect(view.container.querySelector(".notice-detail")?.textContent).toBe(
      "StoreRefused",
    );
  });

  test("more of the turn being written brings the word and the motion back", async () => {
    const view = render(drawn([running(whole)]));
    const quiet = held(view.container);
    view.rerender(
      drawn([running({ answer: `${answer} And 41.`, activity: writing })]),
    );
    await waitFor(() => {
      expect(moving(view.container)).toEqual(["mark"]);
    });
    expect(quiet[2]?.textContent).toBe("Working");
  });
});

describe("a word for waiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function lasting(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  const queued = {
    standing: { standing: "Running", state: "Queued" },
  } as const;

  test("is said once the wait has lasted longer than a glance, and not before", () => {
    for (const [moment, waited] of [
      [queued, "Queued"],
      [{}, "Starting"],
    ] as const) {
      const view = render(drawn([running(moment)]));
      expect(shownWord(view.container)).toEqual([""]);
      expect(moving(view.container)).toEqual(["engine"]);
      lasting(conversationWaitWordAfterMs - 1);
      expect(word(view.container)).toEqual([""]);
      lasting(1);
      expect(shownWord(view.container)).toEqual([waited]);
      expect(moving(view.container)).toEqual(["engine"]);
      cleanup();
    }
  });

  test("is never said of a wait that ends within the glance, however many follow one another", () => {
    const view = render(drawn([running(queued)]));
    lasting(conversationWaitWordAfterMs - 1);
    view.rerender(drawn([running({})]));
    lasting(conversationWaitWordAfterMs - 1);
    expect(word(view.container)).toEqual([""]);
    view.rerender(
      drawn([running({ work: [thought], activity: { activity: "Thinking" } })]),
    );
    lasting(conversationWaitWordAfterMs);
    expect(shownWord(view.container)).toEqual([""]);
  });

  test("goes when the wait it named ends, and the next wait is timed from its own start", () => {
    const view = render(drawn([running(queued)]));
    lasting(conversationWaitWordAfterMs);
    expect(shownWord(view.container)).toEqual(["Queued"]);
    view.rerender(drawn([running({})]));
    expect(shownWord(view.container)).toEqual([""]);
    view.rerender(drawn([running(queued)]));
    expect(shownWord(view.container)).toEqual([""]);
    lasting(conversationWaitWordAfterMs);
    expect(shownWord(view.container)).toEqual(["Queued"]);
  });

  test("a turn no runner can take now says so at once", () => {
    const view = render(
      drawn([running({ standing: { standing: "Running", state: "Waiting" } })]),
    );
    expect(shownWord(view.container)).toEqual(["Waiting"]);
  });
});

describe("what is written later is drawn after what was written before", () => {
  test("a step that begins after the words have is drawn under them, and they keep their node", async () => {
    const view = render(drawn([running({ answer, activity: writing })]));
    await waitFor(() => {
      expect(view.container.querySelector(".run-report")?.textContent).toBe(
        answer,
      );
    });
    const report = found(view.container, ".run-report");
    const root = found(view.container, ".conversation-answer");
    expect(root.firstElementChild?.contains(report)).toBe(true);
    view.rerender(drawn([running({ work: [said, read], activity: reading })]));
    expect(found(view.container, ".run-report")).toBe(report);
    expect(report.textContent).toBe(answer);
    expect(root.firstElementChild?.contains(report)).toBe(true);
    const line = found(view.container, ".conversation-work-line");
    expect(line.textContent).toBe("Read");
    expect(
      report.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    styleless();
  });

  test("an answer that took no work begins with its text, written or stored", () => {
    const view = render(
      drawn([running({ answer, standing: { standing: "Answered" } })]),
    );
    const root = found(view.container, ".conversation-answer");
    expect(
      root.firstElementChild?.contains(found(view.container, ".run-report")),
    ).toBe(true);
  });

  test("the line under the answer is one line from the turn's first moment to its last", () => {
    const view = render(
      drawn([running({ standing: { standing: "Running", state: "Queued" } })]),
    );
    const line = found(view.container, ".conversation-meta");
    const lead = found(view.container, ".conversation-meta-lead");
    const moments: readonly Partial<ConversationExchange>[] = [
      {},
      { answer, activity: writing },
      { answer, activity: { activity: "Whole" } },
      { answer, standing: { standing: "Answered" }, measures: { tokens: 900 } },
    ];
    for (const moment of moments) {
      view.rerender(drawn([running(moment)]));
      expect(found(view.container, ".conversation-meta")).toBe(line);
      expect(found(view.container, ".conversation-meta-lead")).toBe(lead);
      expect(line.parentElement?.lastElementChild).toBe(line);
      expect(lead.childElementCount).toBe(1);
    }
    expect(screen.getByText("Answered")).toBeDefined();
  });
});
