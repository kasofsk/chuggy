/**
 * The agent runtime's `SessionStore`, written against the worker plane instead
 * of a local file. The capability roster the same session runs under is
 * `./chuggyTools.mjs`, beside the tools it admits.
 *
 * `query()` calls exactly three of the interface's six methods — `append` on
 * every run, `load` and `listSubkeys` on every resume — so those three are what
 * this implements and the other three raise. A silent no-op there would be a
 * console read or a retention sweep that quietly returned nothing.
 *
 * THE STREAM IS THE RUNTIME'S SESSION ID, AND `key.projectKey` IS DISCARDED. It
 * is the sanitised `cwd` with no option that sets it, so a path derived from it
 * would be a second and weaker authority for the tenant, project and session the
 * bearer already names.
 *
 * BATCHES ARE FROZEN WHEN THEY ARE NUMBERED. Once entries are given a number the
 * bytes never change: a batch the plane did not acknowledge is re-sent under the
 * same number with the same body, which is what lets the plane deduplicate by
 * digest without ever reading a payload. Nothing is merged into an
 * unacknowledged batch, because that would change the digest and the plane would
 * be right to call it a conflict.
 *
 * A LINE LONGER THAN A BATCH IS CLIPPED HERE RATHER THAN POSTED. Nothing splits
 * a line, so an entry over the bound could only go as a body the plane refuses,
 * and a refusal there fails the turn `StoreRefused` and stops the session. The
 * producer is not where that can be held: a built-in tool's result never crosses
 * `./chuggyTools.mjs`, and the caps the runtime does offer count characters
 * where the line is charged escaped bytes, which one character can cost several
 * of. So the store is the bound of last resort. It replaces the entry's heaviest
 * values, heaviest first, each with a head of itself and a note naming what the
 * original weighed, until the line fits a batch — never the uuids, the type, the
 * timestamp or the ids the runtime walks a transcript by, because those are
 * lighter than the note that would replace them. A list of strings is one such
 * value: a diff's lines are bulk together and nothing apart, so the list is
 * clipped rather than each line of it. What resumes over the entry parses it and
 * reads that it is seeing less, so it can run the tool again. The pod's own file
 * is untouched; this is what the store posts, not what happened. Only an entry
 * no clip brings under the bound raises, naming what it weighs.
 *
 * DEDUPLICATION IS PER STREAM AND AN ENTRY WITHOUT A UUID IS NEVER DROPPED. A
 * fork re-appends the parent's entries under the fork's own key carrying the
 * parent's uuids, so an index wider than one stream would discard most of every
 * inquiry; and the runtime writes bookkeeping entries that carry no uuid at all.
 * The remembered set is bounded, so a re-appended ancient uuid is written twice
 * rather than dropped — a duplicate the `parentUuid` chain walks past, where a
 * dropped entry is a hole nothing can walk past.
 *
 * AN INQUIRY'S OWN TRANSCRIPT IS NEVER WRITTEN. A fork is answered aside and
 * thrown away, so its adapter is opened with `retain: false`: `append` resolves
 * having sent nothing, and the turn therefore names no batch range, because
 * nothing numbered a batch to name. `load` and `listSubkeys` are untouched by
 * the mode — they still go to the plane, which is how the fork reads the parent
 * it was forked from, and "ephemeral" must not come to mean "disconnected".
 * This discard is not the control: the pod is the thing being controlled, and
 * the database refuses an inquiry's batch on its own.
 */

import { Buffer } from "node:buffer";

import { sessionRequest } from "./sessionTransport.mjs";

/** One store batch is one wire body's worth, mirroring the plane's own bound. */
export const sessionStoreBatchBytesMax = 65_536;

/**
 * What a clipped line weighs at most, its newline counted. It is aimed under
 * the bound rather than at it, so two clipped entries still share one batch and
 * the head a clip keeps is a courtesy to whatever resumes over it rather than
 * the whole of a batch's budget.
 */
export const sessionStoreClipLineBytesMax = Math.floor(
  sessionStoreBatchBytesMax / 2,
);

/** The most batches one stream of a session's store holds. */
export const sessionStoreBatchesMax = 65_536;

/** How many batches one store read answers with. */
export const sessionStorePageBatchesMax = 8;

/** How many already-confirmed entry uuids one stream's adapter remembers. */
export const sessionStoreUuidsRemembered = 4_096;

/** The longest stream name, which is a runtime session id and an optional subpath. */
export const sessionStoreStreamCharsMax = 256;

