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

import {
  chuggyToolContext,
  chuggyToolServer,
  chuggyToolServerName,
  sessionAllowedTools,
} from "./chuggyTools.mjs";
import { leadDecisionStaging } from "./leadDecision.mjs";
import { keepWorkerLease } from "./lease.mjs";
import {
  observeRateLimit,
  rateLimitSightings,
  rateLimited,
} from "./rateLimit.mjs";
import { credentialScrub } from "./runEvidence.mjs";
import { sessionMailbox } from "./sessionMailbox.mjs";
import { sessionStoreAdapter } from "./sessionStore.mjs";
import { sessionRequest, sessionStopped } from "./sessionTransport.mjs";

/** The longest result text the plane stores for one turn. */
export const sessionTurnResultCharsMax = 65_536;

const agentSdkModule = "@anthropic-ai/claude-agent-sdk";
const zodModule = "zod";
const defaultWorkspace = "/workspace";
const readStatus = 200;
const acceptedStatus = 204;

function unreffed(milliseconds) {
  return wait(milliseconds, undefined, { ref: false });
}

/**
 * The runtime this pod drives, resolved rather than imported at load, so every
 * suite here runs without the SDK installed. `zod` comes from its own module
 * because the SDK declares it a PEER dependency and does not re-export it; the
 * image's build probe is what proves the peer resolved beside the SDK.
 */
export async function sessionSdk() {
  const { query, tool, createSdkMcpServer } = await import(agentSdkModule);
  const { z } = await import(zodModule);
  return { query, tool, createSdkMcpServer, z };
}

/**
 * Every bound a session pod is launched with, and what makes each one valid. A
 * count of milliseconds or turns is whole; a dollar cap is not, because half a
 * dollar is a cap a site may legitimately choose and this image does not get to
 * overrule its launcher.
 */
export const sessionBounds = {
  mailboxPollMs: Number.isSafeInteger,
  idleMs: Number.isSafeInteger,
  resultDrainMs: Number.isSafeInteger,
  loadTimeoutMs: Number.isSafeInteger,
  turnsMax: Number.isSafeInteger,
  budgetUsd: Number.isFinite,
};
export const sessionBoundNames = Object.keys(sessionBounds);

/**
 * Every bound the launcher owes this pod, refused by name where one is missing
 * or not positive. There is no default to fall back to: a bound this image
 * invented would be a loop nobody chose the cap of, and an absent one silently
 * makes its loop unbounded rather than short.
 */
