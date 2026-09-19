/**
 * The one `chuggy` MCP server a session pod serves in-process, and the capability
 * roster that decides which of its tools a session is given at all.
 *
 * TWO CHANNELS, TOLD APART BY WHAT THEY WRITE. A project tool is a command a
 * console user has: it goes over HTTP to the API under the pod's own session
 * bearer, the API resolves that bearer to the session's principal and authorizes
 * it through the project membership exactly as it authorizes a human's, and the
 * operation row records which session issued it. A decision tool
 *
 * A ROSTER IS NOT A CONTROL. `allowedTools` and `disallowedTools` are enforced
 * by the agent runtime inside the pod, and the pod is the thing being
 * controlled. The two controls that are not the pod's are the membership,
 * enforced by the database when it authorizes a project access, and the
 * decision controls the selector applies to a finished turn — and the second is
 * post-hoc: the tool has already run and its command has already landed, and
 * what the selector refuses is the decision that used it. A control described as
 * stronger than it is, is worse than none.
 *
 * A READ ANSWERS ONE PAGE, WHOLE OR NOT AT ALL. Nothing here walks a
 * collection: the caller's page bound and cursor go through, the route's own
 * body comes back verbatim as JSON text, and the cursor is in the answer for
 * the model to ask again with. A tool that walked would spend the turn's whole
 * token budget on a project's history. A page too large to answer is refused
 * where the model can ask for a smaller one, never cut: a cut JSON document is
 * a page nothing can parse and nothing can resume from.
 *
 * THE TRANSCRIPT READS ARE THE ONE EXCEPTION, and `./transcriptPage.mjs` states
 * why: their route pages by store batch, a batch is bounded by the store's own
 * line bound, and one line is what a whole answer must fit inside. So no page
 * bound a caller could lower makes one of those pages answerable, and a refusal
 * there is a walk that cannot continue. They answer whole entries under the
 * bound and a cursor instead.
 *
 * AN ANSWER IS BOUNDED BY WHAT THE TRANSCRIPT HOLDS, and that is a much tighter
 * bound than the body drawn off the wire. Every answer becomes one `tool_result`
 * entry, `./sessionStore.mjs` mirrors an entry as one line it never splits, and
 * a line over `sessionStoreBatchBytesMax` is a body the plane refuses. The store
 * clips such a line rather than post it, and that is the bound of last resort:
 * the bound here stays because an answer the model can ask again for in pages is
 * a better answer than one the store cut to fit.
 *
 * THE ENTRY CARRIES THE ANSWER TWICE. The line is the on-disk transcript
 * format, and it holds the text in the message's `tool_result` block and again
 * in the entry's own `toolUseResult`. So the bound is what is left of the line
 * after the fixed envelope, divided by the copies — and an answer is weighed as
 * the entry escapes it rather than as it reads, because escaping is what the
 * line is charged for. The entry's shape is the runtime's and this image never
 * composes one, so the suite holds the bound against a captured entry.
 *
 * A WRITE RELAYS THE API'S OUTCOME UNALTERED — the status and the error body, as
 * text. No retry, no repair, no hiding a 409. A tool that decided what a refusal
 * meant would be deciding something the API decided.
 *
 * TICKET ORIGINATION IS A SEPARATE CAPABILITY. `DraftOriginate` admits
 * `create_ticket`; `DraftAuthor` admits update and lifecycle commands for an
 * existing adopted ticket.
 *
 * `zod` IS A PEER DEPENDENCY OF THE AGENT SDK, NOT ONE OF ITS DEPENDENCIES, so
 * nothing here imports it: the shapes are functions of a `z` the caller
 * resolves, and the image's build probe is what proves the peer is installed.
 */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { URLSearchParams } from "node:url";

import {
  chuggyBasePath,
  chuggyBoundedBody,
  chuggyMediaType,
  chuggyRequest,
} from "./chuggyApi.mjs";
import { sessionStoreBatchBytesMax } from "./sessionStore.mjs";
import { transcriptPageAnswer } from "./transcriptPage.mjs";

