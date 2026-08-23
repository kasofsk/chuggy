/**
 * What the console reads, when it reads it, and what a dispatch does.
 *
 * One timer drives every panel and issues at most one request per tick, so the
 * console cannot fan out across the installation's in-flight request cap. Each
 * panel keeps its own bounded poll state, and when all of them have stopped the
 * timer stops with them until an operator resumes.
 */

import {
  panelDeferred,
  panelLoading,
  panelReady,
  panelUnavailable,
  panelUnknown,
} from "../app/panels.js";
import {
  backoffDelayMs,
  jitteredDelayMs,
  pollDecision,
  pollDeferred,
  pollFailed,
  pollIntervalMsBase,
  pollPaused,
  pollResumed,
  pollStart,
  pollSucceeded,
  retryDelayMs,
} from "../app/polling.js";
import { pagingStart, pagingStep } from "../app/paging.js";
import {
  parseArtifactContent,
  parseDispatchView,
  parseExecution,
  parseExecutionsPage,
  parseNotifications,
  parseOperation,
  parseOperationalStatus,
  parseProject,
  parseProjectsPage,
} from "../app/resources.js";
import {
  artifactRequest,
  dispatchViewRequest,
  executionRequest,
  executionStateQuery,
  executionsRequest,
  notificationsRequest,
  operationRequest,
  operationalStatusRequest,
  pageLimitDefault,
  phaseQuery,
  projectsRequest,
  submissionRequest,
  ticketsRequest,
} from "../app/protocol.js";
import { operationAdvanced, operationSubmitting } from "../app/operation.js";
import { manualDispatchMutation } from "../app/views.js";
import { send } from "./transport.js";

export const operationsShownMax = 12;

/** The panels the timer drives, in the order it considers them. */
export const readers = [
  {
    name: "status",
    title: "Scheduler",
    asOf: "Read",
    request: (token, partition) => operationalStatusRequest(token, partition),
    parse: parseOperationalStatus,
  },
  {
    name: "tickets",
    title: "Tickets by phase",
    asOf: "Observed",
    request: (token, partition, cursor) =>
      ticketsRequest(token, partition, {
        limit: pageLimitDefault,
        phases: phaseQuery(cursor.phases),
      }),
    parse: parseProject,
  },
  {
    name: "candidates",
    title: "Dispatch candidates",
    asOf: "Observed",
    request: (token, partition) =>
      dispatchViewRequest(token, partition, { limit: pageLimitDefault }),
    parse: parseDispatchView,
  },
  {
    name: "executions",
    title: "Executions",
    asOf: "Observed",
    request: (token, partition, cursor) =>
      executionsRequest(token, partition, {
        limit: pageLimitDefault,
        states: executionStateQuery(cursor.states),
      }),
    parse: parseExecutionsPage,
  },
  {
    name: "notifications",
    title: "Notifications",
    asOf: "Read",
    request: (token, partition, cursor) =>
      notificationsRequest(
        token,
        partition,
        cursor.notifications,
        pageLimitDefault,
      ),
    parse: parseNotifications,
  },
];

function byName(make) {
  return Object.fromEntries(readers.map((reader) => [reader.name, make()]));
}

/** Which panel a notification kind puts behind; an unmapped kind dirties nothing. */
export function panelForKind(kind) {
  if (kind === "Ticket" || kind === "Project") return "tickets";
  if (kind === "Operation") return "candidates";
  if (kind === "Configuration" || kind === "Draft") return undefined;
  return "executions";
}

export function unavailableReason(outcome) {
  if (outcome.outcome === "Absent")
    return "The resource is absent, or this account cannot see it.";
  if (outcome.outcome === "Unauthenticated")
    return "The session is no longer accepted.";
  if (outcome.outcome === "Conflict")
    return `The server answered ${outcome.code}.`;
  return `The read failed: ${outcome.code}.`;
}

export function submissionEvent(outcome) {
  if (outcome.outcome === "Accepted") {
    const accepted = parseOperation(outcome.body);
    return {
      event: "Accepted",
      operation: accepted.operation,
      state: accepted.state,
    };
  }
  if (outcome.outcome === "Retryable")
    return {
      event: "Deferred",
      code: outcome.code,
      retryAfterSeconds: outcome.retryAfterSeconds,
    };
  if (outcome.outcome === "Absent") return { event: "Absent" };
  return {
    event: "Faulted",
    reason: `the submission answered ${outcome.code}`,
  };
}

export function operationEvent(outcome) {
  if (outcome.outcome === "Ok") {
    const resource = parseOperation(outcome.body);
    return {
      event: "Polled",
      state: resource.state,
      refusalCode: resource.refusalCode,
    };
  }
  if (outcome.outcome === "Absent") return { event: "Absent" };
  return {
    event: "Faulted",
    reason: `the operation read answered ${outcome.code}`,
  };
}

