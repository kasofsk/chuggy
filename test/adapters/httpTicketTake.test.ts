/**
 * A ticket's take and return routes as the API answers them: what each did
 * with the owner it leaves, each refusal under its own name and status, and a
 * caller who cannot see the ticket answered as any absence is.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  errorEnvelopeSchema,
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import { ticketTakeResponseSchema } from "../../src/contract/responses.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type {
  TicketTakeKind,
  TicketTakes,
  TicketTakeWritten,
} from "../../src/interpreter/ticketTake.ts";
import { callerApp } from "./callerAppFixture.ts";

const headers = {
  authorization: "Bearer valid",
  "content-type": nativeHttpMediaType,
};
const member = asPrincipal("member");

/** Takes answering `written` to every write, recording which act on which ticket each was. */
function takesAnswering(
  written: TicketTakeWritten,
  asked: string[],
): TicketTakes {
  return {
    write: (principal, partition, ticket, kind) => {
      asked.push(
        `${kind} ${partition.tenant}/${partition.project}#${String(ticket)} by ${principal}`,
      );
      return Promise.resolve(written);
    },
  };
}

function path(kind: TicketTakeKind): string {
  return (
    kind === "Take"
      ? nativeHttpRoutes.ticketTake
      : nativeHttpRoutes.ticketReturn
  )
    .replace(":tenant", "acme")
    .replace(":project", "atlas")
    .replace(":ticket", "7");
}

test("a take and a return answer what each did and the owner it leaves, on the ticket the path names", async () => {
  const asked: string[] = [];
  for (const [kind, written] of [
    ["Take", { result: "Written", outcome: "Taken", owner: member }],
    ["Take", { result: "Written", outcome: "AlreadyOwner", owner: member }],
    ["Return", { result: "Written", outcome: "Returned" }],
  ] as const) {
    await using app = callerApp(member, {
      takes: takesAnswering(written, asked),
    });
    const answered = await app.inject({
      method: "POST",
      url: path(kind),
      headers,
      payload: {},
    });
    assert.equal(answered.statusCode, 200, written.outcome);
    assert.deepEqual(ticketTakeResponseSchema.parse(answered.json()), {
      outcome: written.outcome,
      ...("owner" in written ? { owner: written.owner } : {}),
    });
  }
  assert.deepEqual(asked, [
    `Take acme/atlas#7 by ${member}`,
    `Take acme/atlas#7 by ${member}`,
    `Return acme/atlas#7 by ${member}`,
  ]);
});

test("each refusal is answered under its own code: an agent and a caller without the permit are forbidden, a ticket's state a conflict", async () => {
  for (const [written, status, code] of [
    [{ result: "Refused", reason: "TakerNotAPerson" }, 403, "TakerNotAPerson"],
    [{ result: "Forbidden" }, 403, "Forbidden"],
    [{ result: "Refused", reason: "Unreleased" }, 409, "Unreleased"],
    [{ result: "Refused", reason: "TicketDone" }, 409, "TicketDone"],
    [{ result: "Refused", reason: "TicketRevoked" }, 409, "TicketRevoked"],
    [{ result: "Refused", reason: "NotTaker" }, 409, "NotTaker"],
    [{ result: "NotFound" }, 404, "NotFound"],
  ] as const) {
    await using app = callerApp(member, {
      takes: takesAnswering(written, []),
    });
    for (const kind of ["Take", "Return"] as const) {
      const answered = await app.inject({
        method: "POST",
        url: path(kind),
        headers,
        payload: {},
      });
      assert.equal(answered.statusCode, status, `${kind} ${code}`);
      assert.equal(
        errorEnvelopeSchema.parse(answered.json()).error.code,
        code,
        kind,
      );
    }
  }
});
