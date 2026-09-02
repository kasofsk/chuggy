/**
 * The evidence a worker produces while the agent runs: the per-turn fold, the
 * transcript batcher, the run totals and the credential scrub every uploaded
 * byte passes through.
 *
 * THE SCRUB IS THE ONLY FILTER. It replaces exact occurrences of the values the
 * worker was itself handed, so what a reader sees is what the run emitted and
 * nothing else was decided about it here.
 *
 * THE BATCHER NUMBERS FROM ONE AND NEVER REORDERS. One flush runs at a time and
 * carries the turns it covers before the bytes, so the plane's contiguity rule
 * is met by construction and a re-delivered flush costs nothing.
 *
 * EVIDENCE NEVER FAILS A RUN. A refused evidence call stops the transcript and
 * is remembered as the reason an already-failing run ended; it does not itself
 * end one, because the ticket's work is not what this module is for.
 */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  observeRateLimit,
  rateLimitSightings,
  rateLimited,
} from "./rateLimit.mjs";
import { workerRequest } from "./transport.mjs";

/** The interval a run's transcript is shipped on, whether or not anyone reads. */
export const runTranscriptFlushMs = 5_000;

/** One batch is one wire body's worth, mirroring `nativeHttpBodyBytesMax`. */
export const runTranscriptBatchBytesMax = 65_536;

/** The most batches one run writes, past which the transcript carries its own
 * truncation. */
export const runTranscriptBatchesMax = 4_096;

/** The largest event kept whole; a larger one keeps its shape and loses its
 * oversized string payloads. */
export const runTranscriptEventBytesMax = 16_384;

/** How deep and how wide an oversized event is walked before it is replaced
 * whole. */
export const runTranscriptEventDepthMax = 16;
export const runTranscriptEventStringsMax = 4_096;

/** The most turns one run's durable series retains. */
export const runTurnSeriesMax = 1_000;

/** The rows one page of a run collection carries, mirroring
 * `nativeHttpPageItemsMax`. */
export const runPageItemsMax = 100;

/** The longest outcome label and model identity the plane stores. */
export const runOutcomeLabelCharsMax = 64;
export const runModelCharsMax = 128;

/** Values shorter than this are not distinctive enough to replace without
 * mangling ordinary text. */
export const credentialScrubCharsMin = 16;

const credentialRedaction = "[redacted credential]";
const turnsExhaustedSubtype = "error_max_turns";
const runCostBasis = "List";
const unnamedModel = "unknown";
const runTurnPagesMax = Math.ceil(runTurnSeriesMax / runPageItemsMax);

/**
 * The scrub every uploaded byte passes through, replacing exact occurrences of
 * the credential values the worker was handed. It matches a value as written,
 * so one carrying a quote, a backslash or a newline is replaced in raw text but
 * not where JSON has escaped it.
 */
export function credentialScrub(secrets) {
  const values = [...new Set(secrets)]
    .filter(
      (secret) =>
        typeof secret === "string" && secret.length >= credentialScrubCharsMin,
    )
    .sort((left, right) => right.length - left.length);
  return (text) =>
    values.reduce(
      (scrubbed, value) => scrubbed.split(value).join(credentialRedaction),
      text,
    );
}

