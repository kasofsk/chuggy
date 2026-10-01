/**
 * The session placement as every screen reads it. No frame says a runner
 * polled, so the read is polled, and a runner that comes back is drawn live
 * with no reload and nothing pressed.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { SessionProvider } from "../app/browser/session.tsx";
import {
  sessionPlacementResource,
  useSessionPlacementReads,
  useSessionRunnerShort,
} from "../app/browser/sessionPlacement.tsx";
import { projectResourceKey } from "../app/core/projectQueryKeys.ts";
import { sessionPlacementPolledMs } from "../app/core/sessionRunners.ts";
import { answer, holderDouble, settled } from "./screenHarness.tsx";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { threadPartition } from "./threadFixture.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function wrapper(props: { readonly children: ReactNode }): ReactNode {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider holder={holderDouble()}>
        {props.children}
      </SessionProvider>
    </QueryClientProvider>
  );
}

test("a runner that comes back is read as live within one poll", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let mine: "Offline" | "Live" = "Offline";
  vi.stubGlobal("fetch", () =>
    Promise.resolve(answer(sessionPlacementBody({ thread: "Pool", mine }))),
  );
  const { result } = renderHook(
    () => useSessionRunnerShort(threadPartition, "thread", "mine"),
    { wrapper },
  );
  await settled();
  expect(result.current).toBe("RunnerOffline");
  mine = "Live";
  await act(() => vi.advanceTimersByTimeAsync(sessionPlacementPolledMs));
  await settled();
  expect(result.current).toBeUndefined();
});

/** Reads are counted rather than timed, so two that land in one millisecond
 * are two, and one that fails is none. */
test("the placement's reads count every answer and no failure", async () => {
  const client = new QueryClient();
  const key = projectResourceKey(
    threadPartition,
    "Project",
    sessionPlacementResource,
  );
  const { result } = renderHook(
    () => useSessionPlacementReads(threadPartition),
    {
      wrapper: (props: { readonly children: ReactNode }) => (
        <QueryClientProvider client={client}>
          {props.children}
        </QueryClientProvider>
      ),
    },
  );
  expect(result.current).toBe(0);
  act(() => {
    client.setQueryData(key, sessionPlacementBody({ thread: "Pool" }));
    client.setQueryData(key, sessionPlacementBody({ thread: "Pool" }));
  });
  expect(result.current).toBe(2);
  await act(() =>
    client
      .fetchQuery({
        queryKey: key,
        queryFn: () => Promise.reject(new Error("unavailable")),
        retry: false,
      })
      .catch(() => undefined),
  );
  expect(result.current).toBe(2);
});
