/**
 * The chat pane's start, read off the hook that holds it: presses that reach
 * it in the same render as one already on its way ask the door for nothing.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { useChatPaneStart } from "../app/browser/shell/chatPaneStart.ts";
import type { ThreadCleared } from "../app/core/threadCommands.ts";
import { settled } from "./screenHarness.tsx";
import { threadPartition } from "./threadFixture.ts";
import { threadSendWrapped } from "./threadSendWrapped.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The hook over a door that records every post and answers none. */
function started(posts: string[]) {
  vi.stubGlobal("fetch", (url: string, init?: { readonly method?: string }) => {
    if (init?.method === "POST") posts.push(url.split("/").at(-1) ?? url);
    return new Promise<never>(() => undefined);
  });
  return renderHook(
    () =>
      useChatPaneStart({
        partition: threadPartition,
        drawn: true,
        onOpened: () => undefined,
        onRefused: () => undefined,
      }),
    { wrapper: threadSendWrapped() },
  );
}

test("a /clear and a New pressed in the same render as a /clear close and open nothing more", async () => {
  const posts: string[] = [];
  const { result } = started(posts);
  const answers: Promise<ThreadCleared>[] = [];
  act(() => {
    const starting = result.current;
    answers.push(starting.cleared("thread-1"));
    answers.push(starting.cleared("thread-1"));
    starting.started();
  });
  await settled();
  expect(posts).toStrictEqual(["close"]);
  expect(result.current.busy).toBe(true);
  expect(await answers[1]).toStrictEqual({ cleared: "Busy" });
});

test("a /clear pressed in the same render as a New closes nothing", async () => {
  const posts: string[] = [];
  const { result } = started(posts);
  let answered: Promise<ThreadCleared> | undefined;
  act(() => {
    const starting = result.current;
    starting.started();
    answered = starting.cleared("thread-1");
  });
  await settled();
  expect(posts).toStrictEqual(["threads"]);
  expect(await answered).toStrictEqual({ cleared: "Busy" });
});
