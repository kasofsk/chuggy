/** The versions, bounds and refusals of the documents a worker writes for the plane to read. */

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
