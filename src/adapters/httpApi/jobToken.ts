/**
 * The per-job credential: a keyed tag over the one ticket-and-task pair a job
 * may answer for, minted with a secret the deployment holds and verified by
 * recomputing it.
 *
 * IT CARRIES NO CLAIMS AND NEEDS NO STORE. The route already knows which task a
 * request names, because the path says so — so the token is the tag over that
 * pair and nothing more: nothing to decode, no expiry to trust and no row to
 * look up, and a tag minted for one task recomputes differently under every
 * other. What a stateless credential cannot do is be withdrawn before the secret
 * rotates, and that is the trade taken here.
 *
 * THE COMPARISON IS `timingSafeEqual`'s. A tag compared byte by byte leaks its
 * matching prefix through the time the comparison takes, and no suite can
 * observe that — so the property is bought by construction rather than asserted,
 * and the length test before the call is what keeps a tag that is not one from
 * throwing instead of refusing.
 *
 * BASE64URL, because it is the alphabet the other credential crossing this
 * boundary already travels in and the platform encodes it: a tag rides an
 * `Authorization` header and could ride a path, and neither needs escaping.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { TaskId, TicketId } from "../../domain/ids.ts";
import type { JobTokenMint } from "../../interpreter/jobToken.ts";

/** The one string a tag is taken over, so the mint and the verify cannot form it differently. */
function httpApiJobSubject(ticket: TicketId, taskId: TaskId): string {
  return `${String(ticket)}:${String(taskId)}`;
}

/** The mint this deployment hands the fabric, keyed by the secret it was given. */
export function httpApiJobTokenMint(secret: string): JobTokenMint {
  return (ticket, taskId) =>
    createHmac("sha256", secret)
      .update(httpApiJobSubject(ticket, taskId))
      .digest("base64url");
}

/** Whether an offered token is the tag this deployment would mint for that ticket's task. */
export function httpApiJobTokenHolds(
  secret: string,
  ticket: TicketId,
  taskId: TaskId,
  offered: string | undefined,
): boolean {
  const expected = Buffer.from(httpApiJobTokenMint(secret)(ticket, taskId));
  const given = Buffer.from(offered ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
