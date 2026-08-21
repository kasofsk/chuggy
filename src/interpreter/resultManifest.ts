/**
 * The result manifest: the strict versioned thing an untrusted worker reports,
 * what makes one acceptable, and the canonical bytes its digest is taken over.
 *
 * IT VALIDATES AND NEVER REPAIRS. A normalizer that rewrote a path would
 * produce a path that no longer names the object the worker actually stored,
 * so verification would then check a key nobody wrote. Every deviation is
 * therefore a refusal — including a spelling that is merely not in normal
 * form — and `docs/design/006-durable-project-dispatch.md`'s normalized paths
 * are paths that arrived normalized rather than paths that were made so.
 *
 * AN UNSEALED MANIFEST IS NOT REPRESENTABLE. `ResultManifest` carries a brand
 * only `acceptResultManifest` can produce, and the scheduler's terminal
 * transaction takes that type — so a result that skipped validation cannot be
 * offered to it, and the fail-closed rule is the compiler's rather than a
 * convention.
 *
 * HANDOFFS AND DIAGNOSTICS ARE TWO FIELDS RATHER THAN A ROLE COLUMN. 006 gives
 * them different authority — only a handoff is authoritative passed-task output
 * and may enter a downstream input bundle — and different retention. A shape
 * where a caller filters by role is a shape where a caller forgets to.
 *
 * THE DIGEST IS COMPUTED HERE AND NEVER CLAIMED BY THE WORKER. It is the value
 * the journal pins, and the untrusted plane has no business naming it; it is
 * also defined over the normalized, sorted manifest, so a worker claiming one
 * would have to reimplement this encoding in every runtime it runs in. The hash
 * itself arrives as an argument because `eslint.config.js` lets this layer name
 * no ambient capability, which is the same reason `ProjectStore` is handed a
 * recovery epoch rather than minting one.
 *
 * THE COUNTS ARE IN THE CANONICAL BYTES ON PURPOSE. Length-prefixing the parts
 * separates one field from the next but not one list from the next, so without
 * them a manifest handing off one artifact and a manifest handing off two would
 * share a digest. The binding is in them for the reason a journal chain has a
 * genesis: a manifest whose digest covered only its rows would verify just as
 * well grafted under another project's execution.
 *
 * WHAT IT DELIBERATELY DOES NOT REFUSE is a path that is merely unusual — a
 * glob metacharacter, a leading dot. Neither has a failure in this tree yet:
 * nothing here materializes a handoff into a workspace or hands one to a shell.
 * The escape guarantee does not rest on them either, so the slice that builds a
 * materializer is the one that earns the rule.
 */

import type { Verdict } from "../domain/generated/modelTypes.ts";
import type { Partition } from "./projectStore.ts";
import type { AttemptId, ExecutionId } from "./schedulerIdentity.ts";
import { asSchedulerText } from "./schedulerIdentity.ts";

declare const resultManifestIdBrand: unique symbol;
declare const artifactPathBrand: unique symbol;
declare const artifactDigestBrand: unique symbol;
declare const canonicalManifestBrand: unique symbol;

/** An immutable result manifest's identity: minted by the scheduler, opaque, never reused. */
export type ResultManifestId = string & {
  readonly [resultManifestIdBrand]: true;
};

/** One artifact's normalized path inside its attempt-scoped namespace. */
export type ArtifactPath = string & { readonly [artifactPathBrand]: true };

/** One artifact's content digest, lower-case hex of fixed width. */
export type ArtifactDigest = string & { readonly [artifactDigestBrand]: true };

/** The bytes a manifest digest is taken over, producible only by this module. */
export type CanonicalManifest = string & {
  readonly [canonicalManifestBrand]: true;
};

/** The schema version this module reads, and the only one it accepts. */
export const resultManifestSchemaVersion = 1;

/** The longest artifact path a stored row carries, which an object key must still hold. */
export const artifactPathCharsMax = 256;

/** The longest single path segment, which a materialized filename must still hold. */
export const artifactPathSegmentCharsMax = 64;

/** The deepest a path may nest, which also bounds the loop that walks it. */
export const artifactPathSegmentsMax = 16;

/** The width of an artifact digest in lower-case hex characters. */
export const artifactDigestChars = 64;

/** The most declared handoffs one manifest may carry. */
export const manifestHandoffsMax = 64;

/** The most attempt diagnostics one manifest may carry. */
export const manifestDiagnosticsMax = 192;

