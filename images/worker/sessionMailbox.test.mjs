import assert from "node:assert/strict";
import test from "node:test";

import { sessionMailbox, sessionUserMessage } from "./sessionMailbox.mjs";

const task = {
  workerPlane: { url: "http://worker-plane.test:3001" },
  bounds: { mailboxPollMs: 10, idleMs: 100 },
};

function mailboxOf(answers) {
  const calls = [];
  let clock = 0;
  const services = {
    request: async (_task, _bearer, path) => {
      calls.push(path);
      const given = answers[Math.min(calls.length, answers.length) - 1];
      return { status: given.status, json: async () => given.body };
    },
    wait: async (milliseconds) => {
      clock += milliseconds;
    },
    now: () => clock,
  };
  return { calls, mailbox: sessionMailbox(task, "chgs_b", services) };
}

const claimed = (turn) => ({
  status: 200,
  body: { turn, ordinal: 1, inputKind: "UserMessage", input: `ask ${turn}` },
});

test("a claimed turn is yielded in the shape the runtime's streaming input takes", async () => {
  const { mailbox } = mailboxOf([claimed("turn-1"), { status: 204 }]);

  const turns = mailbox.turns();
  const first = await turns.next();

  assert.deepEqual(first.value, {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content: "ask turn-1" },
  });
  assert.equal(mailbox.claimed().turn, "turn-1");
});

test("a second turn is not claimed until the first one settled", async () => {
  const { calls, mailbox } = mailboxOf([claimed("turn-1"), claimed("turn-2")]);

  const turns = mailbox.turns();
  await turns.next();
  const second = turns.next();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(
    calls.length,
    1,
    "the mailbox was polled while a turn was in flight",
  );
  mailbox.settled();
  assert.equal((await second).value.message.content, "ask turn-2");
  assert.equal(calls.length, 2);
});

test("an empty mailbox is polled until the idle bound and then ends the iterable", async () => {
  const { calls, mailbox } = mailboxOf([{ status: 204 }]);

  const taken = [];
  for await (const message of mailbox.turns()) taken.push(message);

  assert.deepEqual(taken, []);
  assert.equal(
    calls.length,
    task.bounds.idleMs / task.bounds.mailboxPollMs + 1,
  );
});

test("a fenced claim ends the iterable rather than asking again", async () => {
  for (const status of [401, 409]) {
    const { calls, mailbox } = mailboxOf([{ status }]);

    const taken = [];
    for await (const message of mailbox.turns()) taken.push(message);

    assert.deepEqual(taken, []);
    assert.equal(calls.length, 1, `status ${String(status)} was asked again`);
  }
});

test("a stopped mailbox ends the iterable even with a turn in flight", async () => {
  const { calls, mailbox } = mailboxOf([claimed("turn-1"), claimed("turn-2")]);

  const turns = mailbox.turns();
  await turns.next();
  mailbox.stop();

  assert.equal((await turns.next()).done, true);
  assert.equal(calls.length, 1);
});

test("an answer the mailbox cannot account for is a refusal rather than a turn", async () => {
  const { mailbox } = mailboxOf([{ status: 500 }]);

  await assert.rejects(mailbox.turns().next(), /answered 500/u);
});

test("the user message carries the turn's input and nothing of the plane's envelope", () => {
  assert.deepEqual(sessionUserMessage("remember kestrel"), {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content: "remember kestrel" },
  });
});
