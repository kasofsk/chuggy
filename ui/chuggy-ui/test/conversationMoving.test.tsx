/**
 * What the conversation surface holds still and what it lets move while a turn
 * is out: one indicator and never two, a place already there for whatever
 * arrives late, a member's word for where the turn stands, and what a reader
 * who cannot see the text arriving is told.
 *
 * The surface is handed exchanges and nothing else, so each case draws the
 * moments of a turn as the exchanges a page would hand it. jsdom lays nothing
 * out, so a place being held is asserted as the node that holds it being there
 * before and being the same node after; the offsets are measured in a browser.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
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
const writing = { activity: "Writing" } as const;
const answer = "It is blocked by 40.";

function word(container: HTMLElement): readonly string[] {
  return Array.from(
    container.querySelectorAll('.conversation-meta p [role="status"]'),
    (status) => status.textContent,
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
  test("the engine, until the turn has a word", async () => {
    await settledOn({ standing: { standing: "Running", state: "Queued" } }, [
      "engine",
    ]);
    await settledOn({ standing: { standing: "Running", state: "Waiting" } }, [
      "engine",
    ]);
    await settledOn({}, ["engine"]);
    await settledOn({ work: [thought], activity: { activity: "Thinking" } }, [
      "engine",
    ]);
    await settledOn(
      { work: [read], activity: { activity: "ToolUse", name: "Read" } },
      ["engine"],
    );
  });

  test("the mark, while its text is being written", async () => {
    await settledOn({ answer, activity: writing }, ["mark"]);
    await settledOn({ work: [thought], answer, activity: writing }, ["mark"]);
  });

  test("the glyph under the answer, once there are words and they are not what is being written", async () => {
    await settledOn(
      { work: [read], answer, activity: { activity: "ToolUse", name: "Read" } },
      ["glyph"],
    );
    await settledOn({ answer }, ["glyph"]);
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
    expect(word(view.container)).toEqual(["Working", "Queued"]);
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

/** The moments of one turn, in the order a page hears them. */
const throughMoments: readonly Partial<ConversationExchange>[] = [
  {},
  { work: [thought], activity: { activity: "Thinking" } },
  { work: [thought], answer: "It is", activity: writing },
  { work: [thought], answer, activity: writing },
  {
    work: [thought, read],
    answer: `${answer} And 40 is waiting on a review of its own.`,
    activity: { activity: "ToolUse", name: "Read" },
  },
  {
    work: [thought, read],
    answer: `${answer} And 40 is waiting on a review of its own.`,
    activity: { activity: "Whole" },
  },
];

describe("a turn drawn through", () => {
  test("never has two things moving at once, at any moment", async () => {
    const seen: (readonly string[])[] = [];
    const view = render(
      drawn([running({ standing: { standing: "Running", state: "Queued" } })]),
    );
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
      expect(moving(view.container)).toEqual(["glyph"]);
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
    expect(new Set(seen.flat())).toEqual(new Set(["engine", "mark", "glyph"]));
  });
});

describe("the word under an answer", () => {
  function said(exchange: Partial<ConversationExchange>): string {
    const view = render(drawn([running(exchange)]));
    const words = word(view.container);
    const text = view.container.textContent;
    cleanup();
    expect(words).toHaveLength(1);
    expect(text).not.toContain("Claimed");
    return words[0] ?? "";
  }

  test("is a member's, and never the mailbox's for a turn a runner has", () => {
    expect(said({ standing: { standing: "Running", state: "Queued" } })).toBe(
      "Queued",
    );
    expect(said({ standing: { standing: "Running", state: "Waiting" } })).toBe(
      "Waiting",
    );
    expect(said({})).toBe("Starting");
    expect(said({ activity: { activity: "Thinking" } })).toBe("Working");
    expect(said({ work: [read] })).toBe("Working");
    expect(said({ answer, activity: writing })).toBe("Working");
    expect(said({ answer, standing: { standing: "Answered" } })).toBe(
      "Answered",
    );
  });

  test("is one status that is there throughout, so a reader is told when it changes and of no word of the text", async () => {
    const view = render(drawn([running({})]));
    const status = found(
      view.container,
      '.conversation-meta p [role="status"]',
    );
    expect(status.textContent).toBe("Starting");
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
    expect(quiet[1]?.classList.contains("invisible")).toBe(false);
  });
});

describe("what arrives late lands in a place already held", () => {
  test("a step that begins after the words have takes the place held above them", async () => {
    const view = render(drawn([running({ answer, activity: writing })]));
    await waitFor(() => {
      expect(view.container.querySelector(".run-report")?.textContent).toBe(
        answer,
      );
    });
    const place = found(view.container, ".conversation-work");
    const report = found(view.container, ".run-report");
    expect(place.childElementCount).toBe(0);
    expect(place.nextElementSibling?.contains(report)).toBe(true);
    view.rerender(
      drawn([
        running({
          work: [read],
          answer,
          activity: { activity: "ToolUse", name: "Read" },
        }),
      ]),
    );
    expect(found(view.container, ".conversation-work")).toBe(place);
    expect(place.querySelector(".conversation-trigger")?.textContent).toBe(
      "Read",
    );
    expect(found(view.container, ".run-report")).toBe(report);
    styleless();
  });

  test("the place is held above an answer that took no work, written or stored", () => {
    const view = render(
      drawn([running({ answer, standing: { standing: "Answered" } })]),
    );
    expect(found(view.container, ".conversation-work").childElementCount).toBe(
      0,
    );
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
