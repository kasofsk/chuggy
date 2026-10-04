/**
 * A session's publish allowance as a pure unit: a clock a case sets, and a
 * lane that records what reached it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { sessionLiveEventsMax } from "../../src/contract/http.ts";
import type { SessionLiveEvent } from "../../src/contract/sessionLive.ts";
import {
  asSessionId,
  asSessionTurnId,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  sessionLiveAllowanceLimitsDefault,
  sessionLivePublishAllowed,
  type SessionLiveAllowanceLimits,
} from "../../src/interpreter/sessionLiveAllowance.ts";
import type { SessionLivePublished } from "../../src/interpreter/sessionPlane.ts";
import { partitionOf } from "./projectStreamHarness.ts";

const project = partitionOf("project");
const one = asSessionId("session-1");
const two = asSessionId("session-2");
const turn = asSessionTurnId("turn-1");

function events(count: number): SessionLiveEvent[] {
  return Array.from({ length: count }, (_unused, at) => ({
    live: "Text" as const,
    message: "message-1",
    index: 0,
    offset: at,
    text: "a",
  }));
}

interface Rig {
  /** How many events of each post reached the lane, in order. */
  readonly reached: number[];
  readonly refusals: number[];
  setNowMs(nowMs: number): void;
  answers(answer: SessionLivePublished): void;
  post(
    count: number,
    session?: SessionId,
    partition?: Partition,
  ): Promise<SessionLivePublished>;
}

function rigOf(limits: Partial<SessionLiveAllowanceLimits> = {}): Rig {
  const reached: number[] = [];
  const refusals: number[] = [];
  let nowMs = 0;
  let answer: SessionLivePublished = "Published";
  const port = sessionLivePublishAllowed(
    {
      publish: (input) => {
        reached.push(input.events.length);
        return Promise.resolve(answer);
      },
    },
    () => nowMs,
    { refused: (refusedTotal) => refusals.push(refusedTotal) },
    { ...sessionLiveAllowanceLimitsDefault, ...limits },
  );
  return {
    reached,
    refusals,
    setNowMs: (value) => {
      nowMs = value;
    },
    answers: (value) => {
      answer = value;
    },
    post: (count, session = one, partition = project) =>
      port.publish({ partition, session, turn, events: events(count) }),
  };
}

test("a session publishes its burst at once, and a post past it reaches no lane and is told to come back", async () => {
  const rig = rigOf({ eventsBurstMax: 40 });
  assert.equal(await rig.post(16), "Published");
  assert.equal(await rig.post(16), "Published");
  assert.equal(await rig.post(16), "Unavailable");
  assert.deepEqual(rig.reached, [16, 16]);
  assert.equal(await rig.post(8), "Published");
  assert.equal(await rig.post(1), "Unavailable");
  assert.deepEqual(rig.reached, [16, 16, 8]);
});

test("the allowance comes back at its rate, and never past the burst", async () => {
  const rig = rigOf({ eventsPerSecondMax: 10, eventsBurstMax: 20 });
  assert.equal(await rig.post(16), "Published");
  assert.equal(await rig.post(4), "Published");
  rig.setNowMs(499);
  assert.equal(await rig.post(5), "Unavailable");
  rig.setNowMs(500);
  assert.equal(await rig.post(5), "Published");
  rig.setNowMs(3_600_000);
  assert.equal(await rig.post(16), "Published");
  assert.equal(await rig.post(4), "Published");
  assert.equal(await rig.post(1), "Unavailable");
});

test("a clock that steps back gives nothing and takes nothing", async () => {
  const rig = rigOf({ eventsPerSecondMax: 10, eventsBurstMax: 16 });
  rig.setNowMs(10_000);
  assert.equal(await rig.post(16), "Published");
  rig.setNowMs(0);
  assert.equal(await rig.post(1), "Unavailable");
  rig.setNowMs(100);
  assert.equal(await rig.post(1), "Published");
});

test("a runner posting a few events many times a second, and catching a long block up in one burst, is never refused at the defaults", async () => {
  const rig = rigOf();
  const postsPerSecond = 20;
  const answered = new Set<SessionLivePublished>();
  for (let post = 0; post < 60 * postsPerSecond; post += 1) {
    rig.setNowMs((post * 1_000) / postsPerSecond);
    answered.add(await rig.post(3));
    if (post % (10 * postsPerSecond) === 0)
      for (let caught = 0; caught < 4; caught += 1)
        answered.add(await rig.post(sessionLiveEventsMax));
  }
  assert.deepEqual([...answered], ["Published"]);
});

test("each session of each project draws on its own allowance", async () => {
  const rig = rigOf({ eventsBurstMax: 16 });
  assert.equal(await rig.post(16, one), "Published");
  assert.equal(await rig.post(1, one), "Unavailable");
  assert.equal(await rig.post(16, two), "Published");
  assert.equal(await rig.post(16, one, partitionOf("other")), "Published");
  assert.equal(
    await rig.post(16, one, partitionOf("project", "other-tenant")),
    "Published",
  );
});

test("past the sessions it remembers, the one seen longest ago is forgotten and returns with a whole burst", async () => {
  const rig = rigOf({ eventsBurstMax: 16, sessionsTrackedMax: 2 });
  const three = asSessionId("session-3");
  assert.equal(await rig.post(16, one), "Published");
  assert.equal(await rig.post(16, two), "Published");
  assert.equal(await rig.post(1, one), "Unavailable");
  assert.equal(await rig.post(16, three), "Published");
  assert.equal(await rig.post(1, one), "Unavailable");
  assert.equal(await rig.post(16, two), "Published");
});

test("refusals are reported at the first and at each doubling", async () => {
  const rig = rigOf({ eventsBurstMax: 16 });
  await rig.post(16);
  for (let post = 0; post < 9; post += 1) await rig.post(1);
  assert.deepEqual(rig.refusals, [1, 2, 4, 8]);
});

test("a lane that could not be reached is answered as it answered, and the events are spent", async () => {
  const rig = rigOf({ eventsBurstMax: 16 });
  rig.answers("Unavailable");
  assert.equal(await rig.post(16), "Unavailable");
  rig.answers("Published");
  assert.equal(await rig.post(1), "Unavailable");
  assert.deepEqual(rig.reached, [16]);
  assert.deepEqual(rig.refusals, [1]);
});

test("limits no allowance could run on are refused: one that is not a count, and a burst smaller than a post", () => {
  for (const what of Object.keys(sessionLiveAllowanceLimitsDefault))
    for (const value of [0, -1, 1.5, Number.NaN])
      assert.throws(
        () => rigOf({ [what]: value }),
        new RangeError(`${what} must be a positive integer`),
      );
  assert.throws(
    () => rigOf({ eventsBurstMax: sessionLiveEventsMax - 1 }),
    new RangeError("eventsBurstMax must cover the events of one post"),
  );
  rigOf({ eventsBurstMax: sessionLiveEventsMax });
});
