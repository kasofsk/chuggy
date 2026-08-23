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
  "Done",
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
  };
}

/**
 * The observed sequence a 409 `ProjectionBehind` carries beside its envelope.
 *
 * @param {unknown} value
 */
export function parseObservedSequence(value) {
  return count(
    record(value, "projection conflict"),
    "observedSequence",
    "projection conflict",
  );
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

/**
 * `Reset` means the snapshot moved under the reader and paging starts over.
 * `ticketVersion` is the only source of a manual dispatch's expected version.
 *
 * @param {unknown} value
 */
export function parseDispatchView(value) {
  const fields = record(value, "dispatch view");
  const result = member(fields, "result", ["Page", "Reset"], "dispatch view");
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
  const result = member(fields, "result", ["Events", "Reset"], "notifications");
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
    role: member(fields, "role", ["Handoff", "Diagnostic"], "artifact"),
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
    verdict: member(fields, "verdict", ["Pass", "Fail"], "result"),
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
  return {
    mediaType: text(fields, "mediaType", "artifact content"),
    renderer: member(fields, "renderer", outputRenderers, "artifact content"),
    content:
      typeof fields["content"] === "string" ? String(fields["content"]) : "",
  };
}
