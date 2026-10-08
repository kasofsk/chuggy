/**
 * What the suites of a ticket's own sub-reads share: the app serving only the
 * read a suite composes, behind a bearer that names one caller, and the case
 * holding that a ticket named by something other than its number is refused
 * there exactly as the ticket's own read refuses it.
 */

import assert from "node:assert/strict";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { asInstallationId } from "../../src/domain/ids.ts";
import type { Principal } from "../../src/interpreter/principal.ts";
import type { TicketActionReaches } from "../../src/interpreter/ticketActionReach.ts";
import type { TicketLandingReads } from "../../src/interpreter/ticketLandings.ts";
import { unservedNativeWeb } from "./threadFixtures.ts";

/** The ticket reads one app serves, each absent where its suite composes none. */
export interface TicketReadServices {
  readonly actionReach?: TicketActionReaches;
  readonly landings?: TicketLandingReads;
}

/** The app serving `services`, where `Bearer valid` authenticates `caller` and any other bearer nobody. */
export function ticketReadApp(caller: Principal, services: TicketReadServices) {
  return createNativeHttpApp(
    unservedNativeWeb,
    {
      authenticateBearer: (token) =>
        Promise.resolve(
          token === "valid"
            ? {
                authenticated: "Bearer" as const,
                bearer: { principal: caller },
              }
            : { authenticated: "InvalidToken" as const },
        ),
    },
    { ready: () => Promise.resolve(true) },
    {
      installationAuthority: () =>
        Promise.resolve(
          asInstallationId("018f84a1-4c2b-7def-8abc-0123456789ab"),
        ),
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    services.actionReach,
    services.landings,
  );
}

/**
 * Holds that the sub-read at `suffix` refuses a ticket named by something other
 * than its number as the ticket's own read does, reading nothing beneath. Each
 * naming gets an app of its own from `opened`, which records what it read.
 */
export async function ticketReadRefusesWhatTheTicketDoes(
  opened: (read: string[]) => ReturnType<typeof ticketReadApp>,
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
