/**
 * The chuggy tool roster as the contract states it: every tool gated by exactly
 * one capability, every capability admitting something, the qualified names a
 * control plane must name derivable from a roster, and the bounds a tool call
 * is held to.
 *
 * The roster is compared against a list written out here rather than against
 * itself, because a roster that only agreed with its own derivation would
 * accept a tool silently added to it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  agentAccountCredentialsMax,
  configurationCanonicalCharsMax,
  dispatchViewSchemaVersion,
  leadAutoCompactWindowTokensMax,
  leadDispatchesMax,
  nativeHttpBodyBytesMax,
  nativeHttpPageItemsMax,
  nativeHttpPathSegmentCharsMax,
  nativeHttpRoutes,
  runModelCharsMax,
  selectorAllowlistNameCharsMax,
  selectorAllowlistNamesMax,
  selectorSettingsTextCharsMax,
  sessionEfforts,
  sessionStoreBatchBytesMax,
  sessionTurnToolsMax,
  workerRunCredentialSchema,
} from "../../src/contract/http.ts";
import * as authoring from "../../src/contract/authoring.ts";
import * as brief from "../../src/contract/brief.ts";
import * as configurationSelection from "../../src/contract/configurationSelection.ts";
import * as epics from "../../src/contract/epics.ts";
import {
  agentAccountsResponseSchema,
  epicViewResponseSchema,
  selectorProjectSettingsResponseSchema,
  type AgentAccountsResponse,
} from "../../src/contract/responses.ts";
import {
  accountAgents,
  agentPauseReasons,
  leadOfferings,
  personalAgentCapabilities,
  phaseRoster,
  placementRoutes,
  runUsageWindows,
  selectorDispatchModes,
  selectorModes,
  sessionCapabilities,
} from "../../src/contract/rosters.ts";
import {
  agentAccountSettingsSchema,
  selectorProjectOverridesSchema,
} from "../../src/contract/requests.ts";
import { sessionFactsAnswerSchema } from "../../src/contract/sessionPlane.ts";
import * as epicDomain from "../../src/domain/epics.ts";
import {
  allChuggyTools,
  allDependentRelations,
  builtInToolCapabilities,
  chuggyToolCapabilities,
  chuggyDocsIndex,
  chuggyToolDispatchViewResponseBytesMax,
  chuggyToolDocsResponseBytesMax,
  chuggyToolEpicViewResponseBytesMax,
  chuggyToolLeadSettingsResponseBytesMax,
  chuggyToolNames,
  chuggyToolPagesMax,
  chuggyToolPrefix,
  chuggyToolResponseBytesMax,
  chuggyToolServerName,
  chuggyToolRoutes,
  chuggyToolTicketLandingBytesMax,
  chuggyToolTimeoutMs,
  dependentRelationsAdmitted,
} from "../../src/contract/sessionTools.ts";

test("the roster names every tool the plan gives it, in roster order", () => {
  assert.deepEqual(allChuggyTools, [
    "list_tickets",
    "read_ticket",
    "read_draft",
    "list_drafts",
    "list_configurations",
    "read_configuration",
    "read_decision_log",
    "read_refusals",
    "read_ticket_refusals",
    "read_ticket_landings",
    "read_landing_queues",
    "read_lead",
    "read_lead_transcript",
    "list_executions",
    "read_execution",
    "read_run_transcript",
    "read_run_error",
    "read_operation",
    "list_threads",
    "read_thread",
    "read_thread_transcript",
    "list_repositories",
    "fetch_image",
    "read_docs",
    "read_abilities",
    "list_epics",
    "read_epic",
    "read_epic_history",
    "read_epic_graph",
    "initialize_draft",
    "file_dependent",
    "revise_draft",
    "delete_draft",
    "release_draft",
    "create_draft",
    "revoke_ticket",
    "update_ticket",
    "create_epic",
    "revise_epic",
    "add_epic_tickets",
    "remove_epic_tickets",
    "dispatch_ticket",
    "dispatch",
    "refuse",
    "lift",
    "set_attention",
    "set_handoff_note",
    "set_planning_intent",
    "read_my_abilities",
    "list_projects",
    "list_my_threads",
    "read_my_thread",
    "list_my_runners",
    "read_chat_host",
    "navigate",
    "offer_release",
    "offer_revoke",
    "read_lead_settings",
    "update_lead_settings",
    "read_placement",
    "update_placement",
    "read_usage",
    "update_usage_settings",
    "retry_paused_agent",
    "retire_credential",
  ]);
});

test("no tool re-authors a released ticket, whatever roster holds it", () => {
  for (const refused of [
    "revoke",
    "merge_tickets",
    "split_ticket",
    "supersede_ticket",
    "set_dependencies",
  ])
    assert.ok(
      !(allChuggyTools as readonly string[]).includes(refused),
      `the roster holds ${refused}`,
    );
});

/** `read_docs` reaches no route, so the one tool both reading scopes hold is it. */
test("every capability is mapped and every tool is gated by exactly one, but the docs both reading scopes hold", () => {
  assert.deepEqual(
    Object.keys(chuggyToolCapabilities).sort(),
    [...sessionCapabilities, ...personalAgentCapabilities].sort(),
  );
  const gates = new Map<string, number>();
  for (const capability of [
    ...sessionCapabilities,
    ...personalAgentCapabilities,
  ])
    for (const tool of chuggyToolCapabilities[capability])
      gates.set(tool, (gates.get(tool) ?? 0) + 1);
  for (const tool of allChuggyTools)
    assert.equal(
      gates.get(tool),
      tool === "read_docs" ? 2 : 1,
      `${tool} is gated as often as it should be`,
    );
  assert.equal(gates.size, allChuggyTools.length);
  assert.ok(chuggyToolCapabilities.ProjectRead.includes("read_docs"));
  assert.ok(chuggyToolCapabilities.MemberRead.includes("read_docs"));
});

