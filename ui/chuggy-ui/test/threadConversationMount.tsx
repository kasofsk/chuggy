/**
 * One thread's conversation as its page mounts it: under a session, a query
 * client and the project's stream, and drawn again with each thread read a
 * case hands it.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

import type {
  ThreadResponse,
  ThreadTranscriptResponse,
} from "../../../src/contract/responses.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { ProjectStreamProvider } from "../app/browser/stream.tsx";
import { ThreadConversation } from "../app/browser/thread/ThreadConversation.tsx";
import { answer, holderDouble } from "./screenHarness.tsx";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import type { StreamServer } from "./streamDouble.ts";
import { threadPartition, threadStream } from "./threadFixture.ts";

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

/** The reads a thread's page makes as it mounts, answered at once: the hosted
 * grant, the placement, and the store holding `entries`. Anything else is the
 * case's to answer. */
export function threadReadsAnswered(
  url: string,
  entries: readonly ThreadTranscriptResponse["entries"][number][],
): Response | undefined {
  if (url.endsWith("/hosted-runs")) return answer({ granted: true });
  if (url.endsWith("/session-placement"))
    return answer(sessionPlacementBody({ thread: "InCluster" }));
  if (url.includes("/transcript"))
    return answer({
      stream: threadStream,
      entries,
      held: entries.flatMap((held) =>
        held.uuid === undefined ? [] : [held.uuid],
      ),
      cut: 1,
      elided: 0,
      truncated: false,
    });
  return undefined;
}
