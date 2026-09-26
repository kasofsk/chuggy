/**
 * The contract's worker document schemas held to the parsers that decide the
 * same documents. Whatever a parser accepts, its schema accepts; read from the
 * other side, that is whatever a schema refuses, its parser refuses. The
 * parser may refuse more — a path's normal form, an identity's brand, one field
 * against another, a ticket against the view — so nothing here asks the two to
 * agree exactly.
 *
 * THE CASES ARE THE PARSERS' OWN SUITES' BODIES, and bodies built from each
 * schema at and one past every bound it states. A manifest body written at a
 * retained version is lifted to the version the harness writes, which is the
 * only one the schema describes.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ZodType } from "zod";

import {
  agenticRefusalReasonCharsMax,
  leadDispatchesMax,
  resultReportCharsMax,
} from "../../src/contract/http.ts";
import {
  resultVerdicts,
  selectorAttentions,
} from "../../src/contract/rosters.ts";
import { leadRefusalsPerDecisionMax } from "../../src/contract/sessionTools.ts";
import * as contract from "../../src/contract/workerDocuments.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { parseLeadDecision } from "../../src/interpreter/leadTurn.ts";
import * as reader from "../../src/interpreter/resultManifest.ts";
import {
  leadDecisionBytesMax,
  type SelectorObservation,
} from "../../src/interpreter/selector.ts";
import {
  candidate,
  decision,
  decisionLiftingBareTicket,
  observation,
  parcelledObservation,
  standingRefusal,
} from "../interpreter/leadTurnFixture.ts";
import {
  accept,
  digestFor,
  manifestBodiesMistyped,
  manifestBodiesRefused,
  report,
  row,
  source,
  sourceReport,
  workerReport,
} from "../interpreter/resultManifestFixture.ts";

/** One body and what each side answered it. */
interface Judged {
  readonly text: string;
  readonly parser: boolean;
  readonly schema: boolean;
}

/** An example built from a schema: what it varies, the value, and whether the schema was built to accept it. */
type Built = readonly [string, Readonly<Record<string, unknown>>, boolean];

/** Whether the text parses as JSON, which is what a schema is handed. */
function textIsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Whether the text is JSON the schema accepts, which is a schema's answer to a body. */
function schemaAccepts(schema: ZodType, text: string): boolean {
  return textIsJson(text) && schema.safeParse(JSON.parse(text)).success;
}

/**
 * Asserts no body is accepted by the parser and refused by the schema, over
 * cases that reach both answers. A refusal counts only where the text is JSON,
 * since text that is not JSON is refused before any schema is asked.
 */
function assertParserAcceptsNothingSchemaRefuses(
  judged: readonly Judged[],
): void {
  assert.ok(
    judged.some((each) => each.parser),
    "no case the parser accepts, so nothing is held on that side",
  );
  assert.ok(
    judged.some((each) => !each.schema && textIsJson(each.text)),
    "no JSON case the schema refuses, so nothing is held on that side",
  );
  assert.deepEqual(
    judged
      .filter((each) => each.parser && !each.schema)
      .map((each) => each.text.slice(0, 200)),
    [],
  );
}

/** The names of the built examples the schema answers otherwise than it was built to. */
function builtMisjudged(schema: ZodType, built: readonly Built[]): string[] {
  return built
    .filter(([, value, accepts]) => schema.safeParse(value).success !== accepts)
    .map(([what]) => what);
}

/** A value at a bound the schema states and one past it, built to be accepted and refused in turn. */
function builtAtBound(
  what: string,
  bound: number,
  valueOf: (size: number) => Readonly<Record<string, unknown>>,
): Built[] {
  return [
    [`${what} at the bound`, valueOf(bound), true],
    [`${what} past it`, valueOf(bound + 1), false],
  ];
}

/** A manifest body at a retained version, rewritten at the one the harness writes; any other text is unchanged. */
function manifestLifted(text: string): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return text;
  const record = value as Record<string, unknown>;
  const version = record["version"];
  if (
    version === contract.resultManifestSchemaVersion ||
    !contract.resultManifestSchemaVersionsAccepted.some(
      (retained) => retained === version,
    )
  )
    return text;
  return JSON.stringify({
    report: "a review",
    ...record,
    version: contract.resultManifestSchemaVersion,
  });
}

