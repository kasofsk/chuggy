/**
 * Why a chat's own page draws no composer: a thread that takes no more
 * messages says its standing, whoever's it is, another member's open thread
 * says it is not the reader's, and the reader's own open thread says nothing.
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import {
  threadPageUnavailable,
  threadPageUnavailableLine,
} from "../app/core/threadPage.ts";

test("the reader's own open thread has no reason to draw no composer", () => {
  expect(threadPageUnavailable({ state: "Open", mine: true })).toBeUndefined();
});

test("another member's open thread is not the reader's", () => {
  const unavailable = threadPageUnavailable({ state: "Open", mine: false });
  expect(unavailable).toStrictEqual({ unavailable: "NotMine" });
  expect(
    copyTextEn(threadPageUnavailableLine({ unavailable: "NotMine" })),
  ).toBe("Not your chat · View only");
});

test("a thread that takes no more messages says its standing, whoever's it is", () => {
  for (const state of ["Closed", "Orphaned"] as const)
    for (const mine of [true, false]) {
      const unavailable = threadPageUnavailable({ state, mine });
      expect(unavailable).toStrictEqual({
        unavailable: "Standing",
        standing: state,
      });
      if (unavailable !== undefined)
        expect(copyTextEn(threadPageUnavailableLine(unavailable))).toBe(
          `${state} · Takes no more messages`,
        );
    }
});