export function checkedSessionBounds(bounds) {
  for (const [name, valid] of Object.entries(sessionBounds)) {
    const value = bounds?.[name];
    if (!valid(value) || value <= 0)
      throw new Error(
        `CHUG_SESSION_TASK needs a positive ${name} and carries ${JSON.stringify(value)}`,
      );
  }
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
 *
 * A hold outranks every other reading, including a successful one: a turn whose
 * account was being refused is a turn the session never got, and answering with
 * whatever text came back would settle it as though it had.
 */
export function sessionTurnFailure(result, sightings) {
  const subtype = typeof result?.subtype === "string" ? result.subtype : "";
  if (rateLimited(sightings)) return "AgentRateLimited";
  if (subtype === "success") return undefined;
  if (subtype === "error_max_budget_usd") return "AgentBudgetExhausted";
  if (subtype === "error_max_turns") return "AgentTurnsExhausted";
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

/**
 * The objectives the session carries, appended to the runtime's own preset.
 *
 * THE PRESET RATHER THAN A CUSTOM PROMPT, because the preset is what loads the
 * checkout's `CLAUDE.md`, and `settingSources` must name `'project'` for it to.
 * Until the checkout lands there is no `CLAUDE.md` to load and naming the one
 * source is inert — but it is narrower than omitting the option, which loads the
 * pod's user and local settings too.
 *
 * `snapshot: true` RECORDS THE RENDERED PROMPT FOR THE CONVERSATION instead of
 * re-rendering it every request. A prompt changed mid-session therefore takes
 * effect at the next compaction or in a new session, so an owner who edits the
 * North Star will not see a running lead change. Where the account has not been
 * enabled for recording the option is accepted and has no effect, so it is safe
 * to set now.
 *
 * A SESSION WITH NO OBJECTIVES STILL TAKES ITS TURN. An older session row, or a
 * project whose settings the host has not pushed yet, carries no prompt; a lead
 * with the preset's own objectives is worse than one with the project's and is
 * not a reason to refuse the turn.
 */
function sessionSystemPrompt(facts) {
  const append = facts.systemPrompt;
  return {
    type: "preset",
    preset: "claude_code",
    snapshot: true,
    ...(typeof append === "string" && append.length > 0 ? { append } : {}),
  };
}

/** The options one session's query runs under, every bound the pod was launched with. */
export function sessionQueryOptions(
  task,
  facts,
  store,
  environment,
  token,
  servers = {},
) {
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
    mcpServers: servers,
    systemPrompt: sessionSystemPrompt(facts),
    settingSources: ["project"],
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
  observeRateLimit(context.sightings, message);
  if (message.type !== "system") return;
  if (message.subtype === "init") await bindReference(context, message);
  if (message.subtype === "mirror_error") context.mirrored = true;
}

/** One turn's messages, read to its result and then drained past it. */
export async function runSessionTurn(context) {
  context.store.startTurn();
  context.sightings = rateLimitSightings();
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

/**
 * What one turn's messages settle it as. `Held` names no turn, because it is not
 * the turn that ended: the provider refused the account, so the pod gives up the
 * whole attempt and the plane returns every turn it claimed to the mailbox
 * uncharged. Stopping is the point — a held turn requeued under a live pod would
 * be claimed again at once, and the loop would spend the hold rather than wait
 * it out. The scheduler's placement backoff is what paces the next attempt.
 */
async function settleTurn(context, turn, result) {
  if (context.mirrored) {
    await post(context, "/v1/session/turn/failure", {
      turn: turn.turn,
      failure: "StoreRefused",
    });
    return "Stop";
  }
  const failure = sessionTurnFailure(result, context.sightings);
  if (failure === "AgentRateLimited") {
    await post(context, "/v1/session/held", {});
    return "Held";
  }
  if (failure !== undefined) {
    await post(context, "/v1/session/turn/failure", {
      turn: turn.turn,
      failure,
    });
    return "Continue";
  }
  await post(context, "/v1/session/turn/answer", {
    turn: turn.turn,
    result: sessionAnswerText(context, turn, result),
    ...context.store.turnBatches(),
  });
  return "Continue";
}

/**
 * What one turn answers with: the document its decision tools composed, or the
 * model's own text. The prose arm is not a fallback to be removed — a lead
 * resumed from before the decision tools existed answers in text, and the
 * runtime's one parser reads whichever arrived. A composed document belongs only
 * to an observation: a user's message and a wake are answered to a reader, not
 * to the selector.
 */
function sessionAnswerText(context, turn, result) {
  const document =
    turn.inputKind === "Observation" ? context.staging?.document() : undefined;
  return document === undefined
    ? sessionResultText(result, context.scrub)
    : context
        .scrub(JSON.stringify(document))
        .slice(0, sessionTurnResultCharsMax);
}

/** Every turn the mailbox hands over, until it stops handing them over. */
export async function runSessionTurns(context) {
  for (;;) {
    const { result, ended } = await runSessionTurn(context);
    const turn = context.mailbox.claimed();
    if (turn === undefined) return context.mirrored ? 1 : 0;
    const verdict = await settleTurn(context, turn, result);
    if (verdict === "Held") {
      context.mailbox.stop();
      return 0;
    }
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

/**
 * The in-process servers this session's runtime is opened with, which is the one
 * `chuggy` server and nothing else. Its tools reach the API under the pod's own
 * session bearer, so every command they issue is the session's and carries it.
 */
function sessionToolServers(context, facts, environment, services, sdk) {
  return {
    [chuggyToolServerName]: chuggyToolServer(
      chuggyToolContext(context.task, context.bearer, {
        capabilities: facts.capabilities,
        version: environment.CHUG_SESSION_IMAGE_VERSION ?? "1",
        turn: () => context.mailbox.claimed()?.turn,
        staging: context.staging,
        ...(services.chuggyRequest === undefined
          ? {}
          : { request: services.chuggyRequest }),
      }),
      sdk,
    ),
  };
}

/**
 * The mailbox and the buffer its claims reset, hung on the context as one thing
 * rather than two: the reset is bound to the claim, so a turn that fails leaves
 * nothing for the next one to inherit.
 */
function sessionStagedMailbox(context, { request, wait: pause, now }) {
  const staging = leadDecisionStaging();
  context.staging = staging;
  context.mailbox = sessionMailbox(context.task, context.bearer, {
    request,
    wait: pause,
    now,
    claim: (turn) => staging.reset(turn.input),
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
    const context = {
      task,
      bearer,
      request,
      now,
      scrub,
      mirrored: false,
      sightings: rateLimitSightings(),
    };
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
    sessionStagedMailbox(context, { request, wait: pause, now });
    const sdk = services.sdk ?? (await sessionSdk());
    const stream = sdk.query({
      prompt: context.mailbox.turns(),
      options: sessionQueryOptions(
        task,
        facts,
        context.store,
        environment,
        token,
        sessionToolServers(context, facts, environment, services, sdk),
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
