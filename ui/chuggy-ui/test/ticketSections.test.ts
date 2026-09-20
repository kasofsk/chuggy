import { describe, expect, test } from "vitest";

import { adoptedTicketStateSchema } from "../../../src/contract/adoptedTickets.ts";
import {
  ticketSectionOf,
  ticketSectionRoster,
  ticketSectionStates,
  ticketSectionTitles,
} from "../app/core/ticketSections.ts";

const states = adoptedTicketStateSchema.options;

describe("ticket sections", () => {
  test("every state the wire can send is in exactly one section", () => {
    const held = ticketSectionRoster.flatMap((section) =>
      ticketSectionStates(section),
    );

    expect([...held].sort()).toEqual([...states].sort());
  });

  test("the sections a reader is asking about hold what they name", () => {
    expect(ticketSectionStates("NeedsYou")).toEqual(["Escalated"]);
    expect(ticketSectionStates("InProgress")).toEqual([
      "Work",
      "Evaluation",
      "Finalization",
    ]);
    expect(ticketSectionStates("UpNext")).toEqual(["Pending"]);
    expect(ticketSectionStates("Stopped")).toEqual(["Revoked"]);
  });

  test("a revoked ticket is read beside what failed, not beside what finished", () => {
    expect(ticketSectionOf("Revoked")).toBe("Stopped");
    expect(ticketSectionTitles["Stopped"]).toBe("failed or revoked");
  });
});