function digestOf(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** What replaces a payload too large to keep, naming its size and its digest so
 * the elision is still a reference. */
export function truncationMarker(value) {
  return {
    chuggy_truncated: {
      bytes: Buffer.byteLength(value),
      digest: digestOf(value),
    },
  };
}

function eventStringSites(node, sites, depth) {
  if (depth > runTranscriptEventDepthMax) return false;
  let complete = true;
  for (const [key, value] of Object.entries(node)) {
    if (sites.length >= runTranscriptEventStringsMax) return false;
    if (typeof value === "string")
      sites.push({ container: node, key, bytes: Buffer.byteLength(value) });
    else if (value !== null && typeof value === "object")
      complete = eventStringSites(value, sites, depth + 1) && complete;
  }
  return complete;
}

function replacedEvent(line, type) {
  const marker = truncationMarker(line);
  return JSON.stringify(
    typeof type === "string" ? { type, ...marker } : marker,
  );
}

/**
 * The line as it is kept, with the oversized string payloads of an oversized
 * event replaced so its type, order and position survive.
 */
export function truncatedEvent(line) {
  let bytes = Buffer.byteLength(line);
  if (bytes <= runTranscriptEventBytesMax) return line;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return replacedEvent(line, undefined);
  }
  if (event === null || typeof event !== "object")
    return replacedEvent(line, undefined);
  const sites = [];
  if (!eventStringSites(event, sites, 0))
    return replacedEvent(line, event.type);
  sites.sort((left, right) => right.bytes - left.bytes);
  for (const site of sites) {
    if (bytes <= runTranscriptEventBytesMax) break;
    const marker = truncationMarker(site.container[site.key]);
    bytes -= site.bytes - Buffer.byteLength(JSON.stringify(marker));
    site.container[site.key] = marker;
  }
  const truncated = JSON.stringify(event);
  return Buffer.byteLength(truncated) <= runTranscriptEventBytesMax
    ? truncated
    : replacedEvent(line, event.type);
}

