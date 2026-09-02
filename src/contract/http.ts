/**
 * The versioned public HTTP wire: its routes, its bounds, its error envelope
 * and the primitive schemas every request and response is built from.
 *
 * `src/contract/` depends on `zod` and on nothing else, so the server and a
 * browser hold one copy of the contract rather than two that drift.
 */

import { z } from "zod";

export const nativeHttpVersion = 1;
export const nativeHttpBasePath = "/api/v1";
export const nativeHttpMediaType = "application/vnd.chuggy.v1+json";
export const nativeHttpBodyBytesMax = 65_536;
export const nativeHttpHeaderBytesMax = 16_384;
export const nativeHttpCursorCharsMax = 2_048;
export const nativeHttpPathSegmentCharsMax = 256;

/** The largest page any collection route answers with, and the size it assumes. */
export const nativeHttpPageItemsMax = 100;
export const nativeHttpPageItemsDefault = 50;

/** The version a dispatch view token carries, so a stale reader is refused. */
export const dispatchViewSchemaVersion = 1;

/** The largest count any run figure carries, which is what a browser can hold exactly. */
export const runCountMax = Number.MAX_SAFE_INTEGER;

/**
 * The most turns one run's durable series retains, above any turn ceiling a
 * worker configuration names, so the series is whole for a run that names one.
 */
export const runTurnSeriesMax = 1_000;

/** One transcript batch is one wire body's worth, so a batch never needs a second read. */
export const runTranscriptBatchBytesMax = nativeHttpBodyBytesMax;

/** The most batches one run writes, past which its transcript carries its own truncation. */
export const runTranscriptBatchesMax = 4_096;

/** How many batches one transcript page carries, so a page stays under the preview bound. */
export const runTranscriptPageBatchesMax = 8;

/** The largest configuration snapshot, which is what one read answers whole. */
export const runConfigurationBytesMax = 1_048_576;

/** One store batch is one wire body's worth, so a batch never needs a second read. */
export const sessionStoreBatchBytesMax = nativeHttpBodyBytesMax;

/** The most batches one stream of a session's store holds. */
export const sessionStoreBatchesMax = 65_536;

/** The most bytes one session's whole store holds, across every stream. */
export const sessionStoreBytesMax = 1_073_741_824;

/** The longest stream name, which is an agent runtime session id and an optional subpath. */
export const sessionStoreStreamCharsMax = 256;

/** How many batches one store read answers with, so a page stays under the body bound. */
export const sessionStorePageBatchesMax = 8;

/** How many transcript entries one page of a store read answers with. */
export const sessionTranscriptEntriesMax = 512;

/**
 * How many streams one listing answers with: one past the page above, so a
 * store holding more than a page of them is distinguishable from one holding
 * exactly a page. A listing capped at the page itself would be silently short
 * of the truth, and what a reader does about the extra row is that reader's.
 */
export const sessionStoreStreamsAnswered = nativeHttpPageItemsMax + 1;

/** The most turns one session's mailbox ever holds. */
export const sessionTurnSeriesMax = 100_000;

/** How many of those turns wait at once, past which a submitter is refused. */
export const sessionTurnBacklogMax = 256;

/** How many attempts one turn may be handed before it is failed. */
export const sessionTurnAttemptsMax = 3;

export const sessionTurnResultCharsMax = 65_536;

/**
 * The longest model identity one turn's measurement names. It is the session
 * identity bound rather than a run's, because a turn's measure is stored beside
 * the session's own opaque identities and `test/contract/rosters.test.ts` holds
 * it against that one.
 */
export const sessionTurnModelCharsMax = 256;

/** The most tool names one turn's measurement reports, distinct and in no order. */
export const sessionTurnToolsMax = 64;

/** The longest tool name one turn's measurement reports. */
export const sessionTurnToolNameCharsMax = 128;

/** How many already-confirmed entry uuids one stream's adapter remembers. */
export const sessionStoreUuidsRemembered = 4_096;

/** The largest body one worker-plane upload carries, which an artifact is written against. */
export const workerPlaneUploadBytesMax = 4_194_304;

/** The longest label the agent runtime names its own outcome with. */
export const runOutcomeLabelCharsMax = 64;