function consoleDelay(waitMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, waitMs);
  });
}

function consoleDueMs(desk, name) {
  const poll = desk.state.polls[name];
  return poll.retryAfterSeconds > 0
    ? retryDelayMs(poll.retryAfterSeconds)
    : backoffDelayMs(poll.failures);
}

function consoleDirty(desk) {
  for (const reader of readers) desk.state.polledAtMs[reader.name] = 0;
}

function consoleApply(desk, reader, outcome, at) {
  const panel = desk.state.panels[reader.name];
  if (outcome.outcome === "Ok") {
    desk.state.panels[reader.name] = panelReady(reader.parse(outcome.body), at);
    desk.state.polls[reader.name] = pollSucceeded(
      desk.state.polls[reader.name],
    );
    return;
  }
  if (outcome.outcome === "Retryable") {
    desk.state.panels[reader.name] = panelDeferred(
      panel,
      outcome.code,
      outcome.retryAfterSeconds,
    );
    desk.state.polls[reader.name] = pollDeferred(
      desk.state.polls[reader.name],
      outcome.retryAfterSeconds,
    );
    return;
  }
  desk.state.panels[reader.name] = panelUnavailable(
    panel,
    unavailableReason(outcome),
  );
  desk.state.polls[reader.name] = pollFailed(desk.state.polls[reader.name]);
}

/** An event says which panel is behind; the console refetches rather than believing it. */
function consoleFollowNotifications(desk) {
  const panel = desk.state.panels["notifications"];
  if (panel.state !== "Ready") return;
  desk.state.cursor.notifications = panel.value.cursor;
  const behind =
    panel.value.result === "Reset"
      ? readers.map((reader) => reader.name)
      : panel.value.events.map((event) => panelForKind(event.kind));
  for (const name of new Set(behind)) {
    if (name !== undefined && name !== "notifications")
      desk.state.polledAtMs[name] = 0;
  }
}

async function consoleRead(desk, reader) {
  const token = await desk.session.accessToken();
  if (token === undefined) return;
  desk.state.panels[reader.name] = panelLoading(desk.state.panels[reader.name]);
  const at = desk.nowMs();
  desk.state.polledAtMs[reader.name] = at;
  const outcome = await send(
    reader.request(token, desk.state.partition, desk.state.cursor),
  );
  try {
    consoleApply(desk, reader, outcome, at);
  } catch {
    desk.state.panels[reader.name] = panelUnavailable(
      desk.state.panels[reader.name],
      "The server sent a resource this console cannot read.",
    );
    desk.state.polls[reader.name] = pollFailed(desk.state.polls[reader.name]);
  }
  if (reader.name === "notifications") consoleFollowNotifications(desk);
}

function consoleNextAction(desk, at) {
  let waitMs = pollIntervalMsBase;
  let stopped = 0;
  for (const reader of readers) {
    const decision = pollDecision(
      desk.state.polls[reader.name],
      at - desk.state.polledAtMs[reader.name],
    );
    if (decision.action === "Poll") return { action: "Poll", reader };
    if (decision.action === "Stopped") stopped += 1;
    else waitMs = Math.min(waitMs, decision.delayMs);
  }
  return stopped === readers.length
    ? { action: "Stopped" }
    : { action: "Wait", waitMs };
}

function consoleSchedule(desk, waitMs) {
  if (desk.timer !== undefined) return;
  desk.timer = setTimeout(
    () => {
      desk.timer = undefined;
      void consoleTick(desk);
    },
    jitteredDelayMs(Math.max(waitMs, 0), Math.random()),
  );
}

async function consoleTick(desk) {
  if (desk.state.partition === undefined || !desk.session.signedIn()) {
    desk.onChanged();
    return;
  }
  const action = consoleNextAction(desk, desk.nowMs());
  if (action.action === "Poll") await consoleRead(desk, action.reader);
  desk.onChanged();
  if (action.action === "Poll") consoleSchedule(desk, 0);
  else if (action.action === "Wait") consoleSchedule(desk, action.waitMs);
}

function consoleAdvance(desk, step, event) {
  const index = desk.state.operations.indexOf(step);
  const next = operationAdvanced(step, event);
  if (index >= 0) desk.state.operations[index] = next;
  desk.onChanged();
  return next;
}

/** Bounded by the operation machine's attempt budget, not by this loop. */
async function consoleFollow(desk, start) {
  let step = start;
  while (step.step === "Following") {
    await consoleDelay(pollIntervalMsBase);
    const token = await desk.session.accessToken();
    if (token === undefined) return;
    const outcome = await send(
      operationRequest(token, desk.state.partition, step.operation),
    );
    step = consoleAdvance(desk, step, operationEvent(outcome));
  }
  consoleDirty(desk);
  consoleSchedule(desk, 0);
}