function count(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function micros(usd) {
  return typeof usd === "number" && Number.isFinite(usd) && usd > 0
    ? Math.round(usd * 1e6)
    : 0;
}

function label(name, value) {
  return typeof value === "string" && value.length > 0
    ? { [name]: value.slice(0, runOutcomeLabelCharsMax) }
    : {};
}

/** A model identity inside the length the plane stores, named where the runtime
 * left it blank. */
function boundedModel(model) {
  const named = model.slice(0, runModelCharsMax);
  return named.length > 0 ? named : unnamedModel;
}

function streamTokens(usage) {
  return {
    tokensInput: count(usage?.input_tokens),
    tokensOutput: count(usage?.output_tokens),
    tokensCacheCreation: count(usage?.cache_creation_input_tokens),
    tokensCacheRead: count(usage?.cache_read_input_tokens),
  };
}

/**
 * One assistant turn's usage, or nothing when the event is not a turn the
 * runtime charged for. It carries no instant: the plane dates the row it
 * stores, and a worker clock is no authority on when a row was stored.
 */
export function runTurn(event, ordinal) {
  const model = event?.message?.model;
  if (event?.type !== "assistant" || typeof model !== "string")
    return undefined;
  return {
    ordinal,
    model: boundedModel(model),
    ...streamTokens(event.message.usage),
  };
}

function reportedModels(modelUsage) {
  if (modelUsage === null || typeof modelUsage !== "object") return [];
  return Object.entries(modelUsage)
    .slice(0, runPageItemsMax)
    .map(([model, usage]) => ({
      model: boundedModel(model),
      tokensInput: count(usage?.inputTokens),
      tokensOutput: count(usage?.outputTokens),
      tokensCacheCreation: count(usage?.cacheCreationInputTokens),
      tokensCacheRead: count(usage?.cacheReadInputTokens),
      costUsdMicros: micros(usage?.costUSD),
    }));
}

function foldedModels(turns) {
  const byModel = new Map();
  for (const turn of turns.slice(0, runTurnSeriesMax)) {
    const held = byModel.get(turn.model) ?? {
      model: turn.model,
      tokensInput: 0,
      tokensOutput: 0,
      tokensCacheCreation: 0,
      tokensCacheRead: 0,
      costUsdMicros: 0,
    };
    held.tokensInput += turn.tokensInput;
    held.tokensOutput += turn.tokensOutput;
    held.tokensCacheCreation += turn.tokensCacheCreation;
    held.tokensCacheRead += turn.tokensCacheRead;
    byModel.set(turn.model, held);
  }
  return [...byModel.values()].slice(0, runPageItemsMax);
}

function summed(models, kind) {
  return models.reduce((total, held) => total + held[kind], 0);
}

function foldedTotals(turns) {
  const models = foldedModels(turns);
  return {
    tokensInput: summed(models, "tokensInput"),
    tokensOutput: summed(models, "tokensOutput"),
    tokensCacheCreation: summed(models, "tokensCacheCreation"),
    tokensCacheRead: summed(models, "tokensCacheRead"),
    turns: turns.length,
    durationMs: 0,
    durationApiMs: 0,
    costUsdMicros: 0,
    costBasis: runCostBasis,
    models,
    permissionDenials: 0,
  };
}

/**
 * What one run spent, from the runtime's own result event where there is one and
 * from the folded turn series where the run died before emitting one.
 */
export function runTotals(result, turns) {
  if (result === null || result === undefined) return foldedTotals(turns);
  return {
    ...streamTokens(result.usage),
    turns: count(result.num_turns),
    durationMs: count(result.duration_ms),
    durationApiMs: count(result.duration_api_ms),
    costUsdMicros: micros(result.total_cost_usd),
    costBasis: runCostBasis,
    models: reportedModels(result.modelUsage),
    permissionDenials: Array.isArray(result.permission_denials)
      ? result.permission_denials.length
      : 0,
    ...label("resultSubtype", result.subtype),
    ...label("stopReason", result.stop_reason),
  };
}

/**
 * Which of the plane's run-ended labels this failure was. A run the runtime
 * accounted for is labelled by that account, so a refused upload names the end
 * only of a run nothing else speaks for.
 *
 * A hold outranks the account, because a run that exhausted its turns while the
 * provider was refusing every request never had the turns to spend. What counts
 * as a hold is `rateLimit.mjs`'s, folded from the frames as they went past.
 */
export function endedEvidence(result, planeRefused, sightings) {
  const subtype = typeof result?.subtype === "string" ? result.subtype : "";
  if (rateLimited(sightings)) return "RunRateLimited";
  if (subtype === turnsExhaustedSubtype) return "RunTurnsExhausted";
  if (result !== null && result !== undefined) return "RunFailed";
  return planeRefused === true ? "RunUploadRefused" : "RunFailed";
}

function transcriptTruncationLine(batches) {
  return JSON.stringify({ type: "chuggy_transcript_truncated", batches });
}

function turnsTruncationLine(turns) {
  return JSON.stringify({ type: "chuggy_turns_truncated", turns });
}

function evidenceState(scrub) {
  return {
    scrub,
    lines: [],
    bufferedBytes: 0,
    nextBatch: 1,
    stopped: false,
    transcriptRefused: false,
    planeRefused: false,
    acknowledged: 0,
    ordinal: 0,
    turns: [],
    pending: [],
    result: undefined,
    sightings: rateLimitSightings(),
    totalsPosted: false,
    flushing: Promise.resolve(),
  };
}

function appendLine(state, text) {
  state.lines.push(text);
  state.bufferedBytes += Buffer.byteLength(text) + 1;
}

function wouldExceedBatch(state, text) {
  return (
    state.lines.length > 0 &&
    state.bufferedBytes + Buffer.byteLength(text) + 1 >
      runTranscriptBatchBytesMax
  );
}

function foldTurn(state, event) {
  if (state.ordinal >= runTurnSeriesMax) return undefined;
  const turn = runTurn(event, state.ordinal + 1);
  if (turn === undefined) return undefined;
  state.ordinal += 1;
  state.turns.push(turn);
  if (!state.transcriptRefused && state.ordinal > state.acknowledged)
    state.pending.push(turn);
  return state.ordinal === runTurnSeriesMax
    ? turnsTruncationLine(runTurnSeriesMax)
    : undefined;
}

async function acknowledgedTurns(answer) {
  if (typeof answer?.json !== "function") return 0;
  try {
    return count((await answer.json())?.turnsRecorded);
  } catch {
    return 0;
  }
}

async function deliverTurns(state, call) {
  for (
    let page = 0;
    page < runTurnPagesMax && state.pending.length > 0;
    page += 1
  ) {
    const rows = state.pending.slice(0, runPageItemsMax);
    const answer = await call("/v1/run/turns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turns: rows }),
    });
    state.acknowledged = Math.max(
      state.acknowledged,
      await acknowledgedTurns(answer),
      rows.at(-1).ordinal,
    );
    state.pending = state.pending.filter(
      (turn) => turn.ordinal > state.acknowledged,
    );
  }
}