/** The longest model identity a usage row names. */
export const runModelCharsMax = 128;

/** The longest selector prompt or North Star the wire carries, which is what its column holds. */
export const selectorSettingsTextCharsMax = 65_536;

/** The most names one selector allowlist carries. */
export const selectorAllowlistNamesMax = 64;

/** The longest name one selector allowlist entry carries. */
export const selectorAllowlistNameCharsMax = 256;

/** The largest handoff note the wire carries, which is what its column holds. */
export const selectorHandoffNoteBytesMax = 65_536;

/**
 * How much of the handoff note the lead read carries. The note's own ceiling is
 * a whole wire body, and the lead read carries a mailbox tail and a stream
 * listing beside it, so a note at its bound would put that one response past
 * what the wire admits.
 */
export const selectorHandoffNotePreviewCharsMax = 4_096;

/** How many of one project's decisions a single history page answers with. */
export const selectorHistoryLimitMax = 50;

/**
 * The longest reason one agentic refusal carries. It is what makes a page of
 * standing refusals bounded, so it moves only together with the two counts
 * below it.
 */
export const agenticRefusalReasonCharsMax = 1_024;

/**
 * How many standing refusals one read answers with. Its product with the reason
 * bound is half of what a lead turn's observation may weigh, which is the share
 * the refusals may take of a document that also carries the candidates.
 */
export const agenticRefusalsAnsweredMax = 32;

/** How many of a lead's turns one read of the lead answers with, newest last. */
export const leadTurnsAnsweredMax = 32;

/**
 * How many entries one page of one ticket's refusal ledger answers with, `more`
 * carrying the rest. Its product with the reason bound is half of one wire body,
 * which is what makes a full page a body and a stream frame the wire can hold.
 */
export const agenticRefusalLedgerAnsweredMax = 32;

/** The longest summary a result carries, restating what the manifest reader accepts. */
export const resultReportCharsMax = 8_192;

/**
 * The first manifest schema version whose result carries a summary at all, below
 * which a reader has none to draw rather than an empty one.
 */
export const resultReportSchemaVersionMin = 3;

/**
 * The longest message a member may put in their own thread, which is far below
 * what the mailbox column holds. A door a human types at is bounded by what a
 * human types, not by what the column can take.
 */
export const threadMessageCharsMax = 16_384;

/**
 * What a thread's seeding block weighs beyond the North Star inside it: the
 * headings, and the two standing sentences the block restates. It is a ceiling
 * rather than a measurement, and the interpreter's suite is what holds the
 * composed block under it.
 */
export const threadSeedingFixedCharsMax = 4_096;

/**
 * The longest block a thread's first turn carries in front of the member's
 * message, DERIVED rather than named. The block carries the project's North
 * Star and never sheds it, so a ceiling below what the settings route already
 * accepts would refuse every first turn of a project whose North Star is long —
 * on every member, long after the write that caused it.
 */
export const threadSeedingCharsMax =
  selectorSettingsTextCharsMax + threadSeedingFixedCharsMax;

/** How many turns one thread may have waiting, which is what stops a member queueing a day's work. */
export const threadBacklogMax = 8;

/** How many threads one listing answers with. */
export const threadsAnsweredMax = 64;

/** How many turns of one thread's mailbox a read answers with, newest last. */
export const threadTurnsAnsweredMax = 32;

/** What a wake document weighs, which is a roster member, a resource and one sentence. */
export const threadWakeCharsMax = 2_048;

/** How many wake candidates one pass of the wake runtime reads and enqueues. */
export const threadWakesPerPassMax = 64;

