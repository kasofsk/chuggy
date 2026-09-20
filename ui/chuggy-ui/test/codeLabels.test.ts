import { describe, expect, test } from "vitest";

import { adoptedTicketStateSchema } from "../../../src/contract/adoptedTickets.ts";
import {
  adoptedTicketStateLabel,
  adoptedTicketWord,
} from "../app/core/codeLabels.ts";

const states = adoptedTicketStateSchema.options;

describe("adopted ticket state labels", () => {
  test("every state the wire can send has a label of its own", () => {
    const drawn = states.map((state) => adoptedTicketStateLabel(state));

    expect(drawn.filter((label) => label.trim() === "")).toEqual([]);
    expect(new Set(drawn).size).toBe(states.length);
  });

  test("a state named for what it holds is drawn as what is happening", () => {
    expect(adoptedTicketStateLabel("Work")).toBe("Working");
    expect(adoptedTicketStateLabel("Evaluation")).toBe("Evaluating");
    expect(adoptedTicketStateLabel("Finalization")).toBe("Finalizing");
  });

  test("a ticket is named the same way wherever it is named", () => {
    expect(adoptedTicketWord(7)).toBe("#7");
  });
});