async function deliverBatch(state, call) {
  if (state.lines.length === 0) return;
  const final = state.nextBatch >= runTranscriptBatchesMax;
  const body = final
    ? `${transcriptTruncationLine(state.nextBatch)}\n`
    : `${state.lines.join("\n")}\n`;
  await call(`/v1/run/transcript/${String(state.nextBatch)}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.from(body),
  });
  state.nextBatch += 1;
  state.lines = [];
  state.bufferedBytes = 0;
  if (final) state.stopped = true;
}

function failureText(failure) {
  return failure instanceof Error ? failure.message : "run evidence refused";
}

function refuse(state, warn, what, failure) {
  state.planeRefused = true;
  warn(`${what} refused: ${failureText(failure)}\n`);
}

async function flushOnce(state, call, warn) {
  try {
    await deliverTurns(state, call);
    await deliverBatch(state, call);
  } catch (failure) {
    state.transcriptRefused = true;
    state.lines = [];
    state.bufferedBytes = 0;
    state.pending = [];
    refuse(state, warn, "run evidence", failure);
  }
}

function evidenceUploads(state, call, warn, flush, done) {
  return {
    async configuration(content) {
      try {
        await call("/v1/run/configuration", {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: content,
        });
      } catch (failure) {
        refuse(state, warn, "run configuration", failure);
      }
    },
    async finish() {
      if (state.totalsPosted) return;
      state.totalsPosted = true;
      done();
      await flush();
      try {
        await call("/v1/run/totals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(runTotals(state.result, state.turns)),
        });
      } catch (failure) {
        refuse(state, warn, "run totals", failure);
      }
    },
    async ended() {
      done();
      await call("/v1/run/ended", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          evidence: endedEvidence(
            state.result,
            state.planeRefused,
            state.sightings,
          ),
        }),
      });
    },
    stop: done,
  };
}

/**
 * The worker's evidence client: it buffers the stream, ships it on the flush
 * interval and posts the run's totals before anything terminalizes the
 * execution.
 */
export function runEvidenceRecorder(task, bearer, scrub, services = {}) {
  const {
    request = workerRequest,
    setInterval: schedule = globalThis.setInterval,
    clearInterval: unschedule = globalThis.clearInterval,
    warn = (text) => process.stderr.write(text),
  } = services;
  const state = evidenceState(scrub);
  const call = (path, init) => request(task, bearer, path, init);
  const flush = () => {
    state.flushing = state.flushing.then(() => flushOnce(state, call, warn));
    return state.flushing;
  };
  const append = async (text) => {
    if (state.stopped || state.transcriptRefused) return;
    if (wouldExceedBatch(state, text)) await flush();
    if (!state.stopped && !state.transcriptRefused) appendLine(state, text);
  };
  const timer = schedule(flush, runTranscriptFlushMs);
  timer?.unref?.();
  return {
    ...evidenceUploads(state, call, warn, flush, () => unschedule(timer)),
    async record(line, event) {
      observeRateLimit(state.sightings, event);
      await append(state.scrub(truncatedEvent(line)));
      const marker = foldTurn(state, event);
      if (marker !== undefined) await append(marker);
    },
    observed(result) {
      state.result = result;
    },
  };
}
