/**
 * A member's own chat, derived: who may open one, the door its turns go
 * through, and its listing parted into the member's own threads and the ones
 * projects keep.
 */

import { expect, test } from "vitest";

import {
  memberChatDoor,
  memberChatOpens,
  memberChatThreadsParted,
} from "../app/core/memberChat.ts";
import { threadSendStanding } from "../app/core/threads.ts";
import { threadEntry } from "./threadFixture.ts";

const abilities = {
  principal: "geoff",
  openUnscopedChat: true,
  executeHosted: false,
  registerPersonalRunner: false,
  administerTenant: false,
};

test("only a read that says so lets the reader open a chat of their own", () => {
  expect(memberChatOpens(abilities)).toBe(true);
  expect(memberChatOpens({ ...abilities, openUnscopedChat: false })).toBe(
    false,
  );
  expect(memberChatOpens(undefined)).toBe(false);
});

test("the listing is parted into the member's own threads and each project's, in its own order", () => {
  const own = threadEntry({ session: "own-1", mine: true });
  const held = threadEntry({ session: "held-1", mine: true });
  const later = threadEntry({ session: "own-2", mine: true });
  const parted = memberChatThreadsParted("acme", [
    { ...own, scope: "Member" },
    { ...held, scope: "Project", project: "atlas" },
    { ...later, scope: "Member" },
  ]);
  expect(parted.own).toStrictEqual([own, later]);
  expect(parted.projects).toStrictEqual([
    { partition: { tenant: "acme", project: "atlas" }, thread: held },
  ]);
});

test("a project's thread the listing names no project of is not offered", () => {
  const held = threadEntry({ session: "held-1", mine: true });
  expect(
    memberChatThreadsParted("acme", [{ ...held, scope: "Project" }]).projects,
  ).toStrictEqual([]);
});

test("the door asks for the member's chat host and no grant", () => {
  const live = {
    id: "host-1",
    registeredAt: "2026-09-02T09:00:00Z",
    live: true,
  };
  const idle = { send: "Idle" } as const;
  const standing = (door: ReturnType<typeof memberChatDoor>) =>
    threadSendStanding(idle, true, door).send;
  expect(standing(memberChatDoor({ state: "Absent", reason: "" }, 1))).toBe(
    "NoRunner",
  );
  expect(
    standing(
      memberChatDoor(
        { state: "Ready", value: { ...live, live: false }, observedAtMs: 0 },
        1,
      ),
    ),
  ).toBe("RunnerOffline");
  expect(
    standing(
      memberChatDoor({ state: "Ready", value: live, observedAtMs: 0 }, 1),
    ),
  ).toBe("Idle");
  expect(standing(memberChatDoor({ state: "Pending" }, 0))).toBe("Idle");
});
