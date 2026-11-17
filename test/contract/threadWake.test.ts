import assert from "node:assert/strict";
import test from "node:test";

import {
  threadTicketWakeSettings,
  threadTicketWakesEffective,
} from "../../src/contract/threadWake.ts";

test("a thread's ticket wakes follow its own choice, else its host's setting, else Off", () => {
  assert.equal(threadTicketWakesEffective({}), "Off");
  for (const host of threadTicketWakeSettings) {
    assert.equal(threadTicketWakesEffective({ host }), host);
    for (const thread of threadTicketWakeSettings)
      assert.equal(threadTicketWakesEffective({ thread, host }), thread);
  }
  for (const thread of threadTicketWakeSettings)
    assert.equal(threadTicketWakesEffective({ thread }), thread);
});