test("each capability admits the tools the roster gives it and no other", () => {
  assert.deepEqual(chuggyToolCapabilities.ProjectRead, [
    "list_tickets",
    "read_ticket",
    "read_draft",
    "list_drafts",
    "list_configurations",
    "read_configuration",
    "read_decision_log",
    "read_refusals",
    "read_ticket_refusals",
    "read_ticket_landings",
    "read_landing_queues",
    "read_lead",
    "read_lead_transcript",
    "list_executions",
    "read_execution",
    "read_run_transcript",
    "read_run_error",
    "read_operation",
    "list_threads",
    "read_thread",
    "read_thread_transcript",
    "list_repositories",
    "fetch_image",
    "read_docs",
    "read_abilities",
    "list_epics",
    "read_epic",
    "read_epic_history",
    "read_epic_graph",
  ]);
  assert.deepEqual(chuggyToolCapabilities.DraftAuthor, [
    "initialize_draft",
    "file_dependent",
    "revise_draft",
    "delete_draft",
    "release_draft",
  ]);
  assert.deepEqual(chuggyToolCapabilities.DraftOriginate, [
    "create_draft",
    "revoke_ticket",
    "update_ticket",
    "create_epic",
    "revise_epic",
    "add_epic_tickets",
    "remove_epic_tickets",
  ]);
  assert.deepEqual(chuggyToolCapabilities.TicketDispatch, ["dispatch_ticket"]);
  assert.deepEqual(chuggyToolCapabilities.LeadDecision, [
    "dispatch",
    "refuse",
    "lift",
    "set_attention",
    "set_handoff_note",
    "set_planning_intent",
  ]);
  assert.deepEqual(chuggyToolCapabilities.ThreadOffer, [
    "navigate",
    "offer_release",
    "offer_revoke",
  ]);
  assert.deepEqual(chuggyToolCapabilities.ProjectSettings, [
    "read_lead_settings",
    "update_lead_settings",
    "read_placement",
    "update_placement",
  ]);
});

/**
 * A lead must not rewrite the settings it runs under, and a thread must not
 * make an administrator's write on a chat message's strength, so the settings
 * tools are a person's own agent's alone and no session can be opened with
 * what admits them.
 */
test("no session can hold the capability that admits the settings tools", () => {
  assert.ok(
    !(sessionCapabilities as readonly string[]).includes("ProjectSettings"),
  );
  assert.ok(
    !sessionFactsAnswerSchema.shape.capabilities.safeParse(["ProjectSettings"])
      .success,
  );
  const sessionTools = new Set(chuggyToolNames(sessionCapabilities));
  for (const tool of chuggyToolNames(["ProjectSettings"]))
    assert.ok(!sessionTools.has(tool), tool);
});

