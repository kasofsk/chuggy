/**
 * The routes: what the desk answers, who it answers, and what it does with a
 * refusal.
 *
 * EVERY WRITE GOES THROUGH THE INBOUND FACE, and enablement's refusal is the
 * answer rather than something recovered from. A `Dropped` submission comes
 * back as a conflict carrying the machine's own reason verbatim, so a caller
 * reads why the machine declined instead of a sentence this layer invented
 * about it. Nothing here consults an enablement predicate before submitting:
 * the forms offer what is enabled, and the decision re-checks it.
 *
 * ONE ROUTE TABLE, TWO RENDERINGS. A caller that accepts markup gets a page and
 * the classic redirect after a write; anything else gets JSON. Two tables would
 * be two sets of refusals, and the pair would drift on the first route only one
 * of them grew.
 *
 * THE ADMIN GATE IS AN ESCAPE HATCH AND IS GUARDED AS ONE. `gateOutcome` is the
 * answer a performer would have given for the ticket holding the lease, so a
 * hand reaching it is a hand finishing a wrap-up nothing else finished — and it
 * is refused to anyone the registry did not mark an operator.
 *
 * `SameSite` IS WHAT STANDS BETWEEN THE WRITE ROUTES AND A FORGED POST, and it
 * is named here because it is the only thing that does. Reading a body as JSON
 * whatever content type it claimed is what lets a cross-site form post reach
 * these routes at all, so the session cookie is what must not travel with one;
 * a bearer caller sends no cookie and is not exposed either way.
 *
 * ARRIVALS ARE SERIALIZED, for one reason: the id an arrival made is the dense
 * id the core grew, and reading it back is only exact while no other arrival
 * can be journaled between the decision and the read. The drive as it stands
 * resolves a submission before the next one decides, so the window is shut
 * twice over today — but that ordering is the drive's business and not a
 * promise `Inbound` makes, so the desk holds it shut itself. The chain belongs
 * to `httpApiSerialArrivals` and the arrival is reachable through nothing else,
 * which is what makes the serialization a property of the call graph rather
 * than a wrapper someone can drop.
 *
 * THE ANNEX WRITE IS THE SECOND OF TWO WRITES and is deliberately not welded to
 * the first: a crash between them leaves the draft standing with no annex,
 * which the board renders and its author can write again.
 *
 * THE JOB BAND ANSWERS BEFORE THE DESK READS A BODY OR LOOKS FOR A PERSON. A
 * worker is not a caller the registry holds a row for, so a completion is
 * admitted by a token minted for exactly the ticket's task its path names and by
 * nothing else. It reads its own body too: a declaration is a nested value where
 * the desk's fields are flat, and `httpApiFields` would refuse it before any
 * route saw it.
 *
 * THE ARTIFACT WRITE PRECEDES THE DECISION AND THE ACK FOLLOWS BOTH. A crash
 * between the two leaves a body no journal mentions, which nothing can reach —
 * the producing task of a mark is derived from the journal — where the reverse
 * order would journal a pass whose artifact was lost. So the write is
 * unconditional: a route asking enablement first, to decide whether to store,
 * would be the second decider this file has none of.
 *
 * A DROPPED COMPLETION IS ANSWERED 200 WHERE A DROPPED DESK ACT IS ANSWERED 409.
 * The desk's caller is a person who can go and do something else; a worker
 * re-delivers at least once and would loop on a 4xx forever, so the drop is
 * handed back as the answer it is and the delivery duty ends there.
 */

import {
  asTaskId,
  asTicketId,
  type TaskId,
  type TicketId,
} from "../../domain/ids.ts";
import {
  deliverableTaskIds,
  dependableIn,
  wrapUpOutcomes,
} from "../../domain/enablement.ts";
import {
  projects,
  wrapUpChoices,
  defaultProgram,
} from "../../domain/config.ts";
import type { Config } from "../../domain/config.ts";
import type { Core } from "../../domain/core.ts";
import { assertNever } from "../../domain/assertNever.ts";
import {
  parseDeclaration,
  type CompletionDeclaration,
} from "../../interpreter/artifact.ts";
import type { Inbound, Submitted } from "../../interpreter/inbound.ts";
import type {
  DeskLog,
  Registry,
  RegistryUser,
} from "../../interpreter/registry.ts";
import type { Parsed } from "../../interpreter/wire.ts";
import { httpApiArrival, httpApiWholeNumber } from "./arrival.ts";
import type { HttpApiArtifacts } from "./artifacts.ts";
import { htmlBoard, htmlLogin, htmlRefusal, htmlTicket } from "./html.ts";
import {
  identityCaller,
  identityCookieName,
  identityTokenIn,
  identityVerify,
  type Caller,
  type Identity,
} from "./identity.ts";
import { httpApiJobTokenHolds } from "./jobToken.ts";
import {
  httpApiBodyJson,
  httpApiField,
  httpApiFields,
  type HttpApiFields,
} from "./request.ts";
import { deskActions, viewBoard, viewTicket, type DeskAction } from "./view.ts";

