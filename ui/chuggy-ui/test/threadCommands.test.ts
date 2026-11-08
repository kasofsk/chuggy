/**
 * What `/status` and `/usage` say of the reader's thread: the standing, route
 * and model the status line reads, and the sums the usage line pages the
 * mailbox for, back to its first turn or to the bound. And what `/clear` does:
 * the close first, the open only after a close that answered `Ok`.
 */

import { describe, expect, test } from "vitest";

import type { ThreadResponse } from "../../../src/contract/responses.ts";
import { threadTurnsAnsweredMax } from "../../../src/contract/http.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import { copyOrDataText } from "../app/core/copy.ts";
import type { PanelState } from "../app/core/freshness.ts";
import type { SessionPlacementResponse } from "../../../src/contract/responses.ts";
import {
  threadClearedThenOpened,
  threadClearedWord,
  threadClearWithheld,
  threadModel,
  threadStatusFacts,
  threadUsageFigures,
  threadUsagePaged,
  threadUsagePagesMax,
  threadUsageSummed,
  threadUsageTurnsText,
} from "../app/core/threadCommands.ts";
import type {
  ThreadStatusFact,
  ThreadUsagePageRead,
} from "../app/core/threadCommands.ts";
import { sessionPlacementBody } from "./sessionPlacementFixture.ts";
import { threadBody, threadTurn } from "./threadFixture.ts";

/** What the command line says of a `/clear`, in the base language. */
function clearedSaid(
  cleared: Parameters<typeof threadClearedWord>[0],
): string | undefined {
  const words = threadClearedWord(cleared);
  return words === undefined
    ? undefined
    : copyOrDataText(copyTextEn, words.word);
}

function placed(
  value: SessionPlacementResponse,
): PanelState<SessionPlacementResponse> {
  return { state: "Ready", value, observedAtMs: undefined };
}

function said(facts: readonly ThreadStatusFact[]): Record<string, string> {
  return Object.fromEntries(
    facts.map((fact) => [
      copyTextEn(fact.term),
      copyOrDataText(copyTextEn, fact.said),
    ]),
  );
}

describe("the status line", () => {
  test("a thread on runners says its standing, its route, what set it, the runner and the model", () => {
    const thread = threadBody({
      state: "Open",
      turns: [threadTurn({ turn: "t1", model: "claude-opus-4" })],
    });
    expect(
      said(
        threadStatusFacts(
          thread,
          placed(sessionPlacementBody({ mine: "Offline" })),
        ),
      ),
    ).toStrictEqual({
      Chat: "Open",
      "Runs on": "Runners",
      "Set by": "Default",
      Runner: "Offline",
      Model: "claude-opus-4",
    });
  });

  test("a hosted thread names no runner, because none is waited on", () => {
    const facts = said(
      threadStatusFacts(
        threadBody({}),
        placed(sessionPlacementBody({ thread: "InCluster" })),
      ),
    );
    expect(facts["Runs on"]).toBe("Hosted");
    expect(facts["Runner"]).toBeUndefined();
  });

  test("a placement not read yet or refused says so where the route would be", () => {
    expect(
      said(threadStatusFacts(threadBody({}), { state: "Pending" }))["Runs on"],
    ).toBe("Loading…");
    expect(
      said(
        threadStatusFacts(threadBody({}), {
          state: "Failed",
          failure: { outcome: "Unreachable", reason: "connection refused" },
        }),
      ),
    ).toMatchObject({ "Runs on": "Not read · No connection" });
  });

  test("a box with no thread behind it yet says so, and names no model", () => {
    expect(
      said(threadStatusFacts(undefined, { state: "Pending" })),
    ).toMatchObject({
      Chat: "Not opened",
      Model: "None reported yet",
    });
  });

  test("the model is the newest turn's that names one", () => {
    expect(
      threadModel([
        threadTurn({ turn: "t1", model: "claude-sonnet-4" }),
        threadTurn({ turn: "t2", model: "claude-opus-4" }),
        threadTurn({ turn: "t3", state: "Claimed", model: undefined }),
      ]),
    ).toBe("claude-opus-4");
    expect(
      threadModel([threadTurn({ turn: "t1", model: undefined })]),
    ).toBeUndefined();
  });
});

describe("the usage sums", () => {
  test("each measure is summed over the turns that carried it", () => {
    const usage = threadUsageSummed(
      [
        threadTurn({
          turn: "t1",
          tokens: 100,
          costMicros: 2_000,
          durationMs: 1_000,
        }),
        threadTurn({
          turn: "t2",
          tokens: 50,
          costMicros: undefined,
          durationMs: 500,
        }),
      ],
      true,
    );
    expect(usage).toStrictEqual({
      turns: 2,
      tokens: 150,
      costMicros: 2_000,
      durationMs: 1_500,
      whole: true,
    });
  });

  test("a measure no turn carried is absent rather than zero, and is not drawn", () => {
    const usage = threadUsageSummed(
      [
        threadTurn({
          turn: "t1",
          tokens: undefined,
          costMicros: undefined,
          durationMs: 7,
        }),
      ],
      true,
    );
    expect(usage.tokens).toBeUndefined();
    expect(
      threadUsageFigures(usage).map((figure) => figure.kind),
    ).toStrictEqual(["Duration"]);
  });

  test("the count says only the newest turns where the bound came first", () => {
    expect(copyTextEn(threadUsageTurnsText(threadUsageSummed([], true)))).toBe(
      "0 turns",
    );
    expect(
      copyTextEn(
        threadUsageTurnsText(
          threadUsageSummed([threadTurn({ turn: "t1" })], true),
        ),
      ),
    ).toBe("1 turn");
    expect(
      copyTextEn(
        threadUsageTurnsText(
          threadUsageSummed([threadTurn({ turn: "t1" })], false),
        ),
      ),
    ).toBe("Newest 1 turn");
  });
});