/** A session must not change the thresholds it runs under or retire the credential whose reading pauses it, so the account tools are a person's own agent's alone. */
test("no session can hold the capability that admits the account tools", () => {
  assert.deepEqual(chuggyToolCapabilities.AgentAccounts, [
    "read_usage",
    "update_usage_settings",
    "retry_paused_agent",
    "retire_credential",
  ]);
  assert.ok(
    !(sessionCapabilities as readonly string[]).includes("AgentAccounts"),
  );
  assert.ok(
    !sessionFactsAnswerSchema.shape.capabilities.safeParse(["AgentAccounts"])
      .success,
  );
  const sessionTools = new Set(chuggyToolNames(sessionCapabilities));
  for (const tool of chuggyToolNames(["AgentAccounts"]))
    assert.ok(!sessionTools.has(tool), tool);
});

test("each capability admits the runtime's own tools the roster gives it and no other", () => {
  assert.deepEqual(builtInToolCapabilities, {
    RepositoryRead: ["Glob", "Grep", "Read"],
    RepositoryWrite: ["Edit", "NotebookEdit", "Write"],
    RunCommands: ["Bash"],
    ProjectRead: [],
    DraftAuthor: [],
    DraftOriginate: [],
    TicketDispatch: [],
    LeadDecision: [],
    MemberRead: [],
    ThreadOffer: [],
    ProjectSettings: [],
    AgentAccounts: [],
  });
});

test("a capability that maps built-ins alone admits no chuggy tool", () => {
  for (const capability of [
    "RepositoryRead",
    "RepositoryWrite",
    "RunCommands",
  ] as const)
    assert.deepEqual(chuggyToolCapabilities[capability], []);
});

/** A member that admitted nothing would be a control nothing could be seen obeying. */
test("every capability admits a tool, the runtime's own or the chuggy server's", () => {
  for (const capability of [
    ...sessionCapabilities,
    ...personalAgentCapabilities,
  ])
    assert.ok(
      builtInToolCapabilities[capability].length +
        chuggyToolCapabilities[capability].length >
        0,
      `${capability} admits nothing`,
    );
});

test("a turn's measurement may name every tool a session can be given", () => {
  const builtIns = new Set(Object.values(builtInToolCapabilities).flat());
  assert.ok(allChuggyTools.length + builtIns.size <= sessionTurnToolsMax);
});

test("the qualified names are the roster's own, prefixed, and never repeated", () => {
  assert.deepEqual(chuggyToolNames([]), []);
  assert.deepEqual(
    chuggyToolNames(["LeadDecision"]),
    [
      "dispatch",
      "refuse",
      "lift",
      "set_attention",
      "set_handoff_note",
      "set_planning_intent",
    ].map((tool) => `${chuggyToolPrefix}${tool}`),
  );
  assert.deepEqual(
    chuggyToolNames(["ProjectSettings"]),
    [
      "read_lead_settings",
      "update_lead_settings",
      "read_placement",
      "update_placement",
    ].map((tool) => `${chuggyToolPrefix}${tool}`),
  );
  assert.deepEqual(
    chuggyToolNames(["AgentAccounts"]),
    [
      "read_usage",
      "update_usage_settings",
      "retry_paused_agent",
      "retire_credential",
    ].map((tool) => `${chuggyToolPrefix}${tool}`),
  );
  const every = chuggyToolNames([
    ...sessionCapabilities,
    ...personalAgentCapabilities,
  ]);
  assert.equal(new Set(every).size, every.length);
  assert.deepEqual(
    every,
    allChuggyTools.map((tool) => `${chuggyToolPrefix}${tool}`),
  );
  assert.deepEqual(
    chuggyToolNames(["ProjectRead", "ProjectRead"]),
    chuggyToolNames(["ProjectRead"]),
  );
  assert.deepEqual(chuggyToolNames(["LeadDecision", "ProjectRead"]), [
    ...chuggyToolNames(["ProjectRead"]),
    ...chuggyToolNames(["LeadDecision"]),
  ]);
  assert.equal(chuggyToolPrefix, `mcp__${chuggyToolServerName}__`);
});