/** Everything the face is handed: the machine's face and read, the stores it joins, and who it verifies against. */
export interface HttpApiDesk {
  readonly config: Config;
  readonly inbound: Inbound;
  readonly core: () => Core;
  readonly registry: Registry;
  readonly deskLog: DeskLog;
  readonly artifacts: HttpApiArtifacts;
  readonly identity: Identity;
  readonly oauthClientId: string;
  readonly jobSecret: string;
}

/** One request, as the headers and the body the transport already read. */
export interface HttpApiRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly cookie: string | undefined;
  readonly accept: string | undefined;
  readonly contentType: string;
  readonly body: string;
}

/** One answer: the status, the headers, and the body. */
export interface HttpApiAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** What the transport calls once it has read a request. */
export type HttpApiRouter = (request: HttpApiRequest) => Promise<HttpApiAnswer>;

/** How long a session cookie outlives the token it carries, which is shorter than the token's own life. */
const httpApiSessionSecondsMax = 3600;

/** Whether the caller asked for markup; anything else is answered as JSON. */
function httpApiWantsPage(request: HttpApiRequest): boolean {
  return (request.accept ?? "").includes("text/html");
}

/** A JSON answer. */
function httpApiJson(status: number, value: unknown): HttpApiAnswer {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(value),
  };
}

/** A rendered answer. */
function httpApiPage(status: number, body: string): HttpApiAnswer {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
    body,
  };
}

/** The redirect a browser follows after a write, so a reload does not resubmit it. */
function httpApiSeeOther(location: string): HttpApiAnswer {
  return { status: 303, headers: { location }, body: "" };
}

/** A refusal, in whichever rendering the caller asked for, carrying one reason either way. */
function httpApiRefused(
  request: HttpApiRequest,
  status: number,
  heading: string,
  why: string,
): HttpApiAnswer {
  return httpApiWantsPage(request)
    ? httpApiPage(status, htmlRefusal(heading, why))
    : httpApiJson(status, { refused: heading, why });
}

/** The path's non-empty segments, so a trailing slash changes nothing. */
function httpApiSegments(path: string): readonly string[] {
  return path.split("/").filter((part) => part !== "");
}

/** The ticket a path segment names, or nothing when it names no id at all. */
function httpApiTicketIn(segment: string | undefined): TicketId | undefined {
  const value = httpApiWholeNumber(segment ?? "");
  return value === undefined ? undefined : asTicketId(value);
}

/** The task a path segment names, or nothing when it names no id at all. */
function httpApiTaskIn(segment: string | undefined): TaskId | undefined {
  const value = httpApiWholeNumber(segment ?? "");
  return value === undefined ? undefined : asTaskId(value);
}

/** The pair of identities a job's path names. */
interface HttpApiTaskPath {
  readonly ticket: TicketId;
  readonly taskId: TaskId;
}

/** The ticket and task two adjacent segments name, or nothing when either is not an id. */
function httpApiTaskPath(
  ticketSegment: string | undefined,
  taskSegment: string | undefined,
): HttpApiTaskPath | undefined {
  const ticket = httpApiTicketIn(ticketSegment);
  const taskId = httpApiTaskIn(taskSegment);
  if (ticket === undefined || taskId === undefined) return undefined;
  return { ticket, taskId };
}

/** The two refusals identity produces, each with the status that says which it was. */
function httpApiUnadmitted(
  request: HttpApiRequest,
  caller: Caller,
): HttpApiAnswer {
  switch (caller.caller) {
    case "Unverified":
      return httpApiRefused(request, 401, "not signed in", caller.why);
    case "Unregistered":
      return httpApiRefused(
        request,
        403,
        "not admitted",
        `${caller.subject} is not a subject this deployment holds a row for`,
      );
    case "Admitted":
      throw new Error("httpApi: an admitted caller is not a refusal");
    default:
      return assertNever(caller);
  }
}

