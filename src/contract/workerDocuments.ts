/**
 * The documents a worker and the plane hand each other: the version each is
 * written at, the ways the plane refuses a manifest and its artifacts, and the
 * shapes of the two a worker writes. The rosters and the shapes restate the
 * interpreter, which stays the authority: `test/contract/rosters.test.ts` pins
 * the rosters, and `test/contract/workerDocuments.test.ts` holds each parser,
 * at the version a worker writes, to accepting nothing its shape refuses.
 */

import { z } from "zod";

import {
  agenticRefusalReasonCharsMax,
  artifactDigestChars,
  leadDispatchesMax,
  resultReportCharsMax,
} from "./http.ts";
import { resultVerdicts, selectorAttentions } from "./rosters.ts";
import { leadRefusalsPerDecisionMax } from "./sessionTools.ts";

/** The result manifest schema version workers author now. */
export const resultManifestSchemaVersion = 3;

/** Every result manifest schema version the plane reads, retained manifests carrying the older ones. */
export const resultManifestSchemaVersionsAccepted = [
  1,
  2,
  resultManifestSchemaVersion,
] as const;
export type ResultManifestSchemaVersion =
  (typeof resultManifestSchemaVersionsAccepted)[number];

/** The longest manifest text the plane parses, checked before parsing rather than after. */
export const resultManifestTextCharsMax = 131_072;

/** The one lead turn document version the plane writes and the only one it accepts. */
export const leadTurnDocumentVersion = 1;

/** Every way the plane refuses one result manifest, restating the interpreter's roster. */
export const resultManifestRejections = [
  "PathNotWellFormed",
  "PathEmpty",
  "PathTooLong",
  "PathNotNormalForm",
  "PathHasControlCharacter",
  "PathHasBackslash",
  "PathAbsolute",
  "PathEmptySegment",
  "PathDotSegment",
  "PathTooDeep",
  "PathSegmentTooLong",
  "PathHasEdgeWhitespace",
  "TextTooLong",
  "TextUnreadable",
  "UnexpectedField",
  "MissingField",
  "UnsupportedSchemaVersion",
  "UnknownVerdict",
  "ReportMalformed",
  "TooManyHandoffs",
  "TooManyDiagnostics",
  "HandoffsOnFailedVerdict",
  "SourceMalformed",
  "SourceOnFailedVerdict",
  "SourceAndHandoffs",
  "ArtifactBytesNotCounted",
  "ArtifactTooLarge",
  "ManifestTooLarge",
  "ArtifactDigestMalformed",
  "DuplicatePath",
] as const;

/** Every way one declared artifact fails to be confirmed, restating the interpreter's roster. */
export const artifactFailures = [
  "Missing",
  "NotDurable",
  "DigestMismatch",
  "ByteCountMismatch",
  "ForeignProject",
  "Mutable",
] as const;

/**
 * Copies of the manifest reader's bounds, which limit what storage holds rather
 * than what the wire carries; `test/contract/workerDocuments.test.ts` pins each
 * to the reader's.
 */
export const artifactPathCharsMax = 256;
export const artifactBytesMax = 1_073_741_824;
export const manifestHandoffsMax = 64;
export const manifestDiagnosticsMax = 192;

const resultManifestArtifactSchema = z.strictObject({
  path: z.string().min(1).max(artifactPathCharsMax),
  digest: z
    .string()
    .regex(new RegExp(`^[0-9a-f]{${String(artifactDigestChars)}}$`, "u")),
  bytes: z.number().int().min(0).max(artifactBytesMax),
});

const resultManifestSourceSchema = z.strictObject({
  repository: z.string(),
  ref: z.string(),
  commit: z.string(),
  base: z.string(),
});

/** The result manifest a worker reports, at the version it writes; `source` is left out or null where there is none. */
export const resultManifestDocumentSchema = z.strictObject({
  version: z.literal(resultManifestSchemaVersion),
  verdict: z.enum(resultVerdicts),
  report: z.string().min(1).max(resultReportCharsMax),
  handoffs: z.array(resultManifestArtifactSchema).max(manifestHandoffsMax),
  source: resultManifestSourceSchema.nullable().optional(),
  diagnostics: z
    .array(resultManifestArtifactSchema)
    .max(manifestDiagnosticsMax),
});

const leadDecisionTicketSchema = z.number().int().min(1);
const leadDecisionTicketVersionSchema = z.number().int().min(0);

/**
 * The decision a lead turn answers with. Its choice lists may be left out, and
 * a key the reader does not name is ignored rather than refused, because the
 * reader does both.
 */
export const leadDecisionDocumentSchema = z.object({
  version: z.literal(leadTurnDocumentVersion),
  dispatches: z
    .array(
      z.object({
        ticket: leadDecisionTicketSchema,
        expectedTicketVersion: leadDecisionTicketVersionSchema,
      }),
    )
    .max(leadDispatchesMax)
    .optional(),
  refusals: z
    .array(
      z.object({
        ticket: leadDecisionTicketSchema,
        ticketVersion: leadDecisionTicketVersionSchema,
        reason: z.string().min(1).max(agenticRefusalReasonCharsMax),
      }),
    )
    .max(leadRefusalsPerDecisionMax)
    .optional(),
  lifts: z
    .array(z.object({ ticket: leadDecisionTicketSchema }))
    .max(leadRefusalsPerDecisionMax)
    .optional(),
  attention: z.enum(selectorAttentions),
  handoffNote: z.unknown(),
  planningIntent: z.unknown().optional(),
});
