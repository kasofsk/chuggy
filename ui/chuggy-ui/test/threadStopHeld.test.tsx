/**
 * What one thread holds of its stops, read off the hook that keeps them: a
 * press stands where the door ended the turn, and one that stopped nothing,
 * or whose message the door handed back, is taken back at once.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { SessionProvider } from "../app/browser/session.tsx";
import { useThreadSend } from "../app/browser/thread/threadSend.tsx";
import { holderDouble, settled } from "./screenHarness.tsx";
import { threadPartition } from "./threadFixture.ts";
import { stageAnswered, stageDoor } from "./threadStopStage.tsx";
import type { StageDoors } from "./threadStopStage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The hook under one thread, with every message and stop held for the case. */
function held(doors: StageDoors) {
  vi.stubGlobal("fetch", stageDoor(doors));
  const client = new QueryClient();
  return renderHook(
    () =>
      useThreadSend({
        partition: threadPartition,
        session: "thread-1",
        takes: true,
      }),
    {
      wrapper: (props: { readonly children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <SessionProvider holder={holderDouble()}>
            {props.children}
          </SessionProvider>
        </QueryClientProvider>
      ),
    },
  );
}

test.each([
  { said: "it stopped the turn", body: { stopped: "Stopped" }, status: 200 },
  {
    said: "its thread is closed",
    body: { error: { code: "ThreadClosed" } },
    status: 409,
  },
])(
  "a stop stands from the press and after the door's answer, where the door says $said",
  async ({ body, status }) => {
    const doors: StageDoors = { batches: [], sends: [], stops: [] };
    const { result } = held(doors);
    act(() => {
      void result.current.composer.onStop?.("turn-2");
    });
    expect([...result.current.stopping]).toStrictEqual(["turn-2"]);
    await settled();

    await stageAnswered(doors.stops[0], body, status);
    expect([...result.current.stopping]).toStrictEqual(["turn-2"]);
    expect(result.current.takenBack).toBe(0);
  },
);

test("a stop of a turn that had ended by itself is taken back at once and counted", async () => {
  const doors: StageDoors = { batches: [], sends: [], stops: [] };
  const { result } = held(doors);
  act(() => {
    void result.current.composer.onStop?.("turn-2");
  });
  await settled();

  await stageAnswered(doors.stops[0], { stopped: "AlreadyEnded" }, 200);
  expect([...result.current.stopping]).toStrictEqual([]);
  expect(result.current.takenBack).toBe(1);
});

test("a stop the door refuses is handed back at once and counted, and a turn pressed twice is held once", async () => {
  const doors: StageDoors = { batches: [], sends: [], stops: [] };
  const { result } = held(doors);
  act(() => {
    void result.current.composer.onStop?.("turn-2");
  });
  const before = result.current.stopping;
  act(() => {
    void result.current.composer.onStop?.("turn-2");
  });
  expect(result.current.stopping, "the same turn pressed twice").toBe(before);
  await settled();

  await stageAnswered(doors.stops[0], { error: { code: "Whatever" } }, 409);
  expect([...result.current.stopping]).toStrictEqual([]);
  expect(result.current.takenBack).toBe(1);
});

test("a stop of a message the door hands back is taken back with it, so the same message sent again is out and not stopped", async () => {
  const doors: StageDoors = { batches: [], sends: [], stops: [] };
  const { result } = held(doors);
  const sent = (): void => {
    act(() => {
      void result.current.composer.onSend("the same words");
    });
  };
  sent();
  await settled();
  const turn = doors.sends[0]?.turn ?? "";
  act(() => {
    void result.current.composer.onStop?.(turn);
  });
  expect([...result.current.stopping]).toStrictEqual([turn]);

  await stageAnswered(doors.sends[0], { error: { code: "Invalid" } }, 400);
  expect([...result.current.stopping]).toStrictEqual([]);
  expect(result.current.takenBack, "nothing was refused a stop").toBe(0);
  expect(doors.stops).toStrictEqual([]);

  sent();
  await settled();
  expect(doors.sends[1]?.turn, "the text keeps its turn").toBe(turn);
  expect([...result.current.stopping]).toStrictEqual([]);
});