/** Google's double-submit check: the token the button posted is the one the browser also holds as a cookie. */
function httpApiCrossSiteHeld(
  request: HttpApiRequest,
  fields: HttpApiFields,
): boolean {
  const posted = httpApiField(fields, "g_csrf_token") ?? "";
  const held = /(?:^|;)\s*g_csrf_token=([^;]+)/.exec(request.cookie ?? "")?.[1];
  return posted !== "" && held?.trim() === posted;
}

/** The sign-in exchange: verify the credential the button posted, then hand back the cookie the desk reads. */
async function httpApiSession(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  fields: HttpApiFields,
): Promise<HttpApiAnswer> {
  if (!httpApiCrossSiteHeld(request, fields)) {
    return httpApiRefused(
      request,
      401,
      "not signed in",
      "the sign-in post carried no matching cross-site request token",
    );
  }
  const credential = httpApiField(fields, "credential");
  const verified = await identityVerify(desk.identity, credential);
  if (verified.verified === "Refused") {
    return httpApiRefused(request, 401, "not signed in", verified.why);
  }
  const cookie = `${identityCookieName}=${encodeURIComponent(credential ?? "")}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${String(httpApiSessionSecondsMax)}`;
  return {
    status: 303,
    headers: { location: "/", "set-cookie": cookie },
    body: "",
  };
}

/** The bearer a job carries, read without the session cookie: a browser's cookie is nobody's job credential. */
function httpApiBearer(request: HttpApiRequest): string | undefined {
  return identityTokenIn(request.authorization, undefined);
}

/** The completion path's pair, or nothing when this is not a post to one. */
function httpApiCompletionPath(
  request: HttpApiRequest,
  segments: readonly string[],
): HttpApiTaskPath | undefined {
  if (request.method !== "POST" || segments.length !== 5) return undefined;
  if (segments[0] !== "internal" || segments[1] !== "tasks") return undefined;
  if (segments[4] !== "completion") return undefined;
  return httpApiTaskPath(segments[2], segments[3]);
}

/** The artifact path's pair, or nothing when this is not a read of one. */
function httpApiArtifactPath(
  request: HttpApiRequest,
  segments: readonly string[],
): HttpApiTaskPath | undefined {
  if (request.method !== "GET" || segments.length !== 4) return undefined;
  if (segments[0] !== "api" || segments[1] !== "artifacts") return undefined;
  return httpApiTaskPath(segments[2], segments[3]);
}

/**
 * Whether the request holds a token minted for any task this ticket ever issued,
 * which is what an evaluation job carries when it reads the work body. The range
 * is the delivery range the machine itself admits, so it is bounded by the ids
 * the ticket has spent rather than by anything this file counts.
 */
function httpApiJobOfTicket(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  ticket: TicketId,
): boolean {
  const core = desk.core();
  if (!core.tickets.has(ticket)) return false;
  const offered = httpApiBearer(request);
  return deliverableTaskIds(core, ticket).some((taskId) =>
    httpApiJobTokenHolds(desk.jobSecret, ticket, taskId, offered),
  );
}

/** The declaration a worker posted, read as the nested value it is and refused where the vocabulary does not describe it. */
function httpApiDeclaration(
  request: HttpApiRequest,
): Parsed<CompletionDeclaration> {
  const raw = httpApiBodyJson(request.body);
  return raw.parsed === "Refused" ? raw : parseDeclaration(raw.value);
}

/** One stored body, or the refusal that this deployment kept none under that task. */
async function httpApiArtifact(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  at: HttpApiTaskPath,
): Promise<HttpApiAnswer> {
  const named = `ticket ${String(at.ticket)} task ${String(at.taskId)}`;
  const stored = await desk.artifacts.read(at.ticket, at.taskId);
  if (stored === undefined) {
    return httpApiRefused(
      request,
      404,
      "no such artifact",
      `nothing has been declared for ${named}`,
    );
  }
  if (stored.parsed === "Refused") {
    return httpApiRefused(request, 500, "not an artifact", stored.why);
  }
  return httpApiJson(200, { artifact: stored.value });
}