/** The most artifacts of any role one manifest may carry, derived rather than restated. */
export const manifestArtifactsMax =
  manifestHandoffsMax + manifestDiagnosticsMax;

/** The largest single artifact, past which an object is a dataset with its own transfer story. */
export const artifactBytesMax = 1_073_741_824;

/** The largest total one manifest may declare, which is what bounds project storage growth. */
export const manifestBytesMax = 5_368_709_120;

/** The longest report text this module will parse, checked before parsing rather than after. */
export const resultManifestTextCharsMax = 131_072;

/**
 * How much of a manifest digest the model-grain fold reads. Thirteen hexadecimal
 * characters are fifty-two bits, which stays inside the integers a journal
 * command admits and never turns negative the way a full-width cast would.
 */
export const resultDigestFoldHexChars = 13;

/**
 * The model's result reference is three opaque positive integers, so the
 * authoritative digest is folded to one. It is deliberately not injective: the
 * authority is the manifest identity and full digest on the execution row, and
 * the project-local ordinal beside this value is already unique per project.
 */
export function resultDigestFold(digest: ArtifactDigest): number {
  return Number.parseInt(digest.slice(0, resultDigestFoldHexChars), 16) + 1;
}

/** The first code point a path may carry, below which every value is a control character. */
const artifactPathFirstPrintable = 0x20;

/** The first code point of the delete and C1 block, which survives encoding and renders as nothing. */
const artifactPathFirstUpperControl = 0x7f;

/** The last code point of that block. */
const artifactPathLastUpperControl = 0x9f;

/** Which of a manifest's two lists an artifact was declared in. */
export type ArtifactRole = "Handoff" | "Diagnostic";

/** Every artifact role, so a suite and a database CHECK iterate rather than restate. */
export const allArtifactRoles: readonly ArtifactRole[] = [
  "Handoff",
  "Diagnostic",
];

/** One declared artifact: where it is, what it hashes to, and how large it is. */
export interface ArtifactRow {
  readonly path: ArtifactPath;
  readonly digest: ArtifactDigest;
  readonly bytes: number;
}

/** The attempt a manifest belongs to, which its digest covers so a grafted one disagrees. */
export interface ManifestAttemptBinding {
  readonly partition: Partition;
  readonly execution: ExecutionId;
  readonly attempt: AttemptId;
}

/**
 * The seal a sealed manifest carries. It is not exported, so no other module
 * can produce a value of its type and therefore none can build a manifest.
 */
const manifestSeal = Symbol("chuggy:result-manifest");

/** One accepted immutable result, sealed so nothing outside this module can claim to be one. */
export interface ResultManifest {
  readonly seal: typeof manifestSeal;
  readonly schemaVersion: typeof resultManifestSchemaVersion;
  readonly manifest: ResultManifestId;
  readonly binding: ManifestAttemptBinding;
  readonly verdict: Verdict;
  readonly handoffs: readonly ArtifactRow[];
  readonly diagnostics: readonly ArtifactRow[];
  readonly digest: ArtifactDigest;
}

/** Every way one path is refused, which is also the ordering the checker applies. */
export type ArtifactPathRejection =
  | "PathNotWellFormed"
  | "PathEmpty"
  | "PathTooLong"
  | "PathNotNormalForm"
  | "PathHasControlCharacter"
  | "PathHasBackslash"
  | "PathAbsolute"
  | "PathEmptySegment"
  | "PathDotSegment"
  | "PathTooDeep"
  | "PathSegmentTooLong"
  | "PathHasEdgeWhitespace";

/** Every path rejection, in the order the checker applies them. */
export const allArtifactPathRejections: readonly ArtifactPathRejection[] = [
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
];

/** Every way one manifest is refused, closed so a caller can branch on it. */
export type ManifestRejection =
  | ArtifactPathRejection
  | "TextTooLong"
  | "TextUnreadable"
  | "UnexpectedField"
  | "MissingField"
  | "UnsupportedSchemaVersion"
  | "UnknownVerdict"
  | "TooManyHandoffs"
  | "TooManyDiagnostics"
  | "HandoffsOnFailedVerdict"
  | "ArtifactBytesNotCounted"
  | "ArtifactTooLarge"
  | "ManifestTooLarge"
  | "ArtifactDigestMalformed"
  | "DuplicatePath";

