/**
 * The model and effort a project chooses for its lead and for its threads:
 * held on the session it opened under, served in that session's facts, and
 * bounded by the columns as the door bounds them.
 *
 * A SESSION KEEPS WHAT IT OPENED UNDER. A thread reads the project's thread
 * model and effort as they stand when it opens, as it reads its system prompt,
 * so a change reaches the threads opened after it and no thread already open.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import {
  postgresSelectorProjectSettings,
  postgresSelectorResolvedSettings,
} from "../../src/adapters/postgres/selector.ts";
import {
  leadAutoCompactWindowTokensDefault,
  nativeHttpMediaType,
  runModelCharsMax,
} from "../../src/contract/http.ts";
import { threadEntryResponseSchema } from "../../src/contract/responses.ts";
import {
  asSessionId,
  asSessionTurnId,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import type { LeadOpening } from "../../src/interpreter/leadMailbox.ts";
import {
  leadRunsOn,
  leadStandingReplaced,
} from "../../src/interpreter/leadPolicyHost.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { SelectorProjectOverrides } from "../../src/interpreter/selector.ts";
import {
  sessionRigAttempt,
  sessionRigSession,
  sessionRigTurn,
} from "./sessionHarness.ts";
import { sessionStoreDouble } from "./storeDouble.ts";
import {
  threadRigApp,
  threadRigMember,
  threadRigOpen,
  threadRigProject,
  type ThreadRig,
} from "./threadHarness.ts";

let rig: ThreadRig;

before(async () => {
  rig = await threadRigOpen();
});

after(async () => {
  await rig.close();
});

const administrator = {
  kind: asAuthorityKind("User"),
  subject: asAuthoritySubject("models-admin"),
};

/** What a lead is opened as beside the model and effort a case is about. */
const leadOpened = {
  principal: "principal-lead-models",
  credentialSlot: "claude-code",
  systemPrompt: "the lead's objectives",
  autoCompactWindow: leadAutoCompactWindowTokensDefault,
} as const;

/** Opens the project's lead under `runtime`, as the selector opens one. */
async function leadOpenedUnder(
  partition: Partition,
  runtime: Pick<LeadOpening, "model" | "effort">,
): Promise<SessionId> {
  const opened = await rig.mailbox.openLead({
    partition,
    session: asSessionId(`lead-models-${randomUUID()}`),
    ...leadOpened,
    ...runtime,
  });
  assert.equal(opened.opened, "Opened");
  return opened.session;
}

/** What a session's pod is told of it, through the plane's own authentication. */
async function factsOf(
  partition: Partition,
  session: SessionId,
  label: string,
) {
  const pod = await sessionRigAttempt(rig.sessions, partition, session, label);
  const facts = await rig.sessions.plane.authenticate(pod.secret);
  assert.ok(facts !== undefined, "the pod's bearer was not recognised");
  return facts;
}

/** What a thread's pod is told of it, once a member's turn waits on it. */
async function threadFactsOf(
  partition: Partition,
  thread: SessionId,
  label: string,
) {
  await sessionRigTurn(rig.sessions, partition, thread, label);
  return factsOf(partition, thread, label);
}

/** A decision turn on the lead, which is what an attempt on it opens to take. */
async function leadTurnOffered(partition: Partition): Promise<void> {
  assert.equal(
    (
      await rig.mailbox.offer({
        partition,
        turn: asSessionTurnId(`turn-models-${randomUUID()}`),
        input: "{}",
        route: "InCluster",
      })
    ).offered,
    "Enqueued",
  );
}

/** Writes the project's whole override set over `revision`, refusing anything but a written row. */
async function settingsWritten(
  partition: Partition,
  revision: number,
  overrides: SelectorProjectOverrides,
): Promise<void> {
  const written = await postgresSelectorProjectSettings(rig.apiPool).write(
    partition,
    revision,
    overrides,
    administrator,
  );
  assert.equal(written.written, "Settings");
}

/** Opens a thread of `member`'s through the API's own door, as the console does. */
async function threadOpenedThroughTheDoor(
  partition: Partition,
  member: ReturnType<typeof threadRigMember>,
): Promise<SessionId> {
  await using app = threadRigApp({
    rig,
    principal: member.principal,
    access: rig.sessions.harness.access,
    store: sessionStoreDouble(),
  });
  const opened = await app.inject({
    method: "POST",
    url: `/api/v1/tenants/${partition.tenant}/projects/${partition.project}/threads`,
    headers: {
      authorization: "Bearer valid",
      "content-type": nativeHttpMediaType,
    },
    payload: { key: randomUUID() },
  });
  assert.equal(opened.statusCode, 201, opened.body);
  return asSessionId(threadEntryResponseSchema.parse(opened.json()).session);
}

