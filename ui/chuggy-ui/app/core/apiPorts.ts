/**
 * The ports the API is called through, over whatever holds the session.
 *
 * A 401 reaching them is the API disagreeing with a session its holder still
 * believes in. So the token is renewed once against the issuer, and the
 * session is forgotten and said to be where the issuer will not renew it or
 * where the API refuses the fresh one too — a token minted happily and
 * rejected anyway, which is what an audience or a key set changing under a
 * stored session looks like.
 */

import type { ApiFetchPort, ApiPorts } from "./apiRequest.ts";
import type { SessionHolder } from "./sessionHolder.ts";

/** The session is forgotten before it is said to be, because forgetting it
 * clears what was said. */
export function apiPortsOver(
  holder: Pick<SessionHolder, "bearer" | "refresh" | "signOut" | "refuse">,
  fetch: ApiFetchPort,
  sleepMs: ApiPorts["sleepMs"],
): ApiPorts {
  const abandon = async (): Promise<void> => {
    await holder.signOut();
    holder.refuse("the API refused this session, so it was signed out");
  };
  return {
    fetch,
    bearer: () => holder.bearer(),
    sleepMs,
    renew: async () => {
      if (await holder.refresh()) return true;
      await abandon();
      return false;
    },
    refused: abandon,
  };
}
