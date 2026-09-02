/**
 * The pod's Session mode: load the session from the store, open one `query()`
 * over streaming input, long-poll the mailbox for turns, run each and post what
 * came back. A work attempt is still one-shot and nothing here changes that.
 *
 * THE RESULT MESSAGE IS NOT THE END OF THE TURN'S EVIDENCE. The runtime reports
 * a batch it gave up on as a `mirror_error`, and one can arrive after the
 * `result` that said success — a loop that breaks on `result` never sees it. So
 * the pod records the result, keeps reading for the drain bound, and only then
 * decides. A `mirror_error` seen at any point fails the turn with
 * `StoreRefused` and stops the session: the transcript now has a hole, and a
 * session that keeps talking over a hole is one whose next resume is quietly
 * wrong.
 *
 * `persistSession` IS LEFT UNSET, because the runtime forbids `false` beside a
 * store — local writes are what the mirror fires after. The subprocess gets a
 * writable config directory on the pod's ephemeral workspace instead, and on a
 * store-resumed run that copy is materialised to a temporary directory that
 * does not outlive the process. The store is the only durable copy either way.
 *
 * `sessionStoreFlush` IS EAGER, because under the batched default nothing
 * reaches the store until the turn ends and the console's per-message
 * granularity would be a blank page for the whole turn.
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import { keepWorkerLease } from "./lease.mjs";
import { credentialScrub } from "./runEvidence.mjs";
import { sessionMailbox } from "./sessionMailbox.mjs";
import { sessionAllowedTools, sessionStoreAdapter } from "./sessionStore.mjs";
import { sessionRequest, sessionStopped } from "./sessionTransport.mjs";

/** The longest result text the plane stores for one turn. */
export const sessionTurnResultCharsMax = 65_536;

const agentSdkModule = "@anthropic-ai/claude-agent-sdk";
const defaultWorkspace = "/workspace";
const rateLimitLabel = "rate_limit";
const readStatus = 200;
const acceptedStatus = 204;

function unreffed(milliseconds) {
  return wait(milliseconds, undefined, { ref: false });
}

/** The bounds a session pod is launched with, each an operational choice. */
export const sessionBoundNames = [
  "mailboxPollMs",
  "idleMs",
  "resultDrainMs",
  "loadTimeoutMs",
  "turnsMax",
];

/**
 * Every bound the launcher owes this pod, refused by name where one is missing
 * or not positive. There is no default to fall back to: a bound this image
 * invented would be a loop nobody chose the cap of, and an absent one silently
 * makes its loop unbounded rather than short.
 */
export function checkedSessionBounds(bounds) {
  for (const name of sessionBoundNames) {
    const value = bounds?.[name];
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(
        `CHUG_SESSION_TASK needs a positive whole ${name} and carries ${JSON.stringify(value)}`,
      );
  }
  const budget = bounds.budgetUsd;
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0)
    throw new Error(
      `CHUG_SESSION_TASK needs a positive budgetUsd and carries ${JSON.stringify(budget)}`,
    );
  return bounds;
}

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

/**
 * Which failure a result was, or nothing where the turn is answerable. A result
 * the pod cannot account for is `AgentFailed` rather than an answer, because a
 * turn nothing spoke for is not a turn that succeeded.
 */
export function sessionTurnFailure(result) {
  const subtype = typeof result?.subtype === "string" ? result.subtype : "";
  const stopReason =
    typeof result?.stop_reason === "string" ? result.stop_reason : "";
  if (subtype === "success") return undefined;
  if (subtype === "error_max_budget_usd") return "AgentBudgetExhausted";
  if (subtype === "error_max_turns") return "AgentTurnsExhausted";
  if (subtype.includes(rateLimitLabel) || stopReason.includes(rateLimitLabel))
    return "AgentRateLimited";
  return "AgentFailed";
}

/**
 * What a turn answers with, scrubbed before it is cut. Truncating first would
 * let the cut fall inside a credential, leaving a head the scrub no longer
 * matches.
 */
