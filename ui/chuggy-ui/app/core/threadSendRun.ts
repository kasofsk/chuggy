/**
 * One press of `Send`, from the post to what the composer is left holding.
 *
 * A `NotYourThread` IS SETTLED AGAINST THE MAILBOX AND NOT REPORTED. The door
 * resolves the mailbox from the caller's own principal and compares the URL's
 * session afterwards, so in the close-and-reopen race the refusal arrives after
 * the turn was enqueued in the mailbox that resolved. Dropping the turn there
 * would either lose a message the thread already holds or, on a retry with a
 * fresh identity, put a second copy of it in — so the identity is kept and the
 * mailbox is asked which happened.
 *
 * WHICH MAILBOX IS THE LISTING'S ANSWER AND NOT THE URL'S. The refusal is
 * exactly the URL naming a session that is not the caller's own, so the session
 * to ask about is the one the listing marks `mine`; asking the URL's again would
 * read the thread the message did not go to.
 *
 * THE SECOND SEND IS THE LAST. It carries the identity the first one minted, so
 * the door answers the ordinal it already took if the two race; and a refusal on
 * it is reported rather than settled again, because a settlement that could
 * settle forever is a loop with a network in it.
 *
 * WHAT IS REPORTED IS WHAT WAS OBSERVED. A second dispute is reached only after
 * a listing named a mailbox of the caller's own and that mailbox was read, so
 * saying no such mailbox could be found would assert the fact the settlement had
 * just disproved. The door's own second answer is what a reader is given
 * instead, in the word the roster gives it.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { threadMessageSchema } from "../../../../src/contract/requests.ts";
import type { z } from "zod";

import { apiSendThreadMessage, apiThread, apiThreads } from "./apiRoutes.ts";
import type { ApiPorts } from "./apiRequest.ts";
import { panelReason } from "./freshness.ts";
import { threadHeldTurn, threadMine, threadSendFrom } from "./threads.ts";
import type { ThreadSend } from "./threads.ts";

/** The one thing a settlement can look for and fail to find: a mailbox of the
 * caller's own on a listing it read. */
const threadMailboxUnfound =
  "this member has no open thread the message could have reached";

/**
 * The mailbox the caller's own principal resolves to, as the listing marks it.
 */
async function threadMineSession(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<{ readonly session: string } | ThreadSend> {
  const listed = await apiThreads(ports, partition);
  if (listed.outcome !== "Ok")
    return { send: "Refused", reason: panelReason(listed) };
  const mine = threadMine(listed.value.threads);
  return mine === undefined
    ? { send: "Refused", reason: threadMailboxUnfound }
    : { session: mine.session };
}

/**
 * A `NotYourThread` settled: the resolved mailbox holding the turn is a message
 * that landed, and one that does not is a message to send there under the
 * identity the first press minted.
 */
async function threadSendSettled(
  ports: ApiPorts,
  partition: PartitionIdentity,
  message: z.infer<typeof threadMessageSchema>,
): Promise<ThreadSend> {
  const found = await threadMineSession(ports, partition);
  if (!("session" in found)) return found;
  const standing = await apiThread(ports, partition, found.session);
  if (standing.outcome !== "Ok")
    return { send: "Refused", reason: panelReason(standing) };
  const held = threadHeldTurn(standing.value, message.turn);
  if (held !== undefined) return { send: "Sent", ordinal: held.ordinal };
  const again = threadSendFrom(
    await apiSendThreadMessage(ports, partition, found.session, message),
  );
  return again.send === "Unsettled"
    ? { send: "Refused", reason: again.why }
    : again;
}

/** One press, settled where the door's answer does not say what happened. */
export async function threadMessageSent(
  ports: ApiPorts,
  partition: PartitionIdentity,
  session: string,
  message: z.infer<typeof threadMessageSchema>,
): Promise<ThreadSend> {
  const answered = threadSendFrom(
    await apiSendThreadMessage(ports, partition, session, message),
  );
  return answered.send === "Unsettled"
    ? threadSendSettled(ports, partition, message)
    : answered;
}
