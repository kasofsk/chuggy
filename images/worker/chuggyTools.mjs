/**
 * The one `chuggy` MCP server a session pod serves in-process, and the capability
 * roster that decides which of its tools a session is given at all.
 *
 * TWO CHANNELS, TOLD APART BY WHAT THEY WRITE. A project tool is a command a
 * console user has: it goes over HTTP to the API under the pod's own session
 * bearer, the API resolves that bearer to the session's principal and authorizes
 * it through the project membership exactly as it authorizes a human's, and the
 * operation row records which session issued it. A decision tool
 * (`./leadDecision.mjs`) writes nothing at all.
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
 * A READ ANSWERS ONE PAGE. Nothing here walks a collection: the caller's page
 * bound and cursor go through, the route's own body comes back verbatim as JSON
 * text cut at `chuggyToolResponseBytesMax`, and the cursor is in the answer for
 * the model to ask again with. A tool that walked would spend the turn's whole
 * token budget on a project's history.
 *
 * A WRITE RELAYS THE API'S OUTCOME UNALTERED — the status and the error body, as
 * text. No retry, no repair, no hiding a 409. A tool that decided what a refusal
 * meant would be deciding something the API decided.
 *
 * DERIVED WORK ONLY IS WHAT `DraftAuthor` ADMITS. `file_dependent` files
 * against a parent that already exists and carries it in the draft's
 * dependencies; a roster holding `DraftAuthor` alone cannot originate work.
 * Origination is `create_draft` under `DraftOriginate` alone. Which capability
 * a session is opened with is the provisioning root's, not this image's, so
 * what is true here is the mapping: a roster without `DraftOriginate` cannot
 * reach the tool, and the derived-work rule is that mapping rather than a
 * sentence in a description.
 * `Prerequisite` is admitted by the schema only so its refusal can name the
 * reason — a released ticket's dependencies are immutable in
 * `model/domain.qnt`, which names re-authoring machinery as deliberately absent.
 *
 * `zod` IS A PEER DEPENDENCY OF THE AGENT SDK, NOT ONE OF ITS DEPENDENCIES, so
 * nothing here imports it: the shapes are functions of a `z` the caller
 * resolves, and the image's build probe is what proves the peer is installed.
 */

import { createHash } from "node:crypto";
import { URLSearchParams } from "node:url";

import {
  chuggyBasePath,
  chuggyBoundedBody,
  chuggyMediaType,
  chuggyRequest,
} from "./chuggyApi.mjs";
import { leadDecisionStaging, leadDecisionToolNames } from "./leadDecision.mjs";

/** The one MCP server every session is given, and the prefix its tool names carry. */
export const chuggyToolServerName = "chuggy";
export const chuggyToolPrefix = "mcp__chuggy__";

/** The bounds this image writes a second time; `test/contract/imageTools.test.mjs` holds them to the contract's. */
export const chuggyToolResponseBytesMax = 65_536;
export const chuggyToolTimeoutMs = 30_000;
export const chuggyToolPagesMax = 1;
export const nativeHttpPageItemsMax = 100;
export const selectorHistoryLimitMax = 50;
export const agenticRefusalsAnsweredMax = 32;
export const sessionStorePageBatchesMax = 8;
export const threadTurnsAnsweredMax = 32;

/** The relation a filed dependent may carry, and the one it may not. */
export const allDependentRelations = ["FollowUp", "Prerequisite"];
export const dependentRelationsAdmitted = ["FollowUp"];

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
  "WebFetch",
  "WebSearch",
  "Write",
];

/** Every chuggy tool the reads channel offers, in the order a roster is read in. */
const projectReadTools = [
  "list_tickets",
  "read_ticket",
  "read_draft",
  "list_drafts",
  "list_configurations",
  "read_configuration",
  "read_decision_log",
  "read_refusals",
  "read_ticket_refusals",
  "read_projects",
  "read_lead",
  "read_lead_transcript",
  "list_executions",
  "read_execution",
  "read_run_transcript",
  "read_operation",
  "list_threads",
  "read_thread",
  "read_thread_transcript",
];

const draftAuthorTools = [
  "initialize_draft",
  "file_dependent",
  "revise_draft",
  "delete_draft",
  "release_draft",
];