test("a lead opened under no model or effort is told neither, and one opened under both is told both", async () => {
  const partition = await threadRigProject(rig, "lead-facts");
  const unset = await leadOpenedUnder(partition, {});
  await leadTurnOffered(partition);
  const told = await factsOf(partition, unset, "lead-unset");
  assert.deepEqual(
    [told.session, "model" in told, "effort" in told],
    [unset, false, false],
  );

  const chosen = await threadRigProject(rig, "lead-facts-chosen");
  const lead = await leadOpenedUnder(chosen, {
    model: "claude-sonnet-5-5",
    effort: "medium",
  });
  await leadTurnOffered(chosen);
  const facts = await factsOf(chosen, lead, "lead-chosen");
  assert.deepEqual(
    [facts.model, facts.effort],
    ["claude-sonnet-5-5", "medium"],
  );
});

test("a thread opens under the project's thread model, and neither the lead's settings nor the thread's reach the other", async () => {
  const partition = await threadRigProject(rig, "thread-facts");
  const member = threadRigMember(rig, partition, "thread-facts");
  await settingsWritten(partition, 0, {
    leadModel: "claude-sonnet-5-5",
    leadEffort: "medium",
    threadModel: "claude-opus-5-5",
  });
  const thread = await threadOpenedThroughTheDoor(partition, member);
  const facts = await threadFactsOf(partition, thread, "thread-facts");
  assert.deepEqual(
    [facts.kind, facts.model, "effort" in facts],
    ["Thread", "claude-opus-5-5", false],
    "a thread takes the thread's model and none of the lead's effort",
  );
  assert.deepEqual(
    (
      await postgresSelectorResolvedSettings(rig.apiPool).projectSettings(
        partition,
      )
    ).lead,
    { offering: "Own", model: "claude-sonnet-5-5", effort: "medium" },
  );

  const threadsOnly = await threadRigProject(rig, "thread-facts-only");
  await settingsWritten(threadsOnly, 0, {
    threadModel: "claude-opus-5-5",
    threadEffort: "high",
  });
  assert.deepEqual(
    (
      await postgresSelectorResolvedSettings(rig.apiPool).projectSettings(
        threadsOnly,
      )
    ).lead,
    { offering: "Own" },
    "a thread's model and effort are not the lead's",
  );
});

test("a thread keeps the model it opened under when the project's thread model moves, and a thread opened after takes the new one", async () => {
  const partition = await threadRigProject(rig, "thread-kept");
  const member = threadRigMember(rig, partition, "thread-kept");
  await settingsWritten(partition, 0, {
    threadModel: "claude-opus-5-5",
    threadEffort: "high",
  });
  const before = await threadOpenedThroughTheDoor(partition, member);
  await settingsWritten(partition, 1, { threadModel: "haiku" });
  const later = await threadOpenedThroughTheDoor(partition, member);

  const kept = await threadFactsOf(partition, before, "thread-kept-before");
  assert.deepEqual([kept.model, kept.effort], ["claude-opus-5-5", "high"]);
  const moved = await threadFactsOf(partition, later, "thread-kept-after");
  assert.deepEqual([moved.model, "effort" in moved], ["haiku", false]);
});

test("a lead holding the resolved model and effort is kept, and one holding another is replaced", async () => {
  const partition = await threadRigProject(rig, "lead-replaced");
  await leadOpenedUnder(partition, { model: "sonnet", effort: "low" });
  const standing = await rig.mailbox.lead(partition);
  assert.ok(standing !== undefined);
  const replaced = (runtime: { model?: string; effort?: "low" | "max" }) =>
    leadStandingReplaced(
      standing,
      leadOpened.systemPrompt,
      leadOpened.autoCompactWindow,
      leadRunsOn({ offering: "Own", ...runtime }, leadOpened.credentialSlot),
    );
  assert.equal(replaced({ model: "sonnet", effort: "low" }), false);
  assert.equal(replaced({ model: "opus", effort: "low" }), true, "model");
  assert.equal(replaced({ model: "sonnet", effort: "max" }), true, "effort");
  assert.equal(replaced({}), true, "an override cleared");
});