function sessionResultText(result, scrub) {
  return typeof result?.result === "string"
    ? scrub(result.result).slice(0, sessionTurnResultCharsMax)
    : "";
}

/**
 * One read head over the query's messages. A read that timed out leaves the
 * pending read open, so the drain never consumes a message it then discards.
 */
export function messageReader(stream, pause) {
  const iterator = stream[Symbol.asyncIterator]();
  let pending;
  const taken = (step) =>
    step.done ? { message: undefined } : { message: step.value };
  return {
    async next() {
      pending ??= iterator.next();
      const step = await pending;
      pending = undefined;
      return taken(step);
    },
    async within(milliseconds) {
      pending ??= iterator.next();
      const raced = await Promise.race([
        pending.then((step) => taken(step)),
        pause(milliseconds).then(() => undefined),
      ]);
      if (raced !== undefined) pending = undefined;
      return raced;
    },
  };
}

/** The options one session's query runs under, every bound the pod was launched with. */
export function sessionQueryOptions(task, facts, store, environment, token) {
  const workspace = environment.CHUG_WORKER_WORKSPACE ?? defaultWorkspace;
  const { allowedTools, disallowedTools } = sessionAllowedTools(
    facts.capabilities,
  );
  const model = environment.CHUG_SESSION_MODEL;
  return {
    sessionStore: store,
    sessionStoreFlush: "eager",
    cwd: workspace,
    env: {
      ...environment,
      CLAUDE_CODE_OAUTH_TOKEN: token,
      CLAUDE_CONFIG_DIR: sessionConfigDirectory(environment, workspace),
    },
    allowedTools,
    disallowedTools,
    permissionMode: "bypassPermissions",
    maxTurns: task.bounds.turnsMax,
    maxBudgetUsd: task.bounds.budgetUsd,
    loadTimeoutMs: task.bounds.loadTimeoutMs,
    ...(typeof facts.agentReference === "string"
      ? { resume: facts.agentReference }
      : {}),
    ...(facts.kind === "Inquiry" ? { forkSession: true } : {}),
    ...(typeof model === "string" && model.length > 0 ? { model } : {}),
  };
}

function sessionConfigDirectory(environment, workspace) {
  return environment.CLAUDE_CONFIG_DIR ?? join(workspace, ".claude");
}

async function post(context, path, body) {
  const response = await context.request(context.task, context.bearer, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status !== acceptedStatus)
    throw new Error(
      `the worker plane answered ${String(response.status)} for ${path}`,
    );
}

async function bindReference(context, message) {
  const reference = message.session_id;
  if (context.bound || typeof reference !== "string" || reference.length === 0)
    return;
  const response = await context.request(
    context.task,
    context.bearer,
    "/v1/session/reference",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference }),
    },
  );
  if (sessionStopped(response))
    throw new Error("the session reference was refused by the worker plane");
  if (response.status !== acceptedStatus)
    throw new Error(
      `the worker plane answered ${String(response.status)} binding the session reference`,
    );
  context.bound = true;
}

async function observe(context, message) {
  if (message.type !== "system") return;
  if (message.subtype === "init") await bindReference(context, message);
  if (message.subtype === "mirror_error") context.mirrored = true;
}

/** One turn's messages, read to its result and then drained past it. */
export async function runSessionTurn(context) {
  context.store.startTurn();
  let result;
  for (;;) {
    const { message } = await context.reader.next();
    if (message === undefined) return { result, ended: true };
    await observe(context, message);
    if (message.type === "result") {
      result = message;
      break;
    }
  }
  const until = context.now() + context.task.bounds.resultDrainMs;
  for (;;) {
    const remaining = until - context.now();
    if (remaining <= 0) return { result, ended: false };
    const taken = await context.reader.within(remaining);
    if (taken === undefined) return { result, ended: false };
    if (taken.message === undefined) return { result, ended: true };
    await observe(context, taken.message);
  }
}