/** The one tool that files work nothing derived, which a thread holds and a lead does not. */
const draftOriginateTools = ["create_draft"];

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
  LeadDecision: leadDecisionToolNames,
};

/** Every chuggy tool there is, which is every capability's list but the built-ins'. */
export const allChuggyTools = [
  ...projectReadTools,
  ...draftAuthorTools,
  ...draftOriginateTools,
  ...leadDecisionToolNames,
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

/** One route's answer as the model reads it: its status, and its body verbatim. */
async function relay(context, path, init) {
  const response = await context.request(
    context.task,
    context.bearer,
    path,
    init,
  );
  const { text, cut } = await chuggyBoundedBody(
    response,
    chuggyToolResponseBytesMax,
  );
  const head = `HTTP ${String(response.status)}`;
  const tail = cut
    ? `\n\n[cut at ${String(chuggyToolResponseBytesMax)} bytes]`
    : "";
  return answered(`${head}\n${text}${tail}`, response.status >= 400);
}

function read(context, path) {
  return relay(context, path, { method: "GET" });
}

function write(context, path, method, body, headers = {}) {
  return relay(context, path, {
    method,
    headers: { "content-type": chuggyMediaType, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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
const anyObject = (z) => z.looseObject({});

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
  read_decision_log:
    "This project's decision log cannot be read by this installation yet.",
  read_refusals:
    "This project's standing refusals cannot be read by this installation yet. This turn's observation carries them.",
  read_ticket_refusals:
    "A ticket's refusal ledger cannot be read by this installation yet. This turn's observation carries the standing refusals.",
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
      "One page of this project's tickets, ascending by number. Answers `nextAfter` for the next page; `after` resumes from it.",
    shape: (z) => ({
      after: ticket(z).optional(),
      limit: limit(z, nativeHttpPageItemsMax),
      phase: z.array(z.string().min(1)).max(16).optional(),
    }),
    call: (context, { after, limit: pageLimit, phase }) =>
      read(
        context,
        `${partitionPath(context.task)}${search({ after, limit: pageLimit, phase })}`,
      ),
  },
  {
    name: "read_ticket",
    description:
      "One ticket: its phase, its version, its authoring and its brief.",
    shape: (z) => ({ ticket: ticket(z) }),
    call: (context, args) =>
      read(
        context,
        `${partitionPath(context.task)}/tickets/${String(args.ticket)}`,
      ),
  },
  {
    name: "read_draft",
    description:
      "One draft still open on this project, by the ticket number it holds.",
    shape: (z) => ({ ticket: ticket(z) }),
    call: (context, args) =>
      read(
        context,
        `${partitionPath(context.task)}/drafts/${String(args.ticket)}`,
      ),
  },
  {
    name: "list_drafts",
    description:
      "One page of the drafts this project still holds open, ascending by ticket.",
    shape: (z) => ({
      limit: limit(z, nativeHttpPageItemsMax),
      cursor: identity(z).optional(),
    }),
    call: (context, { cursor, limit: pageLimit }) =>
      read(
        context,
        `${partitionPath(context.task)}/drafts${search({ cursor, limit: pageLimit })}`,
      ),
  },
  {
    name: "list_configurations",
    description:
      "One page of this project's configuration revisions, newest first, with the cursor for the next.",
    shape: (z) => ({
      cursor: identity(z).optional(),
      limit: limit(z, nativeHttpPageItemsMax),
    }),
    call: (context, { cursor, limit: pageLimit }) =>
      read(
        context,
        `${partitionPath(context.task)}/configurations${search({ cursor, limit: pageLimit })}`,
      ),
  },
  {
    name: "read_configuration",
    description:
      "One configuration revision, canonical, as a draft is authored against it.",
    shape: (z) => ({ revision: identity(z) }),
    call: (context, { revision }) =>
      read(
        context,
        `${partitionPath(context.task)}/configurations/${encodeURIComponent(revision)}`,
      ),
  },
  {
    name: "read_decision_log",
    description:
      "One page of this project's past selector decisions, newest first: what each chose and under which settings.",
    shape: (z) => ({
      after: count(z).optional(),
      limit: limit(z, selectorHistoryLimitMax),
    }),
    call: (context, { after, limit: pageLimit }) =>
      read(
        context,
        `${partitionPath(context.task)}/selector-history${search({ after, limit: pageLimit })}`,
      ),
  },
  {
    name: "read_refusals",
    description:
      "The refusals standing across this project, with the ticket version each names.",
    shape: (z) => ({ limit: limit(z, agenticRefusalsAnsweredMax) }),
    call: (context, { limit: pageLimit }) =>
      read(
        context,
        `${partitionPath(context.task)}/agentic-refusals${search({ limit: pageLimit })}`,
      ),
  },
  {
    name: "read_ticket_refusals",
    description:
      "One ticket's whole refusal ledger: every refusal recorded on it and every lift.",
    shape: (z) => ({ ticket: ticket(z) }),
    call: (context, args) =>
      read(
        context,
        `${partitionPath(context.task)}/tickets/${String(args.ticket)}/agentic-refusals`,
      ),
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
      "One page of the lead's own raw transcript, which is how it reads past its own compaction.",
    shape: (z) => ({
      stream: identity(z).optional(),
      after: count(z).optional(),
      limit: limit(z, sessionStorePageBatchesMax),
    }),
    call: (context, { stream, after, limit: pageLimit }) =>
      read(
        context,
        `${partitionPath(context.task)}/lead/transcript${search({ stream, after, limit: pageLimit })}`,
      ),
  },
  {
    name: "list_executions",
    description:
      "One page of this project's executions, narrowed by ticket or by state.",
    shape: (z) => ({
      ticket: ticket(z).optional(),
      state: z.array(z.string().min(1)).max(16).optional(),
      cursor: identity(z).optional(),
      limit: limit(z, nativeHttpPageItemsMax),
    }),
    call: (context, { ticket: onTicket, state, cursor, limit: pageLimit }) =>
      read(
        context,
        `${partitionPath(context.task)}/executions${search({ ticket: onTicket, state, cursor, limit: pageLimit })}`,
      ),
  },
  {
    name: "read_execution",
    description:
      "One execution: its ticket, its attempts, its state and its outcome.",
    shape: (z) => ({ execution: identity(z) }),
    call: (context, { execution }) =>
      read(
        context,
        `${partitionPath(context.task)}/executions/${encodeURIComponent(execution)}`,
      ),
  },
  {
    name: "read_run_transcript",
    description:
      "One page of one attempt's run transcript, from the batch after the one named.",
    shape: (z) => ({
      execution: identity(z),
      attempt: identity(z),
      after: count(z).optional(),
    }),
    call: (context, { execution, attempt, after }) =>
      read(
        context,
        `${partitionPath(context.task)}/executions/${encodeURIComponent(execution)}/attempts/${encodeURIComponent(attempt)}/transcript${search({ after })}`,
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
        `${partitionPath(context.task)}/operations/${encodeURIComponent(operation)}`,
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
      "One page of a thread's own raw transcript, which is how it reads past its own compaction.",
    shape: (z) => ({
      session: identity(z),
      stream: identity(z).optional(),
      after: count(z).optional(),
      limit: limit(z, sessionStorePageBatchesMax),
    }),
    call: (context, { session, stream, after, limit: pageLimit }) =>
      read(
        context,
        `${partitionPath(context.task)}/threads/${encodeURIComponent(session)}/transcript${search({ stream, after, limit: pageLimit })}`,
      ),
  },
  {
    name: "initialize_draft",
    description:
      "The defaults, the dependency candidates and the fence a new draft is filed against, for one configuration revision.",
    shape: (z) => ({ revision: identity(z) }),
    call: (context, { revision }) =>
      read(
        context,
        `${partitionPath(context.task)}/draft-initializations/${encodeURIComponent(revision)}`,
      ),
  },
  {
    name: "file_dependent",
    description:
      "Files a new draft derived from an existing ticket. `relation` admits FollowUp only, and `authoring.dependencies` must carry the parent. The fence comes from initialize_draft.",
    shape: (z) => ({
      parent: ticket(z),
      relation: z.enum(allDependentRelations),
      configurationRevision: identity(z),
      configurationDigest: identity(z),
      expectedProjectSequence: count(z),
      authoring: anyObject(z),
      brief: anyObject(z),
    }),
    call: (context, args) => {
      if (!dependentRelationsAdmitted.includes(args.relation))
        return answered(
          `${args.relation} is not derivable: a released ticket's dependencies are immutable in this machine, so ticket ${String(args.parent)} cannot come to depend on a new one. File a FollowUp instead; a prerequisite of a ticket still in draft is a revise_draft of that draft's dependencies.`,
          true,
        );
      const dependencies = args.authoring?.dependencies;
      if (!Array.isArray(dependencies) || !dependencies.includes(args.parent))
        return answered(
          `a dependent must carry its parent: authoring.dependencies does not name ticket ${String(args.parent)}.`,
          true,
        );
      return write(context, `${partitionPath(context.task)}/drafts`, "POST", {
        configurationRevision: args.configurationRevision,
        configurationDigest: args.configurationDigest,
        expectedProjectSequence: args.expectedProjectSequence,
        authoring: args.authoring,
        brief: args.brief,
      });
    },
  },
  {
    name: "revise_draft",
    description:
      "Replaces one open draft's authoring and brief, fenced on the version read.",
    shape: (z) => ({
      ticket: ticket(z),
      expectedVersion: count(z),
      configurationRevision: identity(z),
      authoring: anyObject(z),
      brief: anyObject(z),
    }),
    call: (context, args) =>
      write(
        context,
        `${partitionPath(context.task)}/drafts/${String(args.ticket)}`,
        "PUT",
        {
          expectedVersion: args.expectedVersion,
          configurationRevision: args.configurationRevision,
          authoring: args.authoring,
          brief: args.brief,
        },
      ),
  },
  {
    name: "delete_draft",
    description: "Deletes one open draft, fenced on the version read.",
    shape: (z) => ({ ticket: ticket(z), expectedVersion: count(z) }),
    call: (context, args) =>
      write(
        context,
        `${partitionPath(context.task)}/drafts/${String(args.ticket)}${search({ expectedVersion: args.expectedVersion })}`,
        "DELETE",
      ),
  },
  {
    name: "release_draft",
    description:
      "Submits the release of one draft. Answers an accepted operation and its id, never an outcome: read that with read_operation.",
    shape: (z) => ({
      ticket: ticket(z),
      authoringVersion: count(z),
      configurationRevision: identity(z),
    }),
    call: (context, args) => {
      const mutation = {
        mutation: "ReleaseDraft",
        ticket: args.ticket,
        authoringVersion: args.authoringVersion,
        configurationRevision: args.configurationRevision,
      };
      const operation = chuggyOperationIdentity(claimedTurn(context), mutation);
      return write(
        context,
        `${partitionPath(context.task)}/operations`,
        "POST",
        { operation, mutation },
        { "idempotency-key": operation },
      );
    },
  },
  {
    name: "create_draft",
    description:
      "Files a new draft for work your owner asked for, derived from nothing. The fence comes from initialize_draft.",
    shape: (z) => ({
      configurationRevision: identity(z),
      configurationDigest: identity(z),
      expectedProjectSequence: count(z),
      authoring: anyObject(z),
      brief: anyObject(z),
    }),
    call: (context, args) =>
      write(context, `${partitionPath(context.task)}/drafts`, "POST", {
        configurationRevision: args.configurationRevision,
        configurationDigest: args.configurationDigest,
        expectedProjectSequence: args.expectedProjectSequence,
        authoring: args.authoring,
        brief: args.brief,
      }),
  },
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
  return [...project, ...context.staging.definitions].filter((definition) =>
    admitted.has(definition.name),
  );
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
 */
export function chuggyToolHandler(definition, z) {
  const shape = z.object(definition.shape(z));
  return async (args) => {
    try {
      return await definition.call(shape.parse(args ?? {}));
    } catch (failure) {
      return answered(
        failure instanceof Error ? failure.message : String(failure),
        true,
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

/** What one session's tools are held in: its task, its bearer, and this turn's staging. */
export function chuggyToolContext(task, bearer, services = {}) {
  return {
    task,
    bearer,
    capabilities: services.capabilities ?? [],
    version: services.version ?? "1",
    request: services.request ?? chuggyRequest,
    turn: services.turn ?? (() => undefined),
    staging: services.staging ?? leadDecisionStaging(),
  };
}
