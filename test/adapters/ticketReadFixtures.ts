/**
 * What the suites of a ticket's own sub-reads share: the case holding that a
 * ticket named by something other than its number is refused there exactly as
 * the ticket's own read refuses it.
 */

import assert from "node:assert/strict";

import type { callerApp } from "./callerAppFixture.ts";

/**
 * Holds that the sub-read at `suffix` refuses a ticket named by something other
 * than its number as the ticket's own read does, reading nothing beneath. Each
 * naming gets an app of its own from `opened`, which records what it read.
 */
export async function ticketReadRefusesWhatTheTicketDoes(
  opened: (read: string[]) => ReturnType<typeof callerApp>,
  suffix: string,
): Promise<void> {
  const authorized = { authorization: "Bearer valid" };
  for (const named of ["seven", "0", "-1", "7.5"]) {
    const read: string[] = [];
    await using app = opened(read);
    const ticketUrl = `/api/v1/tenants/acme/projects/atlas/tickets/${named}`;
    const own = await app.inject({ url: ticketUrl, headers: authorized });
    const found = await app.inject({
      url: `${ticketUrl}/${suffix}`,
      headers: authorized,
    });
    assert.ok(found.statusCode >= 400 && found.statusCode < 500, named);
    assert.equal(found.statusCode, own.statusCode, named);
    assert.deepEqual(found.json(), own.json(), named);
    assert.deepEqual(read, [], named);
  }
}