async function settleTurn(context, turn, result) {
  if (context.mirrored) {
    await post(context, "/v1/session/turn/failure", {
      turn: turn.turn,
      failure: "StoreRefused",
    });
    return "Stop";
  }
  const failure = sessionTurnFailure(result);
  if (failure !== undefined) {
    await post(context, "/v1/session/turn/failure", {
      turn: turn.turn,
      failure,
    });
    return "Continue";
  }
  await post(context, "/v1/session/turn/answer", {
    turn: turn.turn,
    result: sessionResultText(result, context.scrub),
    ...context.store.turnBatches(),
  });
  return "Continue";
}

/** Every turn the mailbox hands over, until it stops handing them over. */
export async function runSessionTurns(context) {
  for (;;) {
    const { result, ended } = await runSessionTurn(context);
    const turn = context.mailbox.claimed();
    if (turn === undefined) return context.mirrored ? 1 : 0;
    const verdict = await settleTurn(context, turn, result);
    if (verdict === "Stop") {
      context.mailbox.stop();
      return 1;
    }
    context.mailbox.settled();
    if (ended) return 0;
  }
}

async function sessionFacts(context) {
  const response = await context.request(
    context.task,
    context.bearer,
    "/v1/session",
    { method: "GET" },
  );
  if (response.status !== readStatus)
    throw new Error(
      `the worker plane answered ${String(response.status)} for the session`,
    );
  return response.json();
}

async function sessionCredential(environment, read, slot) {
  const files = JSON.parse(
    required(environment, "CHUG_WORKER_CREDENTIAL_FILES"),
  );
  const path = files[slot];
  if (typeof path !== "string")
    throw new Error(`the session credential ${slot} is not mounted`);
  return (await read(path)).trim();
}

/**
 * The session's heartbeat, which is the work attempt's with the session's own
 * path: a stop answer is a refusal like any other, remembered until the lease
 * is stopped.
 */
function sessionLease(task, bearer, request) {
  return keepWorkerLease(task, bearer, {
    path: "/v1/session/heartbeat",
    request: async (leaseTask, leaseBearer, path, init) => {
      const response = await request(leaseTask, leaseBearer, path, init);
      if (response.status !== acceptedStatus)
        throw new Error(
          `the session heartbeat answered ${String(response.status)}`,
        );
      return response;
    },
  });
}

export async function sessionMain(services = {}) {
  const {
    environment = process.env,
    read = (path) => readFile(path, "utf8"),
    request = sessionRequest,
    now = Date.now,
    pause = unreffed,
    ensureDirectory = (path) => mkdir(path, { recursive: true }),
    warn = (text) => process.stderr.write(text),
  } = services;
  let scrub = (text) => text;
  let stopLease = async () => undefined;
  try {
    const task = JSON.parse(required(environment, "CHUG_SESSION_TASK"));
    checkedSessionBounds(task.bounds);
    const bearer = (await read(task.workerPlane.capabilityFile)).trim();
    const context = { task, bearer, request, now, scrub, mirrored: false };
    const facts = await sessionFacts(context);
    const token = await sessionCredential(
      environment,
      read,
      facts.credentialSlot,
    );
    scrub = credentialScrub([token, bearer]);
    context.scrub = scrub;
    const workspace = environment.CHUG_WORKER_WORKSPACE ?? defaultWorkspace;
    await ensureDirectory(sessionConfigDirectory(environment, workspace));
    stopLease = sessionLease(task, bearer, request);
    context.store = sessionStoreAdapter(task, bearer, { request });
    context.mailbox = sessionMailbox(task, bearer, {
      request,
      wait: pause,
      now,
    });
    const query = services.query ?? (await import(agentSdkModule)).query;
    const stream = query({
      prompt: context.mailbox.turns(),
      options: sessionQueryOptions(
        task,
        facts,
        context.store,
        environment,
        token,
      ),
    });
    context.reader = messageReader(stream, pause);
    return await runSessionTurns(context);
  } catch (failure) {
    warn(
      `${scrub(failure instanceof Error ? failure.message : "the session failed")}\n`,
    );
    return 1;
  } finally {
    try {
      await stopLease();
    } catch (failure) {
      warn(`${scrub(String(failure))}\n`);
    }
  }
}