test("every bound a tool call is held to is named, an unnamed one being unbounded", () => {
  assert.equal(chuggyToolResponseBytesMax, nativeHttpBodyBytesMax);
  assert.equal(chuggyToolTimeoutMs, 30_000);
  assert.equal(chuggyToolPagesMax, 1);
  assert.equal(chuggyToolDocsResponseBytesMax, 65_536);
});

test("read_docs reads the public docs' own index, which a bootstrap worker is pointed at too", () => {
  assert.equal(
    chuggyDocsIndex,
    "https://raw.githubusercontent.com/kasofsk/chuggy-docs/main/llms.txt",
  );
});

test("a dependent may be a follow-up and may not be a prerequisite", () => {
  assert.deepEqual(allDependentRelations, ["FollowUp", "Prerequisite"]);
  assert.deepEqual(dependentRelationsAdmitted, ["FollowUp"]);
});

/**
 * A candidate pinned to the longest canonical configuration, each of its code
 * units the heaviest one UTF-8 encodes alone, is past an ordinary answer's
 * bound, so
 * `dispatch_ticket` reading its page under that bound could never dispatch it.
 */
test("a dispatch view page of the heaviest candidate is under the bound dispatch_ticket reads it with", () => {
  const page = JSON.stringify({
    result: "Page",
    token: {
      tenant: "t".repeat(64),
      project: "p".repeat(64),
      recoveryEpoch: "e".repeat(64),
      schemaVersion: dispatchViewSchemaVersion,
      watermark: Number.MAX_SAFE_INTEGER,
      digest: "d".repeat(64),
    },
    candidates: [
      {
        ticket: Number.MAX_SAFE_INTEGER,
        ticketVersion: Number.MAX_SAFE_INTEGER,
        dependencies: [],
        program: [],
        configurationRevision: "r".repeat(64),
        configurationDigest: "c".repeat(64),
        configurationCanonical: "€".repeat(configurationCanonicalCharsMax),
      },
    ],
    nextAfter: Number.MAX_SAFE_INTEGER,
    notificationCursor: Number.MAX_SAFE_INTEGER,
  });
  const bytes = Buffer.byteLength(page);
  assert.ok(bytes > nativeHttpBodyBytesMax);
  assert.ok(bytes <= chuggyToolDispatchViewResponseBytesMax);
});

/**
 * What chuggy-common's session pod reserves in a transcript entry beside the
 * copies of a tool answer it holds, `chuggyToolAnswerEnvelopeBytesMax` in its
 * `chuggyTools.mjs`.
 */
const podAnswerEnvelopeBytesMax = 4_096;

/** How many copies of a tool answer one transcript entry holds, `chuggyToolAnswerCopiesInEntry` there. */
const podAnswerCopiesInEntry = 2;

/**
 * What one tool answer of the pod may weigh, so the entry it becomes is one
 * line of one store batch: `chuggyToolAnswerBytesMax` there, derived as it is.
 */
const podAnswerBytesMax = Math.floor(
  (sessionStoreBatchBytesMax - podAnswerEnvelopeBytesMax - 1) /
    podAnswerCopiesInEntry,
);

/**
 * A landing weighing the most one landing may, of backslashes as far as it can
 * be, since every byte of a JSON text escapes to at most two and a backslash is
 * one that does; the pod draws a landing whole or not at all, so one it cannot
 * fit in an answer of its own is a landing it can never answer. The answer is a
 * ticket's that answers no stacks, as no landing bound leaves room beside one
 * for the heaviest stacks the pod would answer with it.
 */
test("the heaviest landing read_ticket_landings answers fits one pod tool answer whole beside no stacks, escaped as the pod escapes it", () => {
  const landing = { state: "Held", cycle: 1, held: "", pad: "" };
  const fixed = Buffer.byteLength(JSON.stringify(landing));
  const held = Math.floor((chuggyToolTicketLandingBytesMax - fixed) / 2);
  const heaviest = {
    ...landing,
    held: "\\".repeat(held),
    pad: "a".repeat(chuggyToolTicketLandingBytesMax - fixed - 2 * held),
  };
  assert.equal(
    Buffer.byteLength(JSON.stringify(heaviest)),
    chuggyToolTicketLandingBytesMax,
  );
  const answer = JSON.stringify({ landings: [heaviest], truncated: true });
  assert.ok(Buffer.byteLength(JSON.stringify(answer)) <= podAnswerBytesMax);
});