const loadPagesMax = Math.ceil(
  sessionStoreBatchesMax / sessionStorePageBatchesMax,
);
const storedStatus = 204;
const readStatus = 200;

/** One stream of the store: the runtime's session id, and its subpath where it set one. */
export function sessionStoreStream(key) {
  const sessionId = key?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0)
    throw new Error("the session store was given a key with no session id");
  const stream =
    typeof key.subpath === "string" && key.subpath.length > 0
      ? `${sessionId}/${key.subpath}`
      : sessionId;
  if (stream.length > sessionStoreStreamCharsMax)
    throw new Error(`the session store stream ${stream} is too long`);
  return stream;
}

function streamState(streams, stream) {
  let held = streams.get(stream);
  if (held === undefined) {
    held = {
      nextBatch: 1,
      confirmed: new Set(),
      remembered: [],
      pending: undefined,
    };
    streams.set(stream, held);
  }
  return held;
}

function remember(state, uuid) {
  if (uuid === undefined || state.confirmed.has(uuid)) return;
  state.confirmed.add(uuid);
  state.remembered.push(uuid);
  while (state.remembered.length > sessionStoreUuidsRemembered)
    state.confirmed.delete(state.remembered.shift());
}

function entryUuid(entry) {
  return typeof entry?.uuid === "string" && entry.uuid.length > 0
    ? entry.uuid
    : undefined;
}

/** What one entry weighs as a line of a batch: its own bytes and the newline after it. */
function lineBytes(line) {
  return Buffer.byteLength(line) + 1;
}

/** What a value weighs where it stands in the line, which is what escaping charges. */
function escapedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

/** What the quotes around an escaped string cost, so what is left is the text's own. */
const escapedQuotesBytes = escapedBytes("");

/** The longest head of `text` whose escaped bytes stand within `bytes`. */
function escapedHead(text, bytes) {
  let head = "";
  let weight = 0;
  for (const character of text) {
    const cost = escapedBytes(character) - escapedQuotesBytes;
    if (weight + cost > bytes) break;
    weight += cost;
    head += character;
  }
  return head;
}

/** The longest prefix of `list` whose elements, commas counted, stand within `bytes`. */
function escapedPrefix(list, bytes) {
  const prefix = [];
  let weight = 0;
  for (const element of list) {
    const cost = escapedBytes(element) + 1;
    if (weight + cost > bytes) break;
    weight += cost;
    prefix.push(element);
  }
  return prefix;
}

/**
 * What a clip leaves in place of what it cut. The reader is whatever resumes
 * over the entry, and what it needs is to know it is seeing less, by how much,
 * and that running the tool again is how to see the rest.
 */
function clipNote(value) {
  const weight =
    typeof value === "string" ? Buffer.byteLength(value) : escapedBytes(value);
  return `[the session store clipped this to fit one store batch; the original was ${String(weight)} bytes, so run the tool again to read the rest]`;
}

/** A value a clip replaces as one thing: a list of strings is bulk the way a string is. */
function clippable(value) {
  return (
    typeof value === "string" ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every((element) => typeof element === "string"))
  );
}

/**
 * Every clippable value in the entry, heaviest first, and where it sits so a
 * clip can replace it. The entry's shape is the runtime's, and a producer this
 * tree has never seen writes its bulk under whatever field names it likes — so
 * weight is what finds a result, and a tool's name is never asked for. A list of
 * strings is taken whole and its elements are not taken again: a diff's lines
 * are bulk together and nothing individually, and clipping them one at a time
 * would replace each with something longer than itself.
 */
function entrySites(entry) {
  const found = [];
  const walk = (held, key) => {
    const value = held[key];
    if (clippable(value)) {
      found.push({ held, key, weight: escapedBytes(value) });
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const inner of Object.keys(value)) walk(value, inner);
  };
  walk({ entry }, "entry");
  return found.sort((first, second) => second.weight - first.weight);
}

/** What a site weighs once nothing of the original is left in it but the note. */
function siteFloor(value, note) {
  return typeof value === "string" ? escapedBytes(note) : escapedBytes([note]);
}

/**
 * The heaviest sites replaced by their notes, heaviest first, stopping as soon
 * as what is left fits. A site no heavier than the note that would replace it is
 * passed over rather than cut, which is why an entry's uuids, timestamps and ids
 * survive a clip and why a clip never lengthens a line.
 */
