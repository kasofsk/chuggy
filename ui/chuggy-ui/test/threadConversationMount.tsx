/**
 * One thread's conversation as its page mounts it: under a session, a query
 * client and the project's stream, and drawn again with each thread read a
 * case hands it.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

import type { ThreadResponse } from "../../../src/contract/responses.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { ProjectStreamProvider } from "../app/browser/stream.tsx";
import { ThreadConversation } from "../app/browser/thread/ThreadConversation.tsx";
import { holderDouble } from "./screenHarness.tsx";
import type { StreamServer } from "./streamDouble.ts";
import { threadPartition } from "./threadFixture.ts";

export interface ThreadConversationMounted {
  readonly container: HTMLElement;
  readonly draw: (thread: ThreadResponse) => void;
  readonly unmount: () => void;
}

export function threadConversationMounted(
  thread: ThreadResponse,
  server: StreamServer,
): ThreadConversationMounted {
  const holder = holderDouble();
  const client = new QueryClient();
  const drawn = (shown: ThreadResponse): ReactNode => (
    <SessionProvider holder={holder}>
      <QueryClientProvider client={client}>
        <ProjectStreamProvider
          partition={threadPartition}
          transport={server.ports.fetch}
        >
          <ThreadConversation partition={threadPartition} thread={shown} />
        </ProjectStreamProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const view = render(drawn(thread));
  return {
    container: view.container,
    draw: (shown) => {
      view.rerender(drawn(shown));
    },
    unmount: () => {
      view.unmount();
    },
  };
}
