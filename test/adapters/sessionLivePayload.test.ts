/**
 * What the live lane reads out of a notification's payload, which is the one
 * door anything on the channel passes before the hub hears of it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { sessionLiveCarried } from "../../src/adapters/postgres/sessionLive.ts";
import {
  sessionIdentityCharsMax,
  sessionLiveEventsMax,
} from "../../src/contract/http.ts";
import type { SessionLiveEvent } from "../../src/contract/sessionLive.ts";

const begun: SessionLiveEvent = {
  live: "Block",
  message: "message-1",
  index: 0,
  kind: "Text",
};

const payload = {
  tenant: "tenant",
  project: "project",
  session: "session-1",
  turn: "turn-1",
  ordinal: 0,
  event: begun,
};

function carried(sent: unknown): ReturnType<typeof sessionLiveCarried> {
  return sessionLiveCarried(JSON.stringify(sent));
}

test("a payload naming whose event it is, and where in its post, is carried as that session's event", () => {
  const events: SessionLiveEvent[] = [
    begun,
    { live: "Text", message: "message-1", index: 0, offset: 0, text: "Hi" },
    { live: "End" },
  ];
  for (const ordinal of [0, sessionLiveEventsMax - 1])
    for (const event of events)
      assert.deepEqual(carried({ ...payload, ordinal, event }), {
        partition: { tenant: "tenant", project: "project" },
        session: "session-1",
        turn: "turn-1",
        event,
      });
});

test("a payload that is not JSON, or not one object, is carried as nothing", () => {
  for (const sent of ["", "{", "not json", "null", "[]", '"text"', "7"])
    assert.equal(sessionLiveCarried(sent), undefined, sent);
});

test("a payload missing a field, carrying one more, or holding one of another type is carried as nothing", () => {
  for (const field of Object.keys(payload)) {
    const short = Object.fromEntries(
      Object.entries(payload).filter(([name]) => name !== field),
    );
    assert.equal(carried(short), undefined, `without ${field}`);
    assert.equal(carried({ ...payload, [field]: 7.5 }), undefined, field);
    assert.equal(carried({ ...payload, [field]: null }), undefined, field);
  }
  assert.equal(carried({ ...payload, more: true }), undefined);
});

test("an identity its own brand refuses is carried as nothing", () => {
  const partitioned = ["", "\ud800"];
  const stored = [
    ...partitioned,
    "nul\u0000",
    "a".repeat(sessionIdentityCharsMax + 1),
  ];
  const refused = {
    tenant: partitioned,
    project: partitioned,
    session: stored,
    turn: stored,
  };
  for (const [field, values] of Object.entries(refused))
    for (const value of values)
      assert.equal(
        carried({ ...payload, [field]: value }),
        undefined,
        `${field} of ${String(value.length)}`,
      );
});

test("a place no post has, or an event the plane would not have admitted, is carried as nothing", () => {
  for (const ordinal of [-1, 0.5, sessionLiveEventsMax])
    assert.equal(carried({ ...payload, ordinal }), undefined, String(ordinal));
  for (const event of [
    { live: "Begun" },
    { live: "End", message: "message-1" },
    { ...begun, kind: "ToolUse" },
    { ...begun, name: "Read" },
    { ...begun, index: -1 },
    { live: "Text", message: "message-1", index: 0, offset: 0 },
  ])
    assert.equal(
      carried({ ...payload, event }),
      undefined,
      JSON.stringify(event),
    );
});