/** The completion a worker posts: the body kept first, then the decision, and the answer only once that resolved. */
async function httpApiCompletion(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  at: HttpApiTaskPath,
): Promise<HttpApiAnswer> {
  const named = `ticket ${String(at.ticket)} task ${String(at.taskId)}`;
  if (
    !httpApiJobTokenHolds(
      desk.jobSecret,
      at.ticket,
      at.taskId,
      httpApiBearer(request),
    )
  ) {
    return httpApiRefused(
      request,
      401,
      "not this task's job",
      `the request carries no token minted for ${named}`,
    );
  }
  const declared = httpApiDeclaration(request);
  if (declared.parsed === "Refused") {
    return httpApiRefused(request, 400, "not a declaration", declared.why);
  }
  await desk.artifacts.write(at.ticket, at.taskId, declared.value.artifact);
  const submitted = await desk.inbound.taskDone(
    at.ticket,
    at.taskId,
    declared.value.verdict,
  );
  return submitted.submitted === "Dropped"
    ? httpApiJson(200, { dropped: submitted.why })
    : httpApiJson(200, { seq: submitted.seq });
}

/**
 * What a job answers for itself. The completion is the job's alone; the artifact
 * read is offered here to the ticket's own jobs and left to the desk's own band
 * for everybody else, so one function answers it under either admission.
 */
async function httpApiJobRoutes(
  desk: HttpApiDesk,
  request: HttpApiRequest,
): Promise<HttpApiAnswer | undefined> {
  const segments = httpApiSegments(request.path);
  const completion = httpApiCompletionPath(request, segments);
  if (completion !== undefined) {
    return await httpApiCompletion(desk, request, completion);
  }
  const artifact = httpApiArtifactPath(request, segments);
  if (artifact === undefined) return undefined;
  if (!httpApiJobOfTicket(desk, request, artifact.ticket)) return undefined;
  return await httpApiArtifact(desk, request, artifact);
}

/** The routes that answer before anyone is identified. */
async function httpApiOpen(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  fields: HttpApiFields,
): Promise<HttpApiAnswer | undefined> {
  const segments = httpApiSegments(request.path);
  const only = segments.length === 1 ? segments[0] : undefined;
  if (request.method === "GET" && only === "healthz") {
    return httpApiJson(200, { serving: true });
  }
  if (request.method === "GET" && only === "login") {
    return httpApiPage(200, htmlLogin(desk.oauthClientId));
  }
  if (request.method === "POST" && only === "session") {
    return await httpApiSession(desk, request, fields);
  }
  return undefined;
}

/** The board, rendered from the live core joined with the annex. */
async function httpApiBoard(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  user: RegistryUser,
): Promise<HttpApiAnswer> {
  const core = desk.core();
  const rows = viewBoard(desk.config, core, await desk.registry.annexes());
  if (!httpApiWantsPage(request)) return httpApiJson(200, { board: rows });
  return httpApiPage(
    200,
    htmlBoard(user, rows, wrapUpOutcomes(true), {
      projects: projects(desk.config),
      wrapUps: wrapUpChoices(desk.config),
      program: defaultProgram(desk.config),
      dependable: dependableIn(core),
    }),
  );
}

/** One ticket in full, or the refusal that the core holds no such ticket. */
async function httpApiTicket(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  user: RegistryUser,
  ticket: TicketId,
): Promise<HttpApiAnswer> {
  const declared = await desk.artifacts.forTicket(ticket);
  if (declared.parsed === "Refused") {
    return httpApiRefused(request, 500, "not an artifact", declared.why);
  }
  const view = viewTicket(
    desk.config,
    desk.core(),
    await desk.registry.annexes(),
    ticket,
    await desk.deskLog.eventsFor(ticket),
    declared.value,
  );
  if (view === undefined) {
    return httpApiRefused(
      request,
      404,
      "no such ticket",
      `the core holds no ticket ${String(ticket)}`,
    );
  }
  if (!httpApiWantsPage(request)) return httpApiJson(200, { ticket: view });
  return httpApiPage(200, htmlTicket(user, view, wrapUpOutcomes(true)));
}

/** Whether a read path names the board, as the page or as its projection. */
function httpApiReadsBoard(segments: readonly string[]): boolean {
  if (segments.length === 0) return true;
  return (
    segments.length === 2 && segments[0] === "api" && segments[1] === "tickets"
  );
}

/** The ticket a read path names, whether the path is the page's or the API's. */
function httpApiReadsTicket(segments: readonly string[]): string | undefined {
  if (segments.length === 2 && segments[0] === "tickets") return segments[1];
  if (
    segments.length === 3 &&
    segments[0] === "api" &&
    segments[1] === "tickets"
  ) {
    return segments[2];
  }
  return undefined;
}

