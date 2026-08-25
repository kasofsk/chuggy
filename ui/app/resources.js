/**
 * The public resources, parsed from `unknown` into shapes the console renders.
 *
 * A field the server did not send is a parse failure rather than a silent
 * `undefined`, because a panel that renders a missing count as zero is the
 * "empty or healthy" reading issue #194 forbids.
 */

/** The model's phases, in the model's order; `test/ui/resources.test.ts` holds them equal. */
export const phaseRoster = [
  "Pending",
  "Working",
  "Evaluating",
  "Finalizing",
  "PublishingHandoff",
  "HandoffBlocked",
  "Done",
  "Abandoned",
  "Escalated",
  "Revoked",
];

class ResourceError extends TypeError {}

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {Record<string, unknown>}
 */
function record(value, what) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ResourceError(`${what} is not an object`);
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string} name
 * @param {string} what
 */
function text(fields, name, what) {
  const value = fields[name];
  if (typeof value !== "string" || value.length === 0)
    throw new ResourceError(`${what}.${name} is not a non-empty string`);
  return value;
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string} name
 * @param {string} what
 */
function count(fields, name, what) {
  const value = fields[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new ResourceError(`${what}.${name} is not a count`);
  return value;
}

/** @param {Record<string, unknown>} fields @param {string} name @param {string} what */
function booleanField(fields, name, what) {
  const value = fields[name];
  if (typeof value !== "boolean")
    throw new ResourceError(`${what}.${name} is not a boolean`);
  return value;
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string} name
 * @param {string} what
 */
function ticket(fields, name, what) {
  const value = count(fields, name, what);
  if (value < 1)
    throw new ResourceError(`${what}.${name} is below the first ticket`);
  return value;
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string} name
 * @param {string} what
 */
function optionalTicket(fields, name, what) {
  return fields[name] === undefined ? undefined : ticket(fields, name, what);
}

/**
 * @param {unknown} value
 * @param {string} what
 * @param {number} limit
 * @returns {readonly unknown[]}
 */
function list(value, what, limit) {
  if (!Array.isArray(value)) throw new ResourceError(`${what} is not an array`);
  if (value.length > limit)
    throw new ResourceError(`${what} is longer than the console accepts`);
  return /** @type {readonly unknown[]} */ (value);
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string} name
 * @param {readonly string[]} roster
 * @param {string} what
 */
function member(fields, name, roster, what) {
  const value = text(fields, name, what);
  if (!roster.includes(value))
    throw new ResourceError(`${what}.${name} is outside the known set`);
  return value;
}

/** The largest array the console will accept from one response. */
export const itemsPerPageMax = 100;

/**
 * @param {unknown} value
 * @param {string} what
 */
function partition(value, what) {
  const fields = record(value, what);
  return {
    tenant: text(fields, "tenant", what),
    project: text(fields, "project", what),
  };
}

/**
 * A page may be shorter than the limit and still carry a cursor.
 *
 * @param {unknown} value
 */
export function parseProjectsPage(value) {
  const fields = record(value, "projects page");
  const projects = list(fields["projects"], "projects", itemsPerPageMax).map(
    (entry) => partition(entry, "project identity"),
  );
  const cursor = fields["nextCursor"];
  return {
    projects,
    nextCursor:
      cursor === undefined
        ? undefined
        : text(fields, "nextCursor", "projects page"),
  };
}

/** @param {unknown} value */
export function parseProject(value) {
  const fields = record(value, "project");
  const tickets = list(fields["tickets"], "tickets", itemsPerPageMax).map(
    (entry) => {
      const row = record(entry, "ticket");
      return {
        ticket: ticket(row, "ticket", "ticket"),
        phase: member(row, "phase", phaseRoster, "ticket"),
        sequence: count(row, "sequence", "ticket"),
      };
    },
  );
  return {
    partition: partition(fields["partition"], "project partition"),
    sequence: count(fields, "sequence", "project"),
    tickets,
    nextAfter: optionalTicket(fields, "nextAfter", "project"),
    nextCursor: optionalText(fields, "nextCursor", "project"),
  };
}

/** @param {unknown} value */
export function parseTicket(value) {
  const fields = record(value, "ticket");
  return {
    ticket: ticket(fields, "ticket", "ticket"),
    phase: member(fields, "phase", phaseRoster, "ticket"),
    sequence: count(fields, "sequence", "ticket"),
  };
}

/** @param {unknown} value */
function dispatchToken(value) {
  const fields = record(value, "dispatch token");
  return {
    tenant: text(fields, "tenant", "dispatch token"),
    project: text(fields, "project", "dispatch token"),
    recoveryEpoch: text(fields, "recoveryEpoch", "dispatch token"),
    schemaVersion: count(fields, "schemaVersion", "dispatch token"),
    watermark: count(fields, "watermark", "dispatch token"),
    digest: text(fields, "digest", "dispatch token"),
  };
}

export const dispatchViewResults = ["Page", "Reset"];
export const notificationResults = ["Events", "Reset"];
export const artifactRoles = ["Handoff", "Diagnostic"];
export const resultVerdicts = ["Pass", "Fail"];

/**
 * `Reset` means the snapshot moved under the reader and paging starts over.
 * `ticketVersion` is the only source of a manual dispatch's expected version.
 *
 * @param {unknown} value
 */
export function parseDispatchView(value) {
  const fields = record(value, "dispatch view");
  const result = member(fields, "result", dispatchViewResults, "dispatch view");
  if (result === "Reset") return { result: /** @type {const} */ ("Reset") };
  const candidates = list(
    fields["candidates"],
    "candidates",
    itemsPerPageMax,
  ).map((entry) => {
    const row = record(entry, "candidate");
    return {
      ticket: ticket(row, "ticket", "candidate"),
      ticketVersion: count(row, "ticketVersion", "candidate"),
      workFanout: count(row, "workFanout", "candidate"),
      configurationRevision: text(row, "configurationRevision", "candidate"),
    };
  });
  return {
    result: /** @type {const} */ ("Page"),
    token: dispatchToken(fields["token"]),
    candidates,
    nextAfter: optionalTicket(fields, "nextAfter", "dispatch view"),
    notificationCursor: count(fields, "notificationCursor", "dispatch view"),
  };
}

/** Which panel an event dirties; the console refetches rather than believing the event. */
export const notificationKinds = [
  "Operation",
  "Ticket",
  "Draft",
  "Configuration",
  "Project",
];

/** @param {unknown} value */
export function parseNotifications(value) {
  const fields = record(value, "notifications");
  const result = member(fields, "result", notificationResults, "notifications");
  const cursor = count(fields, "cursor", "notifications");
  if (result === "Reset")
    return { result: /** @type {const} */ ("Reset"), cursor, events: [] };
  const events = list(fields["events"], "events", itemsPerPageMax).map(
    (entry) => {
      const row = record(entry, "event");
      return {
        ordinal: count(row, "ordinal", "event"),
        kind: member(row, "kind", notificationKinds, "event"),
        resource: text(row, "resource", "event"),
      };
    },
  );
  return { result: /** @type {const} */ ("Events"), cursor, events };
}

export const operationStates = [
  "Pending",
  "Succeeded",
  "Refused",
  "Answered",
  "Cancelled",
];

export const operationRefusalCodes = [
  "NotEnabled",
  "AuthoringChanged",
  "ConfigurationInvalid",
  "TicketChanged",
  "SelectionChanged",
  "CommandUnreadable",
];

/**
 * A submission's 202 body carries only the identity and the state.
 *
 * @param {unknown} value
 */
export function parseOperation(value) {
  const fields = record(value, "operation");
  const state = member(fields, "state", operationStates, "operation");
  return {
    operation: text(fields, "operation", "operation"),
    state,
    refusalCode:
      state === "Refused"
        ? member(fields, "code", operationRefusalCodes, "operation")
        : undefined,
  };
}

/** What the scheduler is willing to claim about its own counts. */
export const schedulerFreshnessRoster = ["Unknown"];

/**
 * The scheduler's counts and the freshness it claims for them. The claim is
 * carried through unchanged: a console that translated `Unknown` into a
 * reassuring word would be reporting an absence of evidence as health.
 *
 * @param {unknown} value
 */
export function parseOperationalStatus(value) {
  const fields = record(value, "operational status");
  return {
    observedAt: text(fields, "observedAt", "operational status"),
    schedulerFreshness: member(
      fields,
      "schedulerFreshness",
      schedulerFreshnessRoster,
      "operational status",
    ),
    queued: count(fields, "queued", "operational status"),
    admitted: count(fields, "admitted", "operational status"),
    launching: count(fields, "launching", "operational status"),
    running: count(fields, "running", "operational status"),
    clusterSlotsMax: count(fields, "clusterSlotsMax", "operational status"),
    clusterActive: count(fields, "clusterActive", "operational status"),
    accountMaximum: count(fields, "accountMaximum", "operational status"),
    accountActive: count(fields, "accountActive", "operational status"),
    accountReservationDeficit: count(
      fields,
      "accountReservationDeficit",
      "operational status",
    ),
  };
}

export const executionStatuses = [
  "Queued",
  "Admitted",
  "Launching",
  "Running",
  "Terminal",
  "Cancelled",
];

export const executionOutcomes = ["Passed", "Failed", "Blocked"];
export const executionTaskKinds = ["Work", "Evaluation"];
export const attemptStates = [
  "Placing",
  "Running",
  "Reported",
  "Lost",
  "Withdrawn",
  "Superseded",
];
export const outputRenderers = ["UnifiedDiff", "Markdown", "Json", "Text"];

/**
 * @param {Record<string, unknown>} fields
 * @param {string} name
 * @param {readonly string[]} roster
 * @param {string} what
 */
function optionalMember(fields, name, roster, what) {
  return fields[name] === undefined
    ? undefined
    : member(fields, name, roster, what);
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string} name
 * @param {string} what
 */
function optionalText(fields, name, what) {
  return fields[name] === undefined ? undefined : text(fields, name, what);
}

export const configurationReadinesses = ["Ready", "Incomplete"];
export const configurationProvenanceSources = ["Authored", "Repository"];
export const repositoryConfigurationFaults = [
  "TooManyDeclarations",
  "PathInvalid",
  "SymlinkRefused",
  "ContentTooLarge",
  "DocumentUnreadable",
  "EnvelopeInvalid",
  "NameInvalid",
  "ConfigurationInvalid",
  "DuplicateName",
  "DuplicatePath",
];

/** @param {unknown} value */
function configurationProvenance(value) {
  const fields = record(value, "configuration provenance");
  const source = member(
    fields,
    "source",
    configurationProvenanceSources,
    "configuration provenance",
  );
  if (source === "Authored")
    return { source: /** @type {const} */ ("Authored") };
  return {
    source: /** @type {const} */ ("Repository"),
    repository: text(fields, "repository", "configuration provenance"),
    commit: text(fields, "commit", "configuration provenance"),
    path: text(fields, "path", "configuration provenance"),
    name: text(fields, "name", "configuration provenance"),
  };
}

/** @param {unknown} value */
function configurationSummary(value) {
  const fields = record(value, "configuration summary");
  const readiness = member(
    fields,
    "readiness",
    configurationReadinesses,
    "configuration summary",
  );
  const summary = {
    revision: text(fields, "revision", "configuration summary"),
    parent: optionalText(fields, "parent", "configuration summary"),
    digest: text(fields, "digest", "configuration summary"),
    createdAt: text(fields, "createdAt", "configuration summary"),
    provenance: configurationProvenance(fields["provenance"]),
  };
  if (readiness === "Incomplete")
    return { ...summary, readiness: /** @type {const} */ ("Incomplete") };
  return {
    ...summary,
    readiness: /** @type {const} */ ("Ready"),
    image: text(fields, "image", "configuration summary"),
    practices: list(
      fields["practices"],
      "configuration practices",
      itemsPerPageMax,
    ).map((practice) => {
      if (typeof practice !== "string" || practice.length === 0)
        throw new ResourceError("configuration practice is not text");
      return practice;
    }),
    workInstructionsCount: count(
      fields,
      "workInstructionsCount",
      "configuration summary",
    ),
    reviewInstructionsCount: count(
      fields,
      "reviewInstructionsCount",
      "configuration summary",
    ),
  };
}

/** @param {unknown} value */
export function parseConfigurationsPage(value) {
  const fields = record(value, "configurations page");
  return {
    configurations: list(
      fields["configurations"],
      "configurations",
      itemsPerPageMax,
    ).map(configurationSummary),
    nextCursor: optionalText(fields, "nextCursor", "configurations page"),
  };
}

/** @param {unknown} value */
export function parseConfiguration(value) {
  const fields = record(value, "configuration");
  return {
    partition: partition(fields["partition"], "configuration partition"),
    revision: text(fields, "revision", "configuration"),
    parent: optionalText(fields, "parent", "configuration"),
    canonical: text(fields, "canonical", "configuration"),
    digest: text(fields, "digest", "configuration"),
  };
}

export const evaluationCombinators = ["UnanimousPass", "AnyPass"];
export const resumePricings = ["RetryCharged", "RetryFree"];
export const finalizers = ["NoFinalizer", "ManagedFinalizer"];
export const draftStates = ["Draft", "Released", "Deleted"];

/** @param {unknown} value @param {string} what */
function stage(value, what) {
  const fields = record(value, what);
  return {
    fanout: ticket(fields, "fanout", what),
    combinator: member(fields, "combinator", evaluationCombinators, what),
  };
}

/** @param {unknown} value @param {string} what */
function reworkPolicy(value, what) {
  const fields = record(value, what);
  if (text(fields, "type", what) !== "BudgetedRework")
    throw new ResourceError(`${what}.type is outside the known set`);
  return {
    type: /** @type {const} */ ("BudgetedRework"),
    value: count(fields, "value", what),
  };
}

/** @param {unknown} value @param {string} what */
function finalizationPricing(value, what) {
  if (value === "DeadlineOnly") return value;
  const fields = record(value, what);
  if (text(fields, "type", what) !== "Budgeted")
    throw new ResourceError(`${what}.type is outside the known set`);
  return {
    type: /** @type {const} */ ("Budgeted"),
    value: count(fields, "value", what),
  };
}

/** @param {unknown} value @param {string} what */
function authoring(value, what) {
  const fields = record(value, what);
  return {
    dependencies: list(
      fields["dependencies"],
      `${what}.dependencies`,
      itemsPerPageMax,
    ).map((entry) => ticket({ ticket: entry }, "ticket", `${what}.dependency`)),
    program: list(fields["program"], `${what}.program`, itemsPerPageMax).map(
      (entry) => stage(entry, `${what}.stage`),
    ),
    workFanout: ticket(fields, "workFanout", what),
    reworkPolicy: reworkPolicy(fields["reworkPolicy"], `${what}.reworkPolicy`),
    finalizationPricing: finalizationPricing(
      fields["finalizationPricing"],
      `${what}.finalizationPricing`,
    ),
    resumePricing: member(fields, "resumePricing", resumePricings, what),
    finalizer: member(fields, "finalizer", finalizers, what),
  };
}

/** @param {Record<string, unknown>} choices */
function draftInitializationChoices(choices) {
  /** @param {string} name */
  const choiceList = (name) =>
    list(
      choices[name],
      `draft initialization choices.${name}`,
      itemsPerPageMax,
    );
  return {
    stages: choiceList("stages").map((entry) =>
      stage(entry, "draft initialization choice stage"),
    ),
    programStagesMax: count(
      choices,
      "programStagesMax",
      "draft initialization.choices",
    ),
    workFanouts: choiceList("workFanouts").map((entry) =>
      ticket({ ticket: entry }, "ticket", "work fanout choice"),
    ),
    reworkPolicies: choiceList("reworkPolicies").map((entry) =>
      reworkPolicy(entry, "rework policy choice"),
    ),
    finalizationPricings: choiceList("finalizationPricings").map((entry) =>
      finalizationPricing(entry, "finalization pricing choice"),
    ),
    resumePricings: choiceList("resumePricings").map((entry) =>
      rosterEntry(entry, resumePricings, "resume pricing choice"),
    ),
    finalizers: choiceList("finalizers").map((entry) =>
      rosterEntry(entry, finalizers, "finalizer choice"),
    ),
  };
}

/** @param {unknown} value @param {readonly string[]} roster @param {string} what */
function rosterEntry(value, roster, what) {
  if (typeof value !== "string" || !roster.includes(value))
    throw new ResourceError(`${what} is outside the known set`);
  return value;
}

/** @param {unknown} value */
export function parseDraft(value) {
  const fields = record(value, "draft");
  return {
    partition: partition(fields["partition"], "draft partition"),
    ticket: ticket(fields, "ticket", "draft"),
    authoringVersion: count(fields, "authoringVersion", "draft"),
    state: member(fields, "state", draftStates, "draft"),
    configurationRevision: text(fields, "configurationRevision", "draft"),
    authoring: authoring(fields["authoring"], "draft.authoring"),
  };
}

/** @param {unknown} value */
export function parseDraftInitialization(value) {
  const fields = record(value, "draft initialization");
  const choices = record(fields["choices"], "draft initialization.choices");
  const fence = record(fields["fence"], "draft initialization.fence");
  return {
    configuration: parseConfiguration(fields["configuration"]),
    fence: {
      projectSequence: count(
        fence,
        "projectSequence",
        "draft initialization.fence",
      ),
      configurationDigest: text(
        fence,
        "configurationDigest",
        "draft initialization.fence",
      ),
    },
    defaults: authoring(fields["defaults"], "draft initialization.defaults"),
    choices: draftInitializationChoices(choices),
    dependencyCandidates: list(
      fields["dependencyCandidates"],
      "dependency candidates",
      itemsPerPageMax,
    ).map((entry) =>
      ticket({ ticket: entry }, "ticket", "dependency candidate"),
    ),
    dependencyCandidatesTruncated: booleanField(
      fields,
      "dependencyCandidatesTruncated",
      "draft initialization",
    ),
  };
}

/** @param {unknown} value */
export function parseRepositoryConfigurationRefusal(value) {
  const fields = record(value, "repository configuration refusal");
  return {
    path: text(fields, "path", "repository configuration refusal"),
    fault: member(
      fields,
      "fault",
      repositoryConfigurationFaults,
      "repository configuration refusal",
    ),
    configurationFault: optionalText(
      fields,
      "configurationFault",
      "repository configuration refusal",
    ),
  };
}

/** @param {unknown} value */
export function parseRepositoryConfigurationRefusals(value) {
  const fields = record(value, "repository configuration refusals");
  return list(
    fields["faults"],
    "repository configuration faults",
    itemsPerPageMax,
  ).map(parseRepositoryConfigurationRefusal);
}

/** @param {unknown} value */
function executionSummary(value) {
  const fields = record(value, "execution");
  return {
    execution: text(fields, "execution", "execution"),
    ticket: ticket(fields, "ticket", "execution"),
    task: count(fields, "task", "execution"),
    taskKind: member(fields, "taskKind", executionTaskKinds, "execution"),
    stage:
      fields["stage"] === undefined
        ? undefined
        : count(fields, "stage", "execution"),
    cluster: text(fields, "cluster", "execution"),
    configurationRevision: text(fields, "configurationRevision", "execution"),
    status: member(fields, "status", executionStatuses, "execution"),
    outcome: optionalMember(fields, "outcome", executionOutcomes, "execution"),
    retriesSpent: count(fields, "retriesSpent", "execution"),
    registeredAt: text(fields, "registeredAt", "execution"),
    terminalAt: optionalText(fields, "terminalAt", "execution"),
  };
}

/** @param {unknown} value */
export function parseExecutionsPage(value) {
  const fields = record(value, "executions page");
  return {
    executions: list(fields["executions"], "executions", itemsPerPageMax).map(
      executionSummary,
    ),
    nextAfter: optionalText(fields, "nextAfter", "executions page"),
  };
}

/** @param {unknown} value */
function executionAttempt(value) {
  const fields = record(value, "attempt");
  return {
    attempt: text(fields, "attempt", "attempt"),
    number: count(fields, "number", "attempt"),
    generation: count(fields, "generation", "attempt"),
    state: member(fields, "state", attemptStates, "attempt"),
    openedAt: text(fields, "openedAt", "attempt"),
    endedAt: optionalText(fields, "endedAt", "attempt"),
  };
}

/** @param {unknown} value */
function resultArtifact(value) {
  const fields = record(value, "artifact");
  const output = fields["output"];
  return {
    ordinal: count(fields, "ordinal", "artifact"),
    role: member(fields, "role", artifactRoles, "artifact"),
    path: text(fields, "path", "artifact"),
    digest: text(fields, "digest", "artifact"),
    bytes: count(fields, "bytes", "artifact"),
    renderer:
      output === undefined
        ? undefined
        : member(
            record(output, "output"),
            "renderer",
            outputRenderers,
            "output",
          ),
  };
}

/** @param {unknown} value */
function executionResult(value) {
  const fields = record(value, "result");
  return {
    manifest: text(fields, "manifest", "result"),
    verdict: member(fields, "verdict", resultVerdicts, "result"),
    recordedAt: text(fields, "recordedAt", "result"),
    artifacts: list(fields["artifacts"], "artifacts", itemsPerPageMax).map(
      resultArtifact,
    ),
  };
}

/** @param {unknown} value */
export function parseExecution(value) {
  const fields = record(value, "execution");
  const result = fields["result"];
  return {
    ...executionSummary(value),
    attempts: list(fields["attempts"], "attempts", itemsPerPageMax).map(
      executionAttempt,
    ),
    result: result === undefined ? undefined : executionResult(result),
  };
}

/**
 * A preview the server already bounded; the console renders it as plain text.
 *
 * @param {unknown} value
 */
export function parseArtifactContent(value) {
  const fields = record(value, "artifact content");
  const content = fields["content"];
  if (typeof content !== "string")
    throw new ResourceError("artifact content.content is not text");
  return {
    mediaType: text(fields, "mediaType", "artifact content"),
    renderer: member(fields, "renderer", outputRenderers, "artifact content"),
    content,
  };
}