test("a lead opened before a project could choose a model is served its facts and is not replaced while none is chosen", async () => {
  const partition = await threadRigProject(rig, "lead-before");
  const lead = await sessionRigSession(rig.sessions, partition, "before", {
    kind: "Lead",
    systemPrompt: leadOpened.systemPrompt,
    autoCompactWindow: leadOpened.autoCompactWindow,
  });
  const standing = await rig.mailbox.lead(partition);
  assert.ok(standing !== undefined);
  assert.deepEqual([standing.model, standing.effort], [undefined, undefined]);
  assert.equal(
    leadStandingReplaced(
      standing,
      leadOpened.systemPrompt,
      leadOpened.autoCompactWindow,
      leadRunsOn({ offering: "Own" }, leadOpened.credentialSlot),
    ),
    false,
  );
  await leadTurnOffered(partition);
  const facts = await factsOf(partition, lead, "lead-before");
  assert.deepEqual(
    [facts.session, facts.systemPrompt, "model" in facts, "effort" in facts],
    [lead, leadOpened.systemPrompt, false, false],
  );
});

/** Model names the door refuses, each of which a column must refuse too. */
const modelsRefused: readonly string[] = [
  "claude sonnet",
  "claude\tsonnet",
  "claude sonnet",
  "claude\u0085sonnet",
  "claude　sonnet",
  "-p",
  "",
  "m".repeat(runModelCharsMax + 1),
];

test("a session's model and effort columns refuse what the door refuses", async () => {
  const partition = await threadRigProject(rig, "session-columns");
  const session = await sessionRigSession(rig.sessions, partition, "columns", {
    kind: "Thread",
  });
  const set = (column: "model" | "effort", value: string) =>
    rig.sessions.harness.query(
      `UPDATE agent_session SET ${column}=$2 WHERE session=$1`,
      [session, value],
    );
  for (const model of modelsRefused)
    await assert.rejects(
      set("model", model),
      /agent_session_model_is_a_model/u,
      JSON.stringify(model),
    );
  await assert.rejects(
    set("effort", "ultra"),
    /agent_session_effort_is_known/u,
  );
  for (const model of ["opus", "claude-opus-5-5", "m".repeat(runModelCharsMax)])
    await set("model", model);
  for (const effort of ["low", "medium", "high", "xhigh", "max"])
    await set("effort", effort);
});

test("a project's model and effort columns refuse what the door refuses", async () => {
  const partition = await threadRigProject(rig, "settings-columns");
  const write = (
    values: readonly [
      string | null,
      string | null,
      string | null,
      string | null,
    ],
  ) =>
    rig.sessions.harness.query(
      `SELECT revision::text FROM update_selector_project_settings(
         $1,$2,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
         NULL,NULL,NULL,NULL,$3,$4,$5,$6,'User','models-admin')`,
      [partition.tenant, partition.project, ...values],
    );
  for (const model of modelsRefused) {
    await assert.rejects(
      write([model, null, null, null]),
      /selector_project_lead_model_is_a_model/u,
      JSON.stringify(model),
    );
    await assert.rejects(
      write([null, null, model, null]),
      /selector_project_thread_model_is_a_model/u,
      JSON.stringify(model),
    );
  }
  await assert.rejects(
    write([null, "ultra", null, null]),
    /selector_project_lead_effort_is_known/u,
  );
  await assert.rejects(
    write([null, null, null, "none"]),
    /selector_project_thread_effort_is_known/u,
  );
});

test("the settings history records the lead's and the threads' model and effort", async () => {
  const partition = await threadRigProject(rig, "settings-history");
  const chosen: SelectorProjectOverrides = {
    leadModel: "claude-sonnet-5-5",
    leadEffort: "medium",
    threadModel: "claude-opus-5-5",
    threadEffort: "xhigh",
  };
  await settingsWritten(partition, 0, chosen);
  await settingsWritten(partition, 1, {});
  const store = postgresSelectorProjectSettings(rig.apiPool);
  assert.deepEqual(
    (await store.history(partition, undefined, 10)).map(
      (revision) => revision.overrides,
    ),
    [{}, chosen],
  );
  assert.deepEqual((await store.read(partition)).settings.overrides, {});
});
