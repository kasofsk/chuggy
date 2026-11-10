/**
 * A ticket's place in its project's landing queues: the holder first, a waiter
 * at its position, a ticket in no queue at none, and each queue of a project
 * counted on its own.
 */

import { expect, test } from "vitest";

import type { LandingQueuesResponse } from "../../../src/contract/responses.ts";
import {
  landingQueuePlaceFigure,
  landingQueuePlaceOf,
  landingQueuePlaceTone,
  landingQueuePlaceWords,
} from "../app/core/landingQueues.ts";

const repository = "https://github.com/acme/widgets.git";

const queues: LandingQueuesResponse = {
  queues: [
    { repository, holder: 4, waiting: [9, 2] },
    { repository, target: "refs/heads/release", holder: 7, waiting: [3] },
  ],
  truncated: false,
};

test("the holder is first of its queue's total, and holds it", () => {
  expect(landingQueuePlaceOf(queues, 4)).toStrictEqual({
    holding: true,
    position: 1,
    total: 3,
    holder: 4,
  });
});

test("a waiter is at its rank counted from one with the holder first, and names the holder", () => {
  expect(landingQueuePlaceOf(queues, 2)).toStrictEqual({
    holding: false,
    position: 3,
    total: 3,
    holder: 4,
  });
});

test("a ticket no queue names has no place, nor does any ticket where there is no read", () => {
  expect(landingQueuePlaceOf(queues, 5)).toBeUndefined();
  expect(
    landingQueuePlaceOf({ queues: [], truncated: false }, 4),
  ).toBeUndefined();
  expect(landingQueuePlaceOf(undefined, 4)).toBeUndefined();
});

test("two queues of one project are each counted on their own", () => {
  expect(landingQueuePlaceOf(queues, 7)).toStrictEqual({
    holding: true,
    position: 1,
    total: 2,
    holder: 7,
  });
  expect(landingQueuePlaceOf(queues, 3)).toStrictEqual({
    holding: false,
    position: 2,
    total: 2,
    holder: 7,
  });
  expect(landingQueuePlaceOf(queues, 9)).toMatchObject({
    position: 2,
    total: 3,
    holder: 4,
  });
});

test("the holder is toned and worded as landing next, a waiter as waiting", () => {
  const holder = landingQueuePlaceOf(queues, 4);
  const waiter = landingQueuePlaceOf(queues, 2);
  if (holder === undefined || waiter === undefined)
    throw new Error("both are queued");
  expect(landingQueuePlaceTone(holder)).toBe("finalization");
  expect(landingQueuePlaceTone(waiter)).toBe("queued");
  expect(landingQueuePlaceFigure(waiter)).toStrictEqual({
    id: "ticket-queue-place",
    args: { position: "3", total: "3" },
  });
  expect(landingQueuePlaceWords(holder).id).toBe("ticket-queue-holding");
  expect(landingQueuePlaceWords(waiter)).toStrictEqual({
    id: "ticket-queue-waiting",
    args: { position: "3", total: "3", holder: "4" },
  });
});
