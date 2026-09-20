import { describe, expect, test } from "vitest";

import { adoptedTicketStateSchema } from "../../../src/contract/adoptedTickets.ts";
import { adoptedTicketStateLabel } from "../app/core/codeLabels.ts";
import { adoptedTicketStateSentence } from "../app/core/codeSentences.ts";

const states = adoptedTicketStateSchema.options;

/** Short of this a line is a word or two, which is what a label already is. */
const sentenceWordsMin = 6;

describe("adopted ticket state sentences", () => {
  test("every state the wire can send is explained, and each differently", () => {
    const said = states.map((state) => adoptedTicketStateSentence(state));

    expect(said.filter((sentence) => sentence.trim() === "")).toEqual([]);
    expect(new Set(said).size).toBe(states.length);
  });

  test("a sentence explains the state rather than restating it", () => {
    for (const state of states) {
      const said = adoptedTicketStateSentence(state);
      expect(said).not.toBe(state);
      expect(said).not.toBe(adoptedTicketStateLabel(state));
      expect(said.split(" ").length).toBeGreaterThanOrEqual(sentenceWordsMin);
    }
  });
});