/** The one MCP server every session is given, and the prefix its tool names carry. */
export const chuggyToolServerName = "chuggy";
export const chuggyToolPrefix = "mcp__chuggy__";

/** The bounds this image writes a second time; `test/contract/imageTools.test.mjs` holds them to the contract's. */
export const chuggyToolResponseBytesMax = 65_536;
export const chuggyToolTimeoutMs = 30_000;
export const chuggyToolPagesMax = 1;
export const nativeHttpPageItemsMax = 100;
export const sessionStorePageBatchesMax = 8;
export const threadTurnsAnsweredMax = 32;

/**
 * How many times the entry the runtime mirrors carries one answer's text. The
 * entry is the on-disk transcript line, and it holds the answer twice: in the
 * `tool_result` block of the message, and again in the entry's own
 * `toolUseResult`. `toolAnswerEntry.fixture.json` is a captured one, and the
 * suite reads the count off it rather than off this line.
 */
export const chuggyToolAnswerCopiesInEntry = 2;

/**
 * What the runtime writes in that entry beside the copies: the call's id, the
 * entry's own uuids, its timestamp, and the session, version, branch and
 * working directory it names. The image never composes that entry, so the
 * reserve is wider than the captured one by more than the whole of it.
 */
export const chuggyToolAnswerEnvelopeBytesMax = 4_096;

/** What one tool answer may weigh, so the entry it becomes is one line of one batch. */
export const chuggyToolAnswerBytesMax = Math.floor(
  (sessionStoreBatchBytesMax - chuggyToolAnswerEnvelopeBytesMax - 1) /
    chuggyToolAnswerCopiesInEntry,
);

/** The argument a paged tool's shape declares, and the only page bound a model can lower. */
export const chuggyToolPageArgument = "limit";

/** The smallest page there is, past which a refusal has nothing left to ask for. */
export const chuggyToolPageItemsMin = 1;

/** The cursors a tool's shape declares, in the order a refusal offers them. */
export const chuggyToolCursorArguments = ["after", "before", "cursor"];

/** How many store batches one transcript read asks for, which is what its answers are cut from. */
export const chuggyTranscriptBatchesRead = 1;

/**
 * What one transcript page may weigh off the wire: that batch re-emitted as
 * entries, and room around it. It is wider than any other read draws because
 * the pod holds this one only long enough to cut it into answers.
 */
export const chuggyTranscriptBodyBytesMax = 4 * sessionStoreBatchBytesMax;

/** What one answer's text weighs as the entry escapes it, which is what the line is charged. */
export function chuggyToolAnswerBytes(text) {
  return Buffer.byteLength(JSON.stringify(text));
}

/**
 * The agent runtime's built-in tools as the pinned CLI names them. A tool a
 * later runtime adds is not in `disallowedTools` until this roster carries it,
 * which is the one thing this file cannot check for itself.
 */
export const sessionBuiltInTools = [
  "Bash",
  "BashOutput",
  "Edit",
  "ExitPlanMode",
  "Glob",
  "Grep",
  "KillShell",
  "NotebookEdit",
  "Read",
  "SlashCommand",
  "Task",
  "TodoWrite",
  "ToolSearch",
  "WebFetch",
  "WebSearch",
  "Write",
];

/** Every chuggy tool the reads channel offers, in the order a roster is read in. */
const projectReadTools = [
  "list_tickets",
  "read_ticket",
  "read_projects",
  "read_lead",
  "read_lead_transcript",
  "read_operation",
  "list_threads",
  "read_thread",
  "read_thread_transcript",
];

const draftAuthorTools = [
  "update_ticket",
  "dispatch_ticket",
  "revoke_ticket",
  "resume_ticket",
];

/** The one tool that files work nothing derived, which a thread holds and a lead does not. */
const draftOriginateTools = ["create_ticket"];

/**
 * Which capability admits which tool. A capability this image does not know
 * admits nothing, and a tool in no list would be a tool nothing gates.
 */
