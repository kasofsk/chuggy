/**
 * The boundary of a ticket's takes and returns: the store is written only
 * under the caller's own `Mutate` authority, the site's selector is refused
 * before any permit is asked, and what the store decides is answered as it
 * decided it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import type { Authority } from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  ticketTakes,
  type TicketTakeKind,
  type TicketTakeStored,
} from "../../src/interpreter/ticketTake.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const member = asPrincipal("issuer-member");
const selector = asPrincipal("issuer-selector");
const ticket = asTicketId(7);

function boundary(
  kinds: readonly ProjectAccessKind[],
  stored: TicketTakeStored = { stored: "Taken", owner: member },
  principal = member,
) {
  const calls: { kind: TicketTakeKind; authority: Authority }[] = [];
  const access = memoryProjectAccess();
  access.grant({ partition, principal, access: new Set(kinds) });
  const takes = ticketTakes(
    access,
    {
      write: (_partition, _ticket, kind, authority) => {
        calls.push({ kind, authority });
        return Promise.resolve(stored);
      },
    },
    { selector },
  );
  return { calls, takes };
}

test("a take and a return are written under the caller's own Mutate authority and answered as the store decided", async () => {
  const { calls, takes } = boundary(["Read", "Mutate"]);
  assert.deepEqual(await takes.write(member, partition, ticket, "Take"), {
    result: "Written",
    outcome: "Taken",
    owner: member,
  });
  assert.deepEqual(
    calls.map(({ kind, authority }) => [kind, authority.subject]),
    [["Take", member]],
  );
  const returned = boundary(["Read", "Mutate"], { stored: "Returned" });
  assert.deepEqual(
    await returned.takes.write(member, partition, ticket, "Return"),
    { result: "Written", outcome: "Returned" },
    "a ticket returned to a creator who is no member is answered with no owner",
  );
});

test("the site's selector is refused before any permit is asked, though it holds every one", async () => {
  const { calls, takes } = boundary(
    ["Read", "Mutate", "DispatchTicket", "Administer"],
    undefined,
    selector,
  );
  for (const kind of ["Take", "Return"] as const)
    assert.deepEqual(await takes.write(selector, partition, ticket, kind), {
      result: "Refused",
      reason: "TakerNotAPerson",
    });
  assert.deepEqual(calls, [], "the store is never reached");
});

test("a reader without Mutate is forbidden, and a caller who cannot read is not told the project is there", async () => {
  const reader = boundary(["Read"]);
  assert.deepEqual(
    await reader.takes.write(member, partition, ticket, "Take"),
    {
      result: "Forbidden",
    },
  );
  const stranger = boundary([]);
  assert.deepEqual(
    await stranger.takes.write(member, partition, ticket, "Take"),
    { result: "NotFound" },
  );
  assert.deepEqual([...reader.calls, ...stranger.calls], []);
});

test("a refusal the store names is answered by its name, and a ticket it does not hold is not found", async () => {
  for (const reason of [
    "Unreleased",
    "TicketDone",
    "TicketRevoked",
    "NotTaker",
  ] as const)
    assert.deepEqual(
      await boundary(["Read", "Mutate"], {
        stored: "Refused",
        reason,
      }).takes.write(member, partition, ticket, "Take"),
      { result: "Refused", reason },
    );
  assert.deepEqual(
    await boundary(["Read", "Mutate"], { stored: "MissingTicket" }).takes.write(
      member,
      partition,
      ticket,
      "Take",
    ),
    { result: "NotFound" },
  );
});