/**
 * The heaviest content the domain saves: every text of control characters,
 * which JSON escapes heaviest, the description padded to the content's byte
 * cap, and the most members at the largest numbers.
 */
function heaviestEpicContent(): epicDomain.EpicContent {
  const escaped = "\u0001";
  const content = {
    title: escaped.repeat(epics.epicTitleCharsMax),
    summary: escaped.repeat(epics.epicSummaryCharsMax),
    description: "",
    visibility: "Archived" as const,
    tickets: Array.from(
      { length: epics.epicTicketsMax },
      (_, index) => Number.MAX_SAFE_INTEGER - epics.epicTicketsMax + index + 1,
    ),
  };
  const spare =
    epics.epicContentBytesMax -
    Buffer.byteLength(JSON.stringify(content), "utf8");
  const escapedBytes = JSON.stringify(escaped).length - 2;
  return {
    ...content,
    description:
      escaped.repeat(Math.floor(spare / escapedBytes)) +
      "x".repeat(spare % escapedBytes),
  };
}

/**
 * An epic whose content is at its cap is past an ordinary answer's bound, so
 * `add_epic_tickets` and `remove_epic_tickets` reading the view under that
 * bound would refuse a change the server saves.
 */
test("an epic view of the heaviest epic the domain saves is under the bound the epic tools read it with", () => {
  const content = heaviestEpicContent();
  assert.deepEqual(
    epicDomain.decideEpic(new Map(), { kind: "Create", content }, () => true),
    { kind: "Saved", epic: 1, revision: 1 },
  );
  assert.equal(
    Buffer.byteLength(JSON.stringify(content), "utf8"),
    epics.epicContentBytesMax,
  );
  const longestStatus = [...epicDomain.epicStatuses].sort(
    (left, right) => right.length - left.length,
  )[0];
  const view = epicViewResponseSchema.parse({
    number: Number.MAX_SAFE_INTEGER,
    revision: Number.MAX_SAFE_INTEGER,
    ...content,
    progress: {
      byPhase: Object.fromEntries(
        phaseRoster.map((phase) => [phase, epics.epicTicketsMax]),
      ),
      drafts: epics.epicTicketsMax,
      done: epics.epicTicketsMax,
      total: epics.epicTicketsMax,
    },
    status: longestStatus,
    waitingOnOutside: Array.from(
      { length: nativeHttpPageItemsMax },
      () => Number.MAX_SAFE_INTEGER,
    ),
  });
  const bytes = Buffer.byteLength(JSON.stringify(view), "utf8");
  assert.ok(bytes > nativeHttpBodyBytesMax);
  assert.ok(bytes <= chuggyToolEpicViewResponseBytesMax);
});

test("the settings tools reach the route table's own lead-settings and placement routes", () => {
  assert.equal(
    chuggyToolRoutes.selectorSettings,
    nativeHttpRoutes.selectorSettings,
  );
  assert.equal(
    chuggyToolRoutes.sessionPlacement,
    nativeHttpRoutes.sessionPlacement,
  );
});

/** The longest member of a roster. */
function longestOf<Member extends string>(roster: readonly Member[]): Member {
  return roster.reduce((longest, member) =>
    member.length > longest.length ? member : longest,
  );
}

/**
 * The heaviest lead settings the wire admits: every text, allowlist name and
 * identity of control characters, which JSON escapes heaviest, at its longest;
 * every allowlist at its most names; every model of the heaviest character a
 * model may hold; and every count the largest a count may be.
 */