export const sessionCapabilityTools = {
  RepositoryRead: ["Read", "Glob", "Grep"],
  RepositoryWrite: ["Write", "Edit", "NotebookEdit"],
  RunCommands: ["Bash"],
  ProjectRead: projectReadTools,
  DraftAuthor: draftAuthorTools,
  DraftOriginate: draftOriginateTools,
};

/** Every chuggy tool there is, which is every capability's list but the built-ins'. */
export const allChuggyTools = [
  ...projectReadTools,
  ...draftAuthorTools,
  ...draftOriginateTools,
];

/**
 * The qualified names the runtime reports and the allowlist must name, in roster
 * order. The roster is filtered rather than the capabilities walked, so a tool
 * two capabilities admitted would still be named once.
 */
export function chuggyToolNames(capabilities) {
  const admitted = new Set(
    (capabilities ?? []).flatMap((held) => sessionCapabilityTools[held] ?? []),
  );
  return allChuggyTools
    .filter((tool) => admitted.has(tool))
    .map((tool) => `${chuggyToolPrefix}${tool}`);
}

/**
 * What the session may reach for and what it may not, over the whole roster of
 * built-ins and chuggy tools alike, so absence is enforced rather than merely
 * not granted. AN MCP NAME IN NEITHER LIST IS GOVERNED BY `permissionMode`
 * ALONE, which under `bypassPermissions` is no roster at all: naming both lists
 * over both halves is what makes the roster mean anything inside the pod.
 */
export function sessionAllowedTools(capabilities) {
  const admitted = new Set(
    (capabilities ?? []).flatMap((held) => sessionCapabilityTools[held] ?? []),
  );
  const every = [
    ...sessionBuiltInTools,
    ...allChuggyTools.map((tool) => `${chuggyToolPrefix}${tool}`),
  ];
  const held = new Set([
    ...sessionBuiltInTools.filter((tool) => admitted.has(tool)),
    ...chuggyToolNames(capabilities),
  ]);
  return {
    allowedTools: every.filter((tool) => held.has(tool)),
    disallowedTools: every.filter((tool) => !held.has(tool)),
  };
}

function partitionPath(task) {
  return `${chuggyBasePath}/tenants/${encodeURIComponent(task.tenant)}/projects/${encodeURIComponent(task.project)}`;
}

/** A query string built from the fields a caller actually gave, or nothing. */
function search(fields) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value])
      query.append(name, String(one));
  }
  const text = query.toString();
  return text.length === 0 ? "" : `?${text}`;
}

function answered(text, isError) {
  return { content: [{ type: "text", text }], ...(isError ? { isError } : {}) };
}

/**
 * What an answer too large to store is refused with. It ends in what this
 * caller can actually do, which is nothing for a tool with no page bound and
 * nothing again for one already asking for a single item: "ask for a smaller
 * page" is then a dead end dressed as an instruction, and a model reads it as
 * one and asks the same question again.
 */
function answerTooLarge(name, fields, args) {
  return answered(
    `this answer is larger than the ${String(chuggyToolAnswerBytesMax)} bytes one tool answer holds in the transcript; ${answerTooLargeRemedy(name, fields, args)}.`,
    true,
  );
}

function answerTooLargeRemedy(name, fields, args) {
  if (!(chuggyToolPageArgument in fields))
    return `${name} takes no ${chuggyToolPageArgument}, so this one cannot be answered`;
  if (args?.[chuggyToolPageArgument] !== chuggyToolPageItemsMin)
    return `ask again with a smaller ${chuggyToolPageArgument}`;
  const cursor = chuggyToolCursorArguments.find((one) => one in fields);
  return cursor === undefined
    ? `${name} is already asking for one, so this one cannot be answered`
    : `${name} is already asking for one; move past it with ${cursor}`;
}

/**
 * One route's answer as the model reads it: its status, and its body verbatim.
 * A body larger than this draws is cut here and weighed by the handler, which
 * refuses it: the cut text is never answered, because a cut JSON document is a
 * page nothing can parse and nothing can resume from.
 */
