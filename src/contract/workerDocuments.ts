/** The versions and bounds of the documents a worker writes for the plane to read. */

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