function heaviestLeadSettings(): unknown {
  const escaped = "\u0001";
  const text = escaped.repeat(selectorSettingsTextCharsMax);
  const allowlist = Array.from({ length: selectorAllowlistNamesMax }, () =>
    escaped.repeat(selectorAllowlistNameCharsMax),
  );
  const identity = escaped.repeat(nativeHttpPathSegmentCharsMax);
  const model = "€".repeat(runModelCharsMax);
  const count = Number.MAX_SAFE_INTEGER;
  const limits = {
    tokensPerDecision: count,
    millisecondsPerDecision: count,
    toolCallsPerDecision: count,
    dispatchesPerDecision: count,
    inputBytesPerDecision: count,
    candidatePagesPerDecision: count,
    autoCompactWindow: count,
  };
  const effectiveLimits = {
    ...limits,
    concurrentDecisions: count,
    selectionsPerMinute: count,
  };
  return {
    partition: { tenant: identity, project: identity },
    revision: count,
    overrides: {
      northStar: text,
      threadStandingRules: text,
      mode: longestOf(selectorModes),
      dispatchMode: longestOf(selectorDispatchModes),
      basePrompt: text,
      modelAllowlist: allowlist,
      toolAllowlist: allowlist,
      limits: {
        ...limits,
        dispatchesPerDecision: leadDispatchesMax,
        autoCompactWindow: leadAutoCompactWindowTokensMax,
      },
      operationalContextMaxAgeMs: count,
      leadModel: model,
      leadEffort: longestOf(sessionEfforts),
      threadModel: model,
      threadEffort: longestOf(sessionEfforts),
    },
    effective: {
      revision: count,
      projectRevision: count,
      mode: longestOf(selectorModes),
      installationMode: longestOf(selectorModes),
      dispatchMode: longestOf(selectorDispatchModes),
      basePrompt: text,
      northStar: text,
      threadStandingRules: text,
      modelAllowlist: allowlist,
      toolAllowlist: allowlist,
      limits: effectiveLimits,
      installationLimits: effectiveLimits,
      operationalContextMaxAgeMs: count,
      leadModel: model,
      leadEffort: longestOf(sessionEfforts),
      leadOffering: longestOf(leadOfferings),
    },
  };
}

/**
 * Lead settings at their heaviest are far past an ordinary answer's bound, so
 * the settings tools reading them, or a write's answer, under that bound would
 * refuse settings the server holds.
 */
test("the heaviest lead settings the wire admits are under the bound the settings tools read them with", () => {
  const settings = selectorProjectSettingsResponseSchema.parse(
    heaviestLeadSettings(),
  );
  const bytes = Buffer.byteLength(JSON.stringify(settings), "utf8");
  assert.ok(bytes > nativeHttpBodyBytesMax);
  assert.ok(bytes <= chuggyToolLeadSettingsResponseBytesMax);
});

test("the account tools reach the route table's own agent-account routes", () => {
  assert.equal(chuggyToolRoutes.agentAccounts, nativeHttpRoutes.agentAccounts);
  assert.equal(
    chuggyToolRoutes.agentAccountSettings,
    nativeHttpRoutes.agentAccountSettings,
  );
  assert.equal(
    chuggyToolRoutes.agentAccountPresses,
    nativeHttpRoutes.agentAccountPresses,
  );
  assert.equal(
    chuggyToolRoutes.agentAccountCredential,
    nativeHttpRoutes.agentAccountCredential,
  );
});

/**
 * What one instant writes inside its quotes, escaping included: the server
 * writes each as `toISOString` renders one, which JSON never escapes. The
 * schema bounds none, so this is a ceiling rather than a measurement.
 */
const agentAccountInstantBytesCeiling = 64;

/**
 * What one utilization writes, a JSON number the schema bounds below and not
 * above. It is a ceiling rather than a measurement, past the longest any
 * double is written in.
 */
const agentAccountUtilizationBytesCeiling = 32;

/** The longest name a credential may have, which no character of JSON escapes. */
const agentAccountCredentialNameCharsMax = 64;

/** Each window's reading, every instant at its ceiling and the utilization written as the one character `0`. */
function heaviestAgentAccountReadings(instant: string) {
  return runUsageWindows.map((window) => ({
    window,
    utilization: 0,
    resetsAt: instant,
    observedAt: instant,
  }));
}

/**
 * The heaviest accounts the wire admits: every agent with every credential it
 * may name, each at its longest name with every window's reading and a pause
 * of every reason, and the account's own readings, limit and pause naming every
 * credential. Instants are at their ceiling and each utilization is `0`, which
 * the bound adds the rest of its ceiling to.
 */