export const nativeHttpRoutes = {
  contract: `${nativeHttpBasePath}/contract`,
  installation: `${nativeHttpBasePath}/installation`,
  projects: `${nativeHttpBasePath}/projects`,
  project: `${nativeHttpBasePath}/tenants/:tenant/projects/:project`,
  tickets: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/tickets`,
  ticket: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/tickets/:ticket`,
  ticketNativeActions: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/tickets/:ticket/native-actions`,
  ticketAgenticRefusals: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/tickets/:ticket/agentic-refusals`,
  nativeActions: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/native-actions`,
  agenticRefusals: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/agentic-refusals`,
  operationalStatus: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/operational-status`,
  selectorContext: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/selector-context`,
  selectorSettings: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/selector-settings`,
  selectorSettingsHistory: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/selector-settings/history`,
  selectorHistory: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/selector-history`,
  lead: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/lead`,
  leadTranscript: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/lead/transcript`,
  executions: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions`,
  execution: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions/:execution`,
  outputContent: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions/:execution/artifacts/:ordinal`,
  runTurns: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions/:execution/attempts/:attempt/turns`,
  runTranscript: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions/:execution/attempts/:attempt/transcript`,
  runConfiguration: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/executions/:execution/attempts/:attempt/configuration`,
  operations: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/operations`,
  operation: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/operations/:operation`,
  notifications: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/notifications`,
  events: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/events`,
  configurations: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/configurations`,
  configurationImports: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/configurations/imports`,
  configuration: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/configurations/:revision`,
  drafts: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/drafts`,
  draftInitialization: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/draft-initializations/:revision`,
  draft: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/drafts/:ticket`,
  dispatchView: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/dispatch-view`,
  threads: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/threads`,
  thread: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/threads/:session`,
  threadTranscript: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/threads/:session/transcript`,
  threadMessages: `${nativeHttpBasePath}/tenants/:tenant/projects/:project/threads/:session/messages`,
} as const;

export type NativeHttpRoute = keyof typeof nativeHttpRoutes;

/** An opaque identity the wire carries in a path segment or a body field. */
export const identitySchema = z
  .string()
  .min(1)
  .max(nativeHttpPathSegmentCharsMax);

/** The longest opaque session identity a stored row carries. */
export const sessionIdentityCharsMax = 256;

/** The longest label a session kind may be, which its own roster is inside. */
export const sessionKindCharsMax = 16;

/** What one character weighs once JSON escapes it, which a control character does. */
const jsonEscapedCharChars = 6;

/** What a JSON string of this many characters weighs: its quotes, every character escaped. */
function jsonStringChars(chars: number): number {
  return chars * jsonEscapedCharChars + 2;
}

/**
 * What one JSON object weighs as `jsonb::text` renders it, which is the only
 * renderer that writes these: its braces, its quoted keys, the space after each
 * key and each comma, and its values.
 */
function jsonObjectChars(
  members: readonly (readonly [string, number])[],
): number {
  return (
    2 +
    members.reduce((total, [key, value]) => total + key.length + 4 + value, 0) +
    Math.max(members.length - 1, 0) * 2
  );
}

/**
 * How long a resource identity a change row may name, which the widest session
 * change decides rather than a path segment: an object naming the session,
 * what the session is, and either the turn or the stream and the batch that
 * moved, with every character of every identity escaped.
 */
export const projectChangeResourceCharsMax = Math.max(
  jsonObjectChars([
    ["session", jsonStringChars(sessionIdentityCharsMax)],
    ["kind", jsonStringChars(sessionKindCharsMax)],
    ["turn", jsonStringChars(sessionIdentityCharsMax)],
  ]),
  jsonObjectChars([
    ["session", jsonStringChars(sessionIdentityCharsMax)],
    ["kind", jsonStringChars(sessionKindCharsMax)],
    ["stream", jsonStringChars(sessionStoreStreamCharsMax)],
    ["batch", String(sessionStoreBatchesMax).length],
  ]),
);

/** How many of a project's notifications one page carries. */
export const notificationPageLimitMax = 100;

/** How many candidates one page of the dispatch view carries. */
export const dispatchViewPageLimitMax = 100;

/** How many of its own past decisions a fresh lead is seeded with. */
export const leadSeedingDecisionsMax = 16;

/** The most a lead's objectives weigh beyond the two texts a project sets. */
export const leadObjectivesFixedCharsMax = 4_096;

/**
 * The longest composed set of objectives one session row holds: what the
 * installation asks of a lead, what the project wants, and what its tools mean.
 * A ceiling below the two texts' sum would refuse a base prompt the settings
 * route had already accepted, on every pass, long after the write that caused it.
 */
export const sessionSystemPromptCharsMax =
  selectorSettingsTextCharsMax * 2 + leadObjectivesFixedCharsMax;

/** The most digits a cursor the observation carries may be written with. */
export const cursorDigitsCharsMax = 20;

/**
 * What one refusal the observation shows weighs beyond its reason: the ticket,
 * the version it was made against, the instant, whether it is superseded, and
 * the keys naming each.
 */
export const leadObservedRefusalEnvelopeCharsMax = 512;

/** What one seeded decision summary weighs: what it dispatched, refused and left. */
export const leadSeededDecisionCharsMax = 4_096;

/** What one notification in the observation's window weighs: an ordinal, a kind, a resource. */
export const leadObservedChangeCharsMax = 1_024;

/** How many dependencies one authored draft names. */
export const nativeHttpDraftDependenciesMax = 100;

/** How many stages one authored program carries. */
export const nativeHttpDraftStagesMax = 100;

/** The longest canonical configuration one revision holds, which 007's column checks. */
export const configurationCanonicalCharsMax = 65_536;

/**
 * What one character of an already-JSON text weighs once it is embedded as a
 * JSON string. It is two rather than six because a canonical configuration
 * carries no control character, and one rather than two would be a bound the
 * quotes in every JSON document already exceed.
 */
const jsonEmbeddedTextCharChars = 2;

/**
 * What one observation carries that is neither a text a project set nor a page
 * of something: its version, its decision reference, its partition, its view
 * token and its operational context.
 */
export const leadObservationFixedCharsMax = 16_384;

/**
 * What one JSON object weighs as `JSON.stringify` writes it, which is what
 * composes an observation: its braces, its quoted keys, its colons and its
 * commas. It is not `jsonb`'s renderer and emits none of its spaces.
 */
function stringifiedObjectChars(
  members: readonly (readonly [string, number])[],
): number {
  return (
    2 +
    members.reduce((total, [key, value]) => total + key.length + 3 + value, 0) +
    Math.max(members.length - 1, 0)
  );
}

/** What one JSON array of that many members weighs beyond them: its brackets and its commas. */
function stringifiedArrayChars(members: number, memberChars: number): number {
  return 2 + members * memberChars + Math.max(members - 1, 0);
}

/** What one refusal weighs where an observation shows it, its reason escaped. */
const leadObservedRefusalChars =
  leadObservedRefusalEnvelopeCharsMax +
  jsonStringChars(agenticRefusalReasonCharsMax);

/** Every standing refusal one observation carries, as one array. */
const leadObservedRefusalsChars = stringifiedArrayChars(
  agenticRefusalsAnsweredMax,
  leadObservedRefusalChars,
);

/** The characters a sha-256 digest is written with, wherever one is carried. */
export const artifactDigestChars = 64;

/** The most digits any counter one candidate carries is written with. */
const candidateCounterDigitsMax = 20;

/** What one stage of a candidate's program weighs: its fanout and its combinator. */
export const leadObservedStageCharsMax = 128;

/** What one label a candidate's pricing or finalizer names weighs. */
const candidateLabelCharsMax = 64;

/** The configuration name one candidate's version label names. */
export const repositoryConfigurationNameCharsMax = 128;

/** Every field one dispatch candidate carries but the configuration, at its own bound. */
const candidateOwnMembers: readonly (readonly [string, number])[] = [
  ["ticket", candidateCounterDigitsMax],
  ["ticketVersion", candidateCounterDigitsMax],
  ["workFanout", candidateCounterDigitsMax],
  [
    "dependencies",
    stringifiedArrayChars(
      nativeHttpDraftDependenciesMax,
      candidateCounterDigitsMax,
    ),
  ],
  [
    "program",
    stringifiedArrayChars(nativeHttpDraftStagesMax, leadObservedStageCharsMax),
  ],
  ["reworkPolicy", jsonStringChars(candidateLabelCharsMax)],
  ["finalizationPricing", jsonStringChars(candidateLabelCharsMax)],
  ["resumePricing", jsonStringChars(candidateLabelCharsMax)],
  ["finalizer", jsonStringChars(candidateLabelCharsMax)],
  [
    "configurationVersion",
    stringifiedObjectChars([
      ["name", jsonStringChars(repositoryConfigurationNameCharsMax)],
      ["number", candidateCounterDigitsMax],
    ]),
  ],
  ["configurationRevision", jsonStringChars(nativeHttpPathSegmentCharsMax)],
  ["configurationDigest", jsonStringChars(artifactDigestChars)],
];

/**
 * What one dispatch candidate weighs beyond the configuration it pins: the
 * counters, the two pages authoring bounds, the labels its pricing is drawn
 * from, and the identities naming the revision it was pinned under.
 */
export const leadObservedCandidateFixedCharsMax =
  stringifiedObjectChars(candidateOwnMembers);

/**
 * What one dispatch candidate weighs, the canonical counted as the member it is
 * so the key naming it is weighed where every other key is. The configuration
 * is the whole of a candidate's size — it embeds the text 007 bounds rather
 * than a reference to it — so a ceiling below that is a page the view composes
 * and the mailbox refuses.
 */
export const leadObservedCandidateCharsMax = stringifiedObjectChars([
  ...candidateOwnMembers,
  [
    "configurationCanonical",
    configurationCanonicalCharsMax * jsonEmbeddedTextCharChars + 2,
  ],
]);

/**
 * The longest observation one lead turn may be given, which is what its mailbox
 * row must hold. Every part of it is bounded somewhere else, and a ceiling
 * below their sum is a document the runtime composes and the database refuses.
 */
export const sessionTurnInputCharsMax = stringifiedObjectChars([
  [
    "instructions",
    stringifiedObjectChars([
      ["revision", jsonStringChars(nativeHttpPathSegmentCharsMax)],
      ["content", jsonStringChars(sessionSystemPromptCharsMax)],
    ]),
  ],
  ["handoffNote", selectorHandoffNoteBytesMax],
  ["refusals", leadObservedRefusalsChars],
  [
    "seeding",
    stringifiedObjectChars([
      ["handoffNote", selectorHandoffNoteBytesMax],
      [
        "decisions",
        stringifiedArrayChars(
          leadSeedingDecisionsMax,
          leadSeededDecisionCharsMax,
        ),
      ],
      ["refusals", leadObservedRefusalsChars],
      ["notificationCursor", cursorDigitsCharsMax],
    ]),
  ],
  [
    "changes",
    stringifiedArrayChars(notificationPageLimitMax, leadObservedChangeCharsMax),
  ],
  [
    "candidates",
    stringifiedArrayChars(
      dispatchViewPageLimitMax,
      leadObservedCandidateCharsMax,
    ),
  ],
  ["observation", leadObservationFixedCharsMax],
]);

/** The key a change row names, which the durable log is bounded by. */
export const changeResourceSchema = z
  .string()
  .min(1)
  .max(projectChangeResourceCharsMax);

export const countSchema = z.number().int().safe().nonnegative();
export const ticketNumberSchema = z.number().int().safe().positive();
export const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const instantSchema = z.string().min(1);
/**
 * All the wire says about a cursor. It is opaque to every reader but the server
 * that issued it, whose own module holds what one decodes to.
 */
export const cursorSchema = z.string().min(1).max(nativeHttpCursorCharsMax);

export const partitionSchema = z.strictObject({
  tenant: identitySchema,
  project: identitySchema,
});

export type PartitionIdentity = z.infer<typeof partitionSchema>;

export interface HttpErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

/** The envelope alone; a status that carries more sends it beside this. */
export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({ code: identitySchema, message: z.string() }),
});

export function nativeHttpError(
  code: string,
  message: string,
): HttpErrorEnvelope {
  return { error: { code, message } };
}

/** The path prefix every project-scoped resource hangs from. */
export function partitionPath(partition: PartitionIdentity): string {
  const tenant = encodeURIComponent(partition.tenant);
  const project = encodeURIComponent(partition.project);
  if (
    tenant.length > nativeHttpPathSegmentCharsMax ||
    project.length > nativeHttpPathSegmentCharsMax
  )
    throw new RangeError("a partition segment is longer than the wire accepts");
  return `${nativeHttpBasePath}/tenants/${tenant}/projects/${project}`;
}
