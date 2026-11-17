/**
 * What the ticket page says aloud when the ticket's state changes under it:
 * the new state, once, in the word its label shows, and nothing on the page's
 * first draw.
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import type { Copy } from "../app/core/copy.ts";
import {
  ticketStateAnnounced,
  ticketStateLabelOf,
  ticketStateStandings,
} from "../app/core/ticketHeader.ts";
import type { TicketStateStanding } from "../app/core/ticketHeader.ts";

test("a change of state says the new state in the word its label shows", () => {
  for (const next of ticketStateStandings) {
    const said = ticketStateAnnounced("Draft", next);
    expect(said, next).toBeDefined();
    expect(copyTextEn(said as Copy), next).toBe(
      `Ticket is now ${copyTextEn(ticketStateLabelOf(next).word)}`,
    );
  }
});

test("the first draw says nothing", () => {
  for (const standing of ticketStateStandings)
    expect(ticketStateAnnounced(undefined, standing), standing).toBeUndefined();
});

test("a state change is said once across the draws that follow it", () => {
  const draws: readonly TicketStateStanding[] = [
    "Ready",
    "Ready",
    "Work",
    "Work",
    "Work",
    "Evaluation",
    "Evaluation",
  ];
  const said = draws.flatMap((standing, index) => {
    const line = ticketStateAnnounced(draws[index - 1], standing);
    return line === undefined ? [] : [copyTextEn(line)];
  });
  expect(said).toStrictEqual([
    "Ticket is now Working",
    "Ticket is now Evaluating",
  ]);
});