/** Every manifest rejection, so a suite iterates rather than restates. */
export const allManifestRejections: readonly ManifestRejection[] = [
  ...allArtifactPathRejections,
  "TextTooLong",
  "TextUnreadable",
  "UnexpectedField",
  "MissingField",
  "UnsupportedSchemaVersion",
  "UnknownVerdict",
  "TooManyHandoffs",
  "TooManyDiagnostics",
  "HandoffsOnFailedVerdict",
  "ArtifactBytesNotCounted",
  "ArtifactTooLarge",
  "ManifestTooLarge",
  "ArtifactDigestMalformed",
  "DuplicatePath",
];

/** Which row a refusal was reached at, carrying no path and nothing correlatable. */
export interface ArtifactSite {
  readonly role: ArtifactRole;
  readonly index: number;
}

/** What accepting a reported manifest found, which fails closed in every arm but one. */
export type ManifestAccepted =
  | { readonly accepted: "Accepted"; readonly manifest: ResultManifest }
  | {
      readonly accepted: "Rejected";
      readonly code: ManifestRejection;
      readonly at?: ArtifactSite;
    };

/** The hash this module is handed, because its own layer may name no ambient capability. */
export type ManifestDigestFunction = (canonical: CanonicalManifest) => string;

/** Brands an opaque manifest identity, which the scheduler mints and no worker names. */
export function asResultManifestId(value: string): ResultManifestId {
  return asSchedulerText(value, "result manifest id") as ResultManifestId;
}

/** Whether the value is a digest at all, which is the one shape a stored column holds. */
function artifactDigestMalformed(value: string): boolean {
  return !new RegExp(`^[0-9a-f]{${String(artifactDigestChars)}}$`, "u").test(
    value,
  );
}

/** Brands an artifact digest, refusing anything that is not lower-case hex of fixed width. */
export function asArtifactDigest(value: string): ArtifactDigest {
  if (artifactDigestMalformed(value)) {
    throw new RangeError(
      `artifact digest: a digest is ${String(artifactDigestChars)} lower-case hexadecimal characters`,
    );
  }
  return value as ArtifactDigest;
}

/** Whether any code point is one a key truncates at or a reader cannot see. */
function artifactPathControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? artifactPathFirstPrintable;
    return (
      code < artifactPathFirstPrintable ||
      (code >= artifactPathFirstUpperControl &&
        code <= artifactPathLastUpperControl)
    );
  });
}

/** Whether any segment carries whitespace at either edge, which is invisible and duplicating. */
function artifactPathEdgeWhitespace(segments: readonly string[]): boolean {
  return segments.some((segment) => /^\s|\s$/u.test(segment));
}

/**
 * Why this path is refused, or nothing when it is not. The order is the
 * algorithm: each step is safe only because the ones above it already ran.
 */
export function artifactPathRejection(
  value: string,
): ArtifactPathRejection | undefined {
  if (!value.isWellFormed()) return "PathNotWellFormed";
  if (value.length === 0) return "PathEmpty";
  if (value.length > artifactPathCharsMax) return "PathTooLong";
  if (value.normalize("NFC") !== value) return "PathNotNormalForm";
  if (artifactPathControlCharacter(value)) return "PathHasControlCharacter";
  if (value.includes("\\")) return "PathHasBackslash";
  if (value.startsWith("/")) return "PathAbsolute";
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0))
    return "PathEmptySegment";
  if (segments.some((segment) => segment === "." || segment === ".."))
    return "PathDotSegment";
  if (segments.length > artifactPathSegmentsMax) return "PathTooDeep";
  if (segments.some((segment) => segment.length > artifactPathSegmentCharsMax))
    return "PathSegmentTooLong";
  if (artifactPathEdgeWhitespace(segments)) return "PathHasEdgeWhitespace";
  return undefined;
}

/** Brands an artifact path, refusing as a programmer error what a report is refused for. */
export function asArtifactPath(value: string): ArtifactPath {
  const rejection = artifactPathRejection(value);
  if (rejection !== undefined) {
    throw new RangeError(`artifact path: ${rejection}`);
  }
  return value as ArtifactPath;
}

/** The label that separates this construction from any other digest this tree computes. */
const resultManifestFormat = "chuggy:result-manifest:v1";

/** Length-prefixes each part, so no opaque value can spell out a boundary. */
function resultManifestInput(parts: readonly string[]): string {
  return parts.map((part) => `${String(part.length)}:${part}`).join("");
}

