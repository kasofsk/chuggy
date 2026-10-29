/**
 * One press of `Send`, from the post to what the composer is left holding.
 *
 * THE DOOR'S ANSWER IS THE WHOLE OF IT. The mailbox is the session the URL
 * names, and the door refuses one that is not the caller's before it enqueues
 * anything, so a refusal is a message that did not land and is reported as one.
 */

import type { threadMessageSchema } from "../../../../src/contract/requests.ts";
import type { z } from "zod";

import type { ApiPorts } from "./apiRequest.ts";
import { apiSendThreadMessageAt } from "./threadHome.ts";
import type { ThreadHome } from "./threadHome.ts";
import { threadSendFrom } from "./threads.ts";
import type { ThreadSend } from "./threads.ts";

/** One press, as the door answered it. */
export async function threadMessageSent(
  ports: ApiPorts,
  home: ThreadHome,
  session: string,
  message: z.infer<typeof threadMessageSchema>,
): Promise<ThreadSend> {
  return threadSendFrom(
    await apiSendThreadMessageAt(ports, home, session, message),
  );
}
