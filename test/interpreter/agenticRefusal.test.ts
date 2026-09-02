/**
 * The refusal ledger's derived standing, and the door the API reads it through.
 *
 * Standing is the whole of what is not stored, so the cases here are the ones a
 * `standing` column would have got wrong: a lift after a refusal, and a refusal
 * after that lift.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  agenticRefusalIsSuperseded,
  agenticRefusalStanding,
  agenticRefusals,
  allAgenticRefusalEvents,
  type AgenticRefusalEntry,
  type AgenticRefusalRead,
} from "../../src/interpreter/agenticRefusal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";

const partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};
const principal = oidcPrincipal("https://issuer.test", "person");
const ticket = asTicketId(42);

function entry(
  ordinal: number,
  event: AgenticRefusalEntry["event"],
  ticketVersion: number,
): AgenticRefusalEntry {
  return {
    ordinal,
    partition,
    ticket,
    event,
    ticketVersion,
    reason: "the dependency is still failing",
    decision: `selector-decision-${String(ordinal)}`,
    recordedAt: "2026-09-02T12:00:00.000Z",
  };
}

const ledger: readonly AgenticRefusalEntry[] = [
  entry(1, "Refused", 2),
  entry(2, "Lifted", 2),
];

const read: AgenticRefusalRead = {
  standing: () =>
    Promise.resolve([
      {
        ticket,
        ticketVersion: 2,
        reason: "the dependency is still failing",
        decision: "selector-decision-1",
        recordedAt: "2026-09-02T12:00:00.000Z",
      },
    ]),
  ledger: () => Promise.resolve(ledger),
};

test("the refusal events are the two the ledger records", () => {
  assert.deepEqual(allAgenticRefusalEvents, ["Refused", "Lifted"]);
});

test("a ledger whose latest entry is a lift stands on nothing", () => {
  assert.equal(agenticRefusalStanding(ledger), undefined);
  assert.equal(agenticRefusalStanding([]), undefined);
  const standing = agenticRefusalStanding([...ledger, entry(3, "Refused", 3)]);
  assert.equal(standing?.ticketVersion, 3);
  assert.equal(standing?.decision, "selector-decision-3");
});

test("a refusal is superseded exactly where the ticket has been authored again", () => {
  const standing = agenticRefusalStanding([entry(1, "Refused", 2)]);
  assert.ok(standing !== undefined);
  assert.equal(agenticRefusalIsSuperseded(standing, 2), false);
  assert.equal(agenticRefusalIsSuperseded(standing, 3), true);
});

test("a reader without project read access is told the project is not there", async () => {
  const refused = agenticRefusals(
    { authorize: () => Promise.resolve(undefined) },
    read,
  );
  assert.deepEqual(await refused.standing(principal, partition, 8), {
    result: "NotFound",
  });
  assert.deepEqual(await refused.ledger(principal, partition, ticket, 8), {
    result: "NotFound",
  });
});

test("an authorized read answers the ledger and the standing it induces", async () => {
  const authority = {
    kind: asAuthorityKind("User"),
    subject: asAuthoritySubject("internal-subject"),
  };
  const service = agenticRefusals(
    { authorize: () => Promise.resolve(authority) },
    read,
  );
  const answered = await service.ledger(principal, partition, ticket, 8);
  assert.equal(answered.result, "Found");
  assert.deepEqual(
    answered.result === "Found" ? answered.entries : undefined,
    ledger,
  );
  assert.equal(
    answered.result === "Found" ? answered.standing : "unset",
    undefined,
  );
  const project = await service.standing(principal, partition, 8);
  assert.equal(
    project.result === "Found" ? project.refusals.length : undefined,
    1,
  );
});