function cutSites(clipped) {
  const cut = [];
  for (const site of entrySites(clipped)) {
    const value = site.held[site.key];
    const note = clipNote(value);
    if (siteFloor(value, note) >= site.weight) continue;
    site.held[site.key] = typeof value === "string" ? note : [note];
    cut.push({ ...site, value, note });
    if (lineBytes(JSON.stringify(clipped)) <= sessionStoreClipLineBytesMax)
      break;
  }
  return cut;
}

/**
 * The cut sites given back as much of their heads as the aim leaves, shared
 * evenly so every copy of one result carries the same head. A share is spent in
 * escaped bytes, because that is what the line is charged for a character.
 */
function growSites(clipped, cut) {
  const spare =
    sessionStoreClipLineBytesMax - lineBytes(JSON.stringify(clipped));
  if (spare <= 0) return;
  const share = Math.floor(spare / cut.length);
  for (const site of cut) {
    if (typeof site.value !== "string") {
      site.held[site.key] = [...escapedPrefix(site.value, share), site.note];
      continue;
    }
    const head = escapedHead(site.value, share - escapedQuotesBytes);
    if (head.length > 0) site.held[site.key] = `${head}\n${site.note}`;
  }
}

/**
 * The line the store posts for one entry: the entry itself where a batch holds
 * it, and a clipped copy of it where nothing else can. The heads are grown
 * against the serialised line and the result is weighed again, because escaping
 * and the copies are what a line is charged for and neither is visible in a
 * character count.
 */
function storedLine(entry) {
  const line = JSON.stringify(entry);
  if (lineBytes(line) <= sessionStoreBatchBytesMax) return line;
  const clipped = JSON.parse(line);
  const cut = cutSites(clipped);
  if (cut.length === 0) return line;
  const notesOnly = JSON.stringify(clipped);
  growSites(clipped, cut);
  const grown = JSON.stringify(clipped);
  return lineBytes(grown) <= sessionStoreBatchBytesMax ? grown : notesOnly;
}

/** The lines this call still owes the store, in order, with the settled ones dropped. */
function owedLines(state, entries) {
  const owed = [];
  for (const entry of entries) {
    const uuid = entryUuid(entry);
    if (uuid !== undefined && state.confirmed.has(uuid)) continue;
    const line = storedLine(entry);
    if (state.pending?.lines.has(line)) continue;
    owed.push({ line, uuid });
  }
  return owed;
}

/** The owed lines cut into contiguous bodies, none over one wire body's worth. */
function plannedBatches(owed) {
  const planned = [];
  let held = [];
  let bytes = 0;
  for (const owedLine of owed) {
    const size = lineBytes(owedLine.line);
    if (size > sessionStoreBatchBytesMax)
      throw new Error(
        `the session store was given an entry of ${String(size - 1)} bytes that clipping does not bring under the ${String(sessionStoreBatchBytesMax)} one batch holds`,
      );
    if (held.length > 0 && bytes + size > sessionStoreBatchBytesMax) {
      planned.push(held);
      held = [];
      bytes = 0;
    }
    held.push(owedLine);
    bytes += size;
  }
  if (held.length > 0) planned.push(held);
  return planned;
}

function frozenBatch(state, held) {
  if (state.nextBatch > sessionStoreBatchesMax)
    throw new Error(
      `the session store stream reached batch ${state.nextBatch}`,
    );
  return {
    batch: state.nextBatch,
    body: `${held.map(({ line }) => line).join("\n")}\n`,
    lines: new Set(held.map(({ line }) => line)),
    uuids: held.map(({ uuid }) => uuid),
  };
}

function batchPath(stream, batch) {
  return `/v1/session/store/${encodeURIComponent(stream)}/${String(batch)}`;
}

function recordTurnBatch(held, stream, batch) {
  if (stream.includes("/")) return;
  held.turn.first ??= batch;
  held.turn.last = batch;
}

function confirm(held, state, stream, frozen) {
  state.nextBatch = frozen.batch + 1;
  for (const uuid of frozen.uuids) remember(state, uuid);
  state.pending = undefined;
  recordTurnBatch(held, stream, frozen.batch);
}

async function sendBatch(held, stream, frozen) {
  const response = await held.call(batchPath(stream, frozen.batch), {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.from(frozen.body),
  });
  if (response.status !== storedStatus)
    throw new Error(
      `the session store refused batch ${String(frozen.batch)} of ${stream} with ${String(response.status)}`,
    );
}

