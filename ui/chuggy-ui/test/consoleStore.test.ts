/**
 * The console's store: a store per call, so what one holds no other sees.
 */

import { expect, test } from "vitest";

import {
  ticketAttemptAt,
  ticketAttemptHeldAt,
} from "../app/browser/ticketAttempts.ts";
import { consoleStoreBare } from "./consoleStoreBare.tsx";

const atlas = { tenant: "acme", project: "atlas" };

test("each store holds its own state, so nothing crosses from one to the next", () => {
  const first = consoleStoreBare();
  const attempt = {
    action: {
      action: "Resume",
      mutation: { mutation: "ResumeTicket", ticket: 11 },
    },
    operation: "op-one",
  } as const;
  first.dispatch(
    ticketAttemptHeldAt({ partition: atlas, ticket: 11, attempt }),
  );
  expect(ticketAttemptAt(first.getState(), atlas, 11)).toStrictEqual(attempt);
  expect(
    ticketAttemptAt(consoleStoreBare().getState(), atlas, 11),
  ).toBeUndefined();
});
