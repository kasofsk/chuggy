/**
 * What every mounted screen in this console needs around it: the three
 * providers, a signed-in session, an API made of scripted responses, and a
 * flush that lets the reads behind a render finish.
 *
 * Written once because a case that built its own would be a second account of
 * what a screen is wrapped in, and the two would drift the first time a
 * provider was added. What stays with each case is what differs between them:
 * the `vi.mock` factories, which are hoisted into the file that declares them,
 * and the bodies each route answers with.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type { SessionHolder } from "../app/core/sessionHolder.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { ProjectStreamProvider } from "../app/browser/stream.tsx";
import { frame, streamServer } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";

/** A render settles over several turns — a query resolves, a follow polls, an
 * invalidation reads again — so the tree is flushed a bounded number of times
 * rather than once. */
export const settleFlushesMax = 8;

export function holderDouble(): SessionHolder {
  return {
    load: () => Promise.resolve(),
    completeCallback: () => Promise.resolve({ result: "None" as const }),
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    bearer: () => Promise.resolve("token"),
    refresh: () => Promise.resolve(true),
    refuse: () => undefined,
    refreshDueAtMs: () => undefined,
    generation: () => 1,
    snapshot: () => ({
      phase: "SignedIn" as const,
      reason: undefined,
      configuration: undefined,
    }),
    subscribe: () => () => undefined,
  };
}

export function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/vnd.chuggy.v1+json" },
  });
}

/** One operation, in whatever state the case wants the actor to leave it in. */
export function operationAt(state: string): unknown {
  return {
    operation: "op-one",
    acceptedAt: "2026-08-26T10:00:00Z",
    state,
  };
}

export interface ApiDouble {
  readonly fetch: typeof fetch;
  readonly submissions: () => number;
  readonly submitted: () => unknown;
}

interface ApiDoubleInit {
  readonly method?: string;
  readonly body?: string;
}

/**
 * The API as a case scripts it: every submission accepted and remembered, the
 * operation route answering one standing, and every other route the case's own.
 */
export function apiDouble(served: {
  readonly operation: unknown;
  readonly route: (url: string) => Response;
}): ApiDouble {
  let submissions = 0;
  let submitted: unknown;
  const respond = (url: string, init?: ApiDoubleInit): Response => {
    if (init?.method === "POST") {
      submissions += 1;
      submitted = JSON.parse(init.body ?? "null");
      return answer({ operation: "op-one", state: "Pending" }, 202);
    }
    if (url.includes("/operations/")) return answer(served.operation);
    return served.route(url);
  };
  return {
    submissions: () => submissions,
    submitted: () => submitted,
    fetch: ((url: string, init?: ApiDoubleInit) =>
      Promise.resolve(respond(url, init))) as unknown as typeof fetch,
  };
}

/**
 * A stream that opens, says it is ready and live, and holds so a case can push.
 * The source frame is not decoration: a real open sends one before anything
 * else, and a double that left it out would leave every screen under it reading
 * on the fallback rather than on the frames the case pushes.
 */
export function openedStream(): StreamServer {
  return streamServer([
    {
      status: 200,
      chunks: [
        frame("ready", undefined, { version: 1 }),
        frame("source", undefined, { version: 1, state: "live" }),
      ],
      hold: true,
    },
  ]);
}

export type StreamTransport = NonNullable<
  Parameters<typeof ProjectStreamProvider>[0]["transport"]
>;

export function ScreenHarness(props: {
  readonly partition: PartitionIdentity;
  readonly client: QueryClient;
  readonly transport: StreamTransport;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={props.client}>
        <ProjectStreamProvider
          partition={props.partition}
          transport={props.transport}
        >
          {props.children}
        </ProjectStreamProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

/** One turn of the tree, which is also what wraps a click a case makes. */
export async function turned(
  doing: () => void = () => undefined,
): Promise<void> {
  await act(async () => {
    doing();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function settled(): Promise<void> {
  for (let flush = 0; flush < settleFlushesMax; flush += 1) await turned();
}