/** The reads: the two pages, and the two projections behind them. */
async function httpApiRead(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  user: RegistryUser,
): Promise<HttpApiAnswer | undefined> {
  if (request.method !== "GET") return undefined;
  const segments = httpApiSegments(request.path);
  if (httpApiReadsBoard(segments)) {
    return await httpApiBoard(desk, request, user);
  }
  const artifact = httpApiArtifactPath(request, segments);
  if (artifact !== undefined) {
    return await httpApiArtifact(desk, request, artifact);
  }
  const named = httpApiReadsTicket(segments);
  if (named === undefined) return undefined;
  const ticket = httpApiTicketIn(named);
  if (ticket === undefined) return undefined;
  return await httpApiTicket(desk, request, user, ticket);
}

/** A submission's answer as the caller's: the refusal enablement gave, or the page the browser goes back to. */
function httpApiSubmitted(
  request: HttpApiRequest,
  submitted: Submitted,
  back: string,
): HttpApiAnswer {
  if (submitted.submitted === "Dropped") {
    return httpApiRefused(request, 409, "refused", submitted.why);
  }
  return httpApiWantsPage(request)
    ? httpApiSeeOther(back)
    : httpApiJson(200, { seq: submitted.seq });
}

/** The operator's gate answer for the ticket holding the lease, refused to anyone the registry did not mark one. */
async function httpApiGate(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  user: RegistryUser,
  ticket: TicketId,
  fields: HttpApiFields,
): Promise<HttpApiAnswer> {
  if (!user.admin) {
    return httpApiRefused(
      request,
      403,
      "not an operator",
      "the gate is answered by hand only by an operator",
    );
  }
  const outcome = wrapUpOutcomes(true).find(
    (choice) => choice === httpApiField(fields, "outcome"),
  );
  if (outcome === undefined) {
    return httpApiRefused(
      request,
      400,
      "not an outcome",
      "outcome names no wrap-up outcome the machine draws",
    );
  }
  const submitted = await desk.inbound.gateOutcome(ticket, outcome);
  return httpApiSubmitted(request, submitted, `/tickets/${String(ticket)}`);
}

/** One act on one ticket, each arm the inbound method the model names for it. */
async function httpApiAct(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  user: RegistryUser,
  ticket: TicketId,
  action: DeskAction,
  fields: HttpApiFields,
): Promise<HttpApiAnswer> {
  const back = `/tickets/${String(ticket)}`;
  switch (action) {
    case "release":
      return httpApiSubmitted(
        request,
        await desk.inbound.release(ticket),
        back,
      );
    case "revoke":
      return httpApiSubmitted(request, await desk.inbound.revoke(ticket), back);
    case "retry":
      return httpApiSubmitted(
        request,
        await desk.inbound.opRetry(ticket),
        back,
      );
    case "gate":
      return httpApiGate(desk, request, user, ticket, fields);
    default:
      return assertNever(action);
  }
}

/** The arrival itself, under the lock: the decision, the id it grew, then the annex beside it. */
async function httpApiArriveHeld(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  user: RegistryUser,
  fields: HttpApiFields,
): Promise<HttpApiAnswer> {
  const arrival = httpApiArrival(desk.config, fields, user.subject);
  if (arrival.parsed === "Refused") {
    return httpApiRefused(request, 400, "not an arrival", arrival.why);
  }
  const draw = arrival.value;
  const submitted = await desk.inbound.arrive(
    draw.deps,
    draw.program,
    draw.project,
    draw.wrapUp,
  );
  if (submitted.submitted === "Dropped") {
    return httpApiRefused(request, 409, "refused", submitted.why);
  }
  const ticket = asTicketId(desk.core().tickets.size);
  await desk.registry.writeAnnex(ticket, draw.annex);
  return httpApiWantsPage(request)
    ? httpApiSeeOther(`/tickets/${String(ticket)}`)
    : httpApiJson(200, { ticket, seq: submitted.seq });
}

/**
 * The only way to reach an arrival: the chain is the function's own, so
 * serialization is not a call anyone can drop but the single path in.
 */
export function httpApiSerialArrivals(): (
  desk: HttpApiDesk,
  request: HttpApiRequest,
  user: RegistryUser,
  fields: HttpApiFields,
) => Promise<HttpApiAnswer> {
  let chain: Promise<void> = Promise.resolve();
  const forget = (): void => undefined;
  return (desk, request, user, fields) => {
    const answer = chain.then(() =>
      httpApiArriveHeld(desk, request, user, fields),
    );
    chain = answer.then(forget, forget);
    return answer;
  };
}

