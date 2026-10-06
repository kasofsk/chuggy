/**
 * The console's poll of a ticket's action reach, held to the two waits the
 * server keeps for that read. A commit the server could not weigh is not asked
 * about again until a wait has passed, so a poll sooner than that wait lands
 * inside it and is told `Unknown` for that commit without its being asked, and
 * a poll later leaves it standing once it could have been asked. The wait is
 * not how long an `Unknown` lasts: one left by a read cut short is cleared by
 * the next read whenever that comes. And a read the server is still bounding
 * when the console gives up is a row that shows a failed read where it would
 * have shown its lines.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { actionReachAncestryDefaults } from "../../src/interpreter/actionReachAncestry.ts";
import { ticketActionReachAnswerSecsMax } from "../../src/interpreter/ticketActionReach.ts";
import { apiTimeoutMsDefault } from "../../ui/chuggy-ui/app/core/apiRequest.ts";
import { ticketDeliveryPolledMs } from "../../ui/chuggy-ui/app/core/ticketDelivery.ts";

test("the console asks for a ticket's action reach as often as the server would ask again of a commit it could not weigh", () => {
  assert.equal(
    ticketDeliveryPolledMs,
    actionReachAncestryDefaults.undecidedWaitSecs * 1000,
  );
});

test("a ticket's action reach is answered before the console gives up on the read", () => {
  assert.ok(ticketActionReachAnswerSecsMax * 1000 < apiTimeoutMsDefault);
});