/** One list's parts, its count first so two lists cannot borrow each other's rows. */
function resultManifestRowParts(rows: readonly ArtifactRow[]): string[] {
  return [
    String(rows.length),
    ...rows.flatMap((row) => [row.path, row.digest, String(row.bytes)]),
  ];
}

/** The exact bytes one manifest's digest is taken over, re-derivable by an auditor. */
export function canonicalResultManifest(
  manifest: ResultManifest,
): CanonicalManifest {
  return resultManifestInput([
    resultManifestFormat,
    manifest.binding.partition.tenant,
    manifest.binding.partition.project,
    manifest.binding.execution,
    manifest.binding.attempt,
    manifest.manifest,
    String(manifest.schemaVersion),
    manifest.verdict,
    ...resultManifestRowParts(manifest.handoffs),
    ...resultManifestRowParts(manifest.diagnostics),
  ]) as CanonicalManifest;
}

/** Whether two manifests are the same authoritative result, which the digest settles. */
export function manifestsAgree(
  stored: ResultManifest,
  offered: ResultManifest,
): boolean {
  return (
    stored.binding.partition.tenant === offered.binding.partition.tenant &&
    stored.binding.partition.project === offered.binding.partition.project &&
    stored.binding.execution === offered.binding.execution &&
    stored.binding.attempt === offered.binding.attempt &&
    stored.manifest === offered.manifest &&
    stored.digest === offered.digest
  );
}

/** Rows in ascending code-unit path order, which makes the digest a function of the set. */
function manifestSortedRows(rows: readonly ArtifactRow[]): ArtifactRow[] {
  return [...rows].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

/** A refusal, with the row it was reached at when there is one. */
function manifestRejected(
  code: ManifestRejection,
  at?: ArtifactSite,
): ManifestAccepted {
  return at === undefined
    ? { accepted: "Rejected", code }
    : { accepted: "Rejected", code, at };
}

/** Whether the value is a plain object this module may read fields from. */
function manifestRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Whether the record carries exactly these keys, since an ignored field is an accepted one. */
function manifestKeysAre(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const found = Object.keys(record);
  return (
    found.length === keys.length && found.every((key) => keys.includes(key))
  );
}

/** One artifact row, or the code and site its refusal is reported at. */
function manifestArtifactRow(
  value: unknown,
  role: ArtifactRole,
  index: number,
): ArtifactRow | ManifestAccepted {
  const at: ArtifactSite = { role, index };
  const record = manifestRecord(value);
  if (record === undefined) return manifestRejected("MissingField", at);
  if (!manifestKeysAre(record, ["path", "digest", "bytes"]))
    return manifestRejected("UnexpectedField", at);
  const path = record["path"];
  const digest = record["digest"];
  const bytes = record["bytes"];
  if (typeof path !== "string" || typeof digest !== "string")
    return manifestRejected("MissingField", at);
  const rejection = artifactPathRejection(path);
  if (rejection !== undefined) return manifestRejected(rejection, at);
  if (artifactDigestMalformed(digest))
    return manifestRejected("ArtifactDigestMalformed", at);
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0)
    return manifestRejected("ArtifactBytesNotCounted", at);
  if (bytes > artifactBytesMax) return manifestRejected("ArtifactTooLarge", at);
  return {
    path: path as ArtifactPath,
    digest: digest as ArtifactDigest,
    bytes,
  };
}

/** Every row of one list, or the first refusal reading them reached. */
function manifestArtifactRows(
  value: unknown,
  role: ArtifactRole,
  rowsMax: number,
  tooMany: ManifestRejection,
): readonly ArtifactRow[] | ManifestAccepted {
  if (!Array.isArray(value)) return manifestRejected("MissingField");
  if (value.length > rowsMax) return manifestRejected(tooMany);
  const rows: ArtifactRow[] = [];
  for (const [index, row] of value.entries()) {
    const read = manifestArtifactRow(row, role, index);
    if ("accepted" in read) return read;
    rows.push(read);
  }
  return rows;
}

/** Whether any path appears twice across both lists, case-folded because a filesystem folds. */
function manifestDuplicatePath(rows: readonly ArtifactRow[]): boolean {
  return (
    new Set(rows.map((row) => row.path.toLowerCase())).size !== rows.length
  );
}