/** An admitted subject's row, written by an operator; the bootstrap operator comes from the deployment instead. */
async function httpApiUser(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  user: RegistryUser,
  fields: HttpApiFields,
): Promise<HttpApiAnswer> {
  if (!user.admin) {
    return httpApiRefused(
      request,
      403,
      "not an operator",
      "the registry is written only by an operator",
    );
  }
  const subject = httpApiField(fields, "subject") ?? "";
  if (subject === "") {
    return httpApiRefused(request, 400, "not a user", "subject is required");
  }
  const display = httpApiField(fields, "display") ?? subject;
  const admin = ["true", "1"].includes(httpApiField(fields, "admin") ?? "");
  await desk.registry.upsertUser(subject, display, admin);
  return httpApiWantsPage(request)
    ? httpApiSeeOther("/")
    : httpApiJson(200, { subject, display, admin });
}

/** A subject's credential grant, written by an operator; what is stored is the reference and the git identity, never material. */
async function httpApiUserCredentials(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  user: RegistryUser,
  fields: HttpApiFields,
): Promise<HttpApiAnswer> {
  if (!user.admin) {
    return httpApiRefused(
      request,
      403,
      "not an operator",
      "the registry is written only by an operator",
    );
  }
  const subject = httpApiField(fields, "subject") ?? "";
  const apiKeyRef = httpApiField(fields, "apiKeyRef") ?? "";
  const gitName = httpApiField(fields, "gitName") ?? "";
  const gitEmail = httpApiField(fields, "gitEmail") ?? "";
  if ([subject, apiKeyRef, gitName, gitEmail].includes("")) {
    return httpApiRefused(
      request,
      400,
      "not a credential grant",
      "subject, apiKeyRef, gitName and gitEmail are all required",
    );
  }
  await desk.registry.upsertCredentials(subject, {
    apiKeyRef,
    gitName,
    gitEmail,
  });
  return httpApiWantsPage(request)
    ? httpApiSeeOther("/")
    : httpApiJson(200, { subject, apiKeyRef, gitName, gitEmail });
}

/** The writes: the arrival, the four acts on a ticket, and the registry. */
async function httpApiWrite(
  desk: HttpApiDesk,
  request: HttpApiRequest,
  user: RegistryUser,
  fields: HttpApiFields,
  arrive: ReturnType<typeof httpApiSerialArrivals>,
): Promise<HttpApiAnswer | undefined> {
  if (request.method !== "POST") return undefined;
  const segments = httpApiSegments(request.path);
  if (segments[0] !== "api") return undefined;
  if (segments[1] === "users" && segments.length === 2) {
    return await httpApiUser(desk, request, user, fields);
  }
  if (
    segments[1] === "users" &&
    segments.length === 3 &&
    segments[2] === "credentials"
  ) {
    return await httpApiUserCredentials(desk, request, user, fields);
  }
  if (segments[1] !== "tickets") return undefined;
  if (segments.length === 2) {
    return await arrive(desk, request, user, fields);
  }
  if (segments.length !== 4) return undefined;
  const ticket = httpApiTicketIn(segments[2]);
  const action = deskActions.find((one) => one === segments[3]);
  if (ticket === undefined || action === undefined) return undefined;
  return await httpApiAct(desk, request, user, ticket, action, fields);
}

/** The whole face: the open routes, then the caller, then everything that needs one. */
export function httpApiRouter(desk: HttpApiDesk): HttpApiRouter {
  const arrive = httpApiSerialArrivals();
  return async (request) => {
    const job = await httpApiJobRoutes(desk, request);
    if (job !== undefined) return job;
    const read = httpApiFields(request.contentType, request.body);
    if (read.parsed === "Refused") {
      return httpApiRefused(request, 400, "not a body", read.why);
    }
    const open = await httpApiOpen(desk, request, read.value);
    if (open !== undefined) return open;
    const caller = await identityCaller(
      desk.identity,
      desk.registry,
      identityTokenIn(request.authorization, request.cookie),
    );
    if (caller.caller !== "Admitted") return httpApiUnadmitted(request, caller);
    const answered =
      (await httpApiRead(desk, request, caller.user)) ??
      (await httpApiWrite(desk, request, caller.user, read.value, arrive));
    return (
      answered ??
      httpApiRefused(
        request,
        404,
        "no such route",
        `${request.method} ${request.path} is no route this desk answers`,
      )
    );
  };
}
