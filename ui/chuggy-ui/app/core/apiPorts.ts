/**
 * The ports the API is called through, over whatever holds the session.
 *
 * A request under a session goes out with its bearer or not at all. A session
 * that could not be renewed has none to send, and the same request sent
 * without one is refused as a stranger's, which says nothing true of the
 * session and is then read as the API refusing it.
 *
 * A 401 reaching them is the API disagreeing with a session its holder still
 * believes in. So the token is renewed once against the issuer, and the
 * session is forgotten and said to be where no fresh one could be had or
 * where the API refuses the fresh one too — a token minted happily and
 * rejected anyway, which is what an audience or a key set changing under a
 * stored session looks like. A session its holder ended while renewing it
 * carries the holder's own reason, and nothing is said over that.
 */

import type { ApiFetchPort, ApiPorts } from "./apiRequest.ts";
import type { SessionHolder } from "./sessionHolder.ts";

/** Why a request under a session was not sent. */
export const apiBearerUnrenewedReason = "the session could not be renewed";

/** The bearer a request goes out with: none where no session is held, and a
 * rejection, so no request, where one is held and has no token to send. */
export function apiBearerOver(
  holder: Pick<SessionHolder, "bearer" | "snapshot">,
): () => Promise<string | undefined> {
  return async () => {
    const signedIn = holder.snapshot().phase === "SignedIn";
    const bearer = await holder.bearer();
    if (bearer === undefined && signedIn)
      throw new Error(apiBearerUnrenewedReason);
    return bearer;
  };
}

/** The session is forgotten before it is said to be, because forgetting it
 * clears what was said. */
export function apiPortsOver(
  holder: Pick<
    SessionHolder,
    "bearer" | "refresh" | "signOut" | "refuse" | "snapshot"
  >,
  fetch: ApiFetchPort,
  sleepMs: ApiPorts["sleepMs"],
): ApiPorts {
  const abandon = async (): Promise<void> => {
    await holder.signOut();
    holder.refuse("the API refused this session, so it was signed out");
  };
  return {
    fetch,
    bearer: apiBearerOver(holder),
    sleepMs,
    renew: async () => {
      if (await holder.refresh()) return true;
      if (holder.snapshot().phase === "SignedIn") await abandon();
      return false;
    },
    refused: abandon,
  };
}
