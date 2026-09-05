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
 *
 * WHAT A TURN SPENT IS READ OFF THE RUNTIME'S OWN MESSAGES, NEVER OFF THE
 * RESULT TEXT. The controls the selector runs over a decision check the model,
 * the tools, the tokens and the duration it took; a count taken from the
 * answer's prose would be a count the thing being controlled wrote. So the pod
 * is the measuring host, and a turn the runtime accounted for nothing on
 * carries no measurement at all rather than one of zeroes — the reader of the
 * envelope is what refuses a decision with no provenance.
 *
 * AN INQUIRY FORKS THE PARENT OR IT DOES NOT RUN. What it resumes is
 * `forkFrom`, the lead's own runtime reference, and never its own: its own
 * store is never written, so resuming it would load nothing. An inquiry the
 * plane named no `forkFrom` for therefore fails its turn instead of opening a
 * query — a fresh session under the lead's objectives answers confidently out
 * of nothing, and the member reading the answer cannot tell that from the
 * lead's own thinking.
 *
 * AN INQUIRY IS ONE EXCHANGE, AND THE POD ENDS ITS MAILBOX AFTER IT. Leaving
 * the loop is not enough: the mailbox's generator is still driven by the live
 * query, so it would claim a second turn and abandon it claimed. The door is
 * what bounds an inquiry — nothing enqueues a second turn on one — so this is
 * the weaker of the two walls, and it is here because the pod is what would
 * otherwise spend the account's attempt on a turn the member never asked for.
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import {
  chuggyToolAnswerEnvelopeBytesMax,
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
import { workerRepositories } from "./repository.mjs";
import { credentialScrub } from "./runEvidence.mjs";
import { sessionCheckout } from "./sessionCheckout.mjs";
import { sessionMailbox } from "./sessionMailbox.mjs";
import {
  sessionStoreAdapter,
  sessionStoreBatchBytesMax,
} from "./sessionStore.mjs";
import { sessionRequest, sessionStopped } from "./sessionTransport.mjs";

/** The longest result text the plane stores for one turn. */
export const sessionTurnResultCharsMax = 65_536;

/**
 * How many times the entry the runtime mirrors carries a command's own output:
 * the `tool_result` block, and the command's streams again inside
 * `toolUseResult`. A built-in's answer crosses no boundary this image owns, so
 * the runtime's own output bound is where it can be held under one store line.
 */
export const sessionCommandOutputCopiesInEntry = 3;

/** What a command's output may weigh, so the entry it becomes is one line of one batch. */
export const sessionCommandOutputCharsMax = Math.floor(
  (sessionStoreBatchBytesMax - chuggyToolAnswerEnvelopeBytesMax - 1) /
    sessionCommandOutputCopiesInEntry,
);

/** The most tool names one turn's measurement reports, distinct and in no order. */
export const sessionTurnToolsMax = 64;

/** The longest tool name one turn's measurement reports. */
export const sessionTurnToolNameCharsMax = 128;

/**
 * The longest model identity one turn's measurement reports, which is the bound
 * on the session's own opaque identities rather than a run usage row's.
 */
export const sessionTurnModelCharsMax = 256;

/** What a micro is of a dollar, which is the unit the measured cost is carried in. */
const microsPerDollar = 1_000_000;

/** Every counter of one model's usage that this pod counts as a token spent. */
const modelUsageCounters = [
  "inputTokens",
  "outputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
];

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
 * One figure the runtime reported, taken where it is a count a stored row holds
 * and zero where it is anything else. A figure this pod cannot read is not a
 * reason to fail a turn the runtime finished, and a whole non-negative number
 * is the only thing the plane's door accepts.
 */
function measuredCount(value) {
  const counted = Number.isFinite(value) ? Math.round(value) : 0;
  return Number.isSafeInteger(counted) && counted > 0 ? counted : 0;
}

/**
 * One text as a stored row can hold it: stripped of the one character no stored
 * text holds, cut to the bound, and made whole again where the cut fell inside a
 * surrogate pair. A value the plane refused would fail a turn the runtime
 * completed, over a label, and leave that turn claimed by a pod that has exited.
 */
function measuredText(value, charsMax) {
  return value.replaceAll("\u0000", "").slice(0, charsMax).toWellFormed();
}

/**
 * What the runtime answers a call to a tool it does not serve. It is the one
 * refusal this pod reads, because it is the one that says the call never ran: a
 * tool that ran and returned an error IS a tool the turn used, and treating
 * every `is_error` result as a non-use would hide exactly the tools whose use
 * the controls most want to see.
 */
const toolNotServed = "No such tool available";

/**
 * The tools one message called, which the runtime names in the assistant's own
 * blocks, each under the id its result will answer.
 */
function messageToolCalls(message) {
  const content = message.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (block) => block?.type === "tool_use" && typeof block.name === "string",
    )
    .map((block) => ({
      id: typeof block.id === "string" ? block.id : undefined,
      name: measuredText(block.name, sessionTurnToolNameCharsMax),
    }))
    .filter(({ name }) => name.length > 0);
}