function heaviestAgentAccounts(): AgentAccountsResponse {
  const instant = "9".repeat(agentAccountInstantBytesCeiling);
  const names = Array.from({ length: agentAccountCredentialsMax }, (_, index) =>
    workerRunCredentialSchema.parse(
      String(index).padStart(agentAccountCredentialNameCharsMax, "-"),
    ),
  );
  const pause = {
    until: instant,
    reasons: [...agentPauseReasons],
    pressed: false,
  };
  return {
    accounts: accountAgents.map((agent) => ({
      agent,
      settings: agentAccountSettingsSchema.parse({
        fiveHourPercent: 100,
        sevenDayPercent: 100,
        pausesThreads: false,
      }),
      readings: heaviestAgentAccountReadings(instant),
      limit: {
        window: longestOf(runUsageWindows),
        resetsAt: instant,
        observedAt: instant,
      },
      pause: { ...pause, credentials: names },
      credentials: names.map((name) => ({
        name,
        readings: heaviestAgentAccountReadings(instant),
        pause,
      })),
    })),
  } satisfies AgentAccountsResponse;
}

/**
 * `read_usage` reads every account under an ordinary answer's bound, so the
 * heaviest accounts must fit it whole, every utilization written at its
 * ceiling and every string as escaped as JSON writes it.
 */
test("the heaviest agent accounts the wire admits are under the bound the account tools read them with", () => {
  assert.ok(
    !workerRunCredentialSchema.safeParse(
      "-".repeat(agentAccountCredentialNameCharsMax + 1),
    ).success,
  );
  const accounts = agentAccountsResponseSchema.parse(heaviestAgentAccounts());
  const utilizations = accounts.accounts.reduce(
    (count, account) =>
      count +
      account.readings.length +
      (account.credentials ?? []).reduce(
        (readings, credential) => readings + credential.readings.length,
        0,
      ),
    0,
  );
  const text = JSON.stringify(accounts);
  const bytes =
    Buffer.byteLength(text, "utf8") +
    utilizations * (agentAccountUtilizationBytesCeiling - "0".length);
  assert.ok(bytes <= chuggyToolResponseBytesMax, String(bytes));
});

test("the request shapes a drafting tool publishes, and their bounds, are the package entry's own", async () => {
  const entry =
    (await import("@chuggy/worker-contract/sessionTools")) as Record<
      string,
      unknown
    >;
  const published = {
    authoringSchema: authoring.authoringSchema,
    evaluatorDefinitionSchema: authoring.evaluatorDefinitionSchema,
    programStageSchema: authoring.programStageSchema,
    briefSchema: brief.briefSchema,
    briefLinkSchema: brief.briefLinkSchema,
    briefBranchSchema: brief.briefBranchSchema,
    briefRepositorySchema: brief.briefRepositorySchema,
    briefCheckSchema: brief.briefCheckSchema,
    briefTitleCharsMax: brief.briefTitleCharsMax,
    briefIntentCharsMax: brief.briefIntentCharsMax,
    briefLinksMax: brief.briefLinksMax,
    briefImagesMax: brief.briefImagesMax,
    briefChecksMax: brief.briefChecksMax,
    briefBranchCharsMax: brief.briefBranchCharsMax,
    briefRepositoryCharsMax: brief.briefRepositoryCharsMax,
    briefLineCharsMax: brief.briefLineCharsMax,
    configurationSelectionSchema:
      configurationSelection.configurationSelectionSchema,
    epicTitleCharsMax: epics.epicTitleCharsMax,
    epicSummaryCharsMax: epics.epicSummaryCharsMax,
    epicContentBytesMax: epics.epicContentBytesMax,
    epicPageLimitMax: epics.epicPageLimitMax,
    epicTicketsMax: epics.epicTicketsMax,
    selectorProjectOverridesSchema,
    selectorSettingsTextCharsMax,
    placementRoutes,
    leadOfferings,
    agentAccountSettingsSchema,
    accountAgents,
  };
  for (const [name, value] of Object.entries(published))
    assert.equal(entry[name], value, name);
});