/** The envelope a report must carry, or the refusal reading it earns. */
function manifestEnvelope(
  text: string,
): { readonly value: Record<string, unknown> } | ManifestAccepted {
  if (text.length > resultManifestTextCharsMax)
    return manifestRejected("TextTooLong");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return manifestRejected("TextUnreadable");
  }
  const record = manifestRecord(parsed);
  if (record === undefined) return manifestRejected("TextUnreadable");
  if (
    !manifestKeysAre(record, ["version", "verdict", "handoffs", "diagnostics"])
  )
    return manifestRejected("UnexpectedField");
  if (record["version"] !== resultManifestSchemaVersion)
    return manifestRejected("UnsupportedSchemaVersion");
  if (record["verdict"] !== "Pass" && record["verdict"] !== "Fail")
    return manifestRejected("UnknownVerdict");
  return { value: record };
}

/** The two lists a report declares, sorted, or the refusal reading them earns. */
function manifestLists(record: Record<string, unknown>):
  | {
      readonly handoffs: readonly ArtifactRow[];
      readonly diagnostics: readonly ArtifactRow[];
    }
  | ManifestAccepted {
  const handoffs = manifestArtifactRows(
    record["handoffs"],
    "Handoff",
    manifestHandoffsMax,
    "TooManyHandoffs",
  );
  if ("accepted" in handoffs) return handoffs;
  const diagnostics = manifestArtifactRows(
    record["diagnostics"],
    "Diagnostic",
    manifestDiagnosticsMax,
    "TooManyDiagnostics",
  );
  if ("accepted" in diagnostics) return diagnostics;
  if (record["verdict"] === "Fail" && handoffs.length > 0)
    return manifestRejected("HandoffsOnFailedVerdict");
  const every = [...handoffs, ...diagnostics];
  if (manifestDuplicatePath(every)) return manifestRejected("DuplicatePath");
  if (every.reduce((total, row) => total + row.bytes, 0) > manifestBytesMax)
    return manifestRejected("ManifestTooLarge");
  return {
    handoffs: manifestSortedRows(handoffs),
    diagnostics: manifestSortedRows(diagnostics),
  };
}

/**
 * Reads one untrusted report into a sealed manifest, or refuses it as a value.
 * Nothing here throws for anything the worker plane controls.
 */
export function acceptResultManifest(
  binding: ManifestAttemptBinding,
  manifest: ResultManifestId,
  text: string,
  digestOf: ManifestDigestFunction,
): ManifestAccepted {
  const envelope = manifestEnvelope(text);
  if ("accepted" in envelope) return envelope;
  const lists = manifestLists(envelope.value);
  if ("accepted" in lists) return lists;
  const unsealed: ResultManifest = {
    seal: manifestSeal,
    schemaVersion: resultManifestSchemaVersion,
    manifest,
    binding,
    verdict: envelope.value["verdict"] as Verdict,
    handoffs: lists.handoffs,
    diagnostics: lists.diagnostics,
    digest: "" as ArtifactDigest,
  };
  const digest = digestOf(canonicalResultManifest(unsealed));
  return {
    accepted: "Accepted",
    manifest: { ...unsealed, digest: asArtifactDigest(digest) },
  };
}

/** Why an artifact could not be confirmed, each remedy different from the others'. */
export type ArtifactFailure =
  | "Missing"
  | "NotDurable"
  | "DigestMismatch"
  | "ByteCountMismatch"
  | "ForeignProject"
  | "Mutable";

/** Every artifact failure, so a suite and a database CHECK iterate rather than restate. */
export const allArtifactFailures: readonly ArtifactFailure[] = [
  "Missing",
  "NotDurable",
  "DigestMismatch",
  "ByteCountMismatch",
  "ForeignProject",
  "Mutable",
];

/**
 * What verifying one manifest's artifacts found. `Unavailable` is its own arm
 * rather than a failure, because a storage outage is not evidence about an
 * artifact and folding it in would fabricate task failures during an incident.
 */
export type ArtifactsVerified =
  | { readonly verified: "Verified" }
  | {
      readonly verified: "Rejected";
      readonly failure: ArtifactFailure;
      readonly at: ArtifactSite;
    }
  | { readonly verified: "Unavailable"; readonly retryAfterSeconds: number };

/**
 * Project-owned immutable artifact storage, behind a typed port. It is handed a
 * sealed manifest so no unnormalized path and no foreign binding can reach it,
 * and it answers with metadata alone — artifacts stay opaque and are never read
 * or rendered here.
 */
export interface ArtifactVerificationPort {
  verifyManifest(manifest: ResultManifest): Promise<ArtifactsVerified>;
}