/** The bodies the reader's own suite reads, beyond the one per rejection its fixture keeps. */
function manifestBodiesFromReaderSuite(): readonly string[] {
  const handoffs = Array.from({ length: reader.manifestHandoffsMax }, (_, at) =>
    row(`out/${String(at)}`),
  );
  const digest = digestFor("out/a");
  return [
    ...manifestBodiesRefused(),
    ...manifestBodiesMistyped.map(([text]) => text),
    workerReport("Pass"),
    workerReport("Fail"),
    workerReport("Fail", null),
    report("Pass", []),
    '{"version":1,"verdict":"Pass"}',
    sourceReport("Pass", source),
    sourceReport("Fail", null),
    sourceReport("Pass", { ...source, extra: "ignored" }),
    sourceReport("Pass", { ...source, base: "c".repeat(39) }),
    report("Pass", handoffs),
    report("Fail", [], [row("log/a")]),
    report("Pass", [row("out/a", 0)]),
    report("Pass", [row("out/a", 1.5)]),
    report("Pass", [row("out/a", Number.MAX_VALUE)]),
    ...[`sha256:${digest}`, digest.slice(0, 63), `${digest}0`].map(
      (malformed) =>
        report("Pass", [{ path: "out/a", digest: malformed, bytes: 1 }]),
    ),
    report("Pass", [
      row(`out/e${String.fromCharCode(0x301)}`.normalize("NFC")),
    ]),
    report("Pass", [row("out/a"), row("out/b")]),
    report("Pass", [row("out/a")], [row("out/b")]),
    report("Pass", [row("out/a")], [row("OUT/A")]),
    JSON.stringify({
      version: 1,
      verdict: "Pass",
      handoffs: {},
      diagnostics: [],
    }),
    JSON.stringify({
      version: 1,
      verdict: "Pass",
      handoffs: [{ path: 1, digest, bytes: 1 }],
      diagnostics: [],
    }),
  ];
}

/** A path of exactly this many code points that the reader's own segment rules admit. */
function artifactPathOfChars(chars: number): string {
  const segment = "a".repeat(reader.artifactPathSegmentCharsMax);
  return Array.from({ length: reader.artifactPathSegmentsMax }, () => segment)
    .join("/")
    .slice(0, chars);
}

/** What the harness writes, which every manifest example varies one thing of. */
const manifestWritten = JSON.parse(workerReport("Pass")) as Readonly<
  Record<string, unknown>
>;

function manifestWith(
  changes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return { ...manifestWritten, ...changes };
}

function manifestWithout(key: string): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(manifestWritten).filter(([found]) => found !== key),
  );
}

function manifestArtifacts(count: number, prefix: string): unknown[] {
  return Array.from({ length: count }, (_, at) =>
    row(`${prefix}/${String(at)}`),
  );
}

function manifestArtifact(
  artifact: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return manifestWith({ diagnostics: [artifact] });
}

const manifestDigest = digestFor("log/a");

/** Examples of the manifest's own keys, at and past each bound the schema states for them. */
const manifestBuiltEnvelope: readonly Built[] = [
  ["as the harness writes it", manifestWritten, true],
  ...resultVerdicts.map((verdict): Built => [
    verdict,
    manifestWith({ verdict }),
    true,
  ]),
  ["an unknown verdict", manifestWith({ verdict: "Skip" }), false],
  [
    "the next version",
    manifestWith({ version: contract.resultManifestSchemaVersion + 1 }),
    false,
  ],
  ...builtAtBound("a report", resultReportCharsMax, (chars) =>
    manifestWith({ report: "😀".repeat(chars) }),
  ),
  ["an empty report", manifestWith({ report: "" }), false],
  ...builtAtBound("handoffs", contract.manifestHandoffsMax, (count) =>
    manifestWith({ handoffs: manifestArtifacts(count, "out") }),
  ),
  ...builtAtBound("diagnostics", contract.manifestDiagnosticsMax, (count) =>
    manifestWith({ diagnostics: manifestArtifacts(count, "log") }),
  ),
  ["an unknown key", manifestWith({ extra: 1 }), false],
  ...["version", "verdict", "report", "handoffs", "diagnostics"].map(
    (key): Built => [`no ${key}`, manifestWithout(key), false],
  ),
];

/** Examples of the source handoff, which the schema reads only as four strings. */
const manifestBuiltSource: readonly Built[] = [
  ["a source", manifestWith({ source }), true],
  ["a null source", manifestWith({ source: null }), true],
  [
    "a source with an unknown key",
    manifestWith({ source: { ...source, extra: "x" } }),
    false,
  ],
  [
    "a source missing a key",
    manifestWith({
      source: {
        repository: source.repository,
        ref: source.ref,
        commit: source.commit,
      },
    }),
    false,
  ],
  [
    "a source naming a number",
    manifestWith({ source: { ...source, commit: 1 } }),
    false,
  ],
];

