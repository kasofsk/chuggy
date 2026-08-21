import assert from "node:assert/strict";
import { test } from "node:test";

import { releaseTicketEvent } from "../../src/actor/decisionEvent.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import {
  deriveDispatchCandidates,
  dispatchViewDigest,
} from "../../src/interpreter/dispatchView.ts";
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";

function pendingCandidates() {
  const one = journalStep(
    refinementInstance,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  const two = journalStep(
    refinementInstance,
    one,
    releaseTicketEvent(id(2), plainAuthoring),
  );
  return deriveDispatchCandidates(
    refinementInstance,
    two.view.post,
    new Map([
      [id(1), 1],
      [id(2), 2],
    ]),
    new Map([
      [
        id(1),
        {
          configurationRevision: "r1",
          configurationDigest: "d1",
          configurationCanonical: '{"worker":"one"}',
        },
      ],
      [
        id(2),
        {
          configurationRevision: "r2",
          configurationDigest: "d2",
          configurationCanonical: '{"worker":"two"}',
        },
      ],
    ]),
  );
}

test("dispatch candidates and their digest ignore map insertion and presentation order", () => {
  const candidates = pendingCandidates();
  assert.deepEqual(
    candidates.map((candidate) => candidate.ticket),
    [id(1), id(2)],
  );
  assert.equal(
    dispatchViewDigest(candidates),
    dispatchViewDigest([...candidates].reverse()),
  );
});

test("every strict candidate fact participates in the digest", () => {
  const candidates = pendingCandidates();
  const first = candidates[0];
  assert.ok(first !== undefined);
  const changed = [
    { ...first, ticketVersion: first.ticketVersion + 1 },
    { ...first, workFanout: first.workFanout + 1 },
    { ...first, dependencies: [99] },
    {
      ...first,
      configurationRevision: `${first.configurationRevision}-changed`,
    },
    { ...first, configurationDigest: `${first.configurationDigest}-changed` },
    {
      ...first,
      configurationCanonical: `${first.configurationCanonical} `,
    },
  ];
  for (const replacement of changed)
    assert.notEqual(
      dispatchViewDigest(candidates),
      dispatchViewDigest([replacement, ...candidates.slice(1)]),
    );
});

test("facts outside the strict view cannot invalidate its digest", () => {
  const candidates = pendingCandidates();
  const digest = dispatchViewDigest(candidates);
  const unrelatedJournalHead = 300;
  const advisoryCapacity = 0;
  assert.equal(dispatchViewDigest(candidates), digest);
  assert.equal(unrelatedJournalHead + advisoryCapacity, 300);
});
