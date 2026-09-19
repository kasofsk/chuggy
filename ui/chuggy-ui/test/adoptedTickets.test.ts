import { describe, expect, test } from "vitest";

import { adoptedOperationOutcomeSchema } from "../../../src/contract/adoptedTickets.ts";
import {
  adoptedOperationRefusal,
  assertAdoptedOperationSucceeded,
} from "../app/core/adoptedTickets.ts";

describe("adopted ticket operation outcomes", () => {
  test("a refused machine decision carries its reason to the caller", () => {
    const outcome = adoptedOperationOutcomeSchema.parse({
      sequence: 4,
      decision: {
        type: "TicketRefused",
        reason: { type: "RevisionMismatch", expected: 2, observed: 3 },
      },
    });

    expect(adoptedOperationRefusal(outcome)).toBe("RevisionMismatch");
    expect(() => {
      assertAdoptedOperationSucceeded(outcome);
    }).toThrow("The ticket operation was refused: RevisionMismatch.");
  });

  test("an accepted machine decision has no refusal", () => {
    const outcome = adoptedOperationOutcomeSchema.parse({
      sequence: 5,
      decision: {
        type: "TicketDecided",
        event: { type: "TicketRevoked", ticket: 7 },
        obligations: [],
      },
    });

    expect(adoptedOperationRefusal(outcome)).toBeUndefined();
  });
});