/** Examples of one artifact row, at and past each bound the schema states for it. */
const manifestBuiltArtifacts: readonly Built[] = [
  ...builtAtBound("a path", contract.artifactPathCharsMax, (chars) =>
    manifestArtifact(row(artifactPathOfChars(chars))),
  ),
  ["an empty path", manifestArtifact(row("")), false],
  [
    "a digest one short",
    manifestArtifact({ ...row("log/a"), digest: manifestDigest.slice(1) }),
    false,
  ],
  [
    "a digest one long",
    manifestArtifact({ ...row("log/a"), digest: `${manifestDigest}0` }),
    false,
  ],
  [
    "an upper-case digest",
    manifestArtifact({ ...row("log/a"), digest: manifestDigest.toUpperCase() }),
    false,
  ],
  ["no bytes", manifestArtifact(row("log/a", 0)), true],
  ...builtAtBound("bytes", contract.artifactBytesMax, (bytes) =>
    manifestArtifact(row("log/a", bytes)),
  ),
  ["negative bytes", manifestArtifact(row("log/a", -1)), false],
  ["fractional bytes", manifestArtifact(row("log/a", 0.5)), false],
  ["bytes as text", manifestArtifact({ ...row("log/a"), bytes: "1" }), false],
  [
    "an artifact with an unknown key",
    manifestArtifact({ ...row("log/a"), extra: 1 }),
    false,
  ],
  [
    "an artifact with no digest",
    manifestArtifact({ path: "log/a", bytes: 1 }),
    false,
  ],
];

const manifestBuilt: readonly Built[] = [
  ...manifestBuiltEnvelope,
  ...manifestBuiltSource,
  ...manifestBuiltArtifacts,
];

test("every bound the manifest schema copies is the reader's own", () => {
  assert.deepEqual(
    {
      artifactPathCharsMax: contract.artifactPathCharsMax,
      artifactBytesMax: contract.artifactBytesMax,
      manifestHandoffsMax: contract.manifestHandoffsMax,
      manifestDiagnosticsMax: contract.manifestDiagnosticsMax,
    },
    {
      artifactPathCharsMax: reader.artifactPathCharsMax,
      artifactBytesMax: reader.artifactBytesMax,
      manifestHandoffsMax: reader.manifestHandoffsMax,
      manifestDiagnosticsMax: reader.manifestDiagnosticsMax,
    },
  );
});

test("every manifest example is answered by the schema as it was built to be", () => {
  assert.deepEqual(
    builtMisjudged(contract.resultManifestDocumentSchema, manifestBuilt),
    [],
  );
});

test("the reader accepts no manifest the schema refuses", () => {
  const texts = [
    ...manifestBodiesFromReaderSuite(),
    ...manifestBuilt.map(([, value]) => JSON.stringify(value)),
  ].map(manifestLifted);
  assertParserAcceptsNothingSchemaRefuses(
    texts.map((text) => ({
      text,
      parser: accept(text).accepted === "Accepted",
      schema: schemaAccepts(contract.resultManifestDocumentSchema, text),
    })),
  );
});

/** A dispatch, a refusal and a lift as the reader's own suite writes them against its one-candidate view. */
const leadDispatch = { ticket: 41, expectedTicketVersion: 3 };
const leadRefusal = { ticket: 41, ticketVersion: 3, reason: "not yet" };
const leadLift = { ticket: 40 };
const leadWhole = decision({ dispatches: [leadDispatch] });

function leadMany(count: number, member: unknown): unknown[] {
  return Array.from({ length: count }, () => member);
}

function leadRefusalWithReason(reason: string): string {
  return decision({ refusals: [{ ...leadRefusal, reason }] });
}

