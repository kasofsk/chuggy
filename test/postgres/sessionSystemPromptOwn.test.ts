/**
 * Whether a session runs on its own system prompt with none of its project's
 * settings: a member's thread never does, so its facts never say it does.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { sessionRigTurn } from "./sessionHarness.ts";
import {
  threadRigFacts,
  threadRigMember,
  threadRigOpen,
  threadRigProject,
  threadRigThread,
  type ThreadRig,
} from "./threadHarness.ts";

let rig: ThreadRig;

before(async () => {
  rig = await threadRigOpen();
});

after(async () => {
  await rig.close();
});

test("a member's thread is opened without its own system prompt", async () => {
  const partition = await threadRigProject(rig, "thread-prompt-own");
  const member = threadRigMember(rig, partition, "thread-prompt-own");
  const thread = (await threadRigThread(rig, partition, member)).session;
  await sessionRigTurn(rig.sessions, partition, thread, "thread-prompt-own");
  assert.equal(
    (await threadRigFacts(rig, partition, thread, "thread-prompt-own"))
      .systemPromptOwn,
    undefined,
  );
});