/** One tool result's text, whichever of the two shapes the runtime gave it. */
function toolResultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .join("");
}

/**
 * What one message answers earlier calls with: the call's id, and whether the
 * runtime refused to serve it at all.
 */
function messageToolResults(message) {
  const content = message.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (block) =>
        block?.type === "tool_result" && typeof block.tool_use_id === "string",
    )
    .map((block) => ({
      id: block.tool_use_id,
      refused:
        block.is_error === true &&
        toolResultText(block.content).includes(toolNotServed),
    }));
}

/**
 * What every model call the runtime made through its query pipeline has spent so
 * far, or nothing where the runtime named no model to account for. This is the
 * runtime's own field for token accounting rather than the per-turn one beside
 * it: that one declares itself the main agent loop alone, so a lead with tools
 * would spend its subagents outside every budget.
 *
 * A RECORD THAT COUNTS NOTHING IS NOT A TOTAL OF ZERO. A running total read as
 * zero moves the mark back to the start of the session, and the next turn
 * reporting a real total is then charged the whole of it. A record with no
 * model in it, one naming models whose counters this pod cannot read, and one
 * whose counters are the zeroes the runtime documents a crashed result as
 * carrying are the same thing to a reader: nothing reported, exactly as an
 * absent record is.
 */
function modelUsageTokens(modelUsage) {
  if (typeof modelUsage !== "object" || modelUsage === null) return undefined;
  let counted = 0;
  for (const spent of Object.values(modelUsage))
    for (const counter of modelUsageCounters)
      counted += measuredCount(spent?.[counter]);
  return counted > 0 ? counted : undefined;
}

/**
 * One figure the runtime reports as a total for its whole query rather than for
 * one turn, read as what this turn moved it by. A total the runtime did not
 * report leaves the mark where it stood, so that spend lands on the next turn
 * reporting one rather than being charged twice; a total that fell — a crash's
 * zeroes, or the clear the runtime documents as resetting it — moves the mark
 * down and charges this turn nothing.
 */
function runningTotal() {
  let mark = 0;
  return (total) => {
    const now = Number.isFinite(total) ? Math.max(0, total) : mark;
    const moved = now - mark;
    mark = now;
    return moved;
  };
}

/**
 * What the runtime spent, gathered as it says it. The model, the tokens and the
 * cost outlive one turn because the runtime reports each per query rather than
 * per turn, so what one turn spent is what its total moved by; the duration is
 * already the turn's and the tools are this turn's alone.
 *
 * A FAILED TURN IS NEVER MEASURED, AND ITS SPEND IS NOT LOST. Only an answered
 * turn asks for an envelope, so a failed one leaves both marks where they stood
 * and what it spent is charged to the next turn that answers. The session's
 * total is what stays true and per-turn attribution is what gives way, toward
 * over-reporting, which is the direction a budget refuses in.
 *
 * A TOOL THE RUNTIME REFUSED TO SERVE IS NOT A TOOL THE TURN USED. The model
 * asks; the runtime is what decides, and a name it answered `No such tool
 * available` for never ran. So a call is paired with its result by id, and a
 * name reported is one with a call the runtime did not refuse — asking twice
 * and being served once is still a use. A call whose result has not arrived is
 * a use: the pod reports what it saw happen, and an unanswered call is the
 * turn's own tool still running rather than one denied it.
 */
