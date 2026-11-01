/**
 * What the console's store hands each thunk as its `extra`: the services a
 * flow of several steps reaches, and what it holds that may not enter the
 * store. Its own file, so `store.ts` and the slices that read it form no
 * cycle.
 */

import type { QueryClient } from "@tanstack/react-query";

import type { ApiPorts } from "../core/apiRequest.ts";
import type { ConversationAttachment } from "../core/conversationAttachments.ts";

/** The services a store is made over: the API's ports and the query cache
 * the tree reads. */
export interface ConsoleServices {
  readonly ports: ApiPorts;
  readonly client: QueryClient;
}

/** The thread a send on its way is taken on, or none where the door hands its
 * text back. */
export type ThreadSendFlight = Promise<string | undefined>;

/** What the thread sends hold that is bytes or a promise, each by the turn a
 * record names it under, and what each image the project took answered. */
export interface ThreadSendsCarried {
  readonly images: Map<string, readonly ConversationAttachment[]>;
  readonly flights: Map<string, ThreadSendFlight>;
  readonly uploaded: WeakMap<
    ConversationAttachment,
    { readonly project: string; readonly artifact: string }
  >;
}

export interface ConsoleExtra extends ConsoleServices {
  readonly threadSends: ThreadSendsCarried;
}

export function threadSendsCarriedMade(): ThreadSendsCarried {
  return { images: new Map(), flights: new Map(), uploaded: new WeakMap() };
}
