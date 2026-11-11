/**
 * Whether a session runs on its own system prompt with none of its project's
 * settings: held on the lead it was opened as, served in its facts, read back
 * by the selector, and false on every session no door opened with it.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { leadAutoCompactWindowTokensDefault } from "../../src/contract/http.ts";
import {
  asSessionId,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import {
  leadRunsOn,
  leadStandingReplaced,
} from "../../src/interpreter/leadPolicyHost.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { sessionRigSession, sessionRigTurn } from "./sessionHarness.ts";
import {
  threadRigFacts,
  threadRigLeadTurn,
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

/** The subsidized profile a case decides under, on a slot of its own. */
const subsidized = {
  offering: "Subsidized",
  credentialSlot: "anthropic-api",
  model: "claude-haiku-5-5",
  effort: "medium",
  turnTokensMax: 120_000,
} as const;

const leadPrompt = "the lead's objectives";

/** Opens the project's lead through the selector's door, on its own system prompt or not. */
async function leadOpenedOwn(
  partition: Partition,
  systemPromptOwn: boolean,
): Promise<SessionId> {
  const opened = await rig.mailbox.openLead({
    partition,
    session: asSessionId(`lead-prompt-own-${randomUUID()}`),
    principal: "principal-lead-prompt-own",
    credentialSlot: subsidized.credentialSlot,
    systemPrompt: leadPrompt,
    autoCompactWindow: leadAutoCompactWindowTokensDefault,
    model: subsidized.model,
    effort: subsidized.effort,
    systemPromptOwn,
  });
  assert.equal(opened.opened, "Opened");
  return opened.session;
}

test("a lead opened on its own system prompt is told so and read back so, and one opened without it is neither", async () => {
  for (const systemPromptOwn of [true, false]) {
    const partition = await threadRigProject(
      rig,
      `lead-prompt-own-${String(systemPromptOwn)}`,
    );
    const lead = await leadOpenedOwn(partition, systemPromptOwn);
    assert.equal(
      (await rig.mailbox.lead(partition))?.systemPromptOwn,
      systemPromptOwn,
    );
    await threadRigLeadTurn(rig, partition);
    const facts = await threadRigFacts(rig, partition, lead, "lead-prompt-own");
    assert.equal(
      facts.systemPromptOwn,
      systemPromptOwn ? true : undefined,
      String(systemPromptOwn),
    );
  }
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

test("a lead stored without its own system prompt on the subsidized profile's slot, model and effort is replaced before a subsidized decision", async () => {
  const partition = await threadRigProject(rig, "lead-prompt-stored");
  await sessionRigSession(rig.sessions, partition, "lead-prompt-stored", {
    kind: "Lead",
    systemPrompt: leadPrompt,
    credentialSlot: subsidized.credentialSlot,
    autoCompactWindow: leadAutoCompactWindowTokensDefault,
    model: subsidized.model,
    effort: subsidized.effort,
  });
  const standing = await rig.mailbox.lead(partition);
  assert.ok(standing !== undefined);
  assert.equal(standing.systemPromptOwn, false);
  const runsOn = leadRunsOn(subsidized, "claude-code");
  assert.equal(
    leadStandingReplaced(
      standing,
      leadPrompt,
      leadAutoCompactWindowTokensDefault,
      runsOn,
    ),
    true,
  );
  assert.equal(
    leadStandingReplaced(
      { ...standing, systemPromptOwn: true },
      leadPrompt,
      leadAutoCompactWindowTokensDefault,
      runsOn,
    ),
    false,
    "the same lead on its own system prompt is kept",
  );
});