/** The bodies the reader's own suite reads, each against the view it reads it under. */
const leadBodiesFromReaderSuite: readonly (readonly [
  string,
  SelectorObservation,
])[] = [
  [
    decision({
      dispatches: [leadDispatch],
      refusals: [{ ticket: 40, ticketVersion: 2, reason: "not yet" }],
      lifts: [{ ticket: 39 }],
      attention: "Attention",
    }),
    parcelledObservation,
  ],
  [decision({}), observation],
  [leadWhole, observation],
  [leadWhole.slice(0, leadWhole.length - 8), observation],
  [
    JSON.stringify({ version: 2, attention: "Monitoring", handoffNote: {} }),
    observation,
  ],
  [
    decision({ handoffNote: { padding: "x".repeat(leadDecisionBytesMax) } }),
    observation,
  ],
  [decision({ dispatches: [{ ...leadDispatch, ticket: 99 }] }), observation],
  [
    decision({ dispatches: [{ ...leadDispatch, expectedTicketVersion: 2 }] }),
    observation,
  ],
  [decision({ refusals: [{ ...leadRefusal, ticketVersion: 9 }] }), observation],
  [
    decision({ dispatches: leadMany(leadDispatchesMax + 1, leadDispatch) }),
    observation,
  ],
  [
    decision({
      refusals: leadMany(leadRefusalsPerDecisionMax + 1, leadRefusal),
    }),
    observation,
  ],
  [
    decision({ lifts: leadMany(leadRefusalsPerDecisionMax + 1, leadLift) }),
    observation,
  ],
  [leadRefusalWithReason(""), observation],
  [
    leadRefusalWithReason("x".repeat(agenticRefusalReasonCharsMax + 1)),
    observation,
  ],
  [
    leadRefusalWithReason("😀".repeat(agenticRefusalReasonCharsMax)),
    observation,
  ],
  [
    leadRefusalWithReason("😀".repeat(agenticRefusalReasonCharsMax + 1)),
    observation,
  ],
  [decision({ refusals: [leadRefusal, leadRefusal] }), observation],
  [decision({ lifts: [leadLift, leadLift] }), observation],
  [
    decision({
      refusals: [{ ...leadRefusal, ticket: 40, ticketVersion: 2 }],
      lifts: [leadLift],
    }),
    parcelledObservation,
  ],
  [
    decision({ dispatches: [leadDispatch], refusals: [leadRefusal] }),
    observation,
  ],
  [decision({ dispatches: [leadDispatch, leadDispatch] }), observation],
  [
    decision({
      dispatches: [leadDispatch, { ticket: 40, expectedTicketVersion: 2 }],
    }),
    parcelledObservation,
  ],
  [decision({ dispatches: [{ ticket: 41 }] }), observation],
  [decision({ lifts: [{ ticket: 39 }] }), observation],
  [decisionLiftingBareTicket, observation],
  [JSON.stringify({ version: 1, attention: "Monitoring" }), observation],
  [JSON.stringify({ version: 1, handoffNote: {} }), observation],
];

/** Enough tickets that every choice list can reach its bound and pass it, none of them named twice. */
const leadTicketsOffered = leadDispatchesMax + leadRefusalsPerDecisionMax + 1;

/** The first ticket the built refusals name, past every one the dispatches can. */
const leadRefusedFirst = leadDispatchesMax + 1;

/** The first ticket the built lifts name, which stands refused and is no candidate. */
const leadStandingFirst = leadTicketsOffered + 1;

/** A view holding a candidate for every dispatch and refusal, and a standing refusal for every lift. */
const leadWideObservation: SelectorObservation = {
  ...observation,
  candidates: Array.from({ length: leadTicketsOffered }, (_, at) => ({
    ...candidate,
    ticket: asTicketId(at + 1),
  })),
  refusals: Array.from({ length: leadRefusalsPerDecisionMax + 1 }, (_, at) => ({
    ...standingRefusal,
    ticket: asTicketId(leadStandingFirst + at),
  })),
};

function leadDispatchOf(ticket: number): Readonly<Record<string, unknown>> {
  return { ticket, expectedTicketVersion: candidate.ticketVersion };
}

function leadRefusalOf(
  ticket: number,
  reason = "not yet",
): Readonly<Record<string, unknown>> {
  return { ticket, ticketVersion: candidate.ticketVersion, reason };
}

/** The tickets from `first` on, `count` of them. */
function leadTickets(first: number, count: number): number[] {
  return Array.from({ length: count }, (_, at) => first + at);
}

/** What the harness writes for a turn that chose nothing, which every decision example varies one thing of. */
const leadWritten: Readonly<Record<string, unknown>> = {
  version: contract.leadTurnDocumentVersion,
  dispatches: [],
  refusals: [],
  lifts: [],
  attention: "Monitoring",
  handoffNote: { watching: "41" },
};

function leadWith(
  changes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return { ...leadWritten, ...changes };
}

function leadWithout(key: string): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(leadWritten).filter(([found]) => found !== key),
  );
}

