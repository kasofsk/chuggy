import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import { releaseOnTermination, terminationSignals } from "./termination.mjs";

/** A process this suite drives, so a signal is a call rather than a kill. */
function fakeProcess() {
  const handlers = new Map();
  const exits = [];
  const reported = [];
  return {
    handlers,
    exits,
    reported,
    services: {
      on: (signal, handler) => handlers.set(signal, handler),
      exit: (code) => exits.push(code),
      report: (message) => reported.push(message),
    },
    signal: async (name) => {
      handlers.get(name)?.();
      await setImmediate();
    },
  };
}

test("a signalled attempt releases what it made and exits nonzero", async () => {
  const released = [];
  const host = fakeProcess();
  releaseOnTermination(async () => {
    released.push("released");
  }, host.services);

  assert.deepEqual([...host.handlers.keys()], [...terminationSignals]);

  await host.signal("SIGTERM");

  assert.deepEqual(released, ["released"]);
  assert.deepEqual(host.exits, [1]);
  assert.match(host.reported[0] ?? "", /SIGTERM: releasing/u);
});

test("the release is paid once, whichever path reaches it first", async () => {
  let calls = 0;
  const host = fakeProcess();
  const once = releaseOnTermination(async () => {
    calls += 1;
  }, host.services);

  await once();
  await host.signal("SIGTERM");
  await host.signal("SIGINT");
  await once();

  assert.equal(calls, 1, "a database dropped twice fails on the way out");
});

test("a release that throws is reported and still exits", async () => {
  const host = fakeProcess();
  releaseOnTermination(async () => {
    throw new Error("the server was already gone");
  }, host.services);

  await host.signal("SIGTERM");

  assert.deepEqual(host.exits, [1]);
  assert.match(host.reported.join(" "), /the server was already gone/u);
});