export function sessionMeasure() {
  let model;
  const dollarsSince = runningTotal();
  const tokensSince = runningTotal();
  let calls = new Map();
  let awaiting = new Map();
  return {
    startTurn() {
      calls = new Map();
      awaiting = new Map();
    },
    saw(message) {
      if (message.type === "system" && message.subtype === "init") {
        const named =
          typeof message.model === "string"
            ? measuredText(message.model, sessionTurnModelCharsMax)
            : "";
        if (named.length > 0) model = named;
      }
      if (message.type === "assistant")
        for (const { id, name } of messageToolCalls(message)) {
          const call =
            calls.get(name) ??
            (calls.size < sessionTurnToolsMax
              ? { made: 0, refused: 0 }
              : undefined);
          if (call === undefined) continue;
          call.made += 1;
          calls.set(name, call);
          if (id !== undefined) awaiting.set(id, name);
        }
      if (message.type !== "user") return;
      for (const { id, refused } of messageToolResults(message)) {
        const name = awaiting.get(id);
        awaiting.delete(id);
        if (refused && name !== undefined) calls.get(name).refused += 1;
      }
    },
    /** The turn's envelope, or nothing where the runtime accounted for nothing. */
    of(result) {
      const spent = modelUsageTokens(result?.modelUsage);
      if (model === undefined || spent === undefined) return undefined;
      return {
        model,
        tokens: measuredCount(tokensSince(spent)),
        costMicros: measuredCount(
          dollarsSince(result.total_cost_usd) * microsPerDollar,
        ),
        durationMs: measuredCount(result.duration_ms),
        tools: [...calls]
          .filter(([, call]) => call.refused < call.made)
          .map(([name]) => name),
      };
    },
  };
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
 * The transcript this attempt forks from, where the plane named one. It is read
 * through one function so the refusal and the query option cannot come to
 * disagree about what "the plane named one" means, and an empty reference is
 * absent here exactly as it is to `bindReference`.
 */
function sessionForkFrom(facts) {
  return typeof facts.forkFrom === "string" && facts.forkFrom.length > 0
    ? facts.forkFrom
    : undefined;
}

/**
 * The objectives the session carries, appended to the runtime's own preset.
 *
 * THE PRESET RATHER THAN A CUSTOM PROMPT, because the preset is what loads the
 * checkout's `CLAUDE.md`, and `settingSources` must name `'project'` for it to.
 * A session with no checkout has no `CLAUDE.md` to load and the option is inert
 * for it — but naming the one source is narrower than omitting the option, which
 * loads the pod's user and local settings too.
 *
 * WHAT THAT ADMITS IS THE BOUND REPOSITORY'S OWN `.claude/settings.json`, all
 * of it — hooks and permissions included, under `permissionMode:
 * "bypassPermissions"`, beside this pod's credentials. That is the project's
 * tree deciding what its own lead may do, which is the same authority the tree
 * already has over the work attempts it runs; it is stated here because
 * `settingSources` is where it is granted. Of what one tree happened to
 * contain: plugins are measured rather than assumed — the marketplace a pod
 * cannot reach means the runtime reports none loaded, with no warning and no
 * start it delayed.
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

/**
 * The options one session's query runs under, every bound the pod was launched
 * with.
 *
 * `cwd` IS THE CHECKOUT WHERE THERE IS ONE, because that is what makes
 * `settingSources: ["project"]` load the tree's own `CLAUDE.md` rather than the
 * bare workspace's absence of one. `CLAUDE_CONFIG_DIR` does NOT move with it:
 * it is the runtime's local mirror, and a mirror written inside a git working
 * tree is pod state the lead would read back as the project's.
 *
 * MOVING `cwd` DOES NOT MOVE A STORE STREAM. The runtime derives `projectKey`
 * from the sanitised `cwd` and `./sessionStore.mjs` discards it, so a session
 * resumed into a pod with a checkout finds the transcript a pod without one
 * wrote. `sessionStore.test.mjs` and this module's suite both hold that.
 */
export function sessionQueryOptions(
  task,
  facts,
  store,
  environment,
  token,
  { servers = {}, checkout } = {},
) {
  const workspace = environment.CHUG_WORKER_WORKSPACE ?? defaultWorkspace;
  const { allowedTools, disallowedTools } = sessionAllowedTools(
    facts.capabilities,
  );
  const model = environment.CHUG_SESSION_MODEL;
  const fork = sessionForkFrom(facts);
  return {
    sessionStore: store,
    sessionStoreFlush: "eager",
    cwd: checkout?.directory ?? workspace,
    env: {
      ...environment,
      BASH_MAX_OUTPUT_LENGTH: String(sessionCommandOutputCharsMax),
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
    ...(fork !== undefined
      ? { resume: fork, forkSession: true }
      : typeof facts.agentReference === "string"
        ? { resume: facts.agentReference }
        : {}),
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
  context.measure.saw(message);
  if (message.type !== "system") return;
  if (message.subtype === "init") await bindReference(context, message);
  if (message.subtype === "mirror_error") context.mirrored = true;
}

/** One turn's messages, read to its result and then drained past it. */
export async function runSessionTurn(context) {
  context.store.startTurn();
  context.sightings = rateLimitSightings();
  context.measure.startTurn();
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
 *
 * `Spent` IS THE SAME ARGUMENT ABOUT A BOUND THIS POD CANNOT OUTLAST. The
 * runtime's budget is per attempt, so once it answers `error_max_budget_usd`
 * every later turn on this query is answered the same way before a token is
 * spent — and a pod that stays running claims the next queued turn and fails it
 * at once, for as long as the session has anything to say. The turn IS failed
 * first, unlike a held one: the runtime did answer it, and it is this attempt's
 * budget rather than the account that is gone.
 *
 * WHAT THE PLANE IS LEFT HOLDING is that one turn `Failed`, every other turn
 * still `Queued` and unclaimed, and an attempt row nobody ended — a hold is the
 * only ending a pod may post, and a spent budget is not one. So the reaper is
 * what collects the attempt, on the lapsed lease or on the idle that failing the
 * turn stamped, and the scheduler places a fresh attempt after it, under a fresh
 * budget, to drain the queue.
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
    return failure === "AgentBudgetExhausted" ? "Spent" : "Continue";
  }
  const measured = context.measure.of(result);
  await post(context, "/v1/session/turn/answer", {
    turn: turn.turn,
    result: sessionAnswerText(context, turn, result),
    ...context.store.turnBatches(),
    ...(measured === undefined ? {} : { measured }),
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
    if (verdict === "Held" || verdict === "Spent") {
      context.mailbox.stop();
      return 0;
    }
    if (verdict === "Stop") {
      context.mailbox.stop();
      return 1;
    }
    context.mailbox.settled();
    if (context.inquiry) {
      context.mailbox.stop();
      return 0;
    }
    if (ended) return 0;
  }
}

/**
 * What a session the site placed but did not equip does instead of running: it
 * claims the turn it was placed for and fails it, so the refusal lands where
 * the reader reads every other answer. Exiting quietly would leave a member
 * watching a turn that never settles, and would leave the attempt row carrying
 * the reap label a pod that never started carries — which is the one thing a
 * misconfigured site must not look like.
 *
 * The reason is a line in the pod's log rather than a field on the row:
 * `allSessionTurnFailures` is a closed vocabulary a durable check is generated
 * from, so a label here is never a payload and `AgentFailed` is the member a
 * pod may name for a turn it could not run.
 */
async function refuseSession(context, warn, reason) {
  warn(`${reason}\n`);
  const turns = context.mailbox.turns();
  if ((await turns.next()).done === false)
    await post(context, "/v1/session/turn/failure", {
      turn: context.mailbox.claimed().turn,
      failure: "AgentFailed",
    });
  context.mailbox.stop();
  return 1;
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

/**
 * Every credential file this pod was mounted, and the agent token among them.
 * The map is read once and handed on, because the checkout resolves its git
 * credential out of the same mounting the runtime's own token came from.
 */
async function sessionCredentials(environment, read, slot) {
  const files = JSON.parse(
    required(environment, "CHUG_WORKER_CREDENTIAL_FILES"),
  );
  const path = files[slot];
  if (typeof path !== "string")
    throw new Error(`the session credential ${slot} is not mounted`);
  return { files, token: (await read(path)).trim() };
}

/**
 * The tree this session reads, cloned before its runtime opens; nothing where
 * the project bound no repository or the clone did not finish; or the refusal
 * where the site named a repository this session cannot reach.
 *
 * IT IS CLONED UNDER A RUNNING LEASE. A clone is the longest thing the pod does
 * before its first turn, so `sessionMain` starts the heartbeat first: an
 * attempt the scheduler reaped while git ran would look like a pod that never
 * started.
 *
 * The site's repository map is read only where the placement bound one: a site
 * running sessions against projects with no binding owes no map, and reading
 * the variable regardless would refuse those pods for a fact they never use.
 */
async function sessionTree(take, task, environment, credentialFiles, logging) {
  const workspace = environment.CHUG_WORKER_WORKSPACE ?? defaultWorkspace;
  const repositories =
    task.repository === undefined
      ? {}
      : workerRepositories(required(environment, "CHUG_WORKER_REPOSITORIES"));
  return take(task, repositories, credentialFiles, workspace, logging);
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

/**
 * The runtime this session speaks through, opened once over the mailbox's own
 * stream of turns. The checkout reaches it only as `cwd`, so a session with no
 * tree opens exactly the same runtime with the bare workspace under it.
 */
async function sessionRuntime(
  context,
  { facts, environment, token, checkout, services },
) {
  const sdk = services.sdk ?? (await sessionSdk());
  return sdk.query({
    prompt: context.mailbox.turns(),
    options: sessionQueryOptions(
      context.task,
      facts,
      context.store,
      environment,
      token,
      {
        servers: sessionToolServers(context, facts, environment, services, sdk),
        ...(checkout === undefined ? {} : { checkout }),
      },
    ),
  });
}

/**
 * The session once everything it runs on is in hand: the store its kind decides
 * the mode of, the mailbox its turns arrive through, and either the runtime it
 * speaks with or one of the refusals that stands in place of one. Both
 * refusals are a session the site placed and did not equip — with no
 * transcript to fork, or with no repository it can reach — and both are
 * checked after the mailbox, because the refusal is a failed turn.
 */
async function sessionRun(context, facts, opened) {
  const { pause, warn } = opened;
  context.inquiry = facts.kind === "Inquiry";
  context.store = sessionStoreAdapter(context.task, context.bearer, {
    request: context.request,
    retain: !context.inquiry,
  });
  sessionStagedMailbox(context, {
    request: context.request,
    wait: pause,
    now: context.now,
  });
  if (context.inquiry && sessionForkFrom(facts) === undefined)
    return await refuseSession(
      context,
      warn,
      "an inquiry was placed with no transcript to fork from",
    );
  if (opened.checkout?.refused !== undefined)
    return await refuseSession(context, warn, opened.checkout.refused);
  const stream = await sessionRuntime(context, { ...opened, facts });
  context.reader = messageReader(stream, pause);
  return await runSessionTurns(context);
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
    checkout: takeCheckout = sessionCheckout,
    lease: startLease = sessionLease,
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
      measure: sessionMeasure(),
    };
    const facts = await sessionFacts(context);
    const { files: credentialFiles, token } = await sessionCredentials(
      environment,
      read,
      facts.credentialSlot,
    );
    scrub = credentialScrub([token, bearer]);
    context.scrub = scrub;
    const workspace = environment.CHUG_WORKER_WORKSPACE ?? defaultWorkspace;
    await ensureDirectory(sessionConfigDirectory(environment, workspace));
    stopLease = startLease(task, bearer, request);
    const checkout = await sessionTree(
      takeCheckout,
      task,
      environment,
      credentialFiles,
      { log: warn, scrub },
    );
    return await sessionRun(context, facts, {
      environment,
      token,
      checkout,
      services,
      pause,
      warn,
    });
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