/** Examples of the decision's own keys. */
const leadBuiltEnvelope: readonly Built[] = [
  ["as the harness writes it", leadWritten, true],
  ["no dispatches", leadWithout("dispatches"), true],
  ...selectorAttentions.map((attention): Built => [
    attention,
    leadWith({ attention }),
    true,
  ]),
  ["an unknown attention", leadWith({ attention: "Idle" }), false],
  ["no attention", leadWithout("attention"), false],
  [
    "the next version",
    leadWith({ version: contract.leadTurnDocumentVersion + 1 }),
    false,
  ],
  ["no version", leadWithout("version"), false],
  ["no handoff note", leadWithout("handoffNote"), false],
  ["a null handoff note", leadWith({ handoffNote: null }), true],
  ["a planning intent", leadWith({ planningIntent: { next: "41" } }), true],
  ["a null planning intent", leadWith({ planningIntent: null }), true],
  ["an unknown key", leadWith({ extra: 1 }), true],
  ["null dispatches", leadWith({ dispatches: null }), false],
  ["dispatches that are not a list", leadWith({ dispatches: {} }), false],
];

/** Examples of each choice list at and past its bound. */
const leadBuiltLists: readonly Built[] = [
  ...builtAtBound("dispatches", leadDispatchesMax, (count) =>
    leadWith({ dispatches: leadTickets(1, count).map(leadDispatchOf) }),
  ),
  ...builtAtBound("refusals", leadRefusalsPerDecisionMax, (count) =>
    leadWith({
      refusals: leadTickets(leadRefusedFirst, count).map((ticket) =>
        leadRefusalOf(ticket),
      ),
    }),
  ),
  ...builtAtBound("lifts", leadRefusalsPerDecisionMax, (count) =>
    leadWith({
      lifts: leadTickets(leadStandingFirst, count).map((ticket) => ({
        ticket,
      })),
    }),
  ),
];

/** Examples of one choice's own fields. */
const leadBuiltChoices: readonly Built[] = [
  ...builtAtBound("a reason", agenticRefusalReasonCharsMax, (chars) =>
    leadWith({
      refusals: [leadRefusalOf(leadRefusedFirst, "😀".repeat(chars))],
    }),
  ),
  [
    "an empty reason",
    leadWith({ refusals: [leadRefusalOf(leadRefusedFirst, "")] }),
    false,
  ],
  [
    "a reason that is a number",
    leadWith({ refusals: [{ ...leadRefusalOf(leadRefusedFirst), reason: 1 }] }),
    false,
  ],
  [
    "a refusal with no version",
    leadWith({ refusals: [{ ticket: leadRefusedFirst, reason: "not yet" }] }),
    false,
  ],
  [
    "a dispatch with no version",
    leadWith({ dispatches: [{ ticket: 1 }] }),
    false,
  ],
  [
    "a dispatch with an unknown key",
    leadWith({ dispatches: [{ ...leadDispatchOf(1), note: "x" }] }),
    true,
  ],
  [
    "a negative version",
    leadWith({ dispatches: [{ ticket: 1, expectedTicketVersion: -1 }] }),
    false,
  ],
  ["ticket zero", leadWith({ dispatches: [leadDispatchOf(0)] }), false],
  [
    "a fractional ticket",
    leadWith({ dispatches: [leadDispatchOf(1.5)] }),
    false,
  ],
  [
    "a ticket past the safe integers",
    leadWith({ dispatches: [leadDispatchOf(Number.MAX_SAFE_INTEGER + 1)] }),
    false,
  ],
  [
    "a ticket as text",
    leadWith({ lifts: [{ ticket: String(leadStandingFirst) }] }),
    false,
  ],
];

const leadBuilt: readonly Built[] = [
  ...leadBuiltEnvelope,
  ...leadBuiltLists,
  ...leadBuiltChoices,
];

/** Whether the reader accepts the decision against the view, which it answers by returning rather than raising. */
function leadParserAccepts(text: string, view: SelectorObservation): boolean {
  try {
    parseLeadDecision(text, view);
    return true;
  } catch {
    return false;
  }
}

test("every decision example is answered by the schema as it was built to be", () => {
  assert.deepEqual(
    builtMisjudged(contract.leadDecisionDocumentSchema, leadBuilt),
    [],
  );
});

test("the reader accepts no decision the schema refuses", () => {
  const bodies = [
    ...leadBodiesFromReaderSuite,
    ...leadBuilt.map(
      ([, value]) => [JSON.stringify(value), leadWideObservation] as const,
    ),
  ];
  assertParserAcceptsNothingSchemaRefuses(
    bodies.map(([text, view]) => ({
      text,
      parser: leadParserAccepts(text, view),
      schema: schemaAccepts(contract.leadDecisionDocumentSchema, text),
    })),
  );
});