async function consoleDispatch(desk, row) {
  const step = operationSubmitting(row.ticket);
  desk.state.operations = [step, ...desk.state.operations].slice(
    0,
    operationsShownMax,
  );
  desk.onChanged();
  const token = await desk.session.accessToken();
  if (token === undefined) return;
  const outcome = await send(
    submissionRequest(token, desk.state.partition, {
      operation: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      mutation: manualDispatchMutation(row),
    }),
  );
  await consoleFollow(
    desk,
    consoleAdvance(desk, step, submissionEvent(outcome)),
  );
}

/** Follows the server's cursor to the end, under the accumulator's own ceilings. */
async function consoleLoadProjects(desk) {
  const token = await desk.session.accessToken();
  if (token === undefined) return;
  let paging = pagingStart();
  let cursor;
  for (;;) {
    const outcome = await send(
      projectsRequest(token, cursor, pageLimitDefault),
    );
    if (outcome.outcome !== "Ok") return;
    const page = parseProjectsPage(outcome.body);
    const stepped = pagingStep(paging, {
      items: page.projects,
      next: page.nextCursor,
    });
    if (stepped.done) {
      desk.state.projects = stepped.items;
      desk.onChanged();
      return;
    }
    paging = stepped.state;
    cursor = stepped.next;
  }
}

async function consoleOpenDetail(desk, execution) {
  desk.state.detail = {
    execution,
    panel: panelLoading(panelUnknown),
    preview: undefined,
  };
  desk.onChanged();
  const token = await desk.session.accessToken();
  if (token === undefined) return;
  const outcome = await send(
    executionRequest(token, desk.state.partition, execution),
  );
  desk.state.detail = {
    execution,
    preview: undefined,
    panel:
      outcome.outcome === "Ok"
        ? panelReady(parseExecution(outcome.body), desk.nowMs())
        : panelUnavailable(panelUnknown, unavailableReason(outcome)),
  };
  desk.onChanged();
}

async function consolePreview(desk, ordinal) {
  const detail = desk.state.detail;
  if (detail === undefined) return;
  const token = await desk.session.accessToken();
  if (token === undefined) return;
  const outcome = await send(
    artifactRequest(token, desk.state.partition, detail.execution, ordinal),
  );
  detail.preview =
    outcome.outcome === "Ok"
      ? parseArtifactContent(outcome.body).content
      : `This artifact could not be previewed. ${unavailableReason(outcome)}`;
  desk.onChanged();
}

function consoleSelect(desk, partition) {
  desk.state.partition = partition;
  desk.state.cursor.notifications = 0;
  desk.state.detail = undefined;
  desk.state.operations = [];
  for (const reader of readers) {
    desk.state.panels[reader.name] = panelUnknown;
    desk.state.polls[reader.name] = pollResumed(desk.state.polls[reader.name]);
  }
  consoleDirty(desk);
  consoleSchedule(desk, 0);
}

function consoleFilter(desk, name, selection) {
  desk.state.cursor[name] = selection;
  desk.state.polledAtMs[name === "phases" ? "tickets" : "executions"] = 0;
  consoleSchedule(desk, 0);
}

function consoleResume(desk) {
  for (const reader of readers) {
    desk.state.polls[reader.name] = pollResumed(desk.state.polls[reader.name]);
  }
  consoleDirty(desk);
  consoleSchedule(desk, 0);
}

function consolePause(desk) {
  for (const reader of readers) {
    desk.state.polls[reader.name] = pollPaused(desk.state.polls[reader.name]);
  }
  if (desk.timer !== undefined) clearTimeout(desk.timer);
  desk.timer = undefined;
  desk.onChanged();
}

export function createConsole(parts) {
  const desk = {
    session: parts.session,
    nowMs: parts.nowMs,
    onChanged: parts.onChanged,
    timer: undefined,
    state: {
      projects: [],
      partition: undefined,
      panels: byName(() => panelUnknown),
      polls: byName(() => pollStart()),
      polledAtMs: byName(() => 0),
      cursor: {
        notifications: 0,
        phases: { selection: "All" },
        states: { selection: "NonTerminal" },
      },
      operations: [],
      detail: undefined,
    },
  };
  return {
    state: desk.state,
    dueMs: (name) => consoleDueMs(desk, name),
    dispatch: (row) => consoleDispatch(desk, row),
    loadProjects: () => consoleLoadProjects(desk),
    openDetail: (execution) => consoleOpenDetail(desk, execution),
    previewArtifact: (ordinal) => consolePreview(desk, ordinal),
    select: (partition) => consoleSelect(desk, partition),
    filter: (name, selection) => consoleFilter(desk, name, selection),
    resume: () => consoleResume(desk),
    pause: () => consolePause(desk),
    stopped: () => consoleNextAction(desk, desk.nowMs()).action === "Stopped",
  };
}
