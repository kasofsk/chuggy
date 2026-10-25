/**
 * The commit ancestry adapter's bounds against real repositories: what an asker
 * is answered once its own bound or the remote's has passed, what an ask leaves
 * running, and how many askers one fetch takes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  type FixtureVerb,
  fixtureFaulted,
  fixtureHistoryHeld,
  fixtureNewer,
  fixtureOpen,
  fixturePort,
  fixtureQuestion,
  fixtureReads,
  fixtureRecorded,
  fixtureRecordedCount,
  fixtureRecordedLines,
  fixtureServe,
  fixtureServed,
  fixtureServing,
  fixtureTwin,
  fixtureUntil,
} from "./gitCommitAncestryFixture.ts";

/** The reads an ask makes of a held tip, in the order it makes them: for a candidate in the tip's history, and for one the scratch does not hold. */
const fixtureAskReads: Readonly<
  Record<"candidate" | "stray", readonly FixtureVerb[]>
> = {
  candidate: ["rev-parse", "cat-file", "merge-base"],
  stray: ["rev-parse", "cat-file", "rev-list"],
};

test("an asker is answered unknown at its own bound, and the fetch it began goes on to hold the tip", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { answerTimeoutSecsMax: 2 });
  fixtureServe(fixture, "Slowed", 3);
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );
  assert.ok(!fixtureHistoryHeld(fixture, fixture.tip));

  await fixtureUntil("the tip's history", () =>
    fixtureHistoryHeld(fixture, fixture.tip),
  );
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Ancestor",
  );
  assert.equal(fixtureServed(fixture), 1);
});

for (const [verb, asked, answer] of fixtureReads) {
  test(`an asker is answered unknown at its own bound while its ${verb} is still running, and nothing more is read for it`, async (t) => {
    const fixture = fixtureOpen(t);
    const environment = fixtureRecorded(fixture);
    const patient = fixturePort(fixture, { environment });
    const port = fixturePort(fixture, { environment, answerTimeoutSecsMax: 1 });
    const question = fixtureQuestion(fixture, fixture[asked]);
    const reads = fixtureAskReads[asked];
    assert.equal(await patient.ancestry(question), answer);
    const before = fixtureRecordedLines(fixture).length;
    fixtureFaulted(fixture, verb, "Stalled");
    assert.equal(await port.ancestry(question), "Unknown");
    fixtureFaulted(fixture, verb, "Whole");
    await fixtureUntil(
      "the read's end",
      () => fixtureRecordedCount(fixture, "ended") === 1,
    );

    assert.equal(await patient.ancestry(question), answer);
    assert.deepEqual(fixtureRecordedLines(fixture).slice(before), [
      ...reads.slice(0, reads.indexOf(verb) + 1),
      "ended",
      ...reads,
    ]);
  });
}

test("askers whose bound has passed read nothing once the fetch they waited on lands", async (t) => {
  const fixture = fixtureOpen(t);
  const environment = fixtureRecorded(fixture);
  const port = fixturePort(fixture, { environment, answerTimeoutSecsMax: 1 });
  const question = fixtureQuestion(fixture, fixture.candidate);
  fixtureServe(fixture, "Slowed");
  assert.deepEqual(
    await Promise.all(Array.from({ length: 5 }, () => port.ancestry(question))),
    Array.from({ length: 5 }, () => "Unknown"),
  );
  await fixtureUntil("the tip's history", () =>
    fixtureHistoryHeld(fixture, fixture.tip),
  );

  assert.equal(
    await fixturePort(fixture, { environment }).ancestry(question),
    "Ancestor",
  );
  assert.equal(fixtureRecordedCount(fixture, "cat-file"), 1);
  assert.equal(fixtureRecordedCount(fixture, "merge-base"), 1);
});

test("a fetch takes as many waiters as may wait on one, and an asker past them is unknown at once", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { fetchWaitersMax: 2 });
  const question = fixtureQuestion(fixture, fixture.candidate);
  fixtureServe(fixture, "Slowed");
  const waiting = [port.ancestry(question), port.ancestry(question)];
  await fixtureServing(fixture, 1);

  assert.equal(await port.ancestry(question), "Unknown");
  assert.ok(!fixtureHistoryHeld(fixture, fixture.tip));
  assert.deepEqual(await Promise.all(waiting), ["Ancestor", "Ancestor"]);
});

test("an asker whose bound has passed leaves its place among a fetch's waiters to another", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, {
    answerTimeoutSecsMax: 4,
    fetchWaitersMax: 1,
  });
  const question = fixtureQuestion(fixture, fixture.candidate);
  fixtureServe(fixture, "Slowed", 5);
  assert.equal(await port.ancestry(question), "Unknown");

  assert.equal(await port.ancestry(question), "Ancestor");
  assert.equal(fixtureServed(fixture), 1);
});

test("an ask that has been answered leaves no timer of its own running", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  const question = fixtureQuestion(fixture, fixture.candidate);
  const timers = (): number =>
    process.getActiveResourcesInfo().filter((held) => held === "Timeout")
      .length;
  const before = timers();
  assert.equal(await port.ancestry(question), "Ancestor");
  assert.equal(await port.ancestry(question), "Ancestor");

  assert.equal(timers(), before);
});

test("an asker whose bound passed while another tip was being fetched begins no fetch of its own", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { answerTimeoutSecsMax: 1 });
  const newer = fixtureNewer(fixture);
  fixtureServe(fixture, "Slowed");
  const first = port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  await fixtureServing(fixture, 1);
  fixtureServe(fixture, "Whole");
  const second = port.ancestry(
    fixtureQuestion(fixture, fixture.candidate, newer),
  );
  assert.deepEqual(await Promise.all([first, second]), ["Unknown", "Unknown"]);

  await fixtureUntil("the tip's history", () =>
    fixtureHistoryHeld(fixture, fixture.tip),
  );
  await sleep(500);
  assert.equal(fixtureServed(fixture), 1);
});

test("a credential source that never answers gives its repository's turn back once the remote bound has passed", async (t) => {
  const fixture = fixtureOpen(t);
  const twin = fixtureTwin(fixture);
  const port = fixturePort(fixture, {
    remoteTimeoutSecsMax: 1,
    answerTimeoutSecsMax: 3,
    fetchesInFlightMax: 1,
    credentials: {
      credential: (binding) =>
        binding.repository === fixture.remote
          ? new Promise<never>(() => undefined)
          : Promise.resolve({ resolved: "Denied" }),
    },
  });
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );

  assert.equal(
    await port.ancestry(
      fixtureQuestion(fixture, fixture.candidate, fixture.tip, twin),
    ),
    "Ancestor",
  );
});

test("the wait for a credential comes out of the time the transfer is given", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, {
    remoteTimeoutSecsMax: 4,
    credentials: {
      credential: async () => {
        await sleep(2000);
        return { resolved: "Denied" };
      },
    },
  });
  fixtureServe(fixture, "Slowed", 3);
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );
  assert.equal(fixtureServed(fixture), 1);
  assert.ok(!fixtureHistoryHeld(fixture, fixture.tip));
});