async function relay(context, path, init) {
  const response = await context.request(
    context.task,
    context.bearer,
    path,
    init,
  );
  const { text } = await chuggyBoundedBody(
    response,
    chuggyToolResponseBytesMax,
  );
  return answered(
    `HTTP ${String(response.status)}\n${text}`,
    response.status >= 400,
  );
}

function read(context, path) {
  return relay(context, path, { method: "GET" });
}

async function readAdoptedTicket(context, wanted) {
  const response = await context.request(
    context.task,
    context.bearer,
    `${ticketMachinePath(context.task)}/tickets`,
    { method: "GET" },
  );
  const { text } = await chuggyBoundedBody(
    response,
    chuggyToolResponseBytesMax,
  );
  if (response.status >= 400)
    return answered(`HTTP ${String(response.status)}\n${text}`, true);
  try {
    const page = JSON.parse(text);
    const found = page?.tickets?.find((held) => held?.ticket === wanted);
    return found === undefined
      ? answered(`ticket ${String(wanted)} was not found`, true)
      : answered(`HTTP 200\n${JSON.stringify(found)}`);
  } catch {
    return answered("the ticket route answered invalid JSON", true);
  }
}

/**
 * One transcript page, cut to the whole entries this answer can carry. The
 * route's own body is parsed rather than relayed, which is what lets the answer
 * be smaller than the batch the route pages by.
 */
async function readTranscript(context, path, cursor) {
  const response = await context.request(context.task, context.bearer, path, {
    method: "GET",
  });
  const { text, cut } = await chuggyBoundedBody(
    response,
    chuggyTranscriptBodyBytesMax,
  );
  if (response.status >= 400)
    return answered(`HTTP ${String(response.status)}\n${text}`, true);
  if (cut)
    return answered(
      `this transcript page is larger than the ${String(chuggyTranscriptBodyBytesMax)} bytes one read draws off the wire, so it cannot be answered.`,
      true,
    );
  let page;
  try {
    page = JSON.parse(text);
  } catch {
    return answered(
      "the transcript route answered a body this read could not parse.",
      true,
    );
  }
  return answered(
    transcriptPageAnswer(
      page,
      cursor,
      (composed) => chuggyToolAnswerBytes(composed) <= chuggyToolAnswerBytesMax,
    ),
  );
}