async function appendOnce(held, stream, entries) {
  const state = streamState(held.streams, stream);
  const resent = state.pending;
  // Owed before the resend, because what the pending batch already carries is
  // read off it; planned after, because planning may raise on an entry nothing
  // can post and the unacknowledged batch is still owed either way.
  const owed = owedLines(state, entries);
  if (resent !== undefined) {
    await sendBatch(held, stream, resent);
    confirm(held, state, stream, resent);
  }
  for (const batch of plannedBatches(owed)) {
    const frozen = frozenBatch(state, batch);
    state.pending = frozen;
    await sendBatch(held, stream, frozen);
    confirm(held, state, stream, frozen);
  }
}

async function readPage(held, stream, after) {
  const query = `after=${String(after)}&limit=${String(sessionStorePageBatchesMax)}`;
  const response = await held.call(
    `/v1/session/store/${encodeURIComponent(stream)}?${query}`,
    { method: "GET" },
  );
  if (response.status !== readStatus)
    throw new Error(
      `the session store answered ${String(response.status)} reading ${stream}`,
    );
  return response.json();
}

/** One page's batch, parsed into entries; a batch a row names and nothing can
 * draw is a hole, and a hole refuses the load. */
function takeBatch(state, entries, batch, stream) {
  if (typeof batch.content !== "string")
    throw new Error(
      `batch ${String(batch.batch)} of ${stream} is named by a row and cannot be read`,
    );
  for (const line of batch.content.split("\n")) {
    if (line.length === 0) continue;
    const entry = JSON.parse(line);
    entries.push(entry);
    remember(state, entryUuid(entry));
  }
}

/**
 * One stream's whole transcript, or a refusal. Reaching the page bound with the
 * stream still unexhausted is not a short read to be returned: the runtime would
 * resume over the missing head and append past it, which is the hole this mode
 * exists to prevent.
 */
async function loadStream(held, stream) {
  const state = streamState(held.streams, stream);
  const entries = [];
  let after = 0;
  let highest = 0;
  let exhausted = false;
  for (let page = 0; page < loadPagesMax && !exhausted; page += 1) {
    const read = await readPage(held, stream, after);
    for (const batch of read.batches ?? []) {
      highest = Math.max(highest, batch.batch);
      takeBatch(state, entries, batch, stream);
    }
    if (read.nextAfter === undefined || read.nextAfter === null)
      exhausted = true;
    else after = read.nextAfter;
  }
  if (!exhausted)
    throw new Error(
      `the session store paged ${stream} to its bound and the stream still names more`,
    );
  state.nextBatch = highest + 1;
  return entries.length === 0 ? null : entries;
}

async function listStreamSubkeys(held, sessionId) {
  const response = await held.call(
    `/v1/session/store?stream=${encodeURIComponent(sessionId)}`,
    { method: "GET" },
  );
  if (response.status !== readStatus)
    throw new Error(
      `the session store answered ${String(response.status)} listing ${sessionId}`,
    );
  const prefix = `${sessionId}/`;
  return ((await response.json()).streams ?? [])
    .map(({ stream }) => stream)
    .filter((stream) => stream.startsWith(prefix))
    .map((stream) => stream.slice(prefix.length));
}

/** One session's store, held open for the life of the pod, retained unless it is a fork's. */
export function sessionStoreAdapter(task, bearer, options = {}) {
  const { request = sessionRequest, retain = true } = options;
  const held = {
    streams: new Map(),
    turn: { first: undefined, last: undefined },
    call: (path, init) => request(task, bearer, path, init),
  };
  let chain = Promise.resolve();
  return {
    async append(key, entries) {
      // Named before the mode is read: a key the store cannot name is a fault
      // in either mode, and a discard that swallowed it would hide it.
      const stream = sessionStoreStream(key);
      if (!retain) return undefined;
      const run = chain.then(() => appendOnce(held, stream, entries));
      chain = run.catch(() => undefined);
      return run;
    },

    load(key) {
      return loadStream(held, sessionStoreStream(key));
    },

    listSubkeys(key) {
      return listStreamSubkeys(held, key?.sessionId);
    },

    listSessions() {
      throw new Error("a session pod does not enumerate the store's sessions");
    },

    listSessionSummaries() {
      throw new Error("a session pod does not summarize the store's sessions");
    },

    delete() {
      throw new Error("a session pod does not delete from the store");
    },

    /** The batches of the session's own stream one turn produced, for its answer. */
    turnBatches() {
      return held.turn.first === undefined
        ? {}
        : { batchFirst: held.turn.first, batchLast: held.turn.last };
    },

    startTurn() {
      held.turn.first = undefined;
      held.turn.last = undefined;
    },
  };
}