/** A mailbox of `pages` pages, newest first, each one turn, each naming the
 * next older by its cursor and the oldest naming none. */
function pagesServed(pages: number): {
  readonly read: ThreadUsagePageRead;
  readonly asked: { readonly before?: number; readonly limit: number }[];
} {
  const asked: { readonly before?: number; readonly limit: number }[] = [];
  return {
    asked,
    read: (page) => {
      asked.push(page);
      const at = page.before ?? pages;
      const body: ThreadResponse = threadBody({
        turns: [threadTurn({ turn: `t${String(at)}`, tokens: 10 })],
        ...(at > 1 ? { nextBefore: at - 1 } : {}),
      });
      return Promise.resolve<ApiResult<ThreadResponse>>({
        outcome: "Ok",
        value: body,
      });
    },
  };
}

describe("paging the mailbox", () => {
  test("every page is read back to the first turn, the newest asked with no cursor", async () => {
    const served = pagesServed(3);
    const usage = await threadUsagePaged(served.read);
    expect(served.asked).toStrictEqual([
      { limit: threadTurnsAnsweredMax },
      { before: 2, limit: threadTurnsAnsweredMax },
      { before: 1, limit: threadTurnsAnsweredMax },
    ]);
    expect(usage).toStrictEqual({
      outcome: "Ok",
      value: {
        turns: 3,
        tokens: 30,
        costMicros: 630_000,
        durationMs: 183_000,
        whole: true,
      },
    });
  });

  test("a mailbox past the bound is summed over the pages read, and says it is not whole", async () => {
    const served = pagesServed(threadUsagePagesMax + 1);
    const usage = await threadUsagePaged(served.read);
    expect(served.asked).toHaveLength(threadUsagePagesMax);
    expect(usage.outcome === "Ok" && usage.value.whole).toBe(false);
  });

  test("a page the server refuses is the answer, and nothing further is asked", async () => {
    let asked = 0;
    const refused = await threadUsagePaged(() => {
      asked += 1;
      return Promise.resolve<ApiResult<ThreadResponse>>({
        outcome: "Unreachable",
        reason: "the network is down",
      });
    });
    expect(refused.outcome).toBe("Unreachable");
    expect(asked).toBe(1);
  });
});

describe("/clear", () => {
  test("closes the thread, and opens another only once the close has answered", async () => {
    const asked: string[] = [];
    let closed: (answered: ApiResult<unknown>) => void = () => undefined;
    const cleared = threadClearedThenOpened(
      () => {
        asked.push("close");
        return new Promise((resolve) => {
          closed = resolve;
        });
      },
      () => {
        asked.push("open");
        return Promise.resolve("opened");
      },
    );
    await Promise.resolve();
    expect(asked, "an open asked before the close answered").toStrictEqual([
      "close",
    ]);
    closed({ outcome: "Ok", value: undefined });
    expect(await cleared).toStrictEqual({
      cleared: "Closed",
      opened: "opened",
    });
    expect(asked).toStrictEqual(["close", "open"]);
  });

  test("a close refused opens nothing, and says why", async () => {
    const asked: string[] = [];
    const absent = { outcome: "Absent" } as const;
    const cleared = await threadClearedThenOpened(
      () => {
        asked.push("close");
        return Promise.resolve(absent as ApiResult<unknown>);
      },
      () => {
        asked.push("open");
        return Promise.resolve("opened");
      },
    );
    expect(asked).toStrictEqual(["close"]);
    expect(cleared).toStrictEqual({ cleared: "Refused", failure: absent });
    expect(
      threadClearedWord({ cleared: "Refused", failure: absent }),
    ).toStrictEqual({ word: { id: "failure-not-found" } });
  });

  test("a thread with a turn unsettled, or a message no read lists yet, is not cleared", () => {
    const idle = threadBody({
      turns: [threadTurn({ turn: "thread-turn-1", state: "Answered" })],
    });
    expect(threadClearWithheld(idle, 0)).toBeUndefined();
    expect(threadClearWithheld(idle, 1)).toBe("Answering");
    expect(
      threadClearWithheld(
        threadBody({
          turns: [threadTurn({ turn: "thread-turn-1", state: "Claimed" })],
        }),
        0,
      ),
    ).toBe("Answering");
    expect(clearedSaid("Answering")).toBe("Chat is answering");
    expect(threadClearedWord({ cleared: "Closed" })).toBeUndefined();
    expect(clearedSaid({ cleared: "Busy" })).toBe("A chat is already starting");
    expect(clearedSaid("Unopened")).toBe("No chat to clear");
  });
});