function write(context, path, method, body, headers = {}) {
  return relay(context, path, {
    method,
    headers: { "content-type": chuggyMediaType, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function writeTicketYaml(context, path, method, source, headers) {
  return relay(context, path, {
    method,
    headers: { "content-type": "application/yaml", ...headers },
    body: source,
  });
}

function ticketMachinePath(task) {
  return `${partitionPath(task)}/ticket-machine`;
}

/**
 * The identity a submitted command carries, minted from the turn and the command
 * itself, so a tool call the model repeats within one turn is the same operation
 * replayed rather than a second one accepted.
 */
export function chuggyOperationIdentity(turn, mutation) {
  return `session-${createHash("sha256")
    .update(`${turn}\u0000${JSON.stringify(mutation)}`)
    .digest("hex")}`;
}

function claimedTurn(context) {
  const turn = context.turn();
  if (typeof turn !== "string" || turn.length === 0)
    throw new Error("no turn is claimed, so no command may be submitted");
  return turn;
}

const ticket = (z) => z.number().int().min(1);
const limit = (z, max) => z.number().int().min(1).max(max).optional();
const count = (z) => z.number().int().min(0);
const identity = (z) => z.string().min(1).max(256);
/** A position in a mailbox, which is counted from one and never from zero. */
const ordinal = (z) => z.number().int().min(1);
/**
 * A JSON object this tool passes through and the API's own schema is the
 * authority on. IT IS `looseObject` AND NOT `record`: the runtime converts a
 * shape to JSON schema when it lists its tools, its converter throws on a zod
 * record, and a server whose listing throws reports itself connected and offers
 * the model no tools at all. `images/worker/toolProbe.mjs` is what holds that
 * shut at build time.
 */

/**
 * The tools whose route this installation's API does not serve yet, and what
 * serves each when it lands.
 *
 * RELAYING THE 404 WOULD BE A LIE THE MODEL CANNOT SEE THROUGH. Every one of
 * these paths answers the same `404` a missing project answers, so a lead told
 * only the status reads "this project has no refusals" where the truth is "this
 * installation cannot answer that yet" — and it decides on the first. A stated
 * refusal is the honest answer, and it names the tool to reach for instead.
 *
 * IT IS ONE TABLE SO IT IS ONE DELETION. Each entry goes in the change that
 * registers its route; an entry left behind is a tool that refuses a route that
 * works, which the first turn against a served installation shows. Nothing here
 * can check that for itself — the image reaches nothing under `src/`, and the
 * route table is built by an app this repo's suites do not stand up — so the
 * suites hold what they can: every key is a tool the roster carries, every tool
 * named here refuses before it makes a request, and no tool outside it does.
 */
export const chuggyToolsNotYetServed = {
  read_lead: "The lead session cannot be read by this installation yet.",
  read_lead_transcript:
    "The lead's own transcript cannot be read by this installation yet.",
};

/**
 * Every project tool: its name, the shape its input is checked against at the
 * boundary, and the one route it reaches. It is a value rather than a function
 * because it is a roster, and a roster read twice must read the same both
 * times; it is exported so a suite can drive the route one tool builds even
 * where `chuggyToolsNotYetServed` is what a session's handler answers.
 */
export const chuggyProjectTools = [
  {
    name: "list_tickets",
    description:
      "The adopted ticket graph: every ticket's revision, state, dependencies and work cycles.",
    shape: () => ({}),
    call: (context) =>
      read(context, `${ticketMachinePath(context.task)}/tickets`),
  },
  {
    name: "read_ticket",
    description:
      "One adopted ticket from the current graph: its revision, state, dependencies and work cycles.",
    shape: (z) => ({ ticket: ticket(z) }),
    call: (context, args) => readAdoptedTicket(context, args.ticket),
  },
  {
    name: "read_projects",
    description: "One page of the projects this session's membership can see.",
    shape: (z) => ({
      cursor: identity(z).optional(),
      limit: limit(z, nativeHttpPageItemsMax),
    }),
    call: (context, { cursor, limit: pageLimit }) =>
      read(
        context,
        `${chuggyBasePath}/projects${search({ cursor, limit: pageLimit })}`,
      ),
  },
  {
    name: "read_lead",
    description:
      "This project's lead session: its state, its mailbox tail and its transcript streams.",
    shape: () => ({}),
    call: (context) => read(context, `${partitionPath(context.task)}/lead`),
  },
  {
    name: "read_lead_transcript",
    description:
      "One page of the lead's own raw transcript, which is how it reads past its own compaction. A page read answers JSON: `entries` whole where they fit, an entry too large as {uuid, type, bytes, preview}, and `next` — pass its `after` and `entry` back for the page after this one. A read that fails answers the reason instead.",
    shape: (z) => ({
      stream: identity(z).optional(),
      after: count(z).optional(),
      entry: count(z).optional(),
    }),
    call: (context, { stream, after, entry }) =>
      readTranscript(
        context,
        `${partitionPath(context.task)}/lead/transcript${search({ stream, after, limit: chuggyTranscriptBatchesRead })}`,
        { after: after ?? 0, entry: entry ?? 0 },
      ),
  },
  {
    name: "read_operation",
    description:
      "One submitted operation's outcome. This is the only way to learn what a command did.",
    shape: (z) => ({ operation: identity(z) }),
    call: (context, { operation }) =>
      read(
        context,
        `${ticketMachinePath(context.task)}/operations${search({ identity: operation })}`,
      ),
  },
  {
    name: "list_threads",
    description:
      "The member threads open on this project: whose each is, its state, and whether it is this session's own.",
    shape: () => ({}),
    call: (context) => read(context, `${partitionPath(context.task)}/threads`),
  },
  {
    name: "read_thread",
    description:
      "One page of a member thread, newest turn last: whose it is, its state, and that much of its conversation. Answers `nextBefore` for the page before this one; `before` resumes from it.",
    shape: (z) => ({
      session: identity(z),
      before: ordinal(z).optional(),
      limit: limit(z, threadTurnsAnsweredMax),
    }),
    call: (context, { session, before, limit: pageLimit }) =>
      read(
        context,
        `${partitionPath(context.task)}/threads/${encodeURIComponent(session)}${search({ before, limit: pageLimit })}`,
      ),
  },
  {
    name: "read_thread_transcript",
    description:
      "One page of a thread's own raw transcript, which is how it reads past its own compaction. A page read answers JSON: `entries` whole where they fit, an entry too large as {uuid, type, bytes, preview}, and `next` — pass its `after` and `entry` back for the page after this one. A read that fails answers the reason instead.",
    shape: (z) => ({
      session: identity(z),
      stream: identity(z).optional(),
      after: count(z).optional(),
      entry: count(z).optional(),
    }),
    call: (context, { session, stream, after, entry }) =>
      readTranscript(
        context,
        `${partitionPath(context.task)}/threads/${encodeURIComponent(session)}/transcript${search({ stream, after, limit: chuggyTranscriptBatchesRead })}`,
        { after: after ?? 0, entry: entry ?? 0 },
      ),
  },
  {
    name: "create_ticket",
    description:
      "Creates an adopted ticket from version-2 ticket YAML at an exact catalog commit. Answers a stable operation identity; poll it with read_operation.",
    shape: (z) => ({
      source: z.string().min(1),
      catalogCommit: identity(z),
      repository: identity(z).optional(),
    }),
    call: (context, args) => {
      const operation = chuggyOperationIdentity(claimedTurn(context), {
        mutation: "CreateTicket",
        ...args,
      });
      return writeTicketYaml(
        context,
        `${ticketMachinePath(context.task)}/tickets`,
        "POST",
        args.source,
        {
          "idempotency-key": operation,
          "x-chug-catalog-commit": args.catalogCommit,
          ...(args.repository === undefined
            ? {}
            : { "x-chug-repository": args.repository }),
        },
      );
    },
  },
  {
    name: "update_ticket",
    description:
      "Replaces an adopted ticket definition with version-2 ticket YAML, fenced by its revision and pinned catalog commit. Poll the returned operation with read_operation.",
    shape: (z) => ({
      ticket: ticket(z),
      expectedRevision: ticket(z),
      source: z.string().min(1),
      catalogCommit: identity(z),
      repository: identity(z).optional(),
    }),
    call: (context, args) => {
      const operation = chuggyOperationIdentity(claimedTurn(context), {
        mutation: "UpdateTicket",
        ...args,
      });
      return writeTicketYaml(
        context,
        `${ticketMachinePath(context.task)}/tickets/${String(args.ticket)}`,
        "PUT",
        args.source,
        {
          "idempotency-key": operation,
          "if-match": String(args.expectedRevision),
          "x-chug-catalog-commit": args.catalogCommit,
          ...(args.repository === undefined
            ? {}
            : { "x-chug-repository": args.repository }),
        },
      );
    },
  },
  ...["dispatch", "revoke", "resume"].map((action) => ({
    name: `${action}_ticket`,
    description: `${action[0].toUpperCase()}${action.slice(1)}s one adopted ticket. Poll the returned operation with read_operation.`,
    shape: (z) => ({
      ticket: ticket(z),
      ...(action === "dispatch"
        ? { repository: identity(z), commit: identity(z) }
        : {}),
    }),
    call: (context, args) => {
      const operation = chuggyOperationIdentity(claimedTurn(context), {
        mutation: `${action[0].toUpperCase()}${action.slice(1)}Ticket`,
        ...args,
      });
      return write(
        context,
        `${ticketMachinePath(context.task)}/tickets/${String(args.ticket)}/${action}`,
        "POST",
        action === "dispatch"
          ? { repository: args.repository, commit: args.commit }
          : {},
        { "idempotency-key": operation },
      );
    },
  })),
];

/**
 * Every tool this session holds, project and decision alike, filtered by the
 * capability roster its row carries. A tool the roster does not admit is not
 * registered at all, so the runtime's own tool list is the proof rather than
 * this source.
 */
export function chuggyToolDefinitions(context) {
  const admitted = new Set(
    (context.capabilities ?? []).flatMap(
      (held) => sessionCapabilityTools[held] ?? [],
    ),
  );
  const project = chuggyProjectTools.map((definition) => ({
    ...definition,
    call: (args) => {
      const unserved = chuggyToolsNotYetServed[definition.name];
      return unserved === undefined
        ? definition.call(context, args)
        : answered(unserved, true);
    },
  }));
  return project.filter((definition) => admitted.has(definition.name));
}

/**
 * One answer, or the refusal that replaces it where the entry it becomes would
 * not fit one of the store's lines. Refusing here is what keeps the answer the
 * model reads and the line the store writes the same thing.
 */
function storableAnswer(definition, fields, args, answer) {
  const text = (answer.content ?? [])
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .join("");
  return chuggyToolAnswerBytes(text) <= chuggyToolAnswerBytesMax
    ? answer
    : answerTooLarge(definition.name, fields, args);
}

/**
 * One tool's handler: its input checked against its own shape, then the call,
 * with every raise answered as text the model reads rather than thrown into the
 * runtime.
 *
 * THE CHECK IS HERE AND NOT ONLY IN THE RUNTIME. The shape is what the runtime
 * publishes and what it validates against, but a bound enforced only by the
 * thing being controlled is a bound this tree does not count; parsing here is
 * what makes the bound a property a suite can drive.
 *
 * A DECISION TOOL ANSWERS TEXT AND THE PROTOCOL ANSWERS AN OBJECT, so text is
 * wrapped here rather than at each call. A bare string reaches the model as an
 * invalid tool result naming a type mismatch — and it reaches it after the
 * call's side effect is staged, so the lead is told its dispatch errored by the
 * very call that staged it, and may dispatch again or report a failure that did
 * not happen.
 *
 * AND IT IS WHERE AN ANSWER IS WEIGHED, because it is the one boundary every
 * tool's answer crosses and the one place the tool that produced it is known.
 * Both returns go through the weighing: a raise the model reads is an answer
 * like any other, and the header would otherwise claim a property the code does
 * not hold.
 */
export function chuggyToolHandler(definition, z) {
  // The shape the model is given is also what says whether this tool pages and
  // what it is paged by: a roster stating that beside it would be a second
  // answer to a question the shape answers, and the two would part.
  const fields = definition.shape(z);
  const shape = z.object(fields);
  return async (args) => {
    let given = args ?? {};
    try {
      given = shape.parse(given);
      const answer = await definition.call(given);
      return storableAnswer(
        definition,
        fields,
        given,
        typeof answer === "string" ? answered(answer) : answer,
      );
    } catch (failure) {
      return storableAnswer(
        definition,
        fields,
        given,
        answered(
          failure instanceof Error ? failure.message : String(failure),
          true,
        ),
      );
    }
  };
}

/**
 * The in-process server the query is opened with. `timeout` is not optional: a
 * tool call is otherwise effectively unbounded, and an unbounded one is a turn
 * that never reaches its deadline.
 */
export function chuggyToolServer(context, sdk) {
  return sdk.createSdkMcpServer({
    name: chuggyToolServerName,
    version: context.version,
    timeout: chuggyToolTimeoutMs,
    tools: chuggyToolDefinitions(context).map((definition) =>
      sdk.tool(
        definition.name,
        definition.description,
        definition.shape(sdk.z),
        chuggyToolHandler(definition, sdk.z),
      ),
    ),
  });
}

/** What one session's tools are held in. */
export function chuggyToolContext(task, bearer, services = {}) {
  return {
    task,
    bearer,
    capabilities: services.capabilities ?? [],
    version: services.version ?? "1",
    request: services.request ?? chuggyRequest,
    turn: services.turn ?? (() => undefined),
  };
}
